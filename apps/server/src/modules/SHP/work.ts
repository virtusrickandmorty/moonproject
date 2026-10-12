/**
 * Shop work (the owner's request, Oct 2026): job orders made for the website shop's own stock, through the production
 * board like any other (steps, workers' pieces and rates, rework), on the shop's own customer at ₱0.
 * - make: a restock of a ready-stock item, new pieces.
 * - rework: pieces of a website item taken off sale to be fixed; they come back into its stock when finished.
 * - change: pieces made into a website item: taken off sale from another website item, or a job order's leftovers, or
 *   other pieces (a note says which).
 * Finished pieces (what the board shows ready for release) are put into the shop's stock; only then are they for sale.
 * A work order is never released to a customer. Pieces taken off sale and not worked on can be given back. Pieces only,
 * no journal (periodic inventory, PLAN D2). Every movement is a new shp_work_moves row.
 */
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { postDocument, type Actor, type EngineEnv } from '../../engine/documents/lifecycle.ts';
import { createCustomer } from '../CUS/public.ts';
import { currentStage, isAbandoned, jobOrderDoc, jobOrderRef, lineState, moveTo, releasableQty } from '../JO/public.ts';
import { stockOf } from './public.ts';

export interface Who { userId: string; at: string; today: string }
const text = (max: number) => z.string().trim().min(1).max(max);
const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;
const item = z.object({ productId: z.uuid(), size: z.string().min(1).max(4), colour: z.string().trim().min(1).max(30) }).strict();

export const workInput = z.object({
  kind: z.enum(['make', 'rework', 'change']),
  dueInDays: z.number().int().min(1).max(365),
  priority: z.enum(['normal', 'rush']),
  notes: text(1000).optional(),
  lines: z.array(z.object({
    to: item,
    qty: z.number().int().min(1).max(10_000),
    /** change: where the pieces come from; rework always takes them from `to` itself. */
    source: z.enum(['shop_stock', 'job_order', 'other']).optional(),
    from: item.optional(),
    sourceNote: text(200).optional(),
  }).strict()).min(1).max(50),
}).strict();

export const KIND_LABEL = { make: 'Restock', rework: 'Rework', change: 'Change' } as const;
const SHOP_CUSTOMER = 'Virtus website shop (own stock)';

/** The shop's own customer for its work orders, made on the first one. Call inside a transaction. */
function shopCustomer(db: Db, who: Who): string {
  const id = db.prepare('SELECT customer_id FROM shp_work_customer WHERE id = 1').pluck().get() as string | undefined;
  if (id) return id;
  const c = createCustomer(db, { kind: 'organization', displayName: SHOP_CUSTOMER, notes: "The website shop's own stock: its restocks, rework and changes go through production on this name." }, who);
  db.prepare('INSERT INTO shp_work_customer (id, customer_id) VALUES (1, ?)').run(c.id);
  return c.id;
}

interface Product { id: string; name: string; madeToOrder: boolean; isActive: boolean }
function product(db: Db, id: string): Product | undefined {
  const p = db.prepare('SELECT id, name, made_to_order AS mto, is_active AS active FROM shp_products WHERE id = ?').get(id) as { id: string; name: string; mto: number; active: number } | undefined;
  return p && { id: p.id, name: p.name, madeToOrder: p.mto === 1, isActive: p.active === 1 };
}
const label = (name: string, i: { size: string; colour: string }) => `${name} (${i.colour}, ${i.size})`;

/** The shop's work mark of a job order, if it was made for the shop's stock. */
export function workOf(db: Db, jobOrderId: string): { kind: 'make' | 'rework' | 'change' } | undefined {
  return db.prepare('SELECT kind FROM shp_work WHERE job_order_id = ?').get(jobOrderId) as { kind: 'make' | 'rework' | 'change' } | undefined;
}

/**
 * A shop work order: a ₱0 job order on the shop's own customer, through the production board; then its mark, and the pieces
 * it takes off sale (rework; change from the shop's stock). Call inside a transaction.
 */
export function createWork(env: EngineEnv, actor: Actor, raw: unknown, who: Who, nowMs: number) {
  const v = workInput.parse(raw);
  const db = env.db;
  const lines = v.lines.map((l, i) => {
    const n = `Line ${i + 1}`;
    const to = product(db, l.to.productId);
    if (!to?.isActive) throw new AppError('VALIDATION', `${n}: pick a product shown in the website shop.`, 422);
    if (to.madeToOrder) throw new AppError('VALIDATION', `${n}: ${to.name} is made to order, so the shop keeps no stock of it.`, 422);
    const source = v.kind === 'make' ? 'new' : v.kind === 'rework' ? 'shop_stock' : l.source;
    if (!source) throw new AppError('VALIDATION', `${n}: say where the pieces come from.`, 422);
    const from = v.kind === 'rework' ? l.to : source === 'shop_stock' ? l.from : undefined;
    if (source === 'shop_stock' && !from) throw new AppError('VALIDATION', `${n}: pick the website item the pieces are taken from.`, 422);
    if ((source === 'job_order' || source === 'other') && (l.sourceNote?.length ?? 0) < 3) {
      throw new AppError('VALIDATION', source === 'job_order' ? `${n}: say which job order the leftover pieces are from.` : `${n}: say where the pieces come from.`, 422);
    }
    const fromProduct = from && product(db, from.productId);
    if (from && !fromProduct) throw new AppError('VALIDATION', `${n}: pick the website item the pieces are taken from.`, 422);
    if (v.kind === 'change' && from && from.productId === l.to.productId && from.size === l.to.size && from.colour === l.to.colour) {
      throw new AppError('VALIDATION', `${n}: the pieces would become the same item. Use rework to fix pieces of an item.`, 422);
    }
    const variants = stockOf(db, [to.id, ...(fromProduct ? [fromProduct.id] : [])], nowMs);
    if (!variants.get(to.id)?.some((s) => s.size === l.to.size && s.colour === l.to.colour)) throw new AppError('VALIDATION', `${n}: ${to.name} does not come in ${l.to.colour}, size ${l.to.size}.`, 422);
    const fromLine = from && variants.get(from.productId)?.find((s) => s.size === from.size && s.colour === from.colour);
    if (from && !fromLine) throw new AppError('VALIDATION', `${n}: ${fromProduct!.name} does not come in ${from.colour}, size ${from.size}.`, 422);
    return { ...l, to: l.to, toName: to.name, source, from, fromName: fromProduct?.name, fromAvailable: fromLine?.available ?? 0 };
  });
  const seen = new Set<string>();
  for (const l of lines) {
    const k = `${l.to.productId}|${l.to.size}|${l.to.colour}|${l.source}|${l.from ? `${l.from.productId}|${l.from.size}|${l.from.colour}` : l.sourceNote ?? ''}`;
    if (seen.has(k)) throw new AppError('VALIDATION', `${label(l.toName, l.to)} is listed twice. Put all its pieces on one line.`, 422);
    seen.add(k);
  }
  // Pieces taken off sale must be there to take (the same item over several lines counts once).
  const taking = new Map<string, { name: string; item: z.infer<typeof item>; qty: number; available: number }>();
  for (const l of lines.filter((x) => x.from)) {
    const k = `${l.from!.productId}|${l.from!.size}|${l.from!.colour}`;
    const t = taking.get(k) ?? { name: l.fromName!, item: l.from!, qty: 0, available: l.fromAvailable };
    taking.set(k, { ...t, qty: t.qty + l.qty });
  }
  for (const t of taking.values()) {
    if (t.qty > t.available) throw conflict('NOT_IN_STOCK', `${label(t.name, t.item)} has ${pieces(t.available)} available, and this takes ${t.qty}. Count the stock if the pieces are here.`);
  }

  const describe = (l: (typeof lines)[number]) =>
    v.kind === 'make' ? label(l.toName, l.to)
      : v.kind === 'rework' ? `Rework: ${label(l.toName, l.to)}`
      : `Change: ${l.from ? label(l.fromName!, l.from) : l.source === 'job_order' ? `leftovers of ${l.sourceNote}` : l.sourceNote} → ${label(l.toName, l.to)}`;
  const input = {
    customerId: shopCustomer(db, who),
    dueInDays: v.dueInDays,
    priority: v.priority,
    paymentTerms: 'cod' as const, // nothing is billed: the pieces are the shop's own
    notes: [`${KIND_LABEL[v.kind]} for the website shop's stock. Finished pieces go into the shop's stock, not out on a release slip.`, v.notes].filter(Boolean).join(' '),
    lines: lines.map((l) => ({ kind: 'made_to_order' as const, description: describe(l).slice(0, 200), qty: l.qty, unitPriceCents: 0, discountCents: 0, roster: [] })),
  };
  const jo = postDocument(env, jobOrderDoc, actor, { input, expectedTotalCents: 0 });
  db.prepare('INSERT INTO shp_work (job_order_id, kind, at, user_id) VALUES (?, ?, ?, ?)').run(jo.id, v.kind, who.at, who.userId);
  const mark = db.prepare(`INSERT INTO shp_work_lines (job_order_id, line_no, product_id, size, colour, source, from_product_id, from_size, from_colour, source_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const move = db.prepare(`INSERT INTO shp_work_moves (id, job_order_id, line_no, product_id, size, colour, kind, qty, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  lines.forEach((l, i) => {
    mark.run(jo.id, i + 1, l.to.productId, l.to.size, l.to.colour, l.source, l.from?.productId ?? null, l.from?.size ?? null, l.from?.colour ?? null, l.sourceNote ?? null);
    if (l.from) move.run(newId(), jo.id, i + 1, l.from.productId, l.from.size, l.from.colour, 'taken_off', -l.qty, who.at, who.userId);
  });
  appendAudit(db, { at: who.at, userId: who.userId, action: 'shp.work.create', entityType: 'jo.job_order', entityId: jo.id, data: { number: jo.number, kind: v.kind, lines: v.lines } });
  return { id: jo.id, number: jo.number };
}

interface WorkLine { lineNo: number; productId: string; size: string; colour: string; source: string; fromProductId: string | null; fromSize: string | null; fromColour: string | null; sourceNote: string | null }
const workLines = (db: Db, jobOrderId: string) =>
  db.prepare(`SELECT line_no AS lineNo, product_id AS productId, size, colour, source, from_product_id AS fromProductId, from_size AS fromSize, from_colour AS fromColour,
    source_note AS sourceNote FROM shp_work_lines WHERE job_order_id = ? ORDER BY line_no`).all(jobOrderId) as WorkLine[];
function moved(db: Db, jobOrderId: string): Map<number, { takenOff: number; givenBack: number; putIn: number }> {
  const out = new Map<number, { takenOff: number; givenBack: number; putIn: number }>();
  for (const r of db.prepare('SELECT line_no AS lineNo, kind, SUM(qty) AS qty FROM shp_work_moves WHERE job_order_id = ? GROUP BY line_no, kind').all(jobOrderId) as { lineNo: number; kind: string; qty: number }[]) {
    const m = out.get(r.lineNo) ?? { takenOff: 0, givenBack: 0, putIn: 0 };
    if (r.kind === 'taken_off') m.takenOff = -r.qty; else if (r.kind === 'given_back') m.givenBack = r.qty; else m.putIn = r.qty;
    out.set(r.lineNo, m);
  }
  return out;
}

/**
 * Each line of a shop work order: its item, pieces finished on the board and not in stock yet (`ready`), pieces put in,
 * and pieces taken off sale that can still be given back (not worked into stock).
 */
export function workState(db: Db, jobOrderId: string) {
  const w = workOf(db, jobOrderId);
  if (!w) return null;
  const marks = new Map(workLines(db, jobOrderId).map((l) => [l.lineNo, l]));
  const finished = releasableQty(db, jobOrderId);
  const m = moved(db, jobOrderId);
  const names = new Map((db.prepare('SELECT id, name FROM shp_products').all() as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return {
    kind: w.kind,
    lines: lineState(db, jobOrderId).map((l) => {
      const mk = marks.get(l.lineNo);
      const mv = m.get(l.lineNo) ?? { takenOff: 0, givenBack: 0, putIn: 0 };
      const outOfSale = mv.takenOff - mv.givenBack;
      return {
        lineNo: l.lineNo, description: l.description, qty: l.qty, putIn: mv.putIn,
        item: mk ? { productId: mk.productId, name: names.get(mk.productId) ?? '', size: mk.size, colour: mk.colour } : null,
        source: mk?.source ?? null, sourceNote: mk?.sourceNote ?? null,
        from: mk?.fromProductId ? { productId: mk.fromProductId, name: names.get(mk.fromProductId) ?? '', size: mk.fromSize!, colour: mk.fromColour! } : null,
        ready: mk ? Math.max(0, Math.min(finished.get(l.lineNo) ?? 0, l.qty - mv.putIn, mk.fromProductId ? outOfSale - mv.putIn : Infinity)) : 0,
        canGiveBack: Math.max(0, outOfSale - mv.putIn),
      };
    }),
  };
}

export const putInInput = z.object({
  lines: z.array(z.object({ lineNo: z.number().int().min(1), qty: z.number().int().min(1).max(10_000) }).strict()).min(1).max(50),
}).strict();

/**
 * Finished pieces of a shop work order go into the shop's stock (for sale from then on), up to what the board shows as
 * finished. When every piece is in, the job order is done (Released). Call inside a transaction.
 */
export function putIntoShopStock(db: Db, jobOrderId: string, raw: unknown, who: Who) {
  const v = putInInput.parse(raw);
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('The job order');
  const state = workState(db, jo.id);
  if (!state) throw conflict('NOT_SHOP_WORK', `${jo.number} was not made for the website shop's stock.`);
  if (jo.status !== 'posted') throw conflict('JO_CANCELLED', `${jo.number} is cancelled.`);
  if (new Set(v.lines.map((l) => l.lineNo)).size !== v.lines.length) throw new AppError('VALIDATION', 'A line is listed twice. Put all its pieces on one row.', 422);
  const byLine = new Map(state.lines.map((l) => [l.lineNo, l]));
  const add = db.prepare(`INSERT INTO shp_work_moves (id, job_order_id, line_no, product_id, size, colour, kind, qty, at, user_id) VALUES (?, ?, ?, ?, ?, ?, 'put_in', ?, ?, ?)`);
  for (const l of v.lines) {
    const s = byLine.get(l.lineNo);
    if (!s) throw new AppError('VALIDATION', `${jo.number} has no line ${l.lineNo}.`, 422);
    if (!s.item) throw conflict('NO_ITEM', `Line ${l.lineNo} of ${jo.number} is not a website item (it was added on an edit).`);
    if (l.qty > s.ready) {
      throw conflict('NOT_FINISHED', s.ready > 0 ? `Line ${l.lineNo}: only ${pieces(s.ready)} are finished and not in the shop's stock yet.` : `Line ${l.lineNo}: no finished pieces are waiting. Finish them on the production board first.`);
    }
    add.run(newId(), jo.id, l.lineNo, s.item.productId, s.item.size, s.item.colour, l.qty, who.at, who.userId);
  }
  const after = workState(db, jo.id)!;
  const complete = after.lines.every((l) => !l.item || l.putIn >= l.qty);
  if (complete && currentStage(db, jo.id) !== 'released') moveTo(db, jo.id, 'released', "All pieces put into the website shop's stock", who);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'shp.work.put_in', entityType: 'jo.job_order', entityId: jo.id, data: { number: jo.number, lines: v.lines, complete } });
  return { ...after, complete };
}

/** Pieces taken off sale that will not be worked on after all go back on sale (as they were). Call inside a transaction. */
export function giveBack(db: Db, jobOrderId: string, raw: unknown, who: Who) {
  const v = putInInput.parse(raw);
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('The job order');
  const state = workState(db, jo.id);
  if (!state) throw conflict('NOT_SHOP_WORK', `${jo.number} was not made for the website shop's stock.`);
  const byLine = new Map(state.lines.map((l) => [l.lineNo, l]));
  const add = db.prepare(`INSERT INTO shp_work_moves (id, job_order_id, line_no, product_id, size, colour, kind, qty, at, user_id) VALUES (?, ?, ?, ?, ?, ?, 'given_back', ?, ?, ?)`);
  for (const l of v.lines) {
    const s = byLine.get(l.lineNo);
    if (!s?.from) throw new AppError('VALIDATION', `Line ${l.lineNo} of ${jo.number} took no pieces off sale.`, 422);
    if (l.qty > s.canGiveBack) throw conflict('NOTHING_TO_GIVE_BACK', `Line ${l.lineNo}: only ${pieces(s.canGiveBack)} can go back on sale.`);
    add.run(newId(), jo.id, l.lineNo, s.from.productId, s.from.size, s.from.colour, l.qty, who.at, who.userId);
  }
  appendAudit(db, { at: who.at, userId: who.userId, action: 'shp.work.give_back', entityType: 'jo.job_order', entityId: jo.id, data: { number: jo.number, lines: v.lines } });
  return workState(db, jo.id)!;
}

/**
 * An edited shop work order stays shop work: the replacement takes its marks line for line, and the pieces off sale move
 * with it (given back on the old, taken off on the new: the stock does not change). Refused once pieces are in stock.
 */
export function carryWorkOver(db: Db, oldId: string, newJoId: string): void {
  const w = db.prepare('SELECT kind, at, user_id AS userId FROM shp_work WHERE job_order_id = ?').get(oldId) as { kind: string; at: string; userId: string } | undefined;
  if (!w) return;
  const state = workState(db, oldId)!;
  if (state.lines.some((l) => l.putIn > 0)) throw conflict('IN_STOCK', "Some of its pieces are already in the website shop's stock, so it cannot be edited. Make a new work order for more pieces.");
  db.prepare('INSERT INTO shp_work (job_order_id, kind, at, user_id) VALUES (?, ?, ?, ?)').run(newJoId, w.kind, w.at, w.userId);
  const kept = new Set(lineState(db, newJoId).map((l) => l.lineNo));
  const mark = db.prepare(`INSERT INTO shp_work_lines (job_order_id, line_no, product_id, size, colour, source, from_product_id, from_size, from_colour, source_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const move = db.prepare(`INSERT INTO shp_work_moves (id, job_order_id, line_no, product_id, size, colour, kind, qty, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const l of workLines(db, oldId)) {
    const s = state.lines.find((x) => x.lineNo === l.lineNo)!;
    if (s.canGiveBack > 0) move.run(newId(), oldId, l.lineNo, l.fromProductId, l.fromSize, l.fromColour, 'given_back', s.canGiveBack, w.at, w.userId);
    if (!kept.has(l.lineNo)) continue;
    mark.run(newJoId, l.lineNo, l.productId, l.size, l.colour, l.source, l.fromProductId, l.fromSize, l.fromColour, l.sourceNote);
    if (s.canGiveBack > 0) move.run(newId(), newJoId, l.lineNo, l.fromProductId, l.fromSize, l.fromColour, 'taken_off', -s.canGiveBack, w.at, w.userId);
  }
}

/** Shop work orders still open (not every piece in stock, not cancelled or abandoned), newest first, with their state. */
export function openWork(db: Db) {
  const ids = db.prepare(`SELECT w.job_order_id FROM shp_work w JOIN documents d ON d.id = w.job_order_id
    WHERE d.status = 'posted' ORDER BY d.posted_at DESC LIMIT 200`).pluck().all() as string[];
  return ids
    .filter((id) => currentStage(db, id) !== 'released' && !isAbandoned(db, id))
    .map((id) => {
      const jo = jobOrderRef(db, id)!;
      return { id, number: jo.number, dueDate: jo.dueDate, priority: jo.priority, stage: currentStage(db, id), ...workState(db, id)! };
    });
}

/** Shop work with pieces finished on the board and not in the shop's stock yet (the notifications bell). */
export function shopWorkReady(db: Db): { id: string; number: string; kind: 'make' | 'rework' | 'change'; pieces: number }[] {
  return openWork(db).map((w) => ({ id: w.id, number: w.number, kind: w.kind, pieces: w.lines.reduce((n, l) => n + l.ready, 0) })).filter((w) => w.pieces > 0);
}
