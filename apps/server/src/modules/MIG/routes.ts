import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, formatPesos, newId } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { duplicateKeys, measurementField, measurementFields, measurementTenths, parseCSV, validateRow, type ParsedRow, type RowType } from './csv.ts';

const auth = { config: { permission: 'mig.run' } };
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
  measurement: z.object({ customerLegacyId: legacyId.optional(), groupLegacyId: legacyId.optional(), ...measureOverrides }).strict(),
  employee: z.object({ employeeName: z.string().trim().min(1).optional(), legacyId: legacyId.optional(), rateCents: moneyCents.optional() }).strict(),
  piece_rate: z.object({ garmentType: z.string().trim().min(1).optional(), operation: z.string().trim().min(1).optional(), rateCents: moneyCents.optional() }).strict(),
};
type ManualData = Record<string, string | number>;
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
function state(row: MigRow): Record<string, unknown> {
  return {
    status: row.status, manualData: row.manual_data_json ? JSON.parse(row.manual_data_json) : null,
    rateCents: row.rate_cents, legacyId: row.legacy_id, mergeIntoRowId: row.merge_into_row_id,
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
    if (manual.customerLegacyId) { raw.Customer_Name = String(manual.customerLegacyId); raw.Source = 'ASSIGNED'; }
    if (manual.groupLegacyId) { raw.Group_Name = String(manual.groupLegacyId); raw.Source = 'ASSIGNED'; }
    for (const field of measurementFields) {
      if (manual[field] === undefined) continue;
      const oldKey = Object.keys(raw).find(key => measurementField(key) === field);
      raw[oldKey ?? field] = String(manual[field]);
    }
  } else if (row.row_type === 'employee') {
    if (manual.employeeName) raw.Employee_Name = String(manual.employeeName);
    if (manual.legacyId) raw.Employee_ID = String(manual.legacyId);
    if (manual.rateCents !== undefined) raw.Daily_Rate = formatPesos(Number(manual.rateCents));
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
  if (row.row_type === 'measurement' && (parsed.customerLegacyId || parsed.groupLegacyId)) {
    // A customer assignment must resolve to a staged customer ID in this upload.
    // Group labels are retained for the future commit, under that customer.
    if (!parsed.customerLegacyId) invalid('Choose a staged customer before assigning a group.');
  }
  return parsed;
}
function assignmentValid(db: Db, row: MigRow, manual: ManualData): void {
  if (row.row_type !== 'measurement') return;
  const raw = JSON.parse(row.raw_json) as Record<string, string>;
  const isManual = raw.Source === 'MANUAL' || raw.Customer_Name === 'MANUAL' || (!raw.Customer_Name && !raw.Group_Name);
  if (isManual && !manual.customerLegacyId) invalid('Assign this MANUAL measurement to a staged customer.');
  if (manual.customerLegacyId) {
    const customer = db.prepare(`SELECT r.id FROM mig_rows r JOIN mig_uploads u ON u.id = r.upload_id
      WHERE r.row_type = 'customer' AND r.legacy_id = ? AND r.status NOT IN ('excluded', 'merged')
      AND u.status = 'staged' LIMIT 1`)
      .get(manual.customerLegacyId);
    if (!customer) invalid('Customer legacy ID is not an active staged customer in this upload.');
  }
}
function activeDuplicates(db: Db, row: MigRow, parsed: ParsedRow): string[] {
  const keys = new Set(duplicateKeys(parsed));
  if (!keys.size) return [];
  const others = db.prepare(`SELECT * FROM mig_rows WHERE upload_id = ? AND id <> ? AND status NOT IN ('excluded', 'merged')`)
    .all(row.upload_id, row.id) as MigRow[];
  return others.filter(other => duplicateKeys(validateRow(effective(other))).some(key => keys.has(key))).map(other => other.id);
}
function validateDecision(db: Db, row: MigRow, manual: ManualData): ParsedRow {
  assignmentValid(db, row, manual);
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
    const parsedRows = csv!.objects.map((raw, i) => ({ id: newId(), rowNumber: csv!.lineNumbers[i]!, parsed: validateRow(raw) }));
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
      const parsed = validateDecision(db, before, manualFor(before));
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
      const parsed = validateDecision(db, before, manual);
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

  app.post('/api/mig/uploads/:uploadId/dry-run', auth, async req => {
    const { uploadId } = validation(uploadParams, req.params);
    staged(db, uploadId);
    const rows = db.prepare('SELECT * FROM mig_rows WHERE upload_id = ? ORDER BY row_number, id').all(uploadId) as MigRow[];
    const pending = rows.filter(r => r.status === 'needs_review').length;
    if (pending) throw new AppError('PENDING_REVIEW', `There are ${pending} rows that still need review.`, 400);
    const counts = { customers: 0, measurements: 0, employees: 0, pieceRates: 0,
      excluded: 0, merged: 0, total: rows.length };
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
      assignmentValid(db, row, manualFor(row));
      const data = effective(row);
      const parsed = validateRow(data);
      const blocking = parsed.issues.filter(issue => !issue.includes('requires owner confirmation') && !issue.includes('seed requires owner confirmation'));
      if (blocking.length || activeDuplicates(db, row, parsed).length) invalid(`Row ${row.row_number} has unresolved validation issues.`);
      if (row.row_type === 'customer') counts.customers++;
      if (row.row_type === 'measurement') {
        counts.measurements++;
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
    return { success: true, counts, checksums: {
      customer: { sha256: hash(normalized.customer) },
      measurement: { sha256: hash(normalized.measurement), cellTenths: measurementCellTenths },
      employee: { sha256: hash(normalized.employee), rateCents: employeeRateCents },
      pieceRate: { sha256: hash(normalized.piece_rate), rateCents: pieceRateCents },
      measurementCellSum: measurementCellTenths, employeeRateCents, pieceRateCents,
    } };
  });
}
