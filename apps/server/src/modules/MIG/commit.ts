import { AppError } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { createCustomer, createGroup, createWearer, createMeasurement } from '../CUS/public.ts';
import { createEmployee, addPayProfile, type Who as EmployeeWho } from '../EMP/public.ts';
import { addRate } from '../RATE/public.ts';
import { measurementField, measurementTenths, rateFromPesos, validateRow } from './csv.ts';

type Kind = 'customer' | 'group' | 'wearer' | 'measurement' | 'employee' | 'piece_rate';
type Row = { id: string; upload_id: string; row_number: number; row_type: Kind; status: string;
  raw_json: string; manual_data_json: string | null; legacy_id: string | null; rate_cents: number | null; merge_into_row_id: string | null };
type Who = EmployeeWho;
type Counts = Record<Kind, { imported: number; alreadyImported: number }>;
const kinds: Kind[] = ['customer', 'group', 'wearer', 'measurement', 'employee', 'piece_rate'];
const counts = (): Counts => Object.fromEntries(kinds.map(k => [k, { imported: 0, alreadyImported: 0 }])) as Counts;
const error = (message: string, details?: unknown): never => { throw new AppError('IMPORT_COMMIT', message, 422, details); };
const string = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const first = (raw: Record<string, string>, ...keys: string[]): string => keys.map(k => string(raw[k])).find(Boolean) ?? '';
const mapped = (db: Db, kind: Kind, legacyId: string): string | undefined =>
  (db.prepare('SELECT new_id FROM mig_legacy_map WHERE legacy_kind = ? AND legacy_id = ?').get(kind, legacyId) as { new_id: string } | undefined)?.new_id;
const putMap = (db: Db, kind: Kind, legacyId: string, newId: string, uploadId: string): void => {
  db.prepare('INSERT INTO mig_legacy_map (legacy_kind,legacy_id,new_id,upload_id) VALUES (?,?,?,?)').run(kind, legacyId, newId, uploadId);
};
const rawFor = (row: Row): Record<string, string> => {
  const raw = JSON.parse(row.raw_json) as Record<string, string>;
  const manual = row.manual_data_json ? JSON.parse(row.manual_data_json) as Record<string, string | number> : {};
  if (row.row_type === 'customer') {
    if (manual.customerName) raw.Customer_Name = String(manual.customerName);
    if (manual.registeredName) raw.Registered_Name = String(manual.registeredName);
    if (manual.legacyId) raw.Legacy_ID = String(manual.legacyId);
  } else if (row.row_type === 'measurement') {
    if (manual.customerLegacyId) { raw.Customer_ID = String(manual.customerLegacyId); raw.Customer_Name = String(manual.customerLegacyId); raw.Source = 'ASSIGNED'; }
    if (manual.groupLegacyId) { raw.Group_ID = String(manual.groupLegacyId); raw.Group_Name = String(manual.groupLegacyId); raw.Source = 'ASSIGNED'; }
    for (const [key, value] of Object.entries(manual)) if (measurementField(key)) {
      const oldKey = Object.keys(raw).find(k => measurementField(k) === key);
      raw[oldKey ?? key] = String(value);
    }
  } else if (row.row_type === 'employee') {
    if (manual.employeeName) raw.Employee_Name = String(manual.employeeName);
    if (manual.rateCents !== undefined) raw.Daily_Rate = (Number(manual.rateCents) / 100).toFixed(2);
  } else if (row.row_type === 'piece_rate') {
    if (manual.garmentType) raw.Garment_Type = String(manual.garmentType);
    if (manual.operation) raw.Operation = String(manual.operation);
    if (manual.rateCents !== undefined) raw.Rate = (Number(manual.rateCents) / 100).toFixed(2);
  }
  return raw;
};

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
      const id = create(row, 'customer', legacyId, () => createCustomer(db, {
        kind: first(raw, 'Kind').toLowerCase() === 'person' ? 'person' : 'organization',
        displayName: first(raw, 'Customer_Name', 'Registered_Name'),
        ...(first(raw, 'Registered_Name') ? { registeredName: first(raw, 'Registered_Name') } : {}),
        ...(first(raw, 'TIN') ? { tin: first(raw, 'TIN') } : {}),
        ...(first(raw, 'Email') ? { email: first(raw, 'Email') } : {}),
      }, who).id);
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
    const contexts = measurementRows.map(row => {
      const raw = data.get(row.id)!;
      const sourceCustomer = first(raw, 'Customer_ID', 'Customer_Legacy_ID', 'Customer_Name');
      const customerId = customerBySource.get(sourceCustomer) ?? customerBySource.get(sourceCustomer.toLowerCase()) ?? mapped(db, 'customer', sourceCustomer);
      if (!customerId) error(`Row ${row.row_number} (measurement): customer ${sourceCustomer || '(missing)'} has no imported legacy mapping.`);
      const groupName = first(raw, 'Group_Name', 'Group');
      const groupKey = first(raw, 'Group_ID') || `${sourceCustomer}:${groupName.toLowerCase()}`;
      const wearerName = first(raw, 'Wearer_Name', 'Person_Name', 'Full_Name', 'Name');
      if (!wearerName) error(`Row ${row.row_number} (measurement): wearer name is missing.`);
      const wearerKey = first(raw, 'Wearer_ID', 'Person_ID') || `${sourceCustomer}:${groupKey}:${wearerName.toLowerCase()}`;
      return { row, raw, customerId: customerId!, groupName, groupKey, wearerName, wearerKey };
    });
    for (const { row, customerId, groupName, groupKey } of contexts) if (groupName && !groupBySource.has(groupKey))
      groupBySource.set(groupKey, create(row, 'group', groupKey, () => createGroup(db, customerId, { name: groupName }, who).id));
    for (const { row, customerId, groupKey, wearerName, wearerKey } of contexts) if (!wearerBySource.has(wearerKey)) {
      const groupId = groupBySource.get(groupKey);
      wearerBySource.set(wearerKey, create(row, 'wearer', wearerKey, () => createWearer(db, customerId,
        { fullName: wearerName, ...(groupId ? { groupId } : {}) }, who).id));
    }
    for (const { row, raw, wearerKey } of contexts) {
      const wearerId = wearerBySource.get(wearerKey)!;
      const values: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw)) {
        const field = measurementField(key);
        if (field) { const tenths = measurementTenths(value); if (tenths !== null) values[field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = tenths / 10; }
      }
      create(row, 'measurement', row.legacy_id ?? first(raw, 'Measurement_ID'), () => createMeasurement(db, wearerId,
        { sizeMode: 'measured', unit: 'inch', values, reason: 'Imported legacy measurement revision' }, who).id);
    }
    for (const row of active.filter(r => r.row_type === 'employee')) {
      const raw = data.get(row.id)!;
      const legacyId = row.legacy_id ?? first(raw, 'Employee_ID', 'Legacy_ID');
      create(row, 'employee', legacyId, () => {
        const centre = first(raw, 'Cost_Centre').toLowerCase() || 'production';
        const e = createEmployee(db, { fullName: first(raw, 'Employee_Name'), costCentre: centre, hireDate: first(raw, 'Hire_Date') || who.today }, who);
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
    const summary = { counts: tally, measurementCellTenths: cellTenths, measurementCellSum: cellTenths / 10,
      excluded: rows.filter(r => r.status === 'excluded').length, merged: rows.filter(r => r.status === 'merged').length };
    db.prepare("UPDATE mig_uploads SET status = 'committed', committed_at = ?, committed_by = ?, counts_json = ?, checksums_json = ? WHERE id = ?")
      .run(who.at, who.userId, JSON.stringify(summary.counts), JSON.stringify({ measurementCellTenths: cellTenths }), uploadId);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'mig.commit', entityType: 'mig_uploads', entityId: uploadId, data: summary });
    return summary;
  });
}
