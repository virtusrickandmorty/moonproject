import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { purSupplierInput, purSupplierContactInput, purSupplyInput } from './schemas.ts';
import { newId } from '@moonproject/shared';
import { AppError } from '@moonproject/shared';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { purLookupRoutes } from './lookups.ts';
import { countableSupply, latestPurchaseCost } from './public.ts';

const costFields = (cost: ReturnType<typeof latestPurchaseCost>) => ({
  purchase_cost_cents: cost.unitCostCents,
  purchase_cost_source: cost.source,
  purchase_cost_source_number: cost.sourceNumber,
  purchase_cost_source_date: cost.sourceDate,
});

const preconditionRequired = (msg: string) => new AppError('PRECONDITION_REQUIRED', msg, 428);
const badRequest = (msg: string) => new AppError('BAD_REQUEST', msg, 400);
const notFound = (msg: string) => new AppError('NOT_FOUND', msg, 404);
const conflict = (msg: string) => new AppError('CONFLICT', msg, 409);

/** `?status=` on the master lists: active (the default, as before), inactive or all. */
const listStatus = (query: unknown) => z.object({ status: z.enum(['active', 'inactive', 'all']).default('active') }).parse(query).status;
const statusWhere = (status: 'active' | 'inactive' | 'all') => (status === 'all' ? '' : `WHERE is_active = ${status === 'active' ? 1 : 0}`);

export function purRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  purLookupRoutes(app, deps);

  app.get('/api/pur/suppliers', { config: { permission: 'pur.supplier.view' } }, async (req) => {
    return db.prepare(`SELECT * FROM pur_suppliers ${statusWhere(listStatus(req.query))} ORDER BY name`).all();
  });

  app.get('/api/pur/suppliers/:id', { config: { permission: 'pur.supplier.view' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const supplier = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id);
    if (!supplier) throw notFound('Supplier not found');
    return supplier;
  });

  app.post('/api/pur/suppliers', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const input = purSupplierInput.parse(req.body);
    const id = newId();
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      db.prepare(`
        INSERT INTO pur_suppliers (id, name, registered_name, tin, is_vat_registered, ewt_class, sworn_declaration_until, payment_terms_days, legacy_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name,
        input.registeredName,
        input.tin || null,
        input.isVatRegistered ? 1 : 0,
        input.ewtClass === 'none' ? null : (input.ewtClass ?? null),
        input.swornDeclarationUntil ?? null,
        input.paymentTermsDays ?? null,
        input.legacyId ?? null,
        now,
        now
      );

      const after = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supplier.create',
        entityType: 'pur_suppliers',
        entityId: id,
        data: { before: null, after },
      });
    });
    return { id, version: 1 };
  });

  app.put('/api/pur/suppliers/:id', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = purSupplierInput.parse(req.body);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = stamp(clock);
    const user = currentUser(req);

    let newVersion = 0;

    tx(db, () => {
      const before = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supplier not found');
      if (!before.is_active) throw badRequest('Cannot edit deactivated supplier');
      if (before.version !== expectedVersion) throw conflict('Supplier was modified by someone else');

      const result = db.prepare(`
        UPDATE pur_suppliers SET
          name = ?, registered_name = ?, tin = ?, is_vat_registered = ?, ewt_class = ?, sworn_declaration_until = ?, payment_terms_days = ?, legacy_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(
        input.name,
        input.registeredName,
        input.tin || null,
        input.isVatRegistered ? 1 : 0,
        input.ewtClass === 'none' ? null : (input.ewtClass ?? null),
        input.swornDeclarationUntil ?? null,
        input.paymentTermsDays ?? null,
        input.legacyId ?? null,
        now,
        id,
        expectedVersion
      );

      if (result.changes !== 1) throw conflict('Supplier was modified by someone else');
      newVersion = expectedVersion + 1;

      const after = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supplier.edit',
        entityType: 'pur_suppliers',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true, version: newVersion };
  });

  app.post('/api/pur/suppliers/:id/deactivate', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      const before = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supplier not found');
      if (!before.is_active) return;
      if (before.version !== expectedVersion) throw conflict('Supplier was modified by someone else');

      const result = db.prepare('UPDATE pur_suppliers SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(now, id, expectedVersion);
      if (result.changes !== 1) throw conflict('Supplier was modified by someone else');

      const after = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supplier.deactivate',
        entityType: 'pur_suppliers',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true };
  });

  app.get('/api/pur/suppliers/:id/contacts', { config: { permission: 'pur.supplier.view' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return db.prepare('SELECT * FROM pur_supplier_contacts WHERE supplier_id = ? AND is_active = 1 ORDER BY name').all(id);
  });

  app.post('/api/pur/suppliers/:id/contacts', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id: supplierId } = z.object({ id: z.string() }).parse(req.params);
    const input = purSupplierContactInput.parse(req.body);
    const id = newId();
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      const supplier = db.prepare('SELECT is_active FROM pur_suppliers WHERE id = ?').get(supplierId) as any;
      if (!supplier) throw notFound('Supplier not found');
      if (!supplier.is_active) throw badRequest('Cannot add contact to deactivated supplier');

      db.prepare(`
        INSERT INTO pur_supplier_contacts (id, supplier_id, name, role, phone, email, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        supplierId,
        input.name,
        input.role ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.isActive ? 1 : 0,
        now,
        now
      );

      const after = db.prepare('SELECT * FROM pur_supplier_contacts WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supplier.contact.create',
        entityType: 'pur_supplier_contacts',
        entityId: id,
        data: { before: null, after },
      });
    });
    return { id };
  });

  app.post('/api/pur/suppliers/:supplierId/contacts/:id/deactivate', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { supplierId, id } = z.object({ supplierId: z.string(), id: z.string() }).parse(req.params);
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      const before = db.prepare('SELECT * FROM pur_supplier_contacts WHERE id = ? AND supplier_id = ?').get(id, supplierId) as any;
      if (!before) throw notFound('Contact not found');
      if (!before.is_active) return;

      db.prepare('UPDATE pur_supplier_contacts SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);

      const after = db.prepare('SELECT * FROM pur_supplier_contacts WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supplier.contact.deactivate',
        entityType: 'pur_supplier_contacts',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true };
  });

  app.get('/api/pur/supplies', { config: { permission: 'pur.supply.view' } }, async (req) => {
    const rows = db.prepare(`SELECT id, name, unit, category, is_active, version FROM pur_supplies ${statusWhere(listStatus(req.query))} ORDER BY name`).all() as Record<string, unknown>[];
    const asOf = today(clock);
    return rows.map((row) => ({ ...row, ...costFields(latestPurchaseCost(db, countableSupply(db, row.id as string)!, asOf)) }));
  });

  app.get('/api/pur/supplies/:id', { config: { permission: 'pur.supply.view' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const row = db.prepare('SELECT id, name, unit, category, is_active, version FROM pur_supplies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    const supply = countableSupply(db, id);
    if (!row || !supply) throw notFound('Supply not found');
    return { ...row, ...costFields(latestPurchaseCost(db, supply, today(clock))) };
  });

  app.post('/api/pur/supplies', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const input = purSupplyInput.parse(req.body);
    const id = newId();
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      db.prepare(`
        INSERT INTO pur_supplies (id, name, unit, category, last_purchase_cost_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.unit, input.category, 0, now, now);

      const after = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supply.create',
        entityType: 'pur_supplies',
        entityId: id,
        data: { before: null, after },
      });
    });
    return { id, version: 1 };
  });

  app.put('/api/pur/supplies/:id', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = purSupplyInput.parse(req.body);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = stamp(clock);
    const user = currentUser(req);

    let newVersion = 0;

    tx(db, () => {
      const before = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supply not found');
      if (!before.is_active) throw badRequest('Cannot edit deactivated supply');
      if (before.version !== expectedVersion) throw conflict('Supply was modified by someone else');

      const result = db.prepare(`
        UPDATE pur_supplies SET name = ?, unit = ?, category = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?
      `).run(input.name, input.unit, input.category, now, id, expectedVersion);

      if (result.changes !== 1) throw conflict('Supply was modified by someone else');
      newVersion = expectedVersion + 1;

      const after = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supply.edit',
        entityType: 'pur_supplies',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true, version: newVersion };
  });

  app.post('/api/pur/supplies/:id/deactivate', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = stamp(clock);
    const user = currentUser(req);

    tx(db, () => {
      const before = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supply not found');
      if (!before.is_active) return;
      if (before.version !== expectedVersion) throw conflict('Supply was modified by someone else');

      const result = db.prepare('UPDATE pur_supplies SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(now, id, expectedVersion);
      if (result.changes !== 1) throw conflict('Supply was modified by someone else');

      const after = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: user.userId,
        action: 'pur.supply.deactivate',
        entityType: 'pur_supplies',
        entityId: id,
        data: { before, after },
      });
    });
    return { success: true };
  });
}
