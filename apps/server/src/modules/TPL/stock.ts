/**
 * A client's stock (TPL): restock job orders made for it, finished pieces put into it, count adjustments, and the stock
 * card. Pieces only, no journal (periodic inventory, PLAN D2). Every movement is a new tpl_stock_moves row.
 */
import { z } from 'zod';
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { postDocument, type Actor, type EngineEnv } from '../../engine/documents/lifecycle.ts';
import { currentStage, jobOrderDoc, jobOrderRef, lineState, moveTo, releasableQty } from '../JO/public.ts';
import { item, itemLabel, itemsOf, program, type Who } from './programs.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

export const restockInput = z.object({
  programId: z.uuid(),
  dueInDays: z.number().int().min(1).max(365),
  priority: z.enum(['normal', 'rush']),
  lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().int().min(1).max(10_000) }).strict()).min(1).max(50),
  notes: text(1000).optional(),
}).strict();

/** The restock mark of a job order, if it was made for a client's stock. */
export function restockOf(db: Db, jobOrderId: string): { programId: string } | undefined {
  return db.prepare('SELECT program_id AS programId FROM tpl_restocks WHERE job_order_id = ?').get(jobOrderId) as { programId: string } | undefined;
}

/** Pieces of each job order line already put into stock. */
function putIn(db: Db, jobOrderId: string): Map<number, number> {
  const rows = db.prepare(`SELECT line_no AS lineNo, SUM(qty) AS qty FROM tpl_stock_moves WHERE kind = 'in' AND document_id = ? GROUP BY line_no`).all(jobOrderId) as { lineNo: number; qty: number }[];
  return new Map(rows.map((r) => [r.lineNo, r.qty]));
}
export const piecesPutIn = (db: Db, jobOrderId: string) => [...putIn(db, jobOrderId).values()].reduce((s, n) => s + n, 0);

/**
 * A restock: a job order for the client at ₱0 (the price is on the program and billed on delivery), no downpayment, which
 * goes through the production board like any other; then the mark that it is for stock. Call inside a transaction.
 */
export function restock(env: EngineEnv, actor: Actor, raw: unknown, who: Who) {
  const v = restockInput.parse(raw);
  const p = program(env.db, v.programId);
  if (!p?.isActive) throw conflict('PROGRAM', 'Pick an active stock program.');
  const items = v.lines.map((l, i) => {
    const it = item(env.db, l.itemId);
    if (!it || it.programId !== p.id || !it.isActive) throw new AppError('VALIDATION', `Line ${i + 1}: pick one of ${p.customerName}'s active items.`, 422);
    return it;
  });
  if (new Set(v.lines.map((l) => l.itemId)).size !== v.lines.length) throw new AppError('VALIDATION', 'An item is listed twice. Put all its pieces on one line.', 422);
  const input = {
    customerId: p.customerId,
    dueInDays: v.dueInDays,
    priority: v.priority,
    paymentTerms: 'cod' as const, // no downpayment: the client pays each delivery on its terms
    notes: [`For ${p.customerName}'s stock (TPL). Billed on delivery.`, v.notes].filter(Boolean).join(' '),
    lines: v.lines.map((l, i) => ({ kind: items[i]!.kind, description: itemLabel(items[i]!), qty: l.qty, unitPriceCents: 0, discountCents: 0, roster: [] })),
  };
  const jo = postDocument(env, jobOrderDoc, actor, { input, expectedTotalCents: 0 });
  env.db.prepare('INSERT INTO tpl_restocks (job_order_id, program_id, at, user_id) VALUES (?, ?, ?, ?)').run(jo.id, p.id, who.at, who.userId);
  const line = env.db.prepare('INSERT INTO tpl_restock_lines (job_order_id, line_no, item_id) VALUES (?, ?, ?)');
  items.forEach((it, i) => line.run(jo.id, i + 1, it.id));
  appendAudit(env.db, { at: who.at, userId: who.userId, action: 'tpl.restock', entityType: 'tpl_program', entityId: p.id, data: { jobOrderId: jo.id, number: jo.number, lines: v.lines } });
  return jo;
}

/** An edited restock job order stays for stock: the replacement takes the mark, line for line (JO edit listener). */
export function carryRestockOver(db: Db, oldId: string, newId: string): void {
  const mark = db.prepare('SELECT program_id AS programId, at, user_id AS userId FROM tpl_restocks WHERE job_order_id = ?').get(oldId) as { programId: string; at: string; userId: string } | undefined;
  if (!mark) return;
  if (piecesPutIn(db, oldId) > 0) throw conflict('IN_STOCK', 'Some of its pieces are already in the client\'s stock, so it cannot be edited. Make a new restock for more pieces, or correct the stock with a count.');
  db.prepare('INSERT INTO tpl_restocks (job_order_id, program_id, at, user_id) VALUES (?, ?, ?, ?)').run(newId, mark.programId, mark.at, mark.userId);
  const lines = new Set(lineState(db, newId).map((l) => l.lineNo));
  const copy = db.prepare('INSERT INTO tpl_restock_lines (job_order_id, line_no, item_id) VALUES (?, ?, ?)');
  for (const r of db.prepare('SELECT line_no AS lineNo, item_id AS itemId FROM tpl_restock_lines WHERE job_order_id = ?').all(oldId) as { lineNo: number; itemId: string }[]) {
    if (lines.has(r.lineNo)) copy.run(newId, r.lineNo, r.itemId);
  }
}

/** What a restock job order can still put into stock, per line: finished on the board and not in stock yet. */
export function toPutIn(db: Db, jobOrderId: string) {
  const mark = restockOf(db, jobOrderId);
  if (!mark) return null;
  const items = new Map((db.prepare('SELECT line_no AS lineNo, item_id AS itemId FROM tpl_restock_lines WHERE job_order_id = ?').all(jobOrderId) as { lineNo: number; itemId: string }[]).map((r) => [r.lineNo, r.itemId]));
  const finished = releasableQty(db, jobOrderId);
  const done = putIn(db, jobOrderId);
  return lineState(db, jobOrderId).map((l) => {
    const inStock = done.get(l.lineNo) ?? 0;
    return { lineNo: l.lineNo, description: l.description, qty: l.qty, inStock, itemId: items.get(l.lineNo) ?? null,
      ready: Math.max(0, Math.min(finished.get(l.lineNo) ?? 0, l.qty - inStock)) };
  });
}

export const putInInput = z.object({
  jobOrderId: z.uuid(),
  lines: z.array(z.object({ lineNo: z.number().int().min(1), qty: z.number().int().min(1).max(10_000) }).strict()).min(1).max(50),
}).strict();

/**
 * Finished pieces of a restock job order go into the client's stock, up to what the board shows as finished. When every
 * piece is in, the job order is done (Released): nothing of it goes to the client but through deliveries.
 * Call inside a transaction.
 */
export function putIntoStock(db: Db, raw: unknown, who: Who & { today: string }) {
  const v = putInInput.parse(raw);
  const jo = jobOrderRef(db, v.jobOrderId);
  if (!jo) throw notFound('The job order');
  const state = toPutIn(db, jo.id);
  if (!state) throw conflict('NOT_FOR_STOCK', `${jo.number} is not a restock job order.`);
  if (jo.status !== 'posted') throw conflict('JO_CANCELLED', `${jo.number} is cancelled.`);
  const byLine = new Map(state.map((l) => [l.lineNo, l]));
  if (new Set(v.lines.map((l) => l.lineNo)).size !== v.lines.length) throw new AppError('VALIDATION', 'A line is listed twice. Put all its pieces on one row.', 422);
  const add = db.prepare(`INSERT INTO tpl_stock_moves (item_id, kind, qty, document_id, line_no, at, business_date, user_id) VALUES (?, 'in', ?, ?, ?, ?, ?, ?)`);
  for (const l of v.lines) {
    const s = byLine.get(l.lineNo);
    if (!s) throw new AppError('VALIDATION', `${jo.number} has no line ${l.lineNo}.`, 422);
    if (!s.itemId) throw conflict('NO_ITEM', `Line ${l.lineNo} of ${jo.number} is not one of the client's items (it was added on an edit). Release it as usual or add the item first.`);
    if (l.qty > s.ready) {
      throw conflict('NOT_FINISHED', s.ready > 0 ? `Line ${l.lineNo}: only ${pieces(s.ready)} are finished and not in stock yet.` : `Line ${l.lineNo}: no finished pieces are waiting. Finish them on the production board first.`);
    }
    add.run(s.itemId, l.qty, jo.id, l.lineNo, who.at, who.today, who.userId);
  }
  const after = toPutIn(db, jo.id)!;
  const all = after.every((l) => l.inStock >= l.qty);
  if (all && currentStage(db, jo.id) !== 'released') moveTo(db, jo.id, 'released', 'All pieces put into the client\'s stock (TPL)', who);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.put_in', entityType: 'jo.job_order', entityId: jo.id, data: { number: jo.number, lines: v.lines, complete: all } });
  return { lines: after, complete: all };
}

export const countInput = z.object({ itemId: z.uuid(), countedQty: z.number().int().min(0).max(1_000_000), reason: z.string().trim().min(10).max(500) }).strict();

/** A count: the pieces on hand become what was counted, with the reason; the difference is the move. Call inside a transaction. */
export function countItem(db: Db, raw: unknown, who: Who & { today: string }) {
  const v = countInput.parse(raw);
  const it = item(db, v.itemId);
  if (!it) throw notFound('The item');
  const diff = v.countedQty - it.onHand;
  if (diff === 0) throw conflict('NO_DIFFERENCE', `${itemLabel(it)} already shows ${pieces(it.onHand)} on hand.`);
  db.prepare(`INSERT INTO tpl_stock_moves (item_id, kind, qty, reason, at, business_date, user_id) VALUES (?, 'count', ?, ?, ?, ?, ?)`).run(it.id, diff, v.reason, who.at, who.today, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.count', entityType: 'tpl_item', entityId: it.id, data: { was: it.onHand, counted: v.countedQty, reason: v.reason } });
  return item(db, it.id)!;
}

/** Every movement of an item, newest first, with the balance after each: put in, counted, delivered, and returned by a cancel. */
export function stockCard(db: Db, itemId: string) {
  const it = item(db, itemId);
  if (!it) throw notFound('The item');
  const moves = db.prepare(`SELECT m.kind, m.qty, m.reason, m.business_date AS date, m.at, d.number, d.doc_type AS docType, d.id AS documentId, u.display_name AS byName
        FROM tpl_stock_moves m LEFT JOIN documents d ON d.id = m.document_id JOIN users u ON u.id = m.user_id WHERE m.item_id = @item
      UNION ALL
      SELECT 'out', -l.qty, NULL, d.business_date, d.posted_at, d.number, d.doc_type, d.id, u.display_name
        FROM tpl_delivery_lines l JOIN documents d ON d.id = l.document_id JOIN users u ON u.id = d.posted_by WHERE l.item_id = @item
      UNION ALL
      SELECT 'back', l.qty, d.cancel_reason, substr(d.cancelled_at, 1, 10), d.cancelled_at, d.number, d.doc_type, d.id, u.display_name
        FROM tpl_delivery_lines l JOIN documents d ON d.id = l.document_id JOIN users u ON u.id = d.cancelled_by WHERE l.item_id = @item AND d.status = 'cancelled'
      ORDER BY 5`)
    .all({ item: itemId }) as { kind: 'in' | 'count' | 'out' | 'back'; qty: number; reason: string | null; date: string; at: string; number: string | null; docType: string | null; documentId: string | null; byName: string }[];
  let balance = 0;
  const rows = moves.map((m) => ({ ...m, balance: (balance += m.qty) }));
  return { item: it, rows: rows.reverse() };
}

/** A program's restock job orders still open (not every piece in stock), newest first, with what each can put in now. */
export function openRestocks(db: Db, programId: string) {
  const ids = db.prepare(`SELECT r.job_order_id FROM tpl_restocks r JOIN documents d ON d.id = r.job_order_id WHERE r.program_id = ? AND d.status = 'posted' ORDER BY d.number DESC`).pluck().all(programId) as string[];
  return ids.map((id) => {
    const jo = jobOrderRef(db, id)!;
    const lines = toPutIn(db, id)!;
    return { id, number: jo.number, dueDate: jo.dueDate, stage: currentStage(db, id), lines };
  }).filter((r) => r.lines.some((l) => l.inStock < l.qty));
}

/** Items at or below their reorder level, for the Restock form and the home card. */
export const belowReorder = (db: Db, programId: string) => itemsOf(db, programId).filter((i) => i.isActive && i.onHand <= i.reorderLevel);
