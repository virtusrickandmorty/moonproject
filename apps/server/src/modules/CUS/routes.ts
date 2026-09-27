import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../../platform/db/driver.ts';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import { chartInput, contactInput, customerInput, customerUpdate, groupInput, measurements, normalizePhone, personInput, personUpdate, phoneInput, sizeInput } from './schemas.ts';

type Row = Record<string, unknown>;
const customerFields: Record<string, string> = {
  kind: 'kind', displayName: 'display_name', registeredName: 'registered_name', tin: 'tin',
  isVatRegistered: 'is_vat_registered', withholdingProfile: 'withholding_profile',
  billingAddress: 'billing_address', email: 'email', emailConsent: 'email_consent',
  creditTermsDays: 'credit_terms_days', parentCustomerId: 'parent_customer_id',
  legacyId: 'legacy_id', notes: 'notes',
};
const personFields: Record<string, string> = {
  fullName: 'full_name', groupId: 'group_id', nickname: 'nickname',
  defaultJerseyName: 'default_jersey_name', defaultJerseyNumber: 'default_jersey_number',
  gender: 'gender', birthday: 'birthday',
};

function id(req: FastifyRequest): string { return (req.params as { id: string }).id; }
function get(db: Db, table: string, rowId: string): Row {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId) as Row | undefined;
  if (!row) throw notFound('Record');
  return row;
}
function active(row: Row): void {
  if (row.is_active !== 1) throw conflict('INACTIVE', 'This record is inactive.');
}
function version(req: FastifyRequest, row: Row): void {
  const raw = req.headers['if-match'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new AppError('VERSION_REQUIRED', 'Reload this record before saving.', 428);
  if (Number(raw) !== row.version) throw conflict('VERSION_CHANGED', 'Someone changed this record. Reload it and review their changes.');
}
function params(q: unknown): { limit: number; offset: number; search: string } {
  const v = q as Record<string, unknown>;
  const limit = v?.limit === undefined ? 25 : Number(v.limit);
  const offset = v?.offset === undefined ? 0 : Number(v.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw new AppError('INVALID_PAGE', 'Choose a page size from 1 to 100.', 400);
  }
  return { limit, offset, search: String(v?.search ?? '').trim().slice(0, 200) };
}
function updated(db: Db, table: string, rowId: string, fields: Record<string, unknown>, map: Record<string, string>, at: string): void {
  const pairs = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!pairs.length) throw new AppError('NO_CHANGES', 'Enter a change before saving.', 400);
  const assignments = pairs.map(([key]) => `${map[key]} = ?`).join(', ');
  const values = pairs.map(([key, value]) => key === 'email' && typeof value === 'string' ? value.toLowerCase() : typeof value === 'boolean' ? Number(value) : value);
  db.prepare(`UPDATE ${table} SET ${assignments}, version = version + 1, updated_at = ? WHERE id = ?`).run(...values, at, rowId);
}
function audit(db: Db, req: FastifyRequest, at: string, action: string, kind: string, rowId: string, data: Record<string, unknown> = {}): void {
  appendAudit(db, { at, userId: currentUser(req).userId, action, entityType: kind, entityId: rowId, data });
}
function validateParent(db: Db, childId: string | null, parentId: string | null): void {
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
function validateGroup(db: Db, customerId: string, groupId: string | null | undefined): void {
  if (!groupId) return;
  const row = get(db, 'cus_groups', groupId);
  active(row);
  if (row.customer_id !== customerId) throw conflict('WRONG_GROUP', 'Choose a group belonging to this customer.');
}
function duplicates(db: Db, customerId: string | null, name: string, email: string | null): { id: string; reason: string }[] {
  const rows = db.prepare('SELECT id, display_name, email FROM cus_customers WHERE is_active = 1 AND id <> coalesce(?, \'\')').all(customerId) as { id: string; display_name: string; email: string | null }[];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const near = (a: string, b: string) => {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 2) return false;
    let distance = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next.push(Math.min(next[j - 1]! + 1, distance[j]! + 1, distance[j - 1]! + Number(a[i - 1] !== b[j - 1])));
      distance = next;
    }
    return distance[b.length]! <= 2;
  };
  const warnings: { id: string; reason: string }[] = [];
  for (const row of rows) {
    if (email && row.email?.toLowerCase() === email.toLowerCase()) warnings.push({ id: row.id, reason: 'email' });
    else if (near(norm(row.display_name), norm(name))) warnings.push({ id: row.id, reason: 'similar name' });
  }
  return warnings;
}
function customerWarnings(db: Db, rowId: string): { id: string; reason: string }[] {
  const row = get(db, 'cus_customers', rowId);
  const out = duplicates(db, rowId, row.display_name as string, row.email as string | null);
  const phones = db.prepare(`SELECT phone FROM cus_customer_phones WHERE customer_id = ? AND is_active = 1
    UNION SELECT phone FROM cus_customer_contacts WHERE customer_id = ? AND is_active = 1 AND phone IS NOT NULL`).all(rowId, rowId) as { phone: string }[];
  for (const { phone } of phones) {
    for (const other of db.prepare(`SELECT customer_id AS id FROM cus_customer_phones WHERE phone = ? AND customer_id <> ? AND is_active = 1
      UNION SELECT customer_id AS id FROM cus_customer_contacts WHERE phone = ? AND customer_id <> ? AND is_active = 1`).all(phone, rowId, phone, rowId) as { id: string }[]) {
      out.push({ id: other.id, reason: 'phone' });
    }
  }
  return out;
}

export function cusRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const timestamp = () => stamp(clock);

  app.get('/api/cus/customers', { config: { permission: 'cus.view' } }, async (req) => {
    const { limit, offset, search } = params(req.query);
    return db.prepare(`SELECT * FROM cus_customers WHERE display_name LIKE ? OR code LIKE ? ORDER BY display_name, id LIMIT ? OFFSET ?`).all(`%${search}%`, `%${search}%`, limit, offset);
  });
  app.post('/api/cus/customers', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = customerInput.parse(req.body);
    const rowId = newId(), at = timestamp();
    return db.transaction(() => {
      validateParent(db, rowId, input.parentCustomerId ?? null);
      const seq = db.prepare("UPDATE cus_sequences SET next_value = next_value + 1 WHERE key = 'customer' RETURNING next_value - 1 AS n").get() as { n: number };
      const code = `CUS-${String(seq.n).padStart(5, '0')}`;
      db.prepare(`INSERT INTO cus_customers (id, code, kind, display_name, registered_name, tin, is_vat_registered,
        withholding_profile, billing_address, email, email_consent, credit_terms_days, parent_customer_id,
        legacy_id, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        rowId, code, input.kind, input.displayName, input.registeredName ?? null, input.tin ?? null,
        Number(input.isVatRegistered ?? false), input.withholdingProfile ?? 'none', input.billingAddress ?? null,
        input.email?.toLowerCase() ?? null, Number(input.emailConsent ?? false), input.creditTermsDays ?? 0,
        input.parentCustomerId ?? null, input.legacyId ?? null, input.notes ?? null, at, at,
      );
      audit(db, req, at, 'cus.customer.create', 'cus_customer', rowId);
      return { ...get(db, 'cus_customers', rowId), duplicateWarnings: customerWarnings(db, rowId) };
    }).immediate();
  });
  app.get('/api/cus/customers/:id', { config: { permission: 'cus.view' } }, async (req) => ({
    ...get(db, 'cus_customers', id(req)),
    contacts: db.prepare('SELECT * FROM cus_customer_contacts WHERE customer_id = ? AND is_active = 1').all(id(req)),
    phones: db.prepare('SELECT * FROM cus_customer_phones WHERE customer_id = ? AND is_active = 1').all(id(req)),
    groups: db.prepare('SELECT * FROM cus_groups WHERE customer_id = ? ORDER BY name').all(id(req)),
    people: db.prepare('SELECT * FROM cus_people WHERE customer_id = ? ORDER BY full_name').all(id(req)),
  }));
  app.put('/api/cus/customers/:id', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = customerUpdate.parse(req.body), at = timestamp(), rowId = id(req);
    return db.transaction(() => {
      const row = get(db, 'cus_customers', rowId); active(row); version(req, row);
      if (input.parentCustomerId !== undefined) validateParent(db, rowId, input.parentCustomerId);
      updated(db, 'cus_customers', rowId, input, customerFields, at);
      audit(db, req, at, 'cus.customer.update', 'cus_customer', rowId, { fields: Object.keys(input) });
      return { ...get(db, 'cus_customers', rowId), duplicateWarnings: customerWarnings(db, rowId) };
    }).immediate();
  });
  app.post('/api/cus/customers/:id/deactivate', { config: { permission: 'cus.manage' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_customers', rowId); active(row); version(req, row);
      const children = db.prepare(`SELECT
        (SELECT count(*) FROM cus_groups WHERE customer_id = ? AND is_active = 1) +
        (SELECT count(*) FROM cus_people WHERE customer_id = ? AND is_active = 1) +
        (SELECT count(*) FROM cus_customers WHERE parent_customer_id = ? AND is_active = 1) AS n`).get(rowId, rowId, rowId) as { n: number };
      if (children.n) throw conflict('HAS_ACTIVE_CHILDREN', 'Deactivate this customer’s groups, wearers and child customers first.');
      db.prepare('UPDATE cus_customers SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(at, rowId);
      audit(db, req, at, 'cus.customer.deactivate', 'cus_customer', rowId);
      return get(db, 'cus_customers', rowId);
    }).immediate();
  });

  app.post('/api/cus/customers/:id/contacts', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = contactInput.parse(req.body), customerId = id(req), rowId = newId(), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_customers', customerId));
      db.prepare('INSERT INTO cus_customer_contacts (id,customer_id,name,role,phone,email,created_at) VALUES (?,?,?,?,?,?,?)').run(
        rowId, customerId, input.name, input.role ?? null, input.phone ? normalizePhone(input.phone) : null, input.email?.toLowerCase() ?? null, at,
      );
      audit(db, req, at, 'cus.contact.create', 'cus_contact', rowId, { customerId });
      return { ...get(db, 'cus_customer_contacts', rowId), duplicateWarnings: customerWarnings(db, customerId) };
    }).immediate();
  });
  app.post('/api/cus/customers/:id/phones', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = phoneInput.parse(req.body), customerId = id(req), rowId = newId(), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_customers', customerId));
      db.prepare('INSERT INTO cus_customer_phones (id,customer_id,phone,label,created_at) VALUES (?,?,?,?,?)').run(rowId, customerId, normalizePhone(input.phone), input.label ?? null, at);
      audit(db, req, at, 'cus.phone.create', 'cus_phone', rowId, { customerId });
      return { ...get(db, 'cus_customer_phones', rowId), duplicateWarnings: customerWarnings(db, customerId) };
    }).immediate();
  });
  for (const [path, table, kind] of [
    ['/api/cus/contacts/:id/deactivate', 'cus_customer_contacts', 'contact'],
    ['/api/cus/phones/:id/deactivate', 'cus_customer_phones', 'phone'],
  ] as const) {
    app.post(path, { config: { permission: 'cus.manage' } }, async (req) => {
      const rowId = id(req), at = timestamp();
      return db.transaction(() => {
        const row = get(db, table, rowId); active(row);
        db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(rowId);
        audit(db, req, at, `cus.${kind}.deactivate`, `cus_${kind}`, rowId);
        return get(db, table, rowId);
      }).immediate();
    });
  }

  app.post('/api/cus/customers/:id/groups', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = groupInput.parse(req.body), customerId = id(req), rowId = newId(), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_customers', customerId));
      db.prepare('INSERT INTO cus_groups (id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(rowId, customerId, input.name, at, at);
      audit(db, req, at, 'cus.group.create', 'cus_group', rowId, { customerId });
      return get(db, 'cus_groups', rowId);
    }).immediate();
  });
  app.put('/api/cus/groups/:id', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = groupInput.parse(req.body), rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_groups', rowId); active(row); version(req, row);
      db.prepare('UPDATE cus_groups SET name = ?, version = version + 1, updated_at = ? WHERE id = ?').run(input.name, at, rowId);
      audit(db, req, at, 'cus.group.update', 'cus_group', rowId);
      return get(db, 'cus_groups', rowId);
    }).immediate();
  });
  app.post('/api/cus/groups/:id/deactivate', { config: { permission: 'cus.manage' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_groups', rowId); active(row); version(req, row);
      const n = db.prepare('SELECT count(*) AS n FROM cus_people WHERE group_id = ? AND is_active = 1').get(rowId) as { n: number };
      if (n.n) throw conflict('GROUP_HAS_WEARERS', 'Move or deactivate the wearers in this group first.');
      db.prepare('UPDATE cus_groups SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(at, rowId);
      audit(db, req, at, 'cus.group.deactivate', 'cus_group', rowId);
      return get(db, 'cus_groups', rowId);
    }).immediate();
  });

  app.post('/api/cus/customers/:id/people', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = personInput.parse(req.body), customerId = id(req), rowId = newId(), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_customers', customerId)); validateGroup(db, customerId, input.groupId);
      db.prepare(`INSERT INTO cus_people (id,customer_id,group_id,full_name,nickname,default_jersey_name,
        default_jersey_number,gender,birthday,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        rowId, customerId, input.groupId ?? null, input.fullName, input.nickname ?? null,
        input.defaultJerseyName ?? null, input.defaultJerseyNumber ?? null, input.gender ?? null,
        input.birthday ?? null, at, at,
      );
      audit(db, req, at, 'cus.person.create', 'cus_person', rowId, { customerId, groupId: input.groupId ?? null });
      return get(db, 'cus_people', rowId);
    }).immediate();
  });
  app.put('/api/cus/people/:id', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = personUpdate.parse(req.body), rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_people', rowId); active(row); version(req, row);
      validateGroup(db, row.customer_id as string, input.groupId);
      updated(db, 'cus_people', rowId, input, personFields, at);
      audit(db, req, at, 'cus.person.update', 'cus_person', rowId, { fields: Object.keys(input), fromGroupId: row.group_id, toGroupId: input.groupId });
      return get(db, 'cus_people', rowId);
    }).immediate();
  });
  app.post('/api/cus/people/:id/deactivate', { config: { permission: 'cus.manage' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_people', rowId); active(row); version(req, row);
      db.prepare('UPDATE cus_people SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(at, rowId);
      db.prepare("UPDATE cus_measure_charts SET status = 'inactive' WHERE person_id = ? AND status = 'active'").run(rowId);
      audit(db, req, at, 'cus.person.deactivate', 'cus_person', rowId);
      return get(db, 'cus_people', rowId);
    }).immediate();
  });

  app.get('/api/cus/sizes', { config: { permission: 'cus.measure.view' } }, async () => db.prepare('SELECT * FROM cus_sizes ORDER BY category,label').all());
  app.post('/api/cus/sizes', { config: { permission: 'cus.sizes.manage' } }, async (req) => {
    const input = sizeInput.parse(req.body), at = timestamp(), rowId = input.label;
    return db.transaction(() => {
      db.prepare('INSERT INTO cus_sizes (id,label,category) VALUES (?,?,?)').run(rowId, input.label, input.category);
      audit(db, req, at, 'cus.size.create', 'cus_size', rowId);
      return get(db, 'cus_sizes', rowId);
    }).immediate();
  });
  app.post('/api/cus/sizes/:id/deactivate', { config: { permission: 'cus.sizes.manage' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_sizes', rowId));
      db.prepare('UPDATE cus_sizes SET is_active = 0 WHERE id = ?').run(rowId);
      audit(db, req, at, 'cus.size.deactivate', 'cus_size', rowId);
      return get(db, 'cus_sizes', rowId);
    }).immediate();
  });

  app.get('/api/cus/people/:id/measurements', { config: { permission: 'cus.measure.view' } }, async (req) => {
    get(db, 'cus_people', id(req));
    return db.prepare('SELECT * FROM cus_measure_charts WHERE person_id = ? ORDER BY revision_no DESC').all(id(req));
  });
  app.post('/api/cus/people/:id/measurements', { config: { permission: 'cus.measure' } }, async (req) => {
    const input = chartInput.parse(req.body), personId = id(req), rowId = newId(), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_people', personId));
      const prior = db.prepare('SELECT id,revision_no FROM cus_measure_charts WHERE person_id = ? ORDER BY revision_no DESC LIMIT 1').get(personId) as { id: string; revision_no: number } | undefined;
      if (prior && !input.reason) throw new AppError('REVISION_REASON', 'Give a reason for the new measurement revision.', 400);
      if (input.sizeMode === 'preset' && !input.upperSize && !input.lowerSize) throw new AppError('SIZE_REQUIRED', 'Choose an upper or lower size.', 400);
      if (input.sizeMode === 'measured' && !measurements.some((m) => input.values[m] != null)) throw new AppError('MEASUREMENT_REQUIRED', 'Enter at least one measurement.', 400);
      for (const size of [input.upperSize, input.lowerSize]) if (size) active(get(db, 'cus_sizes', size));
      const rev = (prior?.revision_no ?? 0) + 1;
      if (prior) db.prepare("UPDATE cus_measure_charts SET status = 'superseded' WHERE id = ? AND status = 'active'").run(prior.id);
      const cols = measurements.map((m) => m.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
      db.prepare(`INSERT INTO cus_measure_charts (id,person_id,revision_no,status,size_mode,upper_size,lower_size,unit,${cols.join(',')},remarks,measured_by,measured_on,reason,supersedes_id)
        VALUES (${Array(8 + cols.length + 5).fill('?').join(',')})`).run(
        rowId, personId, rev, 'active', input.sizeMode, input.upperSize ?? null, input.lowerSize ?? null, input.unit ?? 'inch',
        ...measurements.map((m) => input.values[m] ?? null), input.remarks ?? null, currentUser(req).userId,
        today(clock), input.reason ?? null, prior?.id ?? null,
      );
      audit(db, req, at, 'cus.measure.revise', 'cus_measure_chart', rowId, { personId, revision: rev, supersedesId: prior?.id ?? null });
      const warnings = measurements.filter((m) => {
        const value = input.values[m];
        const threshold = m === 'sleeveHole' ? (input.unit === 'cm' ? 60 : 25) : (input.unit === 'cm' ? 150 : 60);
        return value != null && value > threshold;
      }).map((m) => ({ field: m, message: `Check ${m}: did you enter an extra digit or mean a decimal value?` }));
      return { ...get(db, 'cus_measure_charts', rowId), warnings };
    }).immediate();
  });
  app.post('/api/cus/measurements/:id/deactivate', { config: { permission: 'cus.measure' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_measure_charts', rowId);
      if (row.status !== 'active') throw conflict('CHART_NOT_ACTIVE', 'Only the current chart can be deactivated.');
      db.prepare("UPDATE cus_measure_charts SET status = 'inactive' WHERE id = ?").run(rowId);
      audit(db, req, at, 'cus.measure.deactivate', 'cus_measure_chart', rowId);
      return get(db, 'cus_measure_charts', rowId);
    }).immediate();
  });

  app.post('/api/cus/customers/:id/merge', { config: { permission: 'cus.merge' } }, async (req) => {
    const sourceId = id(req), body = req.body as { intoCustomerId?: unknown; reason?: unknown }, at = timestamp();
    if (!body || Object.keys(body).some((k) => !['intoCustomerId', 'reason'].includes(k)) || typeof body.intoCustomerId !== 'string' || typeof body.reason !== 'string' || body.reason.trim().length < 10) {
      throw new AppError('INVALID_MERGE', 'Choose a destination and give a reason of at least 10 characters.', 400);
    }
    return db.transaction(() => {
      const source = get(db, 'cus_customers', sourceId), target = get(db, 'cus_customers', body.intoCustomerId as string);
      active(source); active(target); version(req, source);
      const targetVersion = req.headers['x-target-version'];
      if (typeof targetVersion !== 'string' || !/^\d+$/.test(targetVersion)) throw new AppError('VERSION_REQUIRED', 'Reload the destination customer before merging.', 428);
      if (Number(targetVersion) !== target.version) throw conflict('VERSION_CHANGED', 'The destination customer changed. Reload it before merging.');
      if (sourceId === target.id) throw conflict('SAME_CUSTOMER', 'Choose a different customer to merge into.');
      validateParent(db, sourceId, target.id as string);
      const collisions = db.prepare(`SELECT count(*) AS n FROM cus_groups s JOIN cus_groups t
        ON t.customer_id = ? AND s.customer_id = ? AND t.is_active = 1 AND s.is_active = 1 AND t.name = s.name COLLATE NOCASE`).get(target.id, sourceId) as { n: number };
      if (collisions.n) throw conflict('GROUP_NAME_CONFLICT', 'Rename duplicate group names before merging.');
      db.prepare('UPDATE cus_customer_contacts SET customer_id = ? WHERE customer_id = ?').run(target.id, sourceId);
      db.prepare('UPDATE cus_customer_phones SET customer_id = ? WHERE customer_id = ?').run(target.id, sourceId);
      db.prepare('UPDATE cus_groups SET customer_id = ? WHERE customer_id = ?').run(target.id, sourceId);
      db.prepare('UPDATE cus_people SET customer_id = ? WHERE customer_id = ?').run(target.id, sourceId);
      db.prepare('UPDATE cus_customers SET parent_customer_id = ? WHERE parent_customer_id = ?').run(target.id, sourceId);
      db.prepare('UPDATE cus_customers SET is_active = 0, merged_into_id = ?, version = version + 1, updated_at = ? WHERE id = ?').run(target.id, at, sourceId);
      db.prepare('UPDATE cus_customers SET version = version + 1, updated_at = ? WHERE id = ?').run(at, target.id);
      audit(db, req, at, 'cus.customer.merge', 'cus_customer', sourceId, { intoCustomerId: target.id, reason: (body.reason as string).trim() });
      return get(db, 'cus_customers', sourceId);
    }).immediate();
  });
}
