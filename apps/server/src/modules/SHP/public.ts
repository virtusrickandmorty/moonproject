/**
 * What other modules may read from the website shop (AGENTS.md: other modules only through public.ts).
 * Pieces on hand of an item (product · size · colour) = stock in and counts (shp_stock_moves) − pieces on recorded quick
 * sales (QS). Available = on hand − pieces held by online orders still waiting for payment.
 */
import type { Issue } from '@moonproject/shared';
import type { NoticeTarget } from '../../engine/documents/registry.ts';
import type { Db } from '../../platform/db/driver.ts';
import { soldShopPieces } from '../QS/public.ts';

export interface StockLine { size: string; colour: string; onHand: number; held: number; available: number }
const key = (size: string, colour: string) => `${size}|${colour}`;

/**
 * Pieces held by online orders: placed and not yet expired, or with a payment sent and not yet decided. A confirmed order's
 * pieces are on its quick sale instead, so they are counted there.
 */
export const HOLD_MS = 24 * 60 * 60 * 1000;
function heldPieces(db: Db, ids: string, nowMs: number) {
  return db.prepare(`SELECT l.product_id AS productId, l.size, l.colour, SUM(l.qty) AS qty FROM shp_order_lines l JOIN shp_orders o ON o.id = l.order_id
    WHERE l.product_id IN (SELECT value FROM json_each(?)) AND ((o.status = 'awaiting_payment' AND o.hold_until_ms > ?) OR o.status = 'payment_sent')
    GROUP BY l.product_id, l.size, l.colour`).all(ids, nowMs) as { productId: string; size: string; colour: string; qty: number }[];
}

/** On hand, held and available for every size × colour each product comes in now (its current version's lists). */
export function stockOf(db: Db, productIds: readonly string[], nowMs: number): Map<string, StockLine[]> {
  const out = new Map<string, StockLine[]>();
  if (!productIds.length) return out;
  const ids = JSON.stringify(productIds);
  const variants = db.prepare(`SELECT p.id AS productId, s.size, c.name AS colour FROM shp_products p
    JOIN shp_product_sizes s ON s.product_id = p.id AND s.version = p.version
    JOIN shp_product_colours c ON c.product_id = p.id AND c.version = p.version
    WHERE p.id IN (SELECT value FROM json_each(?)) ORDER BY p.id, c.position, s.position`).all(ids) as { productId: string; size: string; colour: string }[];
  const counts = new Map<string, number>();
  const add = (productId: string, size: string, colour: string, qty: number) => counts.set(`${productId}|${key(size, colour)}`, (counts.get(`${productId}|${key(size, colour)}`) ?? 0) + qty);
  for (const m of db.prepare(`SELECT product_id AS productId, size, colour, SUM(qty) AS qty FROM shp_stock_moves
    WHERE product_id IN (SELECT value FROM json_each(?)) GROUP BY product_id, size, colour`).all(ids) as { productId: string; size: string; colour: string; qty: number }[]) add(m.productId, m.size, m.colour, m.qty);
  for (const s of soldShopPieces(db, productIds)) add(s.productId, s.size, s.colour, -s.qty);
  const held = new Map<string, number>();
  for (const h of heldPieces(db, ids, nowMs)) held.set(`${h.productId}|${key(h.size, h.colour)}`, (held.get(`${h.productId}|${key(h.size, h.colour)}`) ?? 0) + h.qty);
  for (const v of variants) {
    const k = `${v.productId}|${key(v.size, v.colour)}`;
    const onHand = counts.get(k) ?? 0, h = held.get(k) ?? 0;
    const list = out.get(v.productId) ?? [];
    list.push({ size: v.size, colour: v.colour, onHand, held: h, available: Math.max(0, onHand - h) });
    out.set(v.productId, list);
  }
  return out;
}

/** One item, for a sale that names it: null when the product, size or colour is not in the shop now. */
export function shopVariant(db: Db, productId: string, size: string, colour: string, nowMs: number): { name: string; madeToOrder: boolean; available: number; priceCents: number } | null {
  const p = db.prepare('SELECT name, made_to_order AS mto, price_cents AS priceCents FROM shp_products WHERE id = ?').get(productId) as { name: string; mto: number; priceCents: number } | undefined;
  if (!p) return null;
  const line = stockOf(db, [productId], nowMs).get(productId)?.find((s) => s.size === size && s.colour === colour);
  return line ? { name: p.name, madeToOrder: p.mto === 1, available: line.available, priceCents: p.priceCents } : null;
}

/**
 * On a quick sale that names website shop items (the POS, online orders): warn when an item is not in the shop, or when the
 * sale takes more pieces than are available. Only a warning: the piece may be in the customer's hands while the count is off.
 */
export function shopItemsNotice(db: Db, t: NoticeTarget): Issue[] {
  if (t.docType !== 'qs.sale' || t.action !== 'post') return [];
  const lines = ((t.doc as { lines?: { lineNo: number; qty: number; item?: { productId: string; size: string; colour: string } }[] } | undefined)?.lines ?? []).filter((l) => l.item);
  const issues: Issue[] = [];
  const asked = new Map<string, number>();
  for (const l of lines) {
    const { productId, size, colour } = l.item!;
    const field = `lines.${l.lineNo - 1}.item`;
    const v = shopVariant(db, productId, size, colour, Date.now());
    if (!v) { issues.push({ field, code: 'ITEM', level: 'warning', message: `Line ${l.lineNo}: that item, size or colour is not in the website shop, so no stock is taken off.` }); continue; }
    const want = (asked.get(`${productId}|${size}|${colour}`) ?? 0) + l.qty;
    asked.set(`${productId}|${size}|${colour}`, want);
    if (want > v.available) {
      issues.push({ field, code: 'STOCK', level: 'warning', message: `Line ${l.lineNo}: ${v.name} (${colour}, ${size}) shows ${v.available} available, and this sells ${want}. Record it if the pieces are here, then recount the stock.` });
    }
  }
  return issues;
}

/** A payment sent that staff have not decided on for this long is shown as overdue. It still holds its pieces: only staff cancel it. */
export const PAYMENT_OVERDUE_MS = 72 * 60 * 60 * 1000;
export const OVERDUE_LABEL = 'Overdue: check the bank';
export const isOverdue = (o: { status: string; payment_sent_at: string | null }, nowMs: number) =>
  o.status === 'payment_sent' && o.payment_sent_at !== null && nowMs - Date.parse(o.payment_sent_at) >= PAYMENT_OVERDUE_MS;

/** Online orders with a payment sent and not yet checked by staff, oldest first, each marked overdue after 72 hours (DASH notifications). */
export function paymentsToCheck(db: Db, nowMs = Date.now()): { id: string; number: string; name: string; totalCents: number; sentAt: string; overdue: boolean }[] {
  return (db.prepare(`SELECT id, number, name, total_cents AS totalCents, payment_sent_at AS sentAt FROM shp_orders WHERE status = 'payment_sent' ORDER BY payment_sent_at`).all() as
    { id: string; number: string; name: string; totalCents: number; sentAt: string }[])
    .map((o) => ({ ...o, overdue: isOverdue({ status: 'payment_sent', payment_sent_at: o.sentAt }, nowMs) }));
}
