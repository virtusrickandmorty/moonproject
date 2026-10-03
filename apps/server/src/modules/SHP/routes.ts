/**
 * Website shop products: staff with shp.manage keep the garments the public shop shows; the website reads the active
 * ones without signing in. A showcase only: the "from" price never reaches a quotation or the books.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { sha256Hex, sniffType } from '../../engine/attachments.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';

export const SHAPES = ['tee', 'polo', 'jersey', 'jacket', 'hoodie', 'shorts'] as const;
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const productInput = z.object({
  name: text(1, 100), category: text(1, 40), shape: z.enum(SHAPES),
  priceCents: z.number().int().min(0).max(100_000_000), madeToOrder: z.boolean(),
  minQty: z.number().int().min(1).max(10_000), leadDays: z.number().int().min(0).max(365),
  badge: text(0, 30).transform((v) => v || null), summary: text(1, 300), sortOrder: z.number().int().min(-9999).max(9999),
  features: z.array(text(1, 100)).max(8),
  sizes: z.array(z.enum(SIZES)).min(1).refine((s) => new Set(s).size === s.length, 'sizes'),
  colours: z.array(z.object({ name: text(1, 30), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((h) => h.toLowerCase()) }).strict()).min(1).max(12),
}).strict();
export type ProductInput = z.infer<typeof productInput>;

interface Row {
  id: string; name: string; category: string; shape: string; price_cents: number; made_to_order: number; min_qty: number; lead_days: number;
  badge: string | null; summary: string; sort_order: number; photo_id: string | null; is_active: number; version: number; updated_at: string;
}

/** A product as the website and the staff screen see it: its current version's lists, in order. */
function shape(db: Db, r: Row) {
  const lines = <T>(table: string, cols: string) => db.prepare(`SELECT ${cols} FROM ${table} WHERE product_id = ? AND version = ? ORDER BY position`).all(r.id, r.version) as T[];
  return {
    id: r.id, name: r.name, category: r.category, shape: r.shape, priceCents: r.price_cents, madeToOrder: r.made_to_order === 1,
    minQty: r.min_qty, leadDays: r.lead_days, badge: r.badge, summary: r.summary, sortOrder: r.sort_order,
    photoUrl: r.photo_id ? `/api/shp/photos/${r.photo_id}` : null, isActive: r.is_active === 1, version: r.version, updatedAt: r.updated_at,
    features: lines<{ text: string }>('shp_product_features', 'text').map((f) => f.text),
    sizes: lines<{ size: string }>('shp_product_sizes', 'size').map((s) => s.size),
    colours: lines<{ name: string; hex: string }>('shp_product_colours', 'name, hex'),
  };
}

function writeLists(db: Db, id: string, version: number, p: ProductInput): void {
  const colour = db.prepare('INSERT INTO shp_product_colours (product_id, version, position, name, hex) VALUES (?, ?, ?, ?, ?)');
  const size = db.prepare('INSERT INTO shp_product_sizes (product_id, version, position, size) VALUES (?, ?, ?, ?)');
  const feature = db.prepare('INSERT INTO shp_product_features (product_id, version, position, text) VALUES (?, ?, ?, ?)');
  p.colours.forEach((c, i) => colour.run(id, version, i, c.name, c.hex));
  // Sizes always in the usual order, whatever order they were ticked in.
  [...p.sizes].sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b)).forEach((s, i) => size.run(id, version, i, s));
  p.features.forEach((f, i) => feature.run(id, version, i, f));
}

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;
function matchingVersion(req: FastifyRequest, row: { version: number }): void {
  const raw = req.headers['if-match'];
  if (raw === undefined) throw new AppError('VERSION_REQUIRED', 'Reload the product and try again.', 428);
  if (Number(raw) !== row.version) throw conflict('STALE', 'Someone else changed this product. Reload it and try again.');
}
const tooBig = () => new AppError('FILE_TOO_BIG', 'The photo is bigger than 4 MB. Send a smaller one.', 413);

export function shpRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const row = (id: string) => {
    const r = db.prepare('SELECT * FROM shp_products WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw notFound('The product');
    return r;
  };
  const audit = (req: FastifyRequest, at: string, action: string, id: string, data: Record<string, unknown>) =>
    appendAudit(db, { at, userId: currentUser(req).userId, action, entityType: 'shp.product', entityId: id, data });

  // The website: active products only, in the shop's order.
  app.get('/api/shp/products', { config: { permission: 'public' } }, async () =>
    (db.prepare('SELECT * FROM shp_products WHERE is_active = 1 ORDER BY sort_order, name').all() as Row[]).map((r) => {
      const { isActive: _a, version: _v, updatedAt: _u, sortOrder: _s, ...shown } = shape(db, r);
      return shown;
    }));

  /** A product's current photo; never run as a page of this site (sandbox, nosniff). The id changes with every upload. */
  app.get<{ Params: { photoId: string } }>('/api/shp/photos/:photoId', { config: { permission: 'public' } }, async (req, reply) => {
    const p = db.prepare(`SELECT ph.content_type, ph.data FROM shp_photos ph JOIN shp_products pr ON pr.photo_id = ph.id WHERE ph.id = ?`)
      .get(req.params.photoId) as { content_type: string; data: Buffer } | undefined;
    if (!p) throw notFound('The photo');
    return reply.type(p.content_type).header('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'")
      .header('Cache-Control', 'public, max-age=86400').send(p.data);
  });

  app.get('/api/shp/admin/products', { config: { permission: 'shp.view' } }, async () =>
    (db.prepare('SELECT * FROM shp_products ORDER BY is_active DESC, sort_order, name').all() as Row[]).map((r) => shape(db, r)));

  app.post('/api/shp/products', { config: { permission: 'shp.manage' } }, async (req) => {
    const p = productInput.parse(req.body);
    const at = stamp(clock);
    return tx(db, () => {
      const id = newId();
      db.prepare(`INSERT INTO shp_products (id, name, category, shape, price_cents, made_to_order, min_qty, lead_days, badge, summary, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.name, p.category, p.shape, p.priceCents, p.madeToOrder ? 1 : 0, p.minQty, p.leadDays, p.badge, p.summary, p.sortOrder, at, at);
      writeLists(db, id, 1, p);
      audit(req, at, 'shp.product.create', id, { name: p.name, priceCents: p.priceCents });
      return shape(db, row(id));
    });
  });

  app.put('/api/shp/products/:id', { config: { permission: 'shp.manage' } }, async (req) => {
    const p = productInput.parse(req.body);
    const at = stamp(clock);
    return tx(db, () => {
      const r = row(idOf(req));
      matchingVersion(req, r);
      const version = r.version + 1;
      db.prepare(`UPDATE shp_products SET name = ?, category = ?, shape = ?, price_cents = ?, made_to_order = ?, min_qty = ?, lead_days = ?, badge = ?,
        summary = ?, sort_order = ?, version = ?, updated_at = ? WHERE id = ?`)
        .run(p.name, p.category, p.shape, p.priceCents, p.madeToOrder ? 1 : 0, p.minQty, p.leadDays, p.badge, p.summary, p.sortOrder, version, at, r.id);
      writeLists(db, r.id, version, p);
      audit(req, at, 'shp.product.update', r.id, { name: p.name, fromPriceCents: r.price_cents, priceCents: p.priceCents });
      return shape(db, row(r.id));
    });
  });

  for (const [path, active] of [['hide', 0], ['show', 1]] as const) {
    app.post(`/api/shp/products/:id/${path}`, { config: { permission: 'shp.manage' } }, async (req) => {
      const at = stamp(clock);
      return tx(db, () => {
        const r = row(idOf(req));
        matchingVersion(req, r);
        db.prepare('UPDATE shp_products SET is_active = ?, version = version + 1, updated_at = ? WHERE id = ?').run(active, at, r.id);
        // The lists move to the new version unchanged.
        for (const t of ['shp_product_colours', 'shp_product_sizes', 'shp_product_features']) {
          db.prepare(`INSERT INTO ${t} SELECT product_id, version + 1, ${t === 'shp_product_colours' ? 'position, name, hex' : t === 'shp_product_sizes' ? 'position, size' : 'position, text'} FROM ${t} WHERE product_id = ? AND version = ?`).run(r.id, r.version);
        }
        audit(req, at, `shp.product.${path}`, r.id, { name: r.name });
        return shape(db, row(r.id));
      });
    });
  }

  // The photo is the request body itself, like document attachments, with its own size limit.
  app.register(async (upload) => {
    upload.addHook('preParsing', async (req) => { if (Number(req.headers['content-length'] ?? 0) > MAX_PHOTO_BYTES) throw tooBig(); });
    upload.addContentTypeParser('*', async (_req: FastifyRequest, payload: NodeJS.ReadableStream) => {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of payload) { size += (c as Buffer).length; if (size <= MAX_PHOTO_BYTES) chunks.push(c as Buffer); }
      if (size > MAX_PHOTO_BYTES) throw tooBig();
      return Buffer.concat(chunks);
    });
    upload.post('/api/shp/products/:id/photo', { config: { permission: 'shp.manage' } }, async (req) => {
      const data = req.body;
      const type = Buffer.isBuffer(data) ? sniffType(data) : null;
      if (!Buffer.isBuffer(data) || !data.length || !type || type === 'application/pdf') throw new AppError('FILE_TYPE', 'Only JPEG, PNG or WebP photos can be used.', 415);
      const at = stamp(clock);
      return tx(db, () => {
        const r = row(idOf(req));
        const photoId = newId();
        db.prepare('INSERT INTO shp_photos (id, product_id, content_type, bytes, sha256, data, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(photoId, r.id, type, data.length, sha256Hex(data), data, currentUser(req).userId, at);
        db.prepare('UPDATE shp_products SET photo_id = ?, updated_at = ? WHERE id = ?').run(photoId, at, r.id);
        audit(req, at, 'shp.product.photo', r.id, { name: r.name, photoId, bytes: data.length });
        return shape(db, row(r.id));
      });
    });
  });

  app.post('/api/shp/products/:id/photo/remove', { config: { permission: 'shp.manage' } }, async (req) => {
    const at = stamp(clock);
    return tx(db, () => {
      const r = row(idOf(req));
      db.prepare('UPDATE shp_products SET photo_id = NULL, updated_at = ? WHERE id = ?').run(at, r.id);
      audit(req, at, 'shp.product.photo_remove', r.id, { name: r.name });
      return shape(db, row(r.id));
    });
  });
}
