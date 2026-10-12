/**
 * Alterations and replacements (ALT-, the owner's request, Oct 2026): items a customer brings back.
 * 1. Received (alt.receive): each line is an alteration or a replacement, from a released job order line, a quick sale
 *    line (POS or online order) or described by hand, with what is wrong. A replacement says what becomes of the returned
 *    piece: kept, scrapped, used for parts, or (a website item) fixed in Shop work and sold again.
 * 2. Decided (alt.decide, the owner or the accountant), once: declined with a reason, or accepted with a fee per piece for
 *    each line (₱0 = free) and a reason. Accepting makes a job order for the customer at those fees (no downpayment; paid
 *    on release), which goes on the production board like any other; it needs jo.post too.
 * 3. Back to the customer on a release slip, with its invoice record when there is a fee (the usual JO flow). A ₱0 release
 *    needs no invoice.
 * No journal of its own: any fee is a job order sale, booked by its invoice record.
 */
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { postDocument, type Actor, type EngineEnv } from '../../engine/documents/lifecycle.ts';
import { customerRef } from '../CUS/public.ts';
import { currentStage, jobOrderDoc, jobOrderRef, lineState } from '../JO/public.ts';
import { saleLines, saleRef } from '../QS/public.ts';
import { createShopWork, saleOfOnlineOrder } from '../SHP/public.ts';

export interface Who { userId: string; at: string; today: string }
const text = (max: number) => z.string().trim().min(1).max(max);
const MAX_FEE = 10_000_000; // ₱100,000 a piece

export const returnInput = z.object({
  customerId: z.uuid().optional(), // needed when every line is described by hand; else the source's customer
  contact: text(200).optional(),
  notes: text(1000).optional(),
  lines: z.array(z.object({
    action: z.enum(['alteration', 'replacement']),
    source: z.enum(['job_order', 'sale', 'other']),
    /** The job order, quick sale or online order number. */
    sourceNumber: text(40).optional(),
    sourceLineNo: z.number().int().min(1).optional(),
    description: text(200).optional(), // by hand ('other'); else the source line's
    qty: z.number().int().min(1).max(10_000),
    problem: z.string().trim().min(3).max(500),
    oldPiece: z.enum(['kept', 'scrapped', 'parts', 'shop_rework']).optional(),
    oldPieceNote: text(300).optional(),
  }).strict()).min(1).max(50),
}).strict();

export const decisionInput = z.object({
  outcome: z.enum(['accepted', 'declined']),
  reason: z.string().trim().min(5).max(500),
  dueInDays: z.number().int().min(1).max(365).optional(),
  priority: z.enum(['normal', 'rush']).optional(),
  fees: z.array(z.object({ lineNo: z.number().int().min(1), feeEachCents: z.number().int().min(0).max(MAX_FEE) }).strict()).max(50).optional(),
}).strict();

const ACTION = { alteration: 'Alteration', replacement: 'Replacement' } as const;
const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/** A job order, quick sale or online order by its number: the document and its customer. */
function sourceDoc(db: Db, kind: 'job_order' | 'sale', number: string) {
  if (kind === 'job_order') {
    const id = db.prepare("SELECT id FROM documents WHERE doc_type = 'jo.job_order' AND number = ? COLLATE NOCASE").pluck().get(number.trim()) as string | undefined;
    const jo = id ? jobOrderRef(db, id) : undefined;
    return jo && { id: jo.id, number: jo.number, status: jo.status, customerId: jo.customerId };
  }
  const id = (db.prepare("SELECT id FROM documents WHERE doc_type = 'qs.sale' AND number = ? COLLATE NOCASE").pluck().get(number.trim()) as string | undefined) ?? saleOfOnlineOrder(db, number);
  const s = id ? saleRef(db, id) : undefined;
  return s && { id: s.id, number: s.number, status: s.status, customerId: s.customerId };
}

/** Receive a return (ALT-). Call inside a transaction. */
export function receiveReturn(db: Db, raw: unknown, who: Who) {
  const v = returnInput.parse(raw);
  const customers = new Set<string>();
  const lines = v.lines.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (l.action === 'replacement' && !l.oldPiece) throw new AppError('VALIDATION', `${n}: say what becomes of the returned piece.`, 422);
    if (l.action === 'alteration' && l.oldPiece) throw new AppError('VALIDATION', `${n}: an alteration gives the same piece back, so there is no old piece.`, 422);
    if (l.source === 'other') {
      if (!l.description) throw new AppError('VALIDATION', `${n}: describe the item.`, 422);
      if (l.oldPiece === 'shop_rework') throw new AppError('VALIDATION', `${n}: only a website item can go back to the shop to be fixed and sold again.`, 422);
      return { ...l, docId: null, sourceLineNo: null, description: l.description, item: null };
    }
    if (!l.sourceNumber || !l.sourceLineNo) throw new AppError('VALIDATION', `${n}: give the ${l.source === 'job_order' ? 'job order' : 'sale or online order'} number and its line.`, 422);
    const doc = sourceDoc(db, l.source, l.sourceNumber);
    if (!doc) throw new AppError('VALIDATION', `${n}: there is no ${l.source === 'job_order' ? 'job order' : 'sale or online order'} ${l.sourceNumber}.`, 422);
    if (doc.status !== 'posted') throw conflict('SOURCE_CANCELLED', `${n}: ${doc.number} is cancelled.`);
    customers.add(doc.customerId);
    if (l.source === 'job_order') {
      const line = lineState(db, doc.id).find((x) => x.lineNo === l.sourceLineNo);
      if (!line) throw new AppError('VALIDATION', `${n}: ${doc.number} has no line ${l.sourceLineNo}.`, 422);
      if (l.qty > line.releasedQty) {
        throw conflict('NOT_RELEASED', line.releasedQty ? `${n}: only ${pieces(line.releasedQty)} of ${doc.number} line ${l.sourceLineNo} went out to the customer.` : `${n}: ${doc.number} line ${l.sourceLineNo} has not gone out to the customer yet.`);
      }
      if (l.oldPiece === 'shop_rework') throw new AppError('VALIDATION', `${n}: only a website item can go back to the shop to be fixed and sold again.`, 422);
      return { ...l, docId: doc.id, description: l.description ?? line.description, item: null };
    }
    const line = saleLines(db, doc.id).find((x) => x.lineNo === l.sourceLineNo);
    if (!line) throw new AppError('VALIDATION', `${n}: ${doc.number} has no line ${l.sourceLineNo}.`, 422);
    if (l.qty > line.qty) throw conflict('MORE_THAN_SOLD', `${n}: ${doc.number} line ${l.sourceLineNo} sold ${pieces(line.qty)}.`);
    const item = line.productId && line.size && line.colour ? { productId: line.productId, size: line.size, colour: line.colour } : null;
    if (l.oldPiece === 'shop_rework' && !item) throw new AppError('VALIDATION', `${n}: only a website item can go back to the shop to be fixed and sold again.`, 422);
    return { ...l, docId: doc.id, description: l.description ?? line.description, item };
  });
  if (customers.size > 1) throw new AppError('VALIDATION', 'The items are from different customers. Make one return for each customer.', 422);
  const customerId = [...customers][0] ?? v.customerId;
  if (!customerId) throw new AppError('VALIDATION', 'Pick the customer who brought the items.', 422);
  if (v.customerId && v.customerId !== customerId) throw new AppError('VALIDATION', 'The customer is not the one on the job order or sale.', 422);
  if (!customerRef(db, customerId)) throw new AppError('VALIDATION', 'Pick the customer who brought the items.', 422);

  const seq = db.prepare("UPDATE alt_sequences SET next_value = next_value + 1 WHERE key = 'return' RETURNING next_value - 1 AS n").get() as { n: number };
  const number = `ALT-${String(seq.n).padStart(6, '0')}`;
  const id = newId();
  db.prepare('INSERT INTO alt_returns (id, number, customer_id, received_on, contact, notes, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, number, customerId, who.today, v.contact ?? null, v.notes ?? null, who.at, who.userId);
  const add = db.prepare(`INSERT INTO alt_return_lines (return_id, line_no, action, source, source_doc_id, source_line_no, description, qty, problem, old_piece, old_piece_note, product_id, size, colour)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  lines.forEach((l, i) => add.run(id, i + 1, l.action, l.source, l.docId, l.sourceLineNo ?? null, l.description, l.qty, l.problem, l.oldPiece ?? null, l.oldPieceNote ?? null,
    l.item?.productId ?? null, l.item?.size ?? null, l.item?.colour ?? null));
  appendAudit(db, { at: who.at, userId: who.userId, action: 'alt.receive', entityType: 'alt_return', entityId: id, data: { number, customerId, lines: v.lines } });
  return returnOf(db, id)!;
}

interface LineRow {
  lineNo: number; action: 'alteration' | 'replacement'; source: 'job_order' | 'sale' | 'other'; sourceDocId: string | null; sourceNumber: string | null; sourceLineNo: number | null;
  description: string; qty: number; problem: string; oldPiece: string | null; oldPieceNote: string | null; productId: string | null; size: string | null; colour: string | null; feeEachCents: number | null;
}
export type ReturnStatus = 'awaiting_decision' | 'declined' | 'in_production' | 'ready' | 'released' | 'cancelled';
export const STATUS_LABEL: Record<ReturnStatus, string> = {
  awaiting_decision: 'Awaiting decision', declined: 'Declined', in_production: 'In production', ready: 'Ready to give back', released: 'Given back', cancelled: 'Job order cancelled',
};

/** A return with its lines, the decision and its job order, and where it stands. */
export function returnOf(db: Db, id: string) {
  const r = db.prepare(`SELECT r.id, r.number, r.customer_id AS customerId, c.display_name AS customerName, r.received_on AS receivedOn, r.contact, r.notes, r.at, u.display_name AS receivedBy
    FROM alt_returns r JOIN cus_customers c ON c.id = r.customer_id JOIN users u ON u.id = r.user_id WHERE r.id = ?`).get(id) as
    | { id: string; number: string; customerId: string; customerName: string; receivedOn: string; contact: string | null; notes: string | null; at: string; receivedBy: string }
    | undefined;
  if (!r) return undefined;
  const lines = db.prepare(`SELECT l.line_no AS lineNo, l.action, l.source, l.source_doc_id AS sourceDocId, d.number AS sourceNumber, l.source_line_no AS sourceLineNo, l.description, l.qty, l.problem,
      l.old_piece AS oldPiece, l.old_piece_note AS oldPieceNote, l.product_id AS productId, l.size, l.colour, f.fee_each_cents AS feeEachCents
    FROM alt_return_lines l LEFT JOIN documents d ON d.id = l.source_doc_id LEFT JOIN alt_decision_lines f ON f.return_id = l.return_id AND f.line_no = l.line_no
    WHERE l.return_id = ? ORDER BY l.line_no`).all(id) as LineRow[];
  const d = db.prepare(`SELECT x.outcome, x.reason, x.job_order_id AS jobOrderId, j.number AS jobOrderNumber, x.shop_work_id AS shopWorkId, s.number AS shopWorkNumber, x.at, u.display_name AS decidedBy
    FROM alt_decisions x JOIN users u ON u.id = x.user_id LEFT JOIN documents j ON j.id = x.job_order_id LEFT JOIN documents s ON s.id = x.shop_work_id WHERE x.return_id = ?`).get(id) as
    | { outcome: 'accepted' | 'declined'; reason: string; jobOrderId: string | null; jobOrderNumber: string | null; shopWorkId: string | null; shopWorkNumber: string | null; at: string; decidedBy: string }
    | undefined;
  return { ...r, lines, decision: d ?? null, status: statusOf(db, d), feeCents: lines.reduce((n, l) => n + (l.feeEachCents ?? 0) * l.qty, 0) };
}

function statusOf(db: Db, d: { outcome: string; jobOrderId: string | null } | undefined): ReturnStatus {
  if (!d) return 'awaiting_decision';
  if (d.outcome === 'declined' || !d.jobOrderId) return 'declined';
  if (jobOrderRef(db, d.jobOrderId)?.status !== 'posted') return 'cancelled';
  const stage = currentStage(db, d.jobOrderId);
  return stage === 'ready' ? 'ready' : stage === 'released' || stage === 'partially_released' ? 'released' : 'in_production';
}

/** Returns, newest first: all, or those still open (awaiting a decision, or in production and not yet given back). */
export function listReturns(db: Db, open: boolean) {
  const ids = db.prepare('SELECT id FROM alt_returns ORDER BY at DESC, number DESC LIMIT 500').pluck().all() as string[];
  return ids.map((id) => returnOf(db, id)!).filter((r) => !open || ['awaiting_decision', 'in_production', 'ready'].includes(r.status));
}

/**
 * Management's decision, once. Accepted: a job order for the customer at the fees (₱0 when free), on the production board;
 * and a replaced website piece marked for it goes to Shop work to be fixed and sold again. Call inside a transaction.
 */
export function decide(env: EngineEnv, actor: Actor, id: string, raw: unknown, who: Who, nowMs: number) {
  const v = decisionInput.parse(raw);
  const db = env.db;
  const r = returnOf(db, id);
  if (!r) throw notFound('The return');
  if (r.decision) throw conflict('DECIDED', `${r.number} was already ${r.decision.outcome === 'declined' ? 'declined' : 'accepted'} by ${r.decision.decidedBy}.`);
  if (v.outcome === 'declined') {
    if (v.fees?.length) throw new AppError('VALIDATION', 'A declined return has no fees.', 422);
    db.prepare("INSERT INTO alt_decisions (return_id, outcome, reason, at, user_id) VALUES (?, 'declined', ?, ?, ?)").run(id, v.reason, who.at, who.userId);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'alt.decline', entityType: 'alt_return', entityId: id, data: { number: r.number, reason: v.reason } });
    return returnOf(db, id)!;
  }
  const fees = new Map((v.fees ?? []).map((f) => [f.lineNo, f.feeEachCents]));
  if (fees.size !== (v.fees ?? []).length) throw new AppError('VALIDATION', 'A line is listed twice.', 422);
  for (const k of fees.keys()) if (!r.lines.some((l) => l.lineNo === k)) throw new AppError('VALIDATION', `${r.number} has no line ${k}.`, 422);
  const missing = r.lines.filter((l) => !fees.has(l.lineNo));
  if (missing.length) throw new AppError('VALIDATION', `Set the fee for line ${missing.map((l) => l.lineNo).join(', ')} (₱0 when it is free).`, 422);

  const input = {
    customerId: r.customerId,
    ...(r.contact ? { contact: r.contact } : {}),
    dueInDays: v.dueInDays ?? 7,
    priority: v.priority ?? 'normal',
    paymentTerms: 'cod' as const, // any fee is paid when the items go back
    notes: `${r.number}: items brought back for alteration or replacement. ${[...fees.values()].every((f) => f === 0) ? 'Free' : 'With a fee'} (decided by management): ${v.reason}`.slice(0, 1000),
    lines: r.lines.map((l) => ({
      kind: 'made_to_order' as const,
      description: `${ACTION[l.action]}: ${l.description}${l.sourceNumber ? ` (${l.sourceNumber})` : ''} — ${l.problem}`.slice(0, 200),
      qty: l.qty, unitPriceCents: fees.get(l.lineNo)!, discountCents: 0, roster: [],
    })),
  };
  const total = input.lines.reduce((n, l) => n + l.qty * l.unitPriceCents, 0);
  const jo = postDocument(env, jobOrderDoc, actor, { input, expectedTotalCents: total });
  // Replaced website pieces marked to be fixed and sold again: one Shop work order for them (SHP).
  const rework = r.lines.filter((l) => l.oldPiece === 'shop_rework' && l.productId && l.size && l.colour);
  const shopWork = rework.length
    ? createShopWork(env, actor, {
      kind: 'change', dueInDays: v.dueInDays ?? 7, priority: 'normal', notes: `Returned pieces replaced for the customer (${r.number}).`,
      lines: rework.map((l) => ({ to: { productId: l.productId!, size: l.size!, colour: l.colour! }, qty: l.qty, source: 'other' as const, sourceNote: `Returned piece, ${r.number}` })),
    }, who, nowMs)
    : null;
  db.prepare("INSERT INTO alt_decisions (return_id, outcome, reason, job_order_id, shop_work_id, at, user_id) VALUES (?, 'accepted', ?, ?, ?, ?, ?)")
    .run(id, v.reason, jo.id, shopWork?.id ?? null, who.at, who.userId);
  const fee = db.prepare('INSERT INTO alt_decision_lines (return_id, line_no, fee_each_cents) VALUES (?, ?, ?)');
  for (const [lineNo, cents] of fees) fee.run(id, lineNo, cents);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'alt.accept', entityType: 'alt_return', entityId: id, data: { number: r.number, reason: v.reason, fees: v.fees, jobOrder: jo.number, shopWork: shopWork?.number ?? null } });
  return returnOf(db, id)!;
}

/** Released lines of a job order, or the lines of a sale or online order, to pick what came back (the return form). */
export function sourceLines(db: Db, kind: 'job_order' | 'sale', number: string) {
  const doc = sourceDoc(db, kind, number);
  if (!doc) throw notFound(kind === 'job_order' ? `Job order ${number}` : `Sale or online order ${number}`);
  const customer = customerRef(db, doc.customerId);
  const lines = kind === 'job_order'
    ? lineState(db, doc.id).map((l) => ({ lineNo: l.lineNo, description: l.description, qty: l.releasedQty, website: false }))
    : saleLines(db, doc.id).map((l) => ({ lineNo: l.lineNo, description: l.description, qty: l.qty, website: !!l.productId }));
  return { id: doc.id, number: doc.number, status: doc.status, customerId: doc.customerId, customerName: customer?.display_name ?? '', lines };
}
