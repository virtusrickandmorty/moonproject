/**
 * Ratings and reviews of the shop's products. Only a buyer whose online order is completed can write one, through the
 * order's secret link, once per product on that order. The website shows every review not hidden, under the buyer's first
 * name and initial; staff hide a review (with a reason) and can show it again. Nothing is deleted.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { conflict, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { findCustomersOrder } from './orders.ts';

const reviewInput = z.object({
  token: z.string().min(10).max(100),
  productId: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(80).optional(),
  body: z.string().trim().min(10, 'Write a few words about it (at least 10 letters).').max(1000),
}).strict();
const hideInput = z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).optional(), version: z.number().int().min(1) }).strict()
  .refine((b) => !b.hidden || (b.reason ?? '').length >= 3, { message: 'Say why the review is hidden.', path: ['reason'] });

/** "Juan dela Cruz" → "Juan d.": the first name and the last name's initial, never the full name. */
export const shownName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0]!;
};

/** The products of an order its buyer has reviewed. */
export const reviewedProducts = (db: Db, orderId: string) =>
  db.prepare('SELECT product_id FROM shp_reviews WHERE order_id = ?').pluck().all(orderId) as string[];

export function shpReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** Every review the website shows, newest first (the browser works out each product's average). */
  app.get('/api/shp/reviews', { config: { permission: 'public' } }, async () =>
    db.prepare(`SELECT id, product_id AS productId, product_name AS productName, rating, title, body, shown_name AS name, created_at AS at
      FROM shp_reviews WHERE is_hidden = 0 ORDER BY created_at DESC, rowid DESC LIMIT 500`).all());

  app.post<{ Params: { number: string } }>('/api/shp/orders/:number/reviews', { config: { permission: 'public' } }, async (req) => {
    const b = reviewInput.parse(req.body);
    const at = stamp(clock);
    return tx(db, () => {
      const o = findCustomersOrder(db, req.params.number, b.token);
      if (o.status !== 'completed') throw conflict('NOT_COMPLETED', 'You can rate your items once your order is completed.');
      const line = db.prepare('SELECT product_name FROM shp_order_lines WHERE order_id = ? AND product_id = ? LIMIT 1').get(o.id, b.productId) as { product_name: string } | undefined;
      if (!line) throw notFound('That item on your order');
      if (reviewedProducts(db, o.id).includes(b.productId)) throw conflict('ALREADY_REVIEWED', 'You have already rated this item. Thank you!');
      const id = newId();
      db.prepare(`INSERT INTO shp_reviews (id, order_id, product_id, product_name, rating, title, body, shown_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, o.id, b.productId, line.product_name, b.rating, b.title || null, b.body, shownName(o.name), at);
      appendAudit(db, { at, userId: null, action: 'shp.review.added', entityType: 'shp.review', entityId: id, data: { order: o.number, productId: b.productId, rating: b.rating } });
      return { id, reviewed: reviewedProducts(db, o.id) };
    });
  });

  // ---- Staff ----

  app.get('/api/shp/admin/reviews', { config: { permission: 'shp.view' } }, async () =>
    db.prepare(`SELECT r.id, r.product_id AS productId, r.product_name AS productName, r.rating, r.title, r.body, r.shown_name AS name, o.name AS buyer,
      o.number AS orderNumber, r.is_hidden AS hidden, r.hidden_reason AS hiddenReason, r.hidden_at AS hiddenAt, r.created_at AS at, r.version
      FROM shp_reviews r JOIN shp_orders o ON o.id = r.order_id ORDER BY r.created_at DESC, r.rowid DESC`).all()
      .map((r) => ({ ...(r as object), hidden: (r as { hidden: number }).hidden === 1 })));

  app.post<{ Params: { id: string } }>('/api/shp/admin/reviews/:id/hide', { config: { permission: 'shp.manage' } }, async (req) => {
    const b = hideInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const r = db.prepare('SELECT id, version FROM shp_reviews WHERE id = ?').get(req.params.id) as { id: string; version: number } | undefined;
      if (!r) throw notFound('The review');
      if (r.version !== b.version) throw conflict('STALE', 'This review changed meanwhile. Reload and try again.');
      db.prepare('UPDATE shp_reviews SET is_hidden = ?, hidden_reason = ?, hidden_by = ?, hidden_at = ?, version = version + 1 WHERE id = ?')
        .run(b.hidden ? 1 : 0, b.hidden ? b.reason! : null, b.hidden ? user.userId : null, b.hidden ? at : null, r.id);
      appendAudit(db, { at, userId: user.userId, action: b.hidden ? 'shp.review.hidden' : 'shp.review.shown', entityType: 'shp.review', entityId: r.id, data: { reason: b.reason ?? null } });
      return { ok: true };
    });
  });
}
