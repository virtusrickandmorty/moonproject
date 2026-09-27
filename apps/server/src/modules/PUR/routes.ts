import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { ewtClassSchema, purSupplierInput, purSupplyInput } from '@moonproject/shared';

export function purRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/api/pur/suppliers', { config: { permission: 'pur.supplier.view' } }, async (req) => {
    return db.prepare('SELECT * FROM pur_suppliers WHERE is_active = 1 ORDER BY name').all();
  });

  app.post('/api/pur/suppliers', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const input = purSupplierInput.parse(req.body);
    const result = db.prepare(`
      INSERT INTO pur_suppliers (name, registered_name, tin, is_vat_registered, ewt_class, sworn_declaration_until, payment_terms, bank_details, contacts, legacy_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name,
      input.registeredName,
      input.tin,
      input.isVatRegistered ? 1 : 0,
      input.ewtClass ?? null,
      input.swornDeclarationUntil ?? null,
      input.paymentTerms ?? null,
      input.bankDetails ?? null,
      input.contacts ?? null,
      input.legacyId ?? null
    );
    return { id: result.lastInsertRowid };
  });

  app.put('/api/pur/suppliers/:id', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const input = purSupplierInput.parse(req.body);
    db.prepare(`
      UPDATE pur_suppliers SET
        name = ?, registered_name = ?, tin = ?, is_vat_registered = ?, ewt_class = ?, sworn_declaration_until = ?, payment_terms = ?, bank_details = ?, contacts = ?, legacy_id = ?
      WHERE id = ?
    `).run(
      input.name,
      input.registeredName,
      input.tin,
      input.isVatRegistered ? 1 : 0,
      input.ewtClass ?? null,
      input.swornDeclarationUntil ?? null,
      input.paymentTerms ?? null,
      input.bankDetails ?? null,
      input.contacts ?? null,
      input.legacyId ?? null,
      id
    );
    return { success: true };
  });

  app.post('/api/pur/suppliers/:id/deactivate', { config: { permission: 'pur.supplier.edit' } }, async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    db.prepare('UPDATE pur_suppliers SET is_active = 0 WHERE id = ?').run(id);
    return { success: true };
  });

  app.get('/api/pur/supplies', { config: { permission: 'pur.supply.view' } }, async (req) => {
    return db.prepare('SELECT * FROM pur_supplies WHERE is_active = 1 ORDER BY name').all();
  });

  app.post('/api/pur/supplies', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const input = purSupplyInput.parse(req.body);
    const result = db.prepare(`
      INSERT INTO pur_supplies (name, unit, category, last_purchase_cost_cents)
      VALUES (?, ?, ?, ?)
    `).run(input.name, input.unit, input.category, input.lastPurchaseCostCents);
    return { id: result.lastInsertRowid };
  });

  app.put('/api/pur/supplies/:id', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    const input = purSupplyInput.parse(req.body);
    db.prepare(`
      UPDATE pur_supplies SET name = ?, unit = ?, category = ?, last_purchase_cost_cents = ? WHERE id = ?
    `).run(input.name, input.unit, input.category, input.lastPurchaseCostCents, id);
    return { success: true };
  });

  app.post('/api/pur/supplies/:id/deactivate', { config: { permission: 'pur.supply.edit' } }, async (req) => {
    const { id } = z.object({ id: z.coerce.number() }).parse(req.params);
    db.prepare('UPDATE pur_supplies SET is_active = 0 WHERE id = ?').run(id);
    return { success: true };
  });
}
