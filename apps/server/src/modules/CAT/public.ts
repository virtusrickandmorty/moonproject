import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { AppError, notFound } from '@moonproject/shared';
import { z } from 'zod';

export interface CatalogPrice {
  itemId: string;
  priceId: string;
  effectiveFrom: string;
  minQty: number;
  unitPriceCents: number;
}

/** Stable item metadata for another module's read-only validation. */
export function catalogItemRef(db: Db, id: string): {
  code: string; name: string; class: 'made_to_order_garment' | 'service' | 'ready_made_item';
  unit: 'pc' | 'set'; isActive: boolean;
} | undefined {
  const row = db.prepare('SELECT code, name, class, unit, is_active FROM cat_items WHERE id = ?').get(id) as
    | { code: string; name: string; class: 'made_to_order_garment' | 'service' | 'ready_made_item'; unit: 'pc' | 'set'; is_active: number }
    | undefined;
  return row && { code: row.code, name: row.name, class: row.class, unit: row.unit, isActive: row.is_active === 1 };
}

/**
 * The price list item a job order line is made from, by its words (the owner's request, Oct 2026: production takes the
 * garment type for piece rates, and whether it is a set, from it). Active made-to-order items only. The item named
 * exactly wins; then one whose name's words all appear in the line; then the one sharing most words; a longer name wins
 * a tie. Null when no word is shared.
 */
export function matchCatalogItem(db: Db, text: string): { id: string; name: string; garmentType: string; unit: 'pc' | 'set' } | null {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2));
  const said = words(text);
  const flat = text.trim().toLowerCase();
  const items = db.prepare(`SELECT id, name, garment_type AS garmentType, unit FROM cat_items WHERE is_active = 1 AND class = 'made_to_order_garment'`).all() as { id: string; name: string; garmentType: string; unit: 'pc' | 'set' }[];
  let best: { item: (typeof items)[number]; score: number } | null = null;
  for (const item of items) {
    const own = words(item.name);
    const shared = [...own].filter((w) => said.has(w)).length;
    const score = item.name.trim().toLowerCase() === flat ? 3_000 : shared === own.size && shared > 0 ? 2_000 + shared : shared;
    if (score > 0 && (!best || score > best.score || (score === best.score && item.name.length > best.item.name.length))) best = { item, score };
  }
  return best ? best.item : null;
}

/**
 * The price list as a customer may see it (the website's AI assistant, the owner's request, Oct 2026): active items with
 * their price tiers in force on a date (from how many pieces, at how much each). Names and prices only: no cost, no garment
 * type or other shop detail.
 */
export function publicPriceList(db: Db, businessDate: string): { id: string; name: string; unit: 'pc' | 'set'; kind: 'made to order' | 'ready-made' | 'service'; tiers: { fromQty: number; unitPriceCents: number }[] }[] {
  const items = db.prepare('SELECT id, name, unit, class FROM cat_items WHERE is_active = 1 ORDER BY name').all() as { id: string; name: string; unit: 'pc' | 'set'; class: string }[];
  const tiers = db.prepare(`SELECT min_qty AS fromQty, unit_price_cents AS unitPriceCents FROM cat_prices p
    WHERE item_id = ? AND effective_from = (SELECT MAX(effective_from) FROM cat_prices x WHERE x.item_id = p.item_id AND x.min_qty = p.min_qty AND x.effective_from <= ?)
    ORDER BY min_qty`);
  const kind = (c: string) => (c === 'made_to_order_garment' ? 'made to order' : c === 'ready_made_item' ? 'ready-made' : 'service') as 'made to order' | 'ready-made' | 'service';
  return items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, kind: kind(i.class), tiers: tiers.all(i.id, businessDate) as { fromQty: number; unitPriceCents: number }[] }))
    .filter((i) => i.tiers.length > 0);
}

/** The newest eligible effective date wins; within that date the largest eligible tier wins. */
export function lookupCatalogPrice(db: Db, itemId: string, qty: number, businessDate: string): CatalogPrice | null {
  if (!Number.isSafeInteger(qty) || qty < 1 || !z.iso.date().safeParse(businessDate).success) {
    throw new AppError('INVALID_PRICE_LOOKUP', 'Choose a valid quantity and date.', 400);
  }
  const item = db.prepare('SELECT id, is_active FROM cat_items WHERE id = ?').get(itemId) as { id: string; is_active: number } | undefined;
  if (!item) throw notFound('Catalog item');
  if (!item.is_active) return null;
  const row = db.prepare(`SELECT id, effective_from, min_qty, unit_price_cents FROM cat_prices
    WHERE item_id = ? AND effective_from <= ? AND min_qty <= ?
    ORDER BY effective_from DESC, min_qty DESC LIMIT 1`).get(itemId, businessDate, qty) as
    | { id: string; effective_from: string; min_qty: number; unit_price_cents: number }
    | undefined;
  return row ? { itemId, priceId: row.id, effectiveFrom: row.effective_from, minQty: row.min_qty, unitPriceCents: row.unit_price_cents } : null;
}

/** Use for either a sales line or the whole document, after the server computes its gross and discount. */
export function requireCatalogDiscountReason(db: Db, grossCents: number, discountCents: number,
  reason: string | null | undefined, businessDate: string): void {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0 ||
      !Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents > grossCents ||
      !z.iso.date().safeParse(businessDate).success) {
    throw new AppError('INVALID_DISCOUNT', 'Enter a valid discount.', 400);
  }
  const policy = db.prepare(`SELECT threshold_bps FROM cat_discount_policies
    WHERE effective_from <= ? ORDER BY effective_from DESC, version DESC LIMIT 1`)
    .get(businessDate) as { threshold_bps: number };
  if (BigInt(discountCents) * 10000n > BigInt(grossCents) * BigInt(policy.threshold_bps) && !reason?.trim()) {
    throw new AppError('DISCOUNT_REASON_REQUIRED', 'Enter a reason for this discount.', 400);
  }
}

/** Called inside the sales-line transaction by a module that checks cat.price.override. */
export function logCatalogPriceOverride(db: Db, input: {
  at: string; userId: string; sourceType: string; sourceId: string; itemId: string;
  qty: number; listUnitPriceCents: number; overrideUnitPriceCents: number; reason: string;
}): void {
  if (!input.sourceType || !input.sourceId || !input.reason.trim() ||
      !Number.isSafeInteger(input.qty) || input.qty < 1 ||
      !Number.isSafeInteger(input.listUnitPriceCents) || input.listUnitPriceCents < 0 ||
      !Number.isSafeInteger(input.overrideUnitPriceCents) || input.overrideUnitPriceCents < 0) {
    throw new AppError('INVALID_PRICE_OVERRIDE', 'Enter a valid price override and reason.', 400);
  }
  appendAudit(db, {
    at: input.at, userId: input.userId, action: 'cat.price.override',
    entityType: input.sourceType, entityId: input.sourceId,
    data: { itemId: input.itemId, qty: input.qty, listUnitPriceCents: input.listUnitPriceCents,
      overrideUnitPriceCents: input.overrideUnitPriceCents, reason: input.reason.trim() },
  });
}
