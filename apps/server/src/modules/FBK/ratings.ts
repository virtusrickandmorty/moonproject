/**
 * Customer ratings (the owner's request, Nov 2026). Once a job order is fully released, its customer is asked to rate it,
 * 1 to 5 stars and a comment, on a private link: emailed the day after (COM, to customers who agreed to emails), or copied
 * by staff from the job order to send on Messenger. A rating is given once and kept as given; one of 3 stars or less shows
 * in the bell, so someone calls the customer. The link shows the job order's number and items, never a price.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentStage, jobOrderRef, releasesBetween, trackedJobOrder } from '../JO/public.ts';

export const ratingInput = z.object({
  stars: z.number().int().min(1, 'Pick from 1 to 5 stars.').max(5),
  comment: z.string().trim().max(2000).optional(),
  name: z.string().trim().max(120).optional(),
}).strict();

type RequestRow = { id: string; job_order_id: string; job_order_no: string; customer_id: string; token: string; created_at: string };
type RatingRow = { stars: number; comment: string | null; name: string | null; at: string };

const ratingOf = (db: Db, requestId: string) => db.prepare('SELECT stars, comment, name, at FROM fbk_ratings WHERE request_id = ?').get(requestId) as RatingRow | undefined;
const ratingOut = (r: RatingRow | undefined) => (r ? { stars: r.stars, ...(r.comment ? { comment: r.comment } : {}), ...(r.name ? { name: r.name } : {}), at: r.at } : null);
const requestOf = (db: Db, number: string) => db.prepare('SELECT * FROM fbk_requests WHERE job_order_no = ?').get(number) as RequestRow | undefined;

/** The request for a job order (and the one it was edited from), made when first asked for. Call inside a transaction. */
export function requestFor(db: Db, jobOrderId: string, who: { userId: string | null; at: string }) {
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('That job order');
  const had = requestOf(db, jo.number);
  if (had) return had;
  if (jo.status !== 'posted') throw conflict('CANCELLED', `${jo.number} is cancelled.`);
  const row: RequestRow = { id: newId(), job_order_id: jo.id, job_order_no: jo.number, customer_id: jo.customerId, token: randomBytes(24).toString('base64url'), created_at: who.at };
  db.prepare('INSERT INTO fbk_requests (id, job_order_id, job_order_no, customer_id, token, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.job_order_id, row.job_order_no, row.customer_id, row.token, row.created_at, who.userId);
  return row;
}

/** Staff: a job order's rating link and rating, if any. */
export function ratingForJobOrder(db: Db, jobOrderId: string) {
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('That job order');
  const r = requestOf(db, jo.number);
  return { stage: currentStage(db, jo.id), token: r?.token ?? null, rating: r ? ratingOut(ratingOf(db, r.id)) : null };
}

/** Job orders fully released in the last two weeks up to yesterday: the daily check emails each once (COM, by its dedupe key). */
export function jobOrdersToRate(db: Db, today: string) {
  const day = (n: number) => { const d = new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
  const ids = [...new Set(releasesBetween(db, day(-14), day(-1)).map((r) => r.jobOrderId))];
  return ids.filter((id) => currentStage(db, id) === 'released').map((id) => jobOrderRef(db, id)!);
}

const byToken = (db: Db, token: string) => (/^[\w-]{20,64}$/.test(token) ? db.prepare('SELECT * FROM fbk_requests WHERE token = ?').get(token) as RequestRow | undefined : undefined);

/** The customer's page: the job order and its items, and the rating once given. */
export function publicRating(db: Db, token: string) {
  const r = byToken(db, token);
  if (!r) throw notFound('That rating link');
  const jo = trackedJobOrder(db, r.job_order_no);
  return { jobOrderNumber: jo?.number ?? r.job_order_no, lines: jo?.lines ?? [], rating: ratingOut(ratingOf(db, r.id)) };
}

/** The customer rates, once. Call inside a transaction. */
export function rate(db: Db, token: string, raw: unknown, at: string) {
  const v = ratingInput.parse(raw);
  const r = byToken(db, token);
  if (!r) throw notFound('That rating link');
  if (ratingOf(db, r.id)) throw conflict('RATED', 'You already rated this order. Thank you!');
  db.prepare('INSERT INTO fbk_ratings (request_id, stars, comment, name, at) VALUES (?, ?, ?, ?, ?)').run(r.id, v.stars, v.comment || null, v.name || null, at);
  appendAudit(db, { at, userId: null, action: 'fbk.rated', entityType: 'document', entityId: r.job_order_id, data: { number: r.job_order_no, stars: v.stars } });
  return publicRating(db, token);
}

/** Every rating given in a period, newest first, with the average: the ratings screen. */
export function ratingsBetween(db: Db, from: string, to: string) {
  const rows = (db.prepare(`SELECT q.job_order_no AS jobOrderNumber, q.job_order_id AS jobOrderId, q.customer_id AS customerId,
      r.stars, r.comment, r.name, r.at FROM fbk_ratings r JOIN fbk_requests q ON q.id = r.request_id
    WHERE substr(r.at, 1, 10) BETWEEN ? AND ? ORDER BY r.at DESC`).all(from, to) as
    { jobOrderNumber: string; jobOrderId: string; customerId: string; stars: number; comment: string | null; name: string | null; at: string }[])
    .map((r) => ({ ...r, customerName: jobOrderRef(db, r.jobOrderId)?.customerName ?? null }));
  const asked = db.prepare('SELECT COUNT(*) FROM fbk_requests WHERE substr(created_at, 1, 10) BETWEEN ? AND ?').pluck().get(from, to) as number;
  const average = rows.length ? Math.round((rows.reduce((n, r) => n + r.stars, 0) / rows.length) * 10) / 10 : null;
  return { from, to, asked, rated: rows.length, average, rows };
}

/** Ratings of 3 stars or less since a time: the bell (DASH) asks someone to call the customer. */
export function lowRatingsSince(db: Db, since: string) {
  return db.prepare(`SELECT q.id, q.job_order_no AS jobOrderNumber, q.job_order_id AS jobOrderId, r.stars, r.comment, r.name, r.at
    FROM fbk_ratings r JOIN fbk_requests q ON q.id = r.request_id WHERE r.at >= ? AND r.stars <= 3 ORDER BY r.at DESC`).all(since) as
    { id: string; jobOrderNumber: string; jobOrderId: string; stars: number; comment: string | null; name: string | null; at: string }[];
}
