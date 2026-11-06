/**
 * Each price list item has piece rates of its own, under its own name (the owner's request, Nov 2026). Rates are kept by
 * garment type, and two items on one type moved together whenever either rate changed; a rename left the rates, and what
 * connects to them, on the old name.
 */
import { GARMENT_TYPE_MAX, conflict } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { carryRates, hasRates } from '../RATE/public.ts';
import { movedGarmentTypes } from './public.ts';

type Who = { userId: string; at: string };
type Item = { id: string; code: string; name: string; garment_type: string | null };

/** The other active items on a garment type: they are paid the same rates. */
export function goingBy(db: Db, garmentType: string, except: string): { code: string; name: string }[] {
  return db.prepare('SELECT code, name FROM cat_items WHERE garment_type = ? COLLATE NOCASE AND is_active = 1 AND id <> ? ORDER BY code').all(garmentType, except) as { code: string; name: string }[];
}

export function refuseShared(db: Db, garmentType: string, except: string): void {
  const other = goingBy(db, garmentType, except)[0];
  if (other) throw conflict('GARMENT_TYPE_TAKEN', `${other.code} ${other.name} already goes by this name, and two items on one name share their piece rates. Use a different name.`);
}

const moveRow = (db: Db, from: string, to: string, itemId: string, who: Who) =>
  db.prepare('INSERT INTO cat_garment_type_moves (from_type, to_type, item_id, at, user_id) VALUES (?, ?, ?, ?, ?)').run(from, to, itemId, who.at, who.userId);

/** A name that once moved away now stands for itself: reads of it stop following the old move. The item must exist. */
export function reclaim(db: Db, garmentType: string, itemId: string, who: Who): void {
  if (movedGarmentTypes(db).has(garmentType.toLowerCase())) moveRow(db, garmentType, garmentType, itemId, who);
}

/**
 * The garment type an item goes by under a new name: what connects to an item follows the name it was edited to. Its rates and
 * their history go with it. What stands on the old name reads the new one (a job order line, a cost sheet), unless another item
 * still goes by the old name: that one keeps it. Recorded pieces keep the rate they took. Call inside a transaction.
 */
export function followName(db: Db, row: Item, name: string, who: Who): string {
  const to = name.slice(0, GARMENT_TYPE_MAX).trim();
  const from = row.garment_type!;
  if (to.toLowerCase() === from.toLowerCase()) return to;
  refuseShared(db, to, row.id);
  if (!movedGarmentTypes(db).has(to.toLowerCase()) && hasRates(db, to)) throw conflict('GARMENT_TYPE_TAKEN', `There are piece rates under "${to}" already. Use a different name.`);
  carryRates(db, from, to, who);
  if (goingBy(db, from, row.id).length === 0) moveRow(db, from, to, row.id, who);
  reclaim(db, to, row.id, who);
  return to;
}

/** An item renamed before its rates followed the name, or sharing them with another, goes by its own name from now on. Call inside a transaction. */
export function giveOwnRates(db: Db, row: Item, who: Who): string {
  if (row.garment_type === null) throw conflict('NO_RATES', 'Only a made-to-order garment has piece rates.');
  const garmentType = followName(db, row, row.name, who);
  if (garmentType.toLowerCase() === row.garment_type.toLowerCase()) throw conflict('NO_CHANGE', 'This item already goes by its own name.');
  db.prepare('UPDATE cat_items SET garment_type = ?, version = version + 1, updated_at = ? WHERE id = ?').run(garmentType, who.at, row.id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'cat.item.own_rates', entityType: 'cat_item', entityId: row.id, data: { code: row.code, from: row.garment_type, to: garmentType } });
  return garmentType;
}
