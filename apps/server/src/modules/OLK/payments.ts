/**
 * Each member pays their own share (the owner's request, Nov 2026). On a group link set so, the page shows the price list's
 * prices and the member's share (their pieces at the price for their quantity), the shop's QR code and account, and takes
 * the amount paid, the reference and a picture of the payment. Staff check the shop's account, then either take it as a
 * collection on the member's job order (the collection form opens filled in, to record) or mark it not received, with a
 * reason the member sees. A payment can be sent while none is waiting to be checked, also after the link closes.
 */
import { z } from 'zod';
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { pictureFile, sha256Hex } from '../../engine/attachments.ts';
import { lookupCatalogPrice, publicPriceList } from '../CAT/public.ts';
import { collectionNotes } from '../COL/public.ts';
import { jobOrdersOf } from '../JO/public.ts';
import { shopPayHow } from '../SHP/public.ts';
import { answerOf, itemsOf, type LinkRow, type Who } from './links.ts';

export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
export const b64 = (bytes: number) => Math.ceil(bytes / 3) * 4 + 4;
/** Payments waiting to be checked, every link together; past it members are asked to message the shop. */
const MAX_WAITING = 200;

export const paymentInput = z.object({
  amountCents: z.number().int().min(100).max(1_000_000_000),
  reference: z.string().trim().min(4).max(60),
  proof: z.object({ name: z.string().max(200), data: z.string().max(b64(MAX_PROOF_BYTES)) }).strict(),
}).strict();
export const acceptInput = z.object({ jobOrderId: z.uuid() }).strict();
export const notReceivedInput = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

const linkByToken = (db: Db, token: string) => db.prepare('SELECT * FROM olk_links WHERE token = ?').get(token) as LinkRow | undefined;

/** The prices a member sees: each item's price list tiers today (none for an item not on the price list). */
export function pricesOf(db: Db, l: LinkRow, today: string) {
  const list = new Map(publicPriceList(db, today).map((i) => [i.id, i.tiers]));
  return itemsOf(db, l.id).map((it) => ({ lineNo: it.lineNo, tiers: list.get(it.itemId) ?? [] }));
}

/** A member's share: their pieces at the price for their quantity. Null when an item has no price on the list. */
export function shareOf(db: Db, l: LinkRow, a: ReturnType<typeof answerOf>, today: string) {
  const items = new Map(itemsOf(db, l.id).map((it) => [it.lineNo, it]));
  const lines = a.people.flatMap((p) => p.pieces).map((pc) => {
    const it = items.get(pc.lineNo)!;
    const price = lookupCatalogPrice(db, it.itemId, pc.qty, today);
    return { lineNo: pc.lineNo, name: it.name, qty: pc.qty, unitCents: price?.unitPriceCents ?? null };
  });
  const priced = lines.every((x) => x.unitCents !== null);
  return { lines, totalCents: priced ? lines.reduce((s, x) => s + x.qty * x.unitCents!, 0) : null };
}

/** What the prefilled collection's note says, and how a recorded collection is known for its payment. */
const referenceNote = (reference: string) => `reference ${reference}.`;

/** The payments of an answer, oldest first (without the picture). */
export function paymentsOf(db: Db, responseId: string) {
  return (db.prepare('SELECT id, amount_cents, reference, sent_at, status, reason, decided_at, job_order_id FROM olk_payments WHERE response_id = ? ORDER BY sent_at').all(responseId) as
    { id: string; amount_cents: number; reference: string; sent_at: string; status: 'sent' | 'accepted' | 'not_received'; reason: string | null; decided_at: string | null; job_order_id: string | null }[])
    .map((p) => ({ id: p.id, amountCents: p.amount_cents, reference: p.reference, sentAt: p.sent_at, status: p.status, recorded: p.status === 'accepted' && collectionNotes(db, referenceNote(p.reference)), ...(p.reason ? { reason: p.reason } : {}),
      ...(p.decided_at ? { decidedAt: p.decided_at } : {}), ...(p.job_order_id ? { jobOrderId: p.job_order_id } : {}) }));
}

/** What a member's own page adds when they pay their own share: the share, how to pay, and their payments so far. */
export function memberPay(db: Db, token: string, a: ReturnType<typeof answerOf>, today: string) {
  const l = linkByToken(db, token);
  if (!l?.pay_own) return {};
  // Accepted and not yet recorded as a collection: to the member it is still being checked, not received.
  return { share: shareOf(db, l, a, today), payments: paymentsOf(db, a.id).map(({ id: _, jobOrderId: _j, recorded, ...p }) => (p.status === 'accepted' && !recorded ? { ...p, status: 'sent' as const } : p)) };
}

/** What the link page adds for a pay-own link: the prices and how to pay the shop. */
export function linkPay(db: Db, token: string, today: string) {
  const l = linkByToken(db, token);
  return l?.pay_own ? { prices: pricesOf(db, l, today), pay: shopPayHow(db) } : {};
}

/** What staff see beside each answer of a pay-own link: the member's share and their payments. */
export function staffPay(db: Db, linkId: string, responseId: string, today: string) {
  const l = db.prepare('SELECT * FROM olk_links WHERE id = ?').get(linkId) as LinkRow | undefined;
  if (!l) return { payments: paymentsOf(db, responseId) };
  return { ...(l.pay_own ? { share: shareOf(db, l, answerOf(db, responseId), today) } : {}), payments: paymentsOf(db, responseId) };
}

/** A member sends a payment of their share: the amount, the reference, a picture of it. */
export function sendPayment(db: Db, token: string, responseId: string, raw: unknown, ctx: { at: string; newId: string }) {
  const l = linkByToken(db, token);
  if (!l) throw notFound('That order link');
  if (!l.pay_own) throw conflict('NOT_PAY_OWN', 'This order is paid by the group: the shop will tell you how.');
  const v = paymentInput.parse(raw);
  const raw64 = Buffer.from(v.proof.data, 'base64');
  const pic = raw64.length ? pictureFile(raw64, 'The picture of the payment') : null;
  if (!pic || 'problem' in pic) throw new AppError('FILE_TYPE', pic && 'problem' in pic && /pixels/.test(pic.problem) ? pic.problem : 'The picture of the payment must be a JPEG, PNG or WebP picture, like a screenshot.', 415);
  if (pic.data.length > MAX_PROOF_BYTES) throw new AppError('FILE_TOO_BIG', 'The picture is bigger than 4 MB. Send a smaller one.', 413);
  if (db.prepare("SELECT 1 FROM olk_payments WHERE response_id = ? AND status = 'sent'").get(responseId)) {
    throw conflict('WAITING', 'Your last payment is still being checked. The shop will update this page once it is.');
  }
  if ((db.prepare("SELECT COUNT(*) FROM olk_payments WHERE status = 'sent'").pluck().get() as number) >= MAX_WAITING) {
    throw new AppError('TOO_MANY_PAYMENTS', 'The shop has many payments to check just now. Please message the shop with your reference number.', 429);
  }
  db.prepare('INSERT INTO olk_payments (id, response_id, amount_cents, reference, sent_at) VALUES (?, ?, ?, ?, ?)').run(ctx.newId, responseId, v.amountCents, v.reference, ctx.at);
  db.prepare('INSERT INTO olk_payment_files (payment_id, content_type, bytes, sha256, data) VALUES (?, ?, ?, ?, ?)').run(ctx.newId, pic.type, pic.data.length, sha256Hex(pic.data), pic.data);
  appendAudit(db, { at: ctx.at, userId: null, action: 'olk.payment.sent', entityType: 'olk.payment', entityId: ctx.newId, data: { responseId, amountCents: v.amountCents, reference: v.reference } });
}

type PaymentRow = { id: string; response_id: string; amount_cents: number; reference: string; status: string; version: number; link_id: string; name: string };
function paymentRow(db: Db, id: string): PaymentRow {
  const p = db.prepare('SELECT p.*, r.link_id, r.name FROM olk_payments p JOIN olk_responses r ON r.id = p.response_id WHERE p.id = ?').get(id) as PaymentRow | undefined;
  if (!p) throw notFound('That payment');
  return p;
}

/** The picture of a payment, for staff. */
export function paymentPicture(db: Db, id: string) {
  const f = db.prepare('SELECT content_type AS type, data FROM olk_payment_files WHERE payment_id = ?').get(id) as { type: string; data: Buffer } | undefined;
  if (!f) throw notFound('The picture of the payment');
  return f;
}

/** The recorded job orders a payment can be collected on: those of the customers job orders were started for from the answer. */
export function jobOrdersFor(db: Db, id: string) {
  const p = paymentRow(db, id);
  const customers = db.prepare('SELECT DISTINCT customer_id FROM olk_made WHERE response_id = ?').pluck().all(p.response_id) as string[];
  return customers.flatMap((c) => jobOrdersOf(db, c)).filter((j) => j.status === 'posted')
    .map((j) => ({ id: j.id, number: j.number, customerName: j.customerName, totalCents: j.totalCents, dueDate: j.dueDate }));
}

/** Staff found the payment: it is to be collected on this job order (the collection form opens to record it). */
export function acceptPayment(db: Db, id: string, raw: unknown, who: Who) {
  const v = acceptInput.parse(raw);
  const p = paymentRow(db, id);
  // Accepted but its collection never recorded (the form was closed): it can be taken up again, nothing is lost.
  const again = p.status === 'accepted' && !collectionNotes(db, referenceNote(p.reference));
  if (p.status !== 'sent' && !again) throw conflict('DECIDED', 'This payment was already checked.');
  const jo = jobOrdersFor(db, id).find((j) => j.id === v.jobOrderId);
  if (!jo) throw conflict('JOB_ORDER', "Pick a recorded job order of this member's.");
  db.prepare("UPDATE olk_payments SET status = 'accepted', decided_at = ?, decided_by = ?, job_order_id = ?, version = version + 1 WHERE id = ?").run(who.at, who.userId, jo.id, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'olk.payment.accept', entityType: 'olk.payment', entityId: id, data: { jobOrderId: jo.id } });
  return { jobOrderId: jo.id, jobOrderNumber: jo.number, amountCents: p.amount_cents, note: `Paid through the order link by ${p.name}, ${referenceNote(p.reference)}` };
}

/** Staff did not find the payment: the member sees why and can send it again. */
export function paymentNotReceived(db: Db, id: string, raw: unknown, who: Who) {
  const v = notReceivedInput.parse(raw);
  const p = paymentRow(db, id);
  if (p.status !== 'sent') throw conflict('DECIDED', 'This payment was already checked.');
  db.prepare("UPDATE olk_payments SET status = 'not_received', decided_at = ?, decided_by = ?, reason = ?, version = version + 1 WHERE id = ?").run(who.at, who.userId, v.reason, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'olk.payment.not_received', entityType: 'olk.payment', entityId: id, data: { reason: v.reason } });
  return { ok: true };
}
