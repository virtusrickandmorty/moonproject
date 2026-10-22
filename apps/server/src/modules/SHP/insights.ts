/**
 * Website visitor insights (the owner's request, Oct 2026: "track what the customers do for future marketing and what
 * items they look into most"). First party and anonymous: the website sends what a visitor does (pages, products
 * opened, added to the cart or the wishlist, searches, categories, checkout, orders, quote requests) under a random id
 * it keeps in the visitor's browser; no name, no address, no cookie, no IP kept. A visitor can say "Don't count me" on
 * the website, and a browser asking not to be tracked is not counted. Staff see the summary (shp.view).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';

export const EVENT_KINDS = ['page', 'product', 'cart', 'wish', 'search', 'category', 'checkout', 'order', 'quote'] as const;
const id = z.string().regex(/^[a-z0-9]{8,40}$/);
const short = (n: number) => z.string().trim().min(1).max(n);
const event = z.object({
  kind: z.enum(EVENT_KINDS),
  page: z.string().regex(/^\/[A-Za-z0-9/_-]{0,80}$/).optional(),
  productId: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional(),
  query: short(60).optional(),
  results: z.number().int().min(0).max(10_000).optional(),
  category: short(60).optional(),
  source: z.string().regex(/^[a-z0-9.-]{1,60}$/).optional(),
}).strict();
const batch = z.object({ visitor: id, session: id, events: z.array(event).min(1).max(25) }).strict();

/** The kind of device, from the browser's own description: nothing more of it is kept. */
const deviceOf = (ua: string) => (/ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'phone' : 'computer');

export function shpInsightRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  // The website's batches (anyone; limited by its own allowance in engine/security/public-requests.ts).
  app.post('/api/shp/events', { config: { permission: 'public' }, bodyLimit: 8 * 1024 }, async (req, reply) => {
    const b = batch.parse(req.body);
    const at = stamp(clock), day = today(clock), hour = Number(at.slice(11, 13));
    const device = deviceOf(String(req.headers['user-agent'] ?? ''));
    const ins = db.prepare(`INSERT INTO shp_events (at, day, hour, visitor, session, kind, page, product_id, query, results, category, source, device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const e of b.events) ins.run(at, day, hour, b.visitor, b.session, e.kind, e.page ?? null, e.productId ?? null,
        e.query?.toLowerCase() ?? null, e.results ?? null, e.category ?? null, e.source ?? null, device);
    })();
    return reply.code(204).send();
  });

  app.get('/api/shp/insights', { config: { permission: 'shp.view' } }, async (req) => {
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days ?? 30) || 30));
    return insights(db, today(clock), days);
  });
}

/** A calendar day n days from another (both YYYY-MM-DD; the day itself is a Manila date, no clock involved). */
const plusDays = (date: string, n: number) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

/** The summary for the last `days` days up to `to` (inclusive). */
export function insights(db: Db, to: string, days: number) {
  const from = plusDays(to, -(days - 1));
  const q = <T>(sql: string, ...more: unknown[]) => db.prepare(sql).all(from, to, ...more) as T[];
  const one = <T>(sql: string) => db.prepare(sql).get(from, to) as T;
  const range = 'day BETWEEN ? AND ?';
  const totals = one<{ visitors: number; visits: number; pageViews: number }>(
    `SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS visits, SUM(kind = 'page') AS pageViews FROM shp_events WHERE ${range}`);
  const funnel = one<{ product: number; cart: number; checkout: number; order: number; quote: number }>(
    `SELECT COUNT(DISTINCT CASE WHEN kind = 'product' THEN visitor END) AS product, COUNT(DISTINCT CASE WHEN kind = 'cart' THEN visitor END) AS cart,
      COUNT(DISTINCT CASE WHEN kind = 'checkout' THEN visitor END) AS checkout, COUNT(DISTINCT CASE WHEN kind = 'order' THEN visitor END) AS "order",
      COUNT(DISTINCT CASE WHEN kind = 'quote' THEN visitor END) AS quote FROM shp_events WHERE ${range}`);
  const byDay = q<{ day: string; visitors: number; pageViews: number }>(
    `SELECT day, COUNT(DISTINCT visitor) AS visitors, SUM(kind = 'page') AS pageViews FROM shp_events WHERE ${range} GROUP BY day ORDER BY day`);
  const products = q<{ productId: string; name: string | null; views: number; viewers: number; carts: number; wishes: number; orders: number }>(
    `SELECT e.product_id AS productId, p.name, SUM(e.kind = 'product') AS views, COUNT(DISTINCT CASE WHEN e.kind = 'product' THEN e.visitor END) AS viewers,
      SUM(e.kind = 'cart') AS carts, SUM(e.kind = 'wish') AS wishes, SUM(e.kind = 'order') AS orders
     FROM shp_events e LEFT JOIN shp_products p ON p.id = e.product_id
     WHERE e.${range} AND e.product_id IS NOT NULL GROUP BY e.product_id ORDER BY views DESC, carts DESC LIMIT 20`);
  const searches = q<{ query: string; times: number; noResults: number }>(
    `SELECT query, COUNT(*) AS times, SUM(results = 0) AS noResults FROM shp_events WHERE ${range} AND kind = 'search' GROUP BY query ORDER BY times DESC LIMIT 20`);
  const categories = q<{ category: string; times: number }>(
    `SELECT category, COUNT(*) AS times FROM shp_events WHERE ${range} AND kind = 'category' GROUP BY category ORDER BY times DESC LIMIT 12`);
  const pages = q<{ page: string; views: number }>(
    `SELECT page, COUNT(*) AS views FROM shp_events WHERE ${range} AND kind = 'page' GROUP BY page ORDER BY views DESC LIMIT 12`);
  const sources = q<{ source: string; visits: number }>(
    `SELECT COALESCE(source, 'direct') AS source, COUNT(DISTINCT session) AS visits FROM shp_events WHERE ${range} AND kind = 'page'
     AND id IN (SELECT MIN(id) FROM shp_events WHERE ${range} AND kind = 'page' GROUP BY session) GROUP BY 1 ORDER BY visits DESC LIMIT 10`, from, to);
  const devices = q<{ device: string; visitors: number }>(
    `SELECT device, COUNT(DISTINCT visitor) AS visitors FROM shp_events WHERE ${range} GROUP BY device ORDER BY visitors DESC`);
  const hours = q<{ hour: number; visits: number }>(
    `SELECT hour, COUNT(DISTINCT session) AS visits FROM shp_events WHERE ${range} GROUP BY hour ORDER BY hour`);
  return { from, to, days, ...totals, pageViews: totals.pageViews ?? 0, funnel, byDay, products, searches, categories, pages, sources, devices, hours };
}
