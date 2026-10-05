import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, formatPesos, isBusinessDate, newId } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { activeCustomers, createGroup, createWearer, customerRef } from '../CUS/public.ts';
import {
  applyEmployeeFix, applyMeasurementAssignment, duplicateKeys, isManualMeasurement, manualName, measurementField, measurementFields, measurementTenths, nameKey,
  parseCSV, validateRow, type ManualData, type ParsedRow, type RowType,
} from './csv.ts';
import { fromSheetRow, sheetTabOf } from './sheet.ts';
import { commitUpload } from './commit.ts';

const auth = { config: { permission: 'mig.run' } };
const commitAuth = { config: { permission: 'mig.commit' } };
const uploadBody = z.object({ filename: z.string().min(1), csv: z.string().min(1) }).strict();
const rowParams = z.object({ id: z.string().min(1) }).strict();
const uploadParams = z.object({ uploadId: z.string().min(1) }).strict();
const moneyCents = z.number().int().nonnegative().safe();
const legacyId = z.string().trim().min(1);
const measureValue = z.string().refine(s => {
  try { measurementTenths(s); return true; } catch { return false; }
}, 'Measurement must be exact to tenths.');
const measureOverrides = Object.fromEntries(measurementFields.map(f => [f, measureValue.optional()])) as Record<typeof measurementFields[number], z.ZodOptional<typeof measureValue>>;
const manualSchemas = {
  customer: z.object({ customerName: z.string().trim().min(1).optional(), registeredName: z.string().trim().min(1).optional(), legacyId: legacyId.optional() }).strict(),
  measurement: z.object({
    customerLegacyId: legacyId.optional(), groupLegacyId: legacyId.optional(),
    // A customer already in Virtus, or a new person-customer; a group of that customer, or a new one; the wearer's name.
    customerId: z.uuid().optional(), newCustomer: z.literal(true).optional(), groupId: z.uuid().optional(),
    newGroupName: z.string().trim().min(1).max(200).optional(), wearerName: z.string().trim().min(1).max(200).optional(),
    ...measureOverrides,
  }).strict(),
  employee: z.object({
    employeeName: z.string().trim().min(1).optional(), legacyId: legacyId.optional(), rateCents: moneyCents.optional(),
    payType: z.enum(['daily', 'piece', 'monthly', 'mixed']).optional(),
    hireDate: z.string().trim().refine(isBusinessDate, 'Use a date like 2026-02-11.').optional(),
  }).strict(),
  piece_rate: z.object({ garmentType: z.string().trim().min(1).optional(), operation: z.string().trim().min(1).optional(), rateCents: moneyCents.optional() }).strict(),
};
const bulkAssignBody = z.object({
  rowIds: z.array(z.string().min(1)).min(1).max(500), mode: z.enum(['own', 'under']),
  customerId: z.uuid().optional(), groupId: z.uuid().optional(), newGroupName: z.string().trim().min(1).max(200).optional(),
}).strict();
const employeeFixesBody = z.object({
  fixes: z.array(z.object({
    rowId: z.string().min(1), rateCents: moneyCents.optional(), payType: z.enum(['daily', 'piece', 'monthly', 'mixed']).optional(),
  }).strict().refine(f => f.rateCents !== undefined || f.payType !== undefined, 'Type a rate or choose a pay type.')).min(1).max(500),
}).strict();
type MigRow = {
  id: string; upload_id: string; row_number: number; raw_json: string; row_type: RowType;
  status: string; issues_json: string; manual_data_json: string | null; legacy_id: string | null;
  rate_cents: number | null; merge_into_row_id: string | null; resolved_by: string | null; resolved_at: string | null;
};

function validation<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError('VALIDATION', 'Invalid input.', 422, result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  return result.data;
}
function invalid(message: string): never { throw new AppError('VALIDATION', message, 422); }
function getRow(db: Db, id: string): MigRow {
  const row = db.prepare('SELECT * FROM mig_rows WHERE id = ?').get(id) as MigRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Import row not found.', 404);
  return row;
}
function staged(db: Db, uploadId: string): void {
  const upload = db.prepare('SELECT status FROM mig_uploads WHERE id = ?').get(uploadId) as { status: string } | undefined;
  if (!upload) throw new AppError('NOT_FOUND', 'Upload not found.', 404);
  if (upload.status !== 'staged') throw new AppError('CONFLICT', 'Upload is no longer staged.', 409);
}
/** A row as the audit log keeps it: daily and piece rates named, not valued, since reading the log does not imply pay.view_rates (C6, N-05). */
function state(row: MigRow): Record<string, unknown> {
  const manual = row.manual_data_json ? JSON.parse(row.manual_data_json) as ManualData : null;
  return {
    // Rates and the names of people and groups are named, not valued: the audit log is not a place to read them.
    status: row.status, manualData: manual && Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, ['rateCents', 'wearerName', 'newGroupName'].includes(k) ? 'set' : v])),
    rate: row.rate_cents !== null, legacyId: row.legacy_id, mergeIntoRowId: row.merge_into_row_id,
    resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
  };
}
function auditRow(db: Db, userId: string, at: string, action: string, before: MigRow): void {
  appendAudit(db, { at, userId, action: `mig.row.${action}`, entityType: 'mig_rows', entityId: before.id,
    data: { before: state(before), after: state(getRow(db, before.id)) } });
}
function manualFor(row: MigRow): ManualData {
  return row.manual_data_json ? JSON.parse(row.manual_data_json) as ManualData : {};
}
function effective(row: MigRow, manual: ManualData = manualFor(row)): Record<string, string> {
  const raw = { ...JSON.parse(row.raw_json) as Record<string, string> };
  if (row.row_type === 'customer') {
    if (manual.customerName) raw.Customer_Name = String(manual.customerName);
    if (manual.registeredName) raw.Registered_Name = String(manual.registeredName);
    if (manual.legacyId) raw.Legacy_ID = String(manual.legacyId);
  } else if (row.row_type === 'measurement') {
    applyMeasurementAssignment(raw, manual);
    for (const field of measurementFields) {
      if (manual[field] === undefined) continue;
      const oldKey = Object.keys(raw).find(key => measurementField(key) === field);
      raw[oldKey ?? field] = String(manual[field]);
    }
  } else if (row.row_type === 'employee') {
    applyEmployeeFix(raw, manual);
  } else if (row.row_type === 'piece_rate') {
    if (manual.garmentType) raw.Garment_Type = String(manual.garmentType);
    if (manual.operation) raw.Operation = String(manual.operation);
    if (manual.rateCents !== undefined) raw.Rate = formatPesos(Number(manual.rateCents));
  }
  return raw;
}
function parseManual(row: MigRow, input: unknown): ManualData {
  const schema = manualSchemas[row.row_type as keyof typeof manualSchemas];
  if (!schema) invalid('Unknown row type cannot be fixed.');
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError('VALIDATION', 'Invalid manual data.', 422,
    result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  const parsed = result.data as ManualData;
  if (row.row_type === 'measurement') {
    // A customer assignment must resolve to a staged customer ID in this upload, or to a customer already in Virtus.
    // Group labels are retained for the future commit, under that customer.
    const customers = ['customerLegacyId', 'customerId', 'newCustomer'].filter(k => parsed[k]);
    if (customers.length > 1) invalid('Choose one customer for the measurements.');
    if ((parsed.groupLegacyId || parsed.groupId || parsed.newGroupName) && !parsed.customerLegacyId && !parsed.customerId) invalid('Choose a customer before assigning a group.');
    if (parsed.groupId && parsed.newGroupName) invalid('Choose an existing group or a new group, not both.');
    if (parsed.newCustomer && !parsed.wearerName) invalid('A new customer needs the name from the sheet.');
  }
  return parsed;
}
type By = { userId: string; at: string };
/** Runs a CUS create and takes it back, so the review asks CUS itself whether the group would be accepted. Returns the refusal in words, or null. */
function refusedByCus(db: Db, attempt: () => unknown): string | null {
  db.exec('SAVEPOINT mig_probe');
  try { attempt(); return null; }
  catch (cause) { return cause instanceof Error ? cause.message : String(cause); }
  finally { db.exec('ROLLBACK TO mig_probe'); db.exec('RELEASE mig_probe'); }
}
/** The customer and group a bulk choice names must be usable now: an active customer, and a group that customer can hold. */
function targetUsable(db: Db, manual: ManualData, by: By): void {
  if (!manual.customerId) return;
  const customer = customerRef(db, String(manual.customerId));
  if (!customer || customer.is_active !== 1 || customer.merged_into_id) invalid('That customer is not an active customer.');
  const who = { userId: by.userId, at: by.at, today: by.at.slice(0, 10) };
  const customerId = String(manual.customerId);
  const refusal = manual.groupId ? refusedByCus(db, () => createWearer(db, customerId, { fullName: 'Probe', groupId: String(manual.groupId) }, who))
    : manual.newGroupName ? refusedByCus(db, () => createGroup(db, customerId, { name: String(manual.newGroupName) }, who)) : null;
  if (refusal) invalid(refusal);
}
function assignmentValid(db: Db, row: MigRow, manual: ManualData, by: By): void {
  if (row.row_type !== 'measurement') return;
  const raw = JSON.parse(row.raw_json) as Record<string, string>;
  if (isManualMeasurement(raw) && !manual.customerLegacyId && !manual.customerId && !manual.newCustomer) invalid('Assign this MANUAL measurement to a staged customer.');
  if (manual.customerLegacyId) {
    const customer = db.prepare(`SELECT r.id FROM mig_rows r JOIN mig_uploads u ON u.id = r.upload_id
      WHERE r.row_type = 'customer' AND r.legacy_id = ? AND r.status NOT IN ('excluded', 'merged')
      AND u.status = 'staged' LIMIT 1`)
      .get(manual.customerLegacyId);
    if (!customer) invalid('Customer legacy ID is not an active staged customer in this upload.');
  }
  targetUsable(db, manual, by);
}
function activeDuplicates(db: Db, row: MigRow, parsed: ParsedRow): string[] {
  const keys = new Set(duplicateKeys(parsed));
  if (!keys.size) return [];
  const others = db.prepare(`SELECT * FROM mig_rows WHERE upload_id = ? AND id <> ? AND status NOT IN ('excluded', 'merged')`)
    .all(row.upload_id, row.id) as MigRow[];
  return others.filter(other => duplicateKeys(validateRow(effective(other))).some(key => keys.has(key))).map(other => other.id);
}
function validateDecision(db: Db, row: MigRow, manual: ManualData, by: By): ParsedRow {
  assignmentValid(db, row, manual, by);
  const parsed = validateRow(effective(row, manual));
  const blocking = parsed.issues.filter(issue => !issue.includes('requires owner confirmation') && !issue.includes('seed requires owner confirmation'));
  if (blocking.length) invalid(blocking.join(' '));
  if (activeDuplicates(db, row, parsed).length) invalid('Resolve duplicate rows by merging or excluding one before accepting.');
  return parsed;
}
function sumExact(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) invalid('Checksum exceeds exact integer range.');
  return result;
}
function hash(rows: Record<string, string>[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export function migRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  app.post('/api/mig/upload', auth, async req => {
    const user = currentUser(req);
    const body = validation(uploadBody, req.body);
    let csv: ReturnType<typeof parseCSV>;
    try { csv = parseCSV(body.csv); } catch { invalid('CSV is malformed.'); }
    if (!csv!.objects.length) throw new AppError('EMPTY_CSV', 'The uploaded CSV contains no data rows.', 400);
    const uploadId = newId();
    const at = stamp(clock);
    // A tab of the old sheet, downloaded as it is, is renamed to the importer's columns here; an importer file passes through.
    const tab = sheetTabOf(Object.keys(csv!.objects[0]!));
    const parsedRows = csv!.objects.map((raw, i) => ({ id: newId(), rowNumber: csv!.lineNumbers[i]!, parsed: validateRow(tab ? fromSheetRow(raw, tab) : raw) }));
    if (parsedRows.some(r => r.parsed.rowType === 'unknown')) invalid('The CSV file type is not recognised.');
    // Flag every member of each duplicate set and name the other source row in its issue.
    const byKey = new Map<string, typeof parsedRows>();
    for (const row of parsedRows) for (const key of duplicateKeys(row.parsed)) byKey.set(key, [...(byKey.get(key) ?? []), row]);
    for (const matches of byKey.values()) if (matches.length > 1) {
      for (const row of matches) for (const other of matches) if (row.id !== other.id) {
        const issue = `Possible duplicate of row ${other.rowNumber} (${other.id}).`;
        if (!row.parsed.issues.includes(issue)) row.parsed.issues.push(issue);
        row.parsed.status = 'needs_review';
      }
    }
    tx(db, () => {
      db.prepare(`INSERT INTO mig_uploads (id, filename, uploaded_at, uploaded_by, status) VALUES (?, ?, ?, ?, 'staged')`)
        .run(uploadId, body.filename, at, user.userId);
      const insert = db.prepare(`INSERT INTO mig_rows
        (id, upload_id, row_number, raw_json, row_type, status, issues_json, legacy_id, legacy_type, rate_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of parsedRows) {
        const p = row.parsed;
        insert.run(row.id, uploadId, row.rowNumber, JSON.stringify(p.raw), p.rowType, p.status,
          JSON.stringify(p.issues), p.legacyId, p.legacyId ? p.rowType : null, p.rateCents, at);
      }
      appendAudit(db, { at, userId: user.userId, action: 'mig.upload', entityType: 'mig_uploads', entityId: uploadId,
        data: { before: null, after: { status: 'staged', filename: body.filename, totalRows: parsedRows.length, needsReview: parsedRows.filter(r => r.parsed.status === 'needs_review').length } } });
    });
    return { uploadId, totalRows: parsedRows.length, needsReview: parsedRows.filter(r => r.parsed.status === 'needs_review').length };
  });

  app.get('/api/mig/uploads', auth, async () => ({ uploads: db.prepare(
    'SELECT id, filename, uploaded_at AS uploadedAt, uploaded_by AS uploadedBy, status FROM mig_uploads ORDER BY uploaded_at DESC, id DESC'
  ).all() }));

  app.get('/api/mig/uploads/:uploadId/review', auth, async req => {
    const { uploadId } = validation(uploadParams, req.params);
    staged(db, uploadId);
    const rows = db.prepare(`SELECT * FROM mig_rows WHERE upload_id = ? AND status IN ('needs_review', 'accepted', 'excluded', 'merged') ORDER BY row_number, id`)
      .all(uploadId) as MigRow[];
    return { rows: rows.map(r => ({ id: r.id, rowNumber: r.row_number, rowType: r.row_type, status: r.status,
      raw: JSON.parse(r.raw_json), issues: JSON.parse(r.issues_json), manualData: r.manual_data_json ? JSON.parse(r.manual_data_json) : null,
      legacyId: r.legacy_id, rateCents: r.rate_cents, mergeIntoRowId: r.merge_into_row_id })) };
  });

  app.post('/api/mig/rows/:id/accept', auth, async req => {
    const user = currentUser(req);
    const { id } = validation(rowParams, req.params);
    const at = stamp(clock);
    tx(db, () => {
      const before = getRow(db, id); staged(db, before.upload_id);
      if (before.status !== 'needs_review') throw new AppError('CONFLICT', 'Row is not awaiting review.', 409);
      const parsed = validateDecision(db, before, manualFor(before), { userId: user.userId, at });
      db.prepare(`UPDATE mig_rows SET status = 'accepted', rate_cents = ?, legacy_id = ?, legacy_type = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
        .run(parsed.rateCents, parsed.legacyId, parsed.legacyId ? parsed.rowType : null, user.userId, at, id);
      auditRow(db, user.userId, at, 'accept', before);
    });
    return { success: true };
  });

  app.post('/api/mig/rows/:id/fix', auth, async req => {
    const user = currentUser(req);
    const { id } = validation(rowParams, req.params);
    const body = validation(z.object({ manualData: z.unknown() }).strict(), req.body);
    const at = stamp(clock);
    tx(db, () => {
      const before = getRow(db, id); staged(db, before.upload_id);
      if (before.status !== 'needs_review') throw new AppError('CONFLICT', 'Row is not awaiting review.', 409);
      const manual = parseManual(before, body.manualData);
      const parsed = validateDecision(db, before, manual, { userId: user.userId, at });
      db.prepare(`UPDATE mig_rows SET status = 'accepted', manual_data_json = ?, rate_cents = ?, legacy_id = ?, legacy_type = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
        .run(JSON.stringify(manual), parsed.rateCents, parsed.legacyId, parsed.legacyId ? parsed.rowType : null, user.userId, at, id);
      auditRow(db, user.userId, at, 'fix', before);
    });
    return { success: true };
  });

  app.post('/api/mig/rows/:id/merge', auth, async req => {
    const user = currentUser(req);
    const { id } = validation(rowParams, req.params);
    const { mergeIntoRowId } = validation(z.object({ mergeIntoRowId: z.string().min(1) }).strict(), req.body);
    const at = stamp(clock);
    tx(db, () => {
      const before = getRow(db, id); staged(db, before.upload_id);
      const target = getRow(db, mergeIntoRowId);
      if (id === mergeIntoRowId || before.upload_id !== target.upload_id || before.row_type !== target.row_type ||
        !['needs_review', 'accepted'].includes(before.status) || ['excluded', 'merged'].includes(target.status)) {
        invalid('Choose a distinct active duplicate row in the same upload and type.');
      }
      const dependents = db.prepare(`SELECT count(*) AS count FROM mig_rows WHERE merge_into_row_id = ? AND status = 'merged'`).get(id) as { count: number };
      if (dependents.count) invalid('This row already survives a merge and cannot be merged again.');
      const keys = new Set(duplicateKeys(validateRow(effective(before))));
      if (!duplicateKeys(validateRow(effective(target))).some(key => keys.has(key))) invalid('Rows are not a detected duplicate pair.');
      db.prepare(`UPDATE mig_rows SET status = 'merged', merge_into_row_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
        .run(target.id, user.userId, at, id);
      auditRow(db, user.userId, at, 'merge', before);
    });
    return { success: true, mergeIntoRowId };
  });

  app.post('/api/mig/rows/:id/exclude', auth, async req => {
    const user = currentUser(req);
    const { id } = validation(rowParams, req.params);
    const at = stamp(clock);
    tx(db, () => {
      const before = getRow(db, id); staged(db, before.upload_id);
      if (!['needs_review', 'accepted', 'valid'].includes(before.status)) throw new AppError('CONFLICT', 'Row cannot be excluded in this state.', 409);
      const dependents = db.prepare(`SELECT count(*) AS count FROM mig_rows WHERE merge_into_row_id = ? AND status = 'merged'`).get(id) as { count: number };
      if (dependents.count) invalid('This row is the survivor of a merge. Choose another survivor first.');
      db.prepare(`UPDATE mig_rows SET status = 'excluded', resolved_by = ?, resolved_at = ? WHERE id = ?`)
        .run(user.userId, at, id);
      auditRow(db, user.userId, at, 'exclude', before);
    });
    return { success: true };
  });

  /**
   * The MANUAL size rows of the sheet, put in bulk: each its own customer (a person named as in the sheet), or all of them as wearers
   * of one customer, in one of its groups or a new group. A row that cannot take it is skipped and said so; the rest are saved.
   * The rows are accepted like a Fix does, so the dry run and the commit see them as before.
   */
  app.post('/api/mig/uploads/:uploadId/assign-sizes', auth, async req => {
    const user = currentUser(req);
    const { uploadId } = validation(uploadParams, req.params);
    const body = validation(bulkAssignBody, req.body);
    if (body.mode === 'own' && (body.customerId || body.groupId || body.newGroupName)) invalid('Making each row its own customer takes no customer or group.');
    if (body.mode === 'under' && !body.customerId) invalid('Choose the customer the wearers belong to.');
    if (body.groupId && body.newGroupName) invalid('Choose an existing group or a new group, not both.');
    const at = stamp(clock);
    const by = { userId: user.userId, at };
    return tx(db, () => {
      staged(db, uploadId);
      const target: ManualData = body.mode === 'own' ? { newCustomer: true }
        : { customerId: body.customerId!, ...(body.groupId ? { groupId: body.groupId } : {}), ...(body.newGroupName ? { newGroupName: body.newGroupName } : {}) };
      targetUsable(db, target, by); // a customer or group that cannot be used stops the whole request, not row by row
      const skipped: { rowId: string; rowNumber: number; reason: string }[] = [];
      let assigned = 0;
      for (const rowId of [...new Set(body.rowIds)]) {
        const before = getRow(db, rowId);
        const skip = (reason: string) => { skipped.push({ rowId, rowNumber: before.row_number, reason }); };
        if (before.upload_id !== uploadId) invalid('A row is not in this upload.');
        if (before.row_type !== 'measurement' || before.status !== 'needs_review') { skip('This row is not waiting for review as a measurement row.'); continue; }
        const raw = JSON.parse(before.raw_json) as Record<string, string>;
        if (!isManualMeasurement(raw)) { skip('This row already names its customer.'); continue; }
        const name = manualName(raw);
        if (!name) { skip('This row has no name to use for the customer or wearer.'); continue; }
        const manual: ManualData = { ...target, wearerName: name };
        try {
          const parsed = validateDecision(db, before, manual, by);
          db.prepare(`UPDATE mig_rows SET status = 'accepted', manual_data_json = ?, rate_cents = ?, legacy_id = ?, legacy_type = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
            .run(JSON.stringify(manual), parsed.rateCents, parsed.legacyId, parsed.legacyId ? parsed.rowType : null, user.userId, at, rowId);
          auditRow(db, user.userId, at, 'assign', before);
          assigned++;
        } catch (cause) {
          if (!(cause instanceof AppError)) throw cause;
          skip(cause.message);
        }
      }
      return { success: true, assigned, skipped };
    });
  });

  /** For each MANUAL size row waiting for review: the one customer whose name is the same, ignoring case, spaces and punctuation. Two or none: no suggestion. */
  app.get('/api/mig/uploads/:uploadId/size-suggestions', auth, async req => {
    const { uploadId } = validation(uploadParams, req.params);
    staged(db, uploadId);
    const byName = new Map<string, { id: string; name: string }[]>();
    for (const customer of activeCustomers(db)) {
      const key = nameKey(customer.name);
      if (key) byName.set(key, [...(byName.get(key) ?? []), customer]);
    }
    const rows = db.prepare(`SELECT * FROM mig_rows WHERE upload_id = ? AND row_type = 'measurement' AND status = 'needs_review' ORDER BY row_number, id`).all(uploadId) as MigRow[];
    const suggestions: { rowId: string; customerId: string; code: string; name: string }[] = [];
    for (const row of rows) {
      const raw = JSON.parse(row.raw_json) as Record<string, string>;
      if (!isManualMeasurement(raw)) continue;
      const matches = byName.get(nameKey(manualName(raw))) ?? [];
      if (matches.length === 1) suggestions.push({ rowId: row.id, customerId: matches[0]!.id, code: customerRef(db, matches[0]!.id)?.code ?? '', name: matches[0]!.name });
    }
    return { suggestions };
  });

  /**
   * Employees' missing pay types and rates, typed in one table and saved together. Every row is checked as a Fix would check it;
   * if any row is refused nothing is saved and each refusal is named. The rows are accepted, as a Fix accepts them.
   */
  app.post('/api/mig/uploads/:uploadId/fix-employees', auth, async req => {
    const user = currentUser(req);
    const { uploadId } = validation(uploadParams, req.params);
    const { fixes } = validation(employeeFixesBody, req.body);
    const at = stamp(clock);
    const by = { userId: user.userId, at };
    return tx(db, () => {
      staged(db, uploadId);
      const checked: { before: MigRow; manual: ManualData; parsed: ParsedRow }[] = [];
      const refused: { rowId: string; rowNumber: number; message: string }[] = [];
      for (const fix of fixes) {
        const before = getRow(db, fix.rowId);
        const refuse = (message: string) => { refused.push({ rowId: fix.rowId, rowNumber: before.row_number, message }); };
        if (before.upload_id !== uploadId || before.row_type !== 'employee') { refuse('This is not an employee row of this upload.'); continue; }
        if (before.status !== 'needs_review') { refuse('This row is not awaiting review.'); continue; }
        const { rowId: _rowId, ...typed } = fix;
        const manual: ManualData = typed;
        const payType = String(manual.payType ?? (JSON.parse(before.raw_json) as Record<string, string>).Pay_Type ?? '').toLowerCase();
        if (payType === 'piece' && manual.rateCents !== undefined) { refuse('Piece pay has no rate here: the piece-rate list has it. Clear the rate, or choose daily or monthly pay.'); continue; }
        try { checked.push({ before, manual, parsed: validateDecision(db, before, manual, by) }); }
        catch (cause) { if (!(cause instanceof AppError)) throw cause; refuse(cause.message); }
      }
      if (refused.length) throw new AppError('VALIDATION', `${refused.length === 1 ? 'One row cannot' : `${refused.length} rows cannot`} be saved, so nothing was saved: ${
        refused.map(r => `row ${r.rowNumber}: ${r.message}`).join(' ')}`, 422, refused);
      for (const { before, manual, parsed } of checked) {
        db.prepare(`UPDATE mig_rows SET status = 'accepted', manual_data_json = ?, rate_cents = ?, legacy_id = ?, legacy_type = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
          .run(JSON.stringify(manual), parsed.rateCents, parsed.legacyId, parsed.legacyId ? parsed.rowType : null, user.userId, at, before.id);
        auditRow(db, user.userId, at, 'fix', before);
      }
      return { success: true, saved: checked.length };
    });
  });

  app.post('/api/mig/uploads/:uploadId/dry-run', auth, async req => {
    const user = currentUser(req);
    const { uploadId } = validation(uploadParams, req.params);
    staged(db, uploadId);
    const by = { userId: user.userId, at: stamp(clock) };
    const rows = db.prepare('SELECT * FROM mig_rows WHERE upload_id = ? ORDER BY row_number, id').all(uploadId) as MigRow[];
    const pending = rows.filter(r => r.status === 'needs_review').length;
    if (pending) throw new AppError('PENDING_REVIEW', `There are ${pending} rows that still need review.`, 400);
    const counts = { customers: 0, measurements: 0, employees: 0, pieceRates: 0,
      excluded: 0, merged: 0, total: rows.length };
    // What the bulk choices for MANUAL size rows will make; named in the answer only when there is any.
    const fromManual = { newCustomers: 0, wearers: 0 };
    const newGroups = new Set<string>();
    const normalized: Record<'customer' | 'measurement' | 'employee' | 'piece_rate', Record<string, string>[]> = {
      customer: [], measurement: [], employee: [], piece_rate: [],
    };
    let measurementCellTenths = 0;
    let employeeRateCents = 0;
    let pieceRateCents = 0;
    for (const row of rows) {
      if (row.status === 'excluded') { counts.excluded++; continue; }
      if (row.status === 'merged') { counts.merged++; continue; }
      if (row.row_type === 'unknown') invalid('Unknown row type cannot pass a dry run.');
      assignmentValid(db, row, manualFor(row), by);
      const data = effective(row);
      const parsed = validateRow(data);
      const blocking = parsed.issues.filter(issue => !issue.includes('requires owner confirmation') && !issue.includes('seed requires owner confirmation'));
      if (blocking.length || activeDuplicates(db, row, parsed).length) invalid(`Row ${row.row_number} has unresolved validation issues.`);
      if (row.row_type === 'customer') counts.customers++;
      if (row.row_type === 'measurement') {
        counts.measurements++;
        const manual = manualFor(row);
        if (manual.newCustomer) fromManual.newCustomers++;
        if (manual.wearerName) fromManual.wearers++;
        if (manual.newGroupName) newGroups.add(`${manual.customerId}:${String(manual.newGroupName).toLowerCase()}`);
        for (const [key, value] of Object.entries(data)) if (measurementField(key)) {
          const tenths = measurementTenths(value);
          if (tenths !== null) measurementCellTenths = sumExact(measurementCellTenths, tenths);
        }
      }
      if (row.row_type === 'employee') {
        counts.employees++;
        if (row.status !== 'accepted') invalid(`Employee row ${row.row_number} needs owner confirmation.`);
        if (parsed.rateCents !== null) employeeRateCents = sumExact(employeeRateCents, parsed.rateCents);
      }
      if (row.row_type === 'piece_rate') {
        counts.pieceRates++;
        if (row.status !== 'accepted') invalid(`Piece-rate row ${row.row_number} needs owner confirmation.`);
        if (parsed.rateCents !== null) pieceRateCents = sumExact(pieceRateCents, parsed.rateCents);
      }
      normalized[row.row_type].push(data);
    }
    return { success: true, counts: { ...counts, ...(fromManual.newCustomers ? { newCustomers: fromManual.newCustomers } : {}),
      ...(newGroups.size ? { newGroups: newGroups.size } : {}), ...(fromManual.wearers ? { wearers: fromManual.wearers } : {}) }, checksums: {
      customer: { sha256: hash(normalized.customer) },
      measurement: { sha256: hash(normalized.measurement), cellTenths: measurementCellTenths },
      employee: { sha256: hash(normalized.employee), rateCents: employeeRateCents },
      pieceRate: { sha256: hash(normalized.piece_rate), rateCents: pieceRateCents },
      measurementCellSum: measurementCellTenths, employeeRateCents, pieceRateCents,
    } };
  });

  app.post('/api/mig/uploads/:uploadId/commit', commitAuth, async req => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const { uploadId } = validation(uploadParams, req.params);
    const { expectedMeasurementCellTenths } = validation(z.object({ expectedMeasurementCellTenths: z.number().int().nonnegative().safe() }).strict(), req.body);
    return commitUpload(db, uploadId, expectedMeasurementCellTenths, {
      userId: user.userId, at: stamp(clock), today: today(clock), can: permission => user.permissions.has(permission),
    });
  });

  app.get('/api/mig/uploads/:uploadId/commit', auth, async req => {
    const { uploadId } = validation(uploadParams, req.params);
    const row = db.prepare('SELECT status, counts_json, checksums_json, cleared_at FROM mig_uploads WHERE id = ?').get(uploadId) as
      { status: string; counts_json: string | null; checksums_json: string | null; cleared_at: string | null } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Upload not found.', 404);
    if (row.status !== 'committed') throw new AppError('CONFLICT', 'Upload has not been committed.', 409);
    return { counts: JSON.parse(row.counts_json ?? '{}'), checksums: JSON.parse(row.checksums_json ?? '{}'), clearedAt: row.cleared_at };
  });

  app.post('/api/mig/uploads/:uploadId/clear-staging', commitAuth, async req => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const { uploadId } = validation(uploadParams, req.params);
    return tx(db, () => {
      const row = db.prepare('SELECT status, cleared_at FROM mig_uploads WHERE id = ?').get(uploadId) as { status: string; cleared_at: string | null } | undefined;
      if (!row) throw new AppError('NOT_FOUND', 'Upload not found.', 404);
      if (row.status !== 'committed') throw new AppError('CONFLICT', 'Commit and verify the upload before clearing staging values.', 409);
      if (row.cleared_at) throw new AppError('CONFLICT', 'Staging values were already cleared.', 409);
      const at = stamp(clock);
      const changed = db.prepare("UPDATE mig_rows SET raw_json = '{}', manual_data_json = NULL, issues_json = '[]', legacy_id = NULL, legacy_type = NULL, rate_cents = NULL WHERE upload_id = ?").run(uploadId).changes;
      db.prepare('UPDATE mig_uploads SET filename = ?, cleared_at = ?, cleared_by = ? WHERE id = ?').run('cleared', at, user.userId, uploadId);
      appendAudit(db, { at, userId: user.userId, action: 'mig.clear_staging', entityType: 'mig_uploads', entityId: uploadId,
        data: { rowsCleared: changed, before: { clearedAt: null }, after: { clearedAt: at } } });
      return { success: true, rowsCleared: changed };
    });
  });
}
