import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../../platform/db/driver.ts';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import { contactInput, customerUpdate, groupInput, mergeInput, normalizePhone, personUpdate, phoneInput, sizeInput } from './schemas.ts';
import { chartResponse } from './measurements.ts';
import { auditChanges, customerFields, personalCustomerFields, validateParent, validateGroup,
  createCustomer, createGroup, createWearer, createMeasurement } from './create.ts';

type Row = Record<string, unknown>;
const personFields: Record<string, string> = {
  fullName: 'full_name', groupId: 'group_id', nickname: 'nickname',
  defaultJerseyName: 'default_jersey_name', defaultJerseyNumber: 'default_jersey_number',
  gender: 'gender', birthday: 'birthday',
};
const personalPersonFields = new Set(['fullName', 'nickname', 'defaultJerseyName', 'defaultJerseyNumber', 'gender', 'birthday']);

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
    const created = createCustomer(db, req.body, { userId: currentUser(req).userId, at: timestamp(), today: today(clock) });
    return { ...get(db, 'cus_customers', created.id), duplicateWarnings: customerWarnings(db, created.id) };
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
      const next = get(db, 'cus_customers', rowId);
      audit(db, req, at, 'cus.customer.update', 'cus_customer', rowId, auditChanges(row, next, input, customerFields, personalCustomerFields));
      return { ...next, duplicateWarnings: customerWarnings(db, rowId) };
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
      audit(db, req, at, 'cus.customer.deactivate', 'cus_customer', rowId, { changes: { isActive: { before: 1, after: 0 } } });
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
        const row = get(db, table, rowId); active(row); version(req, row);
        db.prepare(`UPDATE ${table} SET is_active = 0, version = version + 1 WHERE id = ?`).run(rowId);
        audit(db, req, at, `cus.${kind}.deactivate`, `cus_${kind}`, rowId, { changes: { isActive: { before: 1, after: 0 } } });
        return get(db, table, rowId);
      }).immediate();
    });
  }

  app.post('/api/cus/customers/:id/groups', { config: { permission: 'cus.manage' } }, async (req) => {
    const customerId = id(req);
    const created = createGroup(db, customerId, req.body, { userId: currentUser(req).userId, at: timestamp(), today: today(clock) });
    return get(db, 'cus_groups', created.id);
  });
  app.put('/api/cus/groups/:id', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = groupInput.parse(req.body), rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_groups', rowId); active(row); version(req, row);
      const duplicate = db.prepare('SELECT id FROM cus_groups WHERE customer_id = ? AND name = ? COLLATE NOCASE AND is_active = 1 AND id <> ?').get(row.customer_id, input.name, rowId);
      if (duplicate) throw conflict('GROUP_EXISTS', 'This customer already has an active group with that name.');
      db.prepare('UPDATE cus_groups SET name = ?, version = version + 1, updated_at = ? WHERE id = ?').run(input.name, at, rowId);
      audit(db, req, at, 'cus.group.update', 'cus_group', rowId, { fields: ['name'] });
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
      audit(db, req, at, 'cus.group.deactivate', 'cus_group', rowId, { changes: { isActive: { before: 1, after: 0 } } });
      return get(db, 'cus_groups', rowId);
    }).immediate();
  });

  app.post('/api/cus/customers/:id/people', { config: { permission: 'cus.manage' } }, async (req) => {
    const customerId = id(req);
    const created = createWearer(db, customerId, req.body, { userId: currentUser(req).userId, at: timestamp(), today: today(clock) });
    return get(db, 'cus_people', created.id);
  });
  app.put('/api/cus/people/:id', { config: { permission: 'cus.manage' } }, async (req) => {
    const input = personUpdate.parse(req.body), rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_people', rowId); active(row); version(req, row);
      validateGroup(db, row.customer_id as string, input.groupId);
      updated(db, 'cus_people', rowId, input, personFields, at);
      const next = get(db, 'cus_people', rowId);
      audit(db, req, at, 'cus.person.update', 'cus_person', rowId, auditChanges(row, next, input, personFields, personalPersonFields));
      return next;
    }).immediate();
  });
  app.post('/api/cus/people/:id/deactivate', { config: { permission: 'cus.manage' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_people', rowId); active(row); version(req, row);
      db.prepare('UPDATE cus_people SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(at, rowId);
      db.prepare("UPDATE cus_measure_charts SET status = 'inactive' WHERE person_id = ? AND status = 'active'").run(rowId);
      audit(db, req, at, 'cus.person.deactivate', 'cus_person', rowId, { changes: { isActive: { before: 1, after: 0 } } });
      return get(db, 'cus_people', rowId);
    }).immediate();
  });

  app.get('/api/cus/sizes', { config: { permission: 'cus.measure.view' } }, async () => db.prepare('SELECT * FROM cus_sizes ORDER BY category,label').all());
  app.post('/api/cus/sizes', { config: { permission: 'cus.sizes.manage' } }, async (req) => {
    const input = sizeInput.parse(req.body), at = timestamp(), rowId = newId();
    return db.transaction(() => {
      const duplicate = db.prepare('SELECT id FROM cus_sizes WHERE label = ? COLLATE NOCASE').get(input.label);
      if (duplicate) throw conflict('SIZE_EXISTS', 'A size with that label already exists.');
      db.prepare('INSERT INTO cus_sizes (id,label,category) VALUES (?,?,?)').run(rowId, input.label, input.category);
      audit(db, req, at, 'cus.size.create', 'cus_size', rowId, { changes: { category: { before: null, after: input.category } }, fields: ['label', 'category'] });
      return get(db, 'cus_sizes', rowId);
    }).immediate();
  });
  app.post('/api/cus/sizes/:id/deactivate', { config: { permission: 'cus.sizes.manage' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      active(get(db, 'cus_sizes', rowId));
      db.prepare('UPDATE cus_sizes SET is_active = 0 WHERE id = ?').run(rowId);
      audit(db, req, at, 'cus.size.deactivate', 'cus_size', rowId, { changes: { isActive: { before: 1, after: 0 } } });
      return get(db, 'cus_sizes', rowId);
    }).immediate();
  });

  app.get('/api/cus/people/:id/measurements', { config: { permission: 'cus.measure.view' } }, async (req) => {
    get(db, 'cus_people', id(req));
    return (db.prepare('SELECT * FROM cus_measure_charts WHERE person_id = ? ORDER BY revision_no DESC').all(id(req)) as Row[]).map(chartResponse);
  });
  app.post('/api/cus/people/:id/measurements', { config: { permission: 'cus.measure' } }, async (req) => {
    return createMeasurement(db, id(req), req.body, { userId: currentUser(req).userId, at: timestamp(), today: today(clock) });
  });
  app.post('/api/cus/measurements/:id/deactivate', { config: { permission: 'cus.measure' } }, async (req) => {
    const rowId = id(req), at = timestamp();
    return db.transaction(() => {
      const row = get(db, 'cus_measure_charts', rowId);
      if (row.status !== 'active') throw conflict('CHART_NOT_ACTIVE', 'Only the current chart can be deactivated.');
      db.prepare("UPDATE cus_measure_charts SET status = 'inactive' WHERE id = ?").run(rowId);
      audit(db, req, at, 'cus.measure.deactivate', 'cus_measure_chart', rowId, { changes: { status: { before: 'active', after: 'inactive' } } });
      return chartResponse(get(db, 'cus_measure_charts', rowId));
    }).immediate();
  });

  app.post('/api/cus/customers/:id/merge', { config: { permission: 'cus.merge' } }, async (req) => {
    const sourceId = id(req), body = mergeInput.parse(req.body), at = timestamp();
    return db.transaction(() => {
      const source = get(db, 'cus_customers', sourceId), target = get(db, 'cus_customers', body.intoCustomerId);
      active(source); active(target); version(req, source);
      const targetVersion = req.headers['x-target-version'];
      if (typeof targetVersion !== 'string' || !/^\d+$/.test(targetVersion)) throw new AppError('VERSION_REQUIRED', 'Reload the destination customer before merging.', 428);
      if (Number(targetVersion) !== target.version) throw conflict('VERSION_CHANGED', 'The destination customer changed. Reload it before merging.');
      if (sourceId === target.id) throw conflict('SAME_CUSTOMER', 'Choose a different customer to merge into.');
      validateParent(db, sourceId, target.id as string);
      const collisions = db.prepare(`SELECT count(*) AS n FROM cus_groups s JOIN cus_groups t
        ON t.customer_id = ? AND s.customer_id = ? AND t.is_active = 1 AND s.is_active = 1 AND t.name = s.name COLLATE NOCASE`).get(target.id, sourceId) as { n: number };
      if (collisions.n) throw conflict('GROUP_NAME_CONFLICT', 'Rename duplicate group names before merging.');
      const links = [
        ['cus_customer_contacts', 'customer_id'], ['cus_customer_phones', 'customer_id'],
        ['cus_groups', 'customer_id'], ['cus_people', 'customer_id'], ['cus_customers', 'parent_customer_id'],
      ] as const;
      const relinks = links.flatMap(([table, column]) =>
        (db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).all(sourceId) as { id: string }[])
          .map(({ id: rowId }) => ({ table, column, rowId })),
      );
      audit(db, req, at, 'cus.customer.merge', 'cus_customer', sourceId, {
        intoCustomerId: target.id, reason: body.reason, relinkCount: relinks.length,
        changes: { isActive: { before: 1, after: 0 }, mergedIntoId: { before: null, after: target.id } },
      });
      const mergeAuditSeq = (db.prepare('SELECT seq FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { seq: number }).seq;
      const insertRelink = db.prepare(`INSERT INTO cus_merge_relinks
        (id,merge_audit_seq,table_name,row_id,from_customer_id,to_customer_id,created_at) VALUES (?,?,?,?,?,?,?)`);
      for (const link of relinks) insertRelink.run(newId(), mergeAuditSeq, link.table, link.rowId, sourceId, target.id, at);
      for (const [table, column] of links) {
        if (table === 'cus_customer_contacts' || table === 'cus_customer_phones') {
          db.prepare(`UPDATE ${table} SET ${column} = ?, version = version + 1 WHERE ${column} = ?`).run(target.id, sourceId);
        } else {
          db.prepare(`UPDATE ${table} SET ${column} = ?, version = version + 1, updated_at = ? WHERE ${column} = ?`).run(target.id, at, sourceId);
        }
      }
      db.prepare('UPDATE cus_customers SET is_active = 0, merged_into_id = ?, version = version + 1, updated_at = ? WHERE id = ?').run(target.id, at, sourceId);
      db.prepare('UPDATE cus_customers SET version = version + 1, updated_at = ? WHERE id = ?').run(at, target.id);
      return get(db, 'cus_customers', sourceId);
    }).immediate();
  });
}
