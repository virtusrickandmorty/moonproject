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
