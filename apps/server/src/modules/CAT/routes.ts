import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../../platform/db/driver.ts';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import { discountPolicyInput, itemCreate, itemInput, itemUpdate, priceInput, type ItemInput } from './schemas.ts';
import { lookupCatalogPrice } from './public.ts';

type ItemRow = {
  id: string; code: string; name: string; class: ItemInput['class']; garment_type: string | null;
  unit: ItemInput['unit']; set_components: number; revenue_role: string;
  is_active: number; version: number; created_at: string; updated_at: string;
};

const revenueRole = {
  made_to_order_garment: 'SALES_MTO', service: 'SALES_SERVICE', ready_made_item: 'SALES_RTW',
} as const;

function rowId(req: FastifyRequest): string { return (req.params as { id: string }).id; }
function item(db: Db, id: string): ItemRow {
  const row = db.prepare('SELECT * FROM cat_items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!row) throw notFound('Catalog item');
  return row;
}
function active(row: ItemRow): void {
  if (!row.is_active) throw conflict('INACTIVE', 'This catalog item is inactive.');
}
function matchingVersion(req: FastifyRequest, row: { version: number }): void {
  const raw = req.headers['if-match'];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new AppError('VERSION_REQUIRED', 'Reload this catalog item before saving.', 428);
  }
  if (Number(raw) !== row.version) {
    throw conflict('VERSION_CHANGED', 'Someone changed this catalog item. Reload it and review their changes.');
  }
}
function toInput(row: ItemRow): ItemInput {
  return { code: row.code, name: row.name, class: row.class, garmentType: row.garment_type,
    unit: row.unit, setComponents: row.set_components };
}
function priceList(db: Db, id: string): unknown[] {
  return db.prepare(`SELECT id, item_id AS itemId, effective_from AS effectiveFrom, min_qty AS minQty,
    unit_price_cents AS unitPriceCents, version, created_at AS createdAt, created_by AS createdBy
    FROM cat_prices WHERE item_id = ? ORDER BY effective_from DESC, min_qty DESC`).all(id);
}
function audit(db: Db, req: FastifyRequest, at: string, action: string, entityType: string,
  id: string, data: Record<string, unknown>): void {
  appendAudit(db, { at, userId: currentUser(req).userId, action, entityType, entityId: id, data });
}

/** The prefix of an item code by class, and the next free code: the highest number used with that prefix, plus one. */
const CODE_PREFIX: Record<'made_to_order_garment' | 'service' | 'ready_made_item', string> = { made_to_order_garment: 'MTO', service: 'SRV', ready_made_item: 'RTW' };
export function nextCode(db: Db, cls: keyof typeof CODE_PREFIX): string {
  const prefix = CODE_PREFIX[cls];
  const used = db.prepare(`SELECT code FROM cat_items WHERE code LIKE ? COLLATE NOCASE`).pluck().all(`${prefix}-%`) as string[];
  const top = Math.max(0, ...used.map((c) => Number(/^[A-Za-z]+-(\d+)$/.exec(c)?.[1] ?? 0)));
  return `${prefix}-${String(top + 1).padStart(4, '0')}`;
}

export function catRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  app.get('/api/cat/discount-policy', { config: { permission: 'cat.view' } }, async () => {
    const row = db.prepare('SELECT threshold_bps, version, effective_from FROM cat_discount_policies ORDER BY version DESC LIMIT 1')
      .get() as { threshold_bps: number; version: number; effective_from: string };
    return { thresholdBasisPoints: row.threshold_bps, version: row.version, effectiveFrom: row.effective_from };
  });
  app.put('/api/cat/discount-policy', { config: { permission: 'cat.price.manage' } }, async (req) => {
    const input = discountPolicyInput.parse(req.body), at = stamp(clock), effectiveFrom = today(clock);
    return db.transaction(() => {
      const row = db.prepare('SELECT threshold_bps, version FROM cat_discount_policies ORDER BY version DESC LIMIT 1')
        .get() as { threshold_bps: number; version: number };
      matchingVersion(req, row);
      db.prepare('INSERT INTO cat_discount_policies (version, effective_from, threshold_bps, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(row.version + 1, effectiveFrom, input.thresholdBasisPoints, at, currentUser(req).userId);
      audit(db, req, at, 'cat.discount_policy.update', 'cat_discount_policy', String(row.version + 1),
        { beforeBasisPoints: row.threshold_bps, afterBasisPoints: input.thresholdBasisPoints, effectiveFrom });
      return { thresholdBasisPoints: input.thresholdBasisPoints, version: row.version + 1, effectiveFrom };
    }).immediate();
  });

  app.get('/api/cat/items', { config: { permission: 'cat.view' } }, async (req) => {
    const q = req.query as { search?: string; limit?: string; offset?: string; active?: string };
    const limit = q.limit === undefined ? 25 : Number(q.limit);
    const offset = q.offset === undefined ? 0 : Number(q.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 ||
      (q.active !== undefined && q.active !== '0' && q.active !== '1')) {
      throw new AppError('INVALID_PAGE', 'Choose a valid catalog page and filter.', 400);
    }
    const search = String(q.search ?? '').trim().slice(0, 200);
    return db.prepare(`SELECT * FROM cat_items WHERE (name LIKE ? OR code LIKE ?)
      AND (? IS NULL OR is_active = ?) ORDER BY name, id LIMIT ? OFFSET ?`).all(
      `%${search}%`, `%${search}%`, q.active === undefined ? null : Number(q.active),
      q.active === undefined ? null : Number(q.active), limit, offset,
    );
  });

  app.post('/api/cat/items', { config: { permission: 'cat.manage' } }, async (req) => {
    const raw = itemCreate.parse(req.body), id = newId(), at = stamp(clock);
    return db.transaction(() => {
      // No code typed: the next one for its class, counted in the same transaction (the owner's request, Oct 2026).
      const input = itemInput.parse({ ...raw, code: raw.code ?? nextCode(db, raw.class) });
      if (db.prepare('SELECT 1 FROM cat_items WHERE code = ? COLLATE NOCASE').get(input.code)) {
        throw conflict('CODE_EXISTS', 'This catalog code is already in use.');
      }
      db.prepare(`INSERT INTO cat_items (id, code, name, class, garment_type, unit, set_components,
        revenue_role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.code, input.name, input.class, input.garmentType, input.unit,
        input.setComponents, revenueRole[input.class], at, at,
      );
      audit(db, req, at, 'cat.item.create', 'cat_item', id, { code: input.code, name: input.name });
      return item(db, id);
    }).immediate();
  });

  app.get('/api/cat/items/:id', { config: { permission: 'cat.view' } }, async (req) => {
    const row = item(db, rowId(req));
    return { ...row, prices: priceList(db, row.id) };
  });

  app.put('/api/cat/items/:id', { config: { permission: 'cat.manage' } }, async (req) => {
    const input = itemUpdate.parse(req.body), id = rowId(req), at = stamp(clock);
    if (!Object.keys(input).length) throw new AppError('NO_CHANGES', 'Enter a change before saving.', 400);
    return db.transaction(() => {
      const before = item(db, id); active(before); matchingVersion(req, before);
      const next = itemInput.parse({ ...toInput(before), ...input });
      const hasPrices = !!db.prepare('SELECT 1 FROM cat_prices WHERE item_id = ? LIMIT 1').get(id);
      if (hasPrices && (next.class !== before.class || next.garmentType !== before.garment_type ||
        next.unit !== before.unit || next.setComponents !== before.set_components)) {
        throw conflict('ITEM_IN_USE', 'Deactivate this item and create a new one to change its type or unit.');
      }
      if (next.code.toLowerCase() !== before.code.toLowerCase() &&
        db.prepare('SELECT 1 FROM cat_items WHERE code = ? COLLATE NOCASE').get(next.code)) {
        throw conflict('CODE_EXISTS', 'This catalog code is already in use.');
      }
      db.prepare(`UPDATE cat_items SET code = ?, name = ?, class = ?, garment_type = ?, unit = ?,
        set_components = ?, revenue_role = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(
        next.code, next.name, next.class, next.garmentType, next.unit, next.setComponents,
        revenueRole[next.class], at, id,
      );
      audit(db, req, at, 'cat.item.update', 'cat_item', id, { before: toInput(before), after: next });
      return item(db, id);
    }).immediate();
  });

  app.post('/api/cat/items/:id/deactivate', { config: { permission: 'cat.manage' } }, async (req) => {
    const id = rowId(req), at = stamp(clock);
    return db.transaction(() => {
      const before = item(db, id); active(before); matchingVersion(req, before);
      db.prepare('UPDATE cat_items SET is_active = 0, version = version + 1, updated_at = ? WHERE id = ?').run(at, id);
      audit(db, req, at, 'cat.item.deactivate', 'cat_item', id, { code: before.code });
      return item(db, id);
    }).immediate();
  });

  app.get('/api/cat/items/:id/prices', { config: { permission: 'cat.view' } }, async (req) => {
    const row = item(db, rowId(req));
    return priceList(db, row.id);
  });

  app.post('/api/cat/items/:id/prices', { config: { permission: 'cat.price.manage' } }, async (req) => {
    const input = priceInput.parse(req.body), itemId = rowId(req), id = newId(), at = stamp(clock);
    return db.transaction(() => {
      const row = item(db, itemId); active(row); matchingVersion(req, row);
      if (input.effectiveFrom < today(clock)) {
        throw conflict('PRICE_BACKDATED', 'Choose today or a future date for a new price.');
      }
      if (db.prepare('SELECT 1 FROM cat_prices WHERE item_id = ? AND effective_from = ? AND min_qty = ?')
        .get(itemId, input.effectiveFrom, input.minQty)) {
        throw conflict('PRICE_EXISTS', 'A price already exists for that date and quantity tier.');
      }
      db.prepare(`INSERT INTO cat_prices (id, item_id, effective_from, min_qty, unit_price_cents,
        created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, itemId, input.effectiveFrom, input.minQty, input.unitPriceCents, at, currentUser(req).userId,
      );
      db.prepare('UPDATE cat_items SET version = version + 1, updated_at = ? WHERE id = ?').run(at, itemId);
      audit(db, req, at, 'cat.price.create', 'cat_price', id,
        { itemId, effectiveFrom: input.effectiveFrom, minQty: input.minQty, unitPriceCents: input.unitPriceCents });
      return { id, itemId, ...input, version: 1 };
    }).immediate();
  });

  app.get('/api/cat/items/:id/price', { config: { permission: 'cat.view' } }, async (req) => {
    const q = req.query as { qty?: string; onDate?: string };
    const price = lookupCatalogPrice(db, rowId(req), Number(q.qty), q.onDate ?? today(clock));
    if (!price) throw notFound('Catalog price');
    return price;
  });
}
