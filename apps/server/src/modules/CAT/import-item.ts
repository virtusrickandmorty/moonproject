/**
 * Price list items from another module's import (MIG, the owner's request, Oct 2026: Import old data brings in the price
 * list, its piece rates on each item). The item codes are counted here, for the item routes and the import alike.
 */
import { newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

/** The prefix of an item code by class, and the next free code: the highest number used with that prefix, plus one. */
export const CODE_PREFIX: Record<'made_to_order_garment' | 'service' | 'ready_made_item', string> = { made_to_order_garment: 'MTO', service: 'SRV', ready_made_item: 'RTW' };
export function nextCode(db: Db, cls: keyof typeof CODE_PREFIX): string {
  const prefix = CODE_PREFIX[cls];
  const used = db.prepare(`SELECT code FROM cat_items WHERE code LIKE ? COLLATE NOCASE`).pluck().all(`${prefix}-%`) as string[];
  const top = Math.max(0, ...used.map((c) => Number(/^[A-Za-z]+-(\d+)$/.exec(c)?.[1] ?? 0)));
  return `${prefix}-${String(top + 1).padStart(4, '0')}`;
}

const REVENUE_ROLE = { made_to_order_garment: 'SALES_MTO', service: 'SALES_SERVICE', ready_made_item: 'SALES_RTW' } as const;

export interface ImportedItem {
  name: string;
  class: keyof typeof CODE_PREFIX;
  unit: 'pc' | 'set';
  /** Selling price per piece or set, VAT included; left out = no price yet. */
  priceCents?: number | undefined;
}

/**
 * The price list item an import row names: the active item of that name (any case), or a new one (its code the next of
 * its class; a made-to-order garment goes by its name for its piece rates). A price is added from today when the item
 * has none in force yet; an existing price is never changed by an import. Call inside the import's transaction.
 */
export function importPriceListItem(db: Db, row: ImportedItem, who: { userId: string; at: string; today: string }): { id: string; garmentType: string | null; created: boolean; priced: boolean } {
  const name = row.name.trim();
  const found = db.prepare(`SELECT id, garment_type AS garmentType FROM cat_items WHERE name = ? COLLATE NOCASE AND is_active = 1 ORDER BY created_at LIMIT 1`).get(name) as
    | { id: string; garmentType: string | null }
    | undefined;
  let id = found?.id;
  let garmentType = found?.garmentType ?? null;
  if (!id) {
    id = newId();
    garmentType = row.class === 'made_to_order_garment' ? name : null;
    const code = nextCode(db, row.class);
    db.prepare(`INSERT INTO cat_items (id, code, name, class, garment_type, unit, set_components, revenue_role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, code, name, row.class, garmentType, row.unit, row.unit === 'set' ? 2 : 1, REVENUE_ROLE[row.class], who.at, who.at);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'cat.item.create', entityType: 'cat_item', entityId: id, data: { code, name, imported: true } });
  }
  let priced = false;
  if (row.priceCents !== undefined) {
    const has = db.prepare('SELECT 1 FROM cat_prices WHERE item_id = ? AND effective_from <= ? LIMIT 1').get(id, who.today);
    if (!has) {
      const priceId = newId();
      db.prepare(`INSERT INTO cat_prices (id, item_id, effective_from, min_qty, unit_price_cents, created_at, created_by) VALUES (?, ?, ?, 1, ?, ?, ?)`)
        .run(priceId, id, who.today, row.priceCents, who.at, who.userId);
      db.prepare('UPDATE cat_items SET version = version + 1, updated_at = ? WHERE id = ?').run(who.at, id);
      appendAudit(db, { at: who.at, userId: who.userId, action: 'cat.price.create', entityType: 'cat_price', entityId: priceId, data: { itemId: id, effectiveFrom: who.today, minQty: 1, unitPriceCents: row.priceCents, imported: true } });
      priced = true;
    }
  }
  return { id, garmentType, created: !found, priced };
}
