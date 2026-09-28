/** Transaction-joining master-data creates for imports and other CUS callers. */
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { chartInput, customerInput, groupInput, personInput, measurements } from './schemas.ts';
import { chartResponse, hundredthsColumn, toHundredthsInch } from './measurements.ts';

type Who = { userId: string; at: string; today: string };
type Row = Record<string, unknown>;
export const customerFields: Record<string, string> = {
  kind: 'kind', displayName: 'display_name', registeredName: 'registered_name', tin: 'tin',
  isVatRegistered: 'is_vat_registered', withholdingProfile: 'withholding_profile',
  billingAddress: 'billing_address', email: 'email', emailConsent: 'email_consent',
  creditTermsDays: 'credit_terms_days', parentCustomerId: 'parent_customer_id', notes: 'notes',
};
export const personalCustomerFields = new Set(['displayName', 'registeredName', 'tin', 'billingAddress', 'email', 'notes']);

export function auditChanges(before: Row, after: Row, fields: Record<string, unknown>, map: Record<string, string>, personal: Set<string>): Record<string, unknown> {
  const names = Object.keys(fields).filter(key => fields[key] !== undefined);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of names) if (!personal.has(key) && before[map[key]!] !== after[map[key]!]) {
    changes[key] = { before: before[map[key]!] ?? null, after: after[map[key]!] ?? null };
  }
  return { fields: names, changes };
}
function get(db: Db, table: string, id: string): Row {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw notFound('Record');
  return row;
}
function active(row: Row): void {
  if (row.is_active !== 1) throw conflict('INACTIVE', 'This record is inactive.');
}
export function validateParent(db: Db, childId: string | null, parentId: string | null): void {
  if (!parentId) return;
  if (parentId === childId) throw conflict('PARENT_CYCLE', 'A customer cannot be its own parent.');
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor) || cursor === childId) throw conflict('PARENT_CYCLE', 'This parent would make a loop in the customer list.');
    seen.add(cursor);
    const row = get(db, 'cus_customers', cursor);
    active(row);
    cursor = row.parent_customer_id as string | null;
  }
}
export function validateGroup(db: Db, customerId: string, groupId: string | null | undefined): void {
  if (!groupId) return;
  const row = get(db, 'cus_groups', groupId);
  active(row);
  if (row.customer_id !== customerId) throw conflict('WRONG_GROUP', 'Choose a group belonging to this customer.');
}
function activeId(db: Db, table: string, id: string): void {
  active(get(db, table, id));
}

export function createCustomer(db: Db, raw: unknown, who: Who, legacyId?: string): { id: string; code: string } {
  const v = customerInput.parse(raw);
  return tx(db, () => {
    const id = newId();
    validateParent(db, id, v.parentCustomerId ?? null);
    const seq = db.prepare("UPDATE cus_sequences SET next_value = next_value + 1 WHERE key = 'customer' RETURNING next_value - 1 AS n").get() as { n: number };
    const code = `CUS-${String(seq.n).padStart(5, '0')}`;
    db.prepare(`INSERT INTO cus_customers (id,code,kind,display_name,registered_name,tin,is_vat_registered,withholding_profile,billing_address,email,email_consent,credit_terms_days,parent_customer_id,legacy_id,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, code, v.kind, v.displayName, v.registeredName ?? null, v.tin ?? null,
      Number(v.isVatRegistered ?? false), v.withholdingProfile ?? 'none', v.billingAddress ?? null,
      v.email?.toLowerCase() ?? null, Number(v.emailConsent ?? false), v.creditTermsDays ?? 0,
      v.parentCustomerId ?? null, legacyId ?? null, v.notes ?? null, who.at, who.at);
    const created = get(db, 'cus_customers', id);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'cus.customer.create', entityType: 'cus_customer', entityId: id,
      data: auditChanges({}, created, v, customerFields, personalCustomerFields) });
    return { id, code };
  });
}

export function createGroup(db: Db, customerId: string, raw: unknown, who: Who): { id: string } {
  const v = groupInput.parse(raw);
  return tx(db, () => {
    activeId(db, 'cus_customers', customerId);
    if (db.prepare('SELECT 1 FROM cus_groups WHERE customer_id = ? AND name = ? COLLATE NOCASE AND is_active = 1').get(customerId, v.name))
      throw new AppError('GROUP_EXISTS', 'This customer already has an active group with that name.', 409);
    const id = newId();
    db.prepare('INSERT INTO cus_groups (id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, customerId, v.name, who.at, who.at);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'cus.group.create', entityType: 'cus_group', entityId: id, data: { customerId, fields: ['name'] } });
    return { id };
  });
}

export function createWearer(db: Db, customerId: string, raw: unknown, who: Who): { id: string } {
  const v = personInput.parse(raw);
  return tx(db, () => {
    activeId(db, 'cus_customers', customerId);
    validateGroup(db, customerId, v.groupId);
    const id = newId();
    db.prepare(`INSERT INTO cus_people (id,customer_id,group_id,full_name,nickname,default_jersey_name,default_jersey_number,gender,birthday,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, customerId, v.groupId ?? null, v.fullName, v.nickname ?? null,
      v.defaultJerseyName ?? null, v.defaultJerseyNumber ?? null, v.gender ?? null, v.birthday ?? null, who.at, who.at);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'cus.person.create', entityType: 'cus_person', entityId: id, data: { customerId, groupId: v.groupId ?? null } });
    return { id };
  });
}

export function createMeasurement(db: Db, personId: string, raw: unknown, who: Who): { id: string } {
  const v = chartInput.parse(raw);
  return tx(db, () => {
    activeId(db, 'cus_people', personId);
    const prior = db.prepare('SELECT id,revision_no FROM cus_measure_charts WHERE person_id = ? ORDER BY revision_no DESC LIMIT 1').get(personId) as { id: string; revision_no: number } | undefined;
    if (prior && !v.reason) throw new AppError('REVISION_REASON', 'Give a reason for the new measurement revision.', 400);
    if (v.sizeMode === 'preset' && !v.upperSize && !v.lowerSize) throw new AppError('SIZE_REQUIRED', 'Choose an upper or lower size.', 400);
    if (v.sizeMode === 'measured' && !measurements.some(m => v.values[m] != null)) throw new AppError('MEASUREMENT_REQUIRED', 'Enter at least one measurement.', 400);
    for (const size of [v.upperSize, v.lowerSize]) if (size) activeId(db, 'cus_sizes', size);
    const id = newId();
    const unit = v.unit ?? 'inch';
    const values = measurements.map(m => v.values[m] == null ? null : toHundredthsInch(v.values[m], unit));
    if (prior) db.prepare("UPDATE cus_measure_charts SET status = 'superseded' WHERE id = ? AND status = 'active'").run(prior.id);
    const cols = measurements.map(hundredthsColumn);
    db.prepare(`INSERT INTO cus_measure_charts (id,person_id,revision_no,status,size_mode,upper_size,lower_size,unit,${cols.join(',')},remarks,measured_by,measured_on,reason,supersedes_id)
      VALUES (${Array(8 + cols.length + 5).fill('?').join(',')})`).run(id, personId, (prior?.revision_no ?? 0) + 1, 'active', v.sizeMode,
      v.upperSize ?? null, v.lowerSize ?? null, unit, ...values, v.remarks ?? null, who.userId, who.today, v.reason ?? null, prior?.id ?? null);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'cus.measure.revise', entityType: 'cus_measure_chart', entityId: id,
      data: { personId, revision: (prior?.revision_no ?? 0) + 1, supersedesId: prior?.id ?? null } });
    const warnings = measurements.filter((m, i) => {
      const value = values[i];
      const threshold = m === 'sleeveHole' ? 2500 : 6000;
      return value != null && value > threshold;
    }).map(m => ({ field: m, message: `Check ${m}: did you enter an extra digit or mean a decimal value?` }));
    return { id, ...chartResponse(get(db, 'cus_measure_charts', id)), warnings };
  });
}
