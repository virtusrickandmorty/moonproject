import { AppError } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { addCustomerPhone, createCustomer, createGroup, createWearer, createMeasurement, customerRef, normalizePhone } from '../CUS/public.ts';
import { createEmployee, addPayProfile, type Who as EmployeeWho } from '../EMP/public.ts';
import { addRate } from '../RATE/public.ts';
import { createSizerSet } from '../SZR/public.ts';
import { applyEmployeeFix, applyMeasurementAssignment, applySizerFix, measurementField, measurementTenths, rateFromPesos, validateRow, type ManualData } from './csv.ts';

type Kind = 'customer' | 'group' | 'wearer' | 'measurement' | 'employee' | 'piece_rate' | 'sizer_set';
type Row = { id: string; upload_id: string; row_number: number; row_type: Kind; status: string;
  raw_json: string; manual_data_json: string | null; legacy_id: string | null; rate_cents: number | null; merge_into_row_id: string | null };
type Who = EmployeeWho;
type Counts = Record<Kind, { imported: number; alreadyImported: number }>;
const kinds: Kind[] = ['customer', 'group', 'wearer', 'measurement', 'employee', 'piece_rate', 'sizer_set'];
const counts = (): Counts => Object.fromEntries(kinds.map(k => [k, { imported: 0, alreadyImported: 0 }])) as Counts;
const error = (message: string, details?: unknown): never => { throw new AppError('IMPORT_COMMIT', message, 422, details); };
const string = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const first = (raw: Record<string, string>, ...keys: string[]): string => keys.map(k => string(raw[k])).find(Boolean) ?? '';
const mapped = (db: Db, kind: Kind, legacyId: string): string | undefined =>
  (db.prepare('SELECT new_id FROM mig_legacy_map WHERE legacy_kind = ? AND legacy_id = ?').get(kind, legacyId) as { new_id: string } | undefined)?.new_id;
const putMap = (db: Db, kind: Kind, legacyId: string, newId: string, uploadId: string): void => {
  db.prepare('INSERT INTO mig_legacy_map (legacy_kind,legacy_id,new_id,upload_id) VALUES (?,?,?,?)').run(kind, legacyId, newId, uploadId);
};
const manualOf = (row: Row): ManualData => (row.manual_data_json ? JSON.parse(row.manual_data_json) as ManualData : {});
const rawFor = (row: Row): Record<string, string> => {
  const raw = JSON.parse(row.raw_json) as Record<string, string>;
  const manual = manualOf(row);
  if (row.row_type === 'customer') {
    if (manual.customerName) raw.Customer_Name = String(manual.customerName);
    if (manual.registeredName) raw.Registered_Name = String(manual.registeredName);
    if (manual.legacyId) raw.Legacy_ID = String(manual.legacyId);
  } else if (row.row_type === 'measurement') {
    applyMeasurementAssignment(raw, manual);
    for (const [key, value] of Object.entries(manual)) if (measurementField(key)) {
      const oldKey = Object.keys(raw).find(k => measurementField(k) === key);
      raw[oldKey ?? key] = String(value);
    }
  } else if (row.row_type === 'employee') {
    applyEmployeeFix(raw, manual);
  } else if (row.row_type === 'piece_rate') {
    if (manual.garmentType) raw.Garment_Type = String(manual.garmentType);
    if (manual.operation) raw.Operation = String(manual.operation);
    if (manual.rateCents !== undefined) raw.Rate = (Number(manual.rateCents) / 100).toFixed(2);
  } else if (row.row_type === 'sizer_set') {
    applySizerFix(raw, manual);
  }
  return raw;
};

/** The numbers in a phone cell (several may share it, split by / , or ;): those Virtus can read, and those it cannot. */
function phoneNumbers(cell: string): { readable: string[]; unreadable: string[] } {
  const out: { readable: string[]; unreadable: string[] } = { readable: [], unreadable: [] };
  for (const part of cell.split(/[/,;]/).map(p => p.trim()).filter(Boolean)) {
    try { normalizePhone(part); out.readable.push(part); } catch { out.unreadable.push(part); }
  }
  return out;
}
/** A measurement's note: the sizes and remarks the old sheet held beside the cells ("-" means none). */
function measurementNote(raw: Record<string, string>): string {
  const part = (label: string, value: string) => (value && value !== '-' ? `${label}: ${value}` : '');
  return [part('Upper size', first(raw, 'Upper_Size')), part('Lower size', first(raw, 'Lower_Size')), part('Remarks', first(raw, 'Remarks'))]
    .filter(Boolean).join('. ').slice(0, 500);
}

/** All module creates and map writes join this one immediate transaction. */
export function commitUpload(db: Db, uploadId: string, expectedCellTenths: number, who: Who) {
  return tx(db, () => {
    const upload = db.prepare('SELECT status FROM mig_uploads WHERE id = ?').get(uploadId) as { status: string } | undefined;
    if (!upload) throw new AppError('NOT_FOUND', 'Upload not found.', 404);
    if (upload.status !== 'staged') throw new AppError('CONFLICT', 'Upload is no longer staged.', 409);
    const rows = db.prepare('SELECT * FROM mig_rows WHERE upload_id = ? ORDER BY row_number, id').all(uploadId) as Row[];
    if (rows.some(r => r.status === 'needs_review')) error('Review every row before committing.');
    const active = rows.filter(r => r.status !== 'excluded' && r.status !== 'merged');
    const data = new Map(active.map(r => [r.id, rawFor(r)]));
    let cellTenths = 0;
    for (const row of active) {
      const raw = data.get(row.id)!;
      const parsed = validateRow(raw);
      const blocking = parsed.issues.filter(issue => !issue.includes('requires owner confirmation') && !issue.includes('seed requires owner confirmation'));
      if (blocking.length) error(`Row ${row.row_number} (${row.row_type}): ${blocking.join(' ')}`, { rowId: row.id, rowNumber: row.row_number });
      if (row.row_type === 'measurement') for (const [key, value] of Object.entries(raw)) if (measurementField(key)) {
        const tenths = measurementTenths(value);
        if (tenths !== null) cellTenths += tenths;
      }
    }
    if (!Number.isSafeInteger(cellTenths) || cellTenths !== expectedCellTenths)
      error(`Measurement cells total ${cellTenths / 10} does not match the dry run total ${expectedCellTenths / 10}.`);

    const tally = counts();
    const customerBySource = new Map<string, string>();
    const customerRows = active.filter(r => r.row_type === 'customer');
    const create = (row: Row, kind: Kind, legacyId: string, fn: () => string): string => {
      if (!legacyId) error(`Row ${row.row_number} (${kind}) has no legacy ID.`);
      const old = mapped(db, kind, legacyId);
      if (old) { tally[kind].alreadyImported++; return old; }
      try {
        const id = fn();
        putMap(db, kind, legacyId, id, uploadId);
        tally[kind].imported++;
        return id;
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        return error(`Row ${row.row_number} (${kind}): ${reason}`, { rowId: row.id, rowNumber: row.row_number, kind });
      }
    };
    for (const row of customerRows) {
      const raw = data.get(row.id)!;
      const legacyId = row.legacy_id ?? first(raw, 'Legacy_ID', 'Customer_ID');
      const phones = phoneNumbers(first(raw, 'Phone'));
      const notes = [first(raw, 'Notes'), phones.unreadable.length ? `Phone in the old sheet: ${phones.unreadable.join(', ')}` : ''].filter(Boolean).join('. ');
      const id = create(row, 'customer', legacyId, () => {
        const created = createCustomer(db, {
          kind: first(raw, 'Kind').toLowerCase() === 'person' ? 'person' : 'organization',
          displayName: first(raw, 'Customer_Name', 'Registered_Name'),
          ...(first(raw, 'Registered_Name') ? { registeredName: first(raw, 'Registered_Name') } : {}),
          ...(first(raw, 'TIN') ? { tin: first(raw, 'TIN') } : {}),
          ...(first(raw, 'Email') ? { email: first(raw, 'Email') } : {}),
          ...(first(raw, 'Address') ? { billingAddress: first(raw, 'Address') } : {}),
          ...(notes ? { notes } : {}),
        }, who, legacyId);
        for (const phone of phones.readable) addCustomerPhone(db, created.id, { phone }, who);
        return created.id;
      });
      customerBySource.set(legacyId, id);
      customerBySource.set(first(raw, 'Customer_Name', 'Registered_Name').toLowerCase(), id);
    }
    for (const row of rows.filter(r => r.status === 'merged' && r.row_type === 'customer')) {
      const target = rows.find(r => r.id === row.merge_into_row_id);
      const targetId = target && customerBySource.get(target.legacy_id ?? '');
      if (!targetId || !row.legacy_id) error(`Row ${row.row_number}: merged customer has no imported survivor.`);
      if (!mapped(db, 'customer', row.legacy_id!)) putMap(db, 'customer', row.legacy_id!, targetId!, uploadId);
    }
    const groupBySource = new Map<string, string>();
    const wearerBySource = new Map<string, string>();
    const measurementRows = active.filter(r => r.row_type === 'measurement');
    const measurementLegacyId = (row: Row): string => row.legacy_id ?? first(data.get(row.id)!, 'Measurement_ID');
    // A row imported by an earlier run makes nothing again: not its measurement, and not the customer, group or wearer it would need.
    const todo = new Set(measurementRows.filter(r => !mapped(db, 'measurement', measurementLegacyId(r))).map(r => r.id));
    // A MANUAL row the owner made its own customer: a person, named as in the sheet, keyed by the sheet's Size ID.
    for (const row of measurementRows) if (todo.has(row.id) && manualOf(row).newCustomer) {
      const raw = data.get(row.id)!;
      const legacyId = first(raw, 'Customer_ID');
      customerBySource.set(legacyId, create(row, 'customer', legacyId, () =>
        createCustomer(db, { kind: 'person', displayName: first(raw, 'Wearer_Name') }, who, legacyId).id));
    }
    const contexts = measurementRows.map(row => {
      const raw = data.get(row.id)!;
      const manual = manualOf(row);
      const needed = todo.has(row.id);
      const sourceCustomer = first(raw, 'Customer_ID', 'Customer_Legacy_ID', 'Customer_Name');
      let customerId = customerBySource.get(sourceCustomer) ?? customerBySource.get(sourceCustomer.toLowerCase()) ?? mapped(db, 'customer', sourceCustomer);
      if (manual.customerId) {
        // A customer already in Virtus, chosen for a whole batch of rows: it must still be there and active.
        const chosen = customerRef(db, String(manual.customerId));
        if (needed && (!chosen || chosen.is_active !== 1 || chosen.merged_into_id)) error(`Row ${row.row_number} (measurement): the customer chosen for it is no longer an active customer.`);
        customerId = String(manual.customerId);
      }
      if (!customerId && needed) error(`Row ${row.row_number} (measurement): customer ${sourceCustomer || '(missing)'} has no imported legacy mapping.`);
      const groupName = first(raw, 'Group_Name', 'Group');
      const groupKey = first(raw, 'Group_ID') || `${sourceCustomer}:${groupName.toLowerCase()}`;
      if (manual.groupId) groupBySource.set(groupKey, String(manual.groupId)); // a group that is already there is used, not made
      // A sheet row names no wearer: the measurements are the customer's own.
      const wearerName = first(raw, 'Wearer_Name', 'Person_Name', 'Full_Name', 'Name') || (customerId ? customerRef(db, customerId)?.display_name ?? '' : '');
      if (!wearerName && needed) error(`Row ${row.row_number} (measurement): wearer name is missing.`);
      const wearerKey = first(raw, 'Wearer_ID', 'Person_ID') || `${sourceCustomer}:${groupKey}:${wearerName.toLowerCase()}`;
      return { row, raw, customerId: customerId ?? '', groupName, groupKey, wearerName, wearerKey };
    });
    for (const { row, customerId, groupName, groupKey } of contexts) if (todo.has(row.id) && groupName && !groupBySource.has(groupKey))
      groupBySource.set(groupKey, create(row, 'group', groupKey, () => createGroup(db, customerId, { name: groupName }, who).id));
    for (const { row, customerId, groupKey, wearerName, wearerKey } of contexts) if (todo.has(row.id) && !wearerBySource.has(wearerKey)) {
      const groupId = groupBySource.get(groupKey);
      wearerBySource.set(wearerKey, create(row, 'wearer', wearerKey, () => createWearer(db, customerId,
        { fullName: wearerName, ...(groupId ? { groupId } : {}) }, who).id));
    }
    for (const { row, raw, wearerKey } of contexts) {
      const values: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw)) {
        const field = measurementField(key);
        if (field) { const tenths = measurementTenths(value); if (tenths !== null) values[field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = tenths / 10; }
      }
      create(row, 'measurement', measurementLegacyId(row), () => createMeasurement(db, wearerBySource.get(wearerKey)!,
        { sizeMode: 'measured', unit: 'inch', values, ...(measurementNote(raw) ? { remarks: measurementNote(raw) } : {}), reason: 'Imported legacy measurement revision' }, who).id);
    }
    for (const row of active.filter(r => r.row_type === 'employee')) {
      const raw = data.get(row.id)!;
      const legacyId = row.legacy_id ?? first(raw, 'Employee_ID', 'Legacy_ID');
      create(row, 'employee', legacyId, () => {
        const centre = first(raw, 'Cost_Centre').toLowerCase() || 'production';
        const e = createEmployee(db, { fullName: first(raw, 'Employee_Name'), costCentre: centre, hireDate: first(raw, 'Hire_Date') || who.today,
          ...(first(raw, 'Position', 'Job_Title') ? { position: first(raw, 'Position', 'Job_Title').slice(0, 60) } : {}) }, who);
        const rate = row.rate_cents;
        const payType = first(raw, 'Pay_Type').toLowerCase() || (rate ? 'daily' : 'piece');
        const daily = payType === 'daily' || payType === 'mixed';
        const monthlyRate = first(raw, 'Monthly_Rate');
        const group = first(raw, 'Pay_Group') || (payType === 'monthly' ? 'SEMI_MONTHLY' : daily ? 'SEMI_DAILY' : 'WEEKLY_PIECE');
        const workweek = Number(first(raw, 'Workweek_Days') || 6);
        addPayProfile(db, e.id, { effectiveFrom: e.hireDate, payType, ...(daily ? { dailyRateCents: rate } : {}),
          ...(payType === 'monthly' ? { monthlyRateCents: rateFromPesos(monthlyRate) } : {}),
          payGroup: group, workweekDays: workweek, isMwe: ['1', 'true', 'yes'].includes(first(raw, 'Is_MWE').toLowerCase()),
          reason: 'Confirmed legacy import pay profile' }, who);
        return e.id;
      });
    }
    for (const row of active.filter(r => r.row_type === 'piece_rate')) {
      const raw = data.get(row.id)!;
      const garmentType = first(raw, 'Garment_Type'), stepCode = first(raw, 'Operation').toUpperCase();
      const complexity = first(raw, 'Complexity').toLowerCase() || 'standard';
      const legacyId = row.legacy_id ?? (first(raw, 'Rate_ID', 'Legacy_ID') ||
        `${garmentType.toLowerCase()}:${stepCode}:${complexity}:${first(raw, 'Effective_From')}:${row.rate_cents}`);
      create(row, 'piece_rate', legacyId, () => String(addRate(db, { garmentType, stepCode, complexity,
        rateCents: row.rate_cents, effectiveFrom: who.today, reason: 'Confirmed legacy piece-rate import' }, who).id));
    }
    // Sizer sets (the owner's request, Oct 2026), in the shop; a code already on file stops the import with the row named.
    for (const row of active.filter(r => r.row_type === 'sizer_set')) {
      const raw = data.get(row.id)!;
      create(row, 'sizer_set', first(raw, 'Code'), () => createSizerSet(db,
        { code: first(raw, 'Code'), garmentType: first(raw, 'Garment_Type'), sizesIncluded: first(raw, 'Sizes_Included') }, who).id);
    }
    const summary = { counts: tally, measurementCellTenths: cellTenths, measurementCellSum: cellTenths / 10,
      excluded: rows.filter(r => r.status === 'excluded').length, merged: rows.filter(r => r.status === 'merged').length };
    db.prepare("UPDATE mig_uploads SET status = 'committed', committed_at = ?, committed_by = ?, counts_json = ?, checksums_json = ? WHERE id = ?")
      .run(who.at, who.userId, JSON.stringify(summary.counts), JSON.stringify({ measurementCellTenths: cellTenths }), uploadId);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'mig.commit', entityType: 'mig_uploads', entityId: uploadId, data: summary });
    return summary;
  });
}
