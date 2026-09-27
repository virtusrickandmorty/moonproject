import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { purSupplierInput, purSupplierContactInput, purSupplyInput } from './schemas.ts';
import { newId } from '@moonproject/shared';
import { AppError } from '@moonproject/shared';
import { appendAudit } from '../../engine/audit.ts';

const preconditionRequired = (msg: string) => new AppError('PRECONDITION_REQUIRED', msg, 428);
const badRequest = (msg: string) => new AppError('BAD_REQUEST', msg, 400);
const notFound = (msg: string) => new AppError('NOT_FOUND', msg, 404);
const conflict = (msg: string) => new AppError('CONFLICT', msg, 409);

export function purRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.get('/api/pur/suppliers', { config: { permission: 'pur.supplier.view' } }, async (req) => {
    return db.prepare('SELECT * FROM pur_suppliers WHERE is_active = 1 ORDER BY name').all();
  });

  app.post('/api/pur/suppliers', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const input = purSupplierInput.parse(req.body);
    const id = newId();
    const now = clock.now().toISOString();

    db.transaction(() => {
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
        userId: (req as any).user?.id || 'system',
        action: 'pur.supplier.create',
        entityType: 'pur_suppliers',
        entityId: id,
        data: { before: null, after },
      });
    })();
    return { id, version: 1 };
  });

  app.put('/api/pur/suppliers/:id', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = purSupplierInput.parse(req.body);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = clock.now().toISOString();

    let newVersion = 0;

    db.transaction(() => {
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
        userId: (req as any).user?.id || 'system',
        action: 'pur.supplier.edit',
        entityType: 'pur_suppliers',
        entityId: id,
        data: { before, after },
      });
    })();
    return { success: true, version: newVersion };
  });

  app.post('/api/pur/suppliers/:id/deactivate', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const now = clock.now().toISOString();

    db.transaction(() => {
      const before = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supplier not found');
      if (!before.is_active) return;

      db.prepare('UPDATE pur_suppliers SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(now, id);

      const after = db.prepare('SELECT * FROM pur_suppliers WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: (req as any).user?.id || 'system',
        action: 'pur.supplier.deactivate',
        entityType: 'pur_suppliers',
        entityId: id,
        data: { before, after },
      });
    })();
    return { success: true };
  });

  app.get('/api/pur/supplies', { config: { permission: 'pur.supply.view' } }, async (req) => {
    return db.prepare('SELECT * FROM pur_supplies WHERE is_active = 1 ORDER BY name').all();
  });

  app.post('/api/pur/supplies', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const input = purSupplyInput.parse(req.body);
    const id = newId();
    const now = clock.now().toISOString();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO pur_supplies (id, name, unit, category, last_purchase_cost_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.unit, input.category, input.lastPurchaseCostCents ?? 0, now, now);

      const after = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: (req as any).user?.id || 'system',
        action: 'pur.supply.create',
        entityType: 'pur_supplies',
        entityId: id,
        data: { before: null, after },
      });
    })();
    return { id, version: 1 };
  });

  app.put('/api/pur/supplies/:id', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const input = purSupplyInput.parse(req.body);
    const versionMatch = req.headers['if-match'];
    if (!versionMatch) throw preconditionRequired('Missing If-Match header');
    const expectedVersion = parseInt(versionMatch.replace(/"/g, ''), 10);
    const now = clock.now().toISOString();

    let newVersion = 0;

    db.transaction(() => {
      const before = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supply not found');
      if (!before.is_active) throw badRequest('Cannot edit deactivated supply');
      if (before.version !== expectedVersion) throw conflict('Supply was modified by someone else');

      // Note: lastPurchaseCostCents is intentionally ignored on edit, as it is owned by AP
      const result = db.prepare(`
        UPDATE pur_supplies SET name = ?, unit = ?, category = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?
      `).run(input.name, input.unit, input.category, now, id, expectedVersion);

      if (result.changes !== 1) throw conflict('Supply was modified by someone else');
      newVersion = expectedVersion + 1;

      const after = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: (req as any).user?.id || 'system',
        action: 'pur.supply.edit',
        entityType: 'pur_supplies',
        entityId: id,
        data: { before, after },
      });
    })();
    return { success: true, version: newVersion };
  });

  app.post('/api/pur/supplies/:id/deactivate', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const now = clock.now().toISOString();

    db.transaction(() => {
      const before = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id) as any;
      if (!before) throw notFound('Supply not found');
      if (!before.is_active) return;

      db.prepare('UPDATE pur_supplies SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(now, id);

      const after = db.prepare('SELECT * FROM pur_supplies WHERE id = ?').get(id);
      appendAudit(db, {
        at: now,
        userId: (req as any).user?.id || 'system',
        action: 'pur.supply.deactivate',
        entityType: 'pur_supplies',
        entityId: id,
        data: { before, after },
      });
    })();
    return { success: true };
  });
}
