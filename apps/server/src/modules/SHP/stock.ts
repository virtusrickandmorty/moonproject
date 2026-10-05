/**
 * The website shop's categories (shp.manage) and its own-brand stock (shp.stock): pieces coming in, and counts that set
 * what is on the shelf. Pieces only, never money: the books keep periodic inventory (PLAN D2), valued at the stock count.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { stockOf } from './public.ts';

const categoryInput = z.object({ name: z.string().trim().min(1).max(40), sortOrder: z.number().int().min(-9999).max(9999) }).strict();
/** `in`: pieces received (made or bought in); `count`: what was counted on the shelf, which becomes the pieces on hand. */
const stockInput = z.object({
  mode: z.enum(['in', 'count']),
  note: z.string().trim().max(300).optional(),
  lines: z.array(z.object({ size: z.string().min(1).max(4), colour: z.string().trim().min(1).max(30), qty: z.number().int().min(0).max(100_000) }).strict()).min(1).max(200),
}).strict();

interface CategoryRow { id: string; name: string; sort_order: number; is_active: number; version: number; products: number }
const out = (c: CategoryRow) => ({ id: c.id, name: c.name, sortOrder: c.sort_order, isActive: c.is_active === 1, version: c.version, products: c.products });
const CATEGORIES = `SELECT c.*, (SELECT COUNT(*) FROM shp_products p WHERE p.category_id = c.id AND p.is_active = 1) AS products FROM shp_categories c`;
const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;
function matchingVersion(req: FastifyRequest, row: { version: number }, what: string): void {
  const raw = req.headers['if-match'];
  if (raw === undefined) throw new AppError('VERSION_REQUIRED', `Reload the ${what} and try again.`, 428);
  if (Number(raw) !== row.version) throw conflict('STALE', `Someone else changed this ${what}. Reload it and try again.`);
}

export function shpStockRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const category = (id: string) => {
    const c = db.prepare(`${CATEGORIES} WHERE c.id = ?`).get(id) as CategoryRow | undefined;
    if (!c) throw notFound('The category');
    return c;
  };
  const sameName = (name: string, except = '') => {
    if (db.prepare('SELECT 1 FROM shp_categories WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, except)) throw conflict('CATEGORY_EXISTS', `There is already a category called ${name}.`);
  };
  const audit = (req: FastifyRequest, at: string, action: string, type: string, id: string, data: Record<string, unknown>) =>
    appendAudit(db, { at, userId: currentUser(req).userId, action, entityType: type, entityId: id, data });

  app.get('/api/shp/categories', { config: { permission: 'shp.view' } }, async () =>
    (db.prepare(`${CATEGORIES} ORDER BY c.is_active DESC, c.sort_order, c.name`).all() as CategoryRow[]).map(out));

  app.post('/api/shp/categories', { config: { permission: 'shp.manage' } }, async (req) => {
    const b = categoryInput.parse(req.body);
    const at = stamp(clock);
    return tx(db, () => {
      sameName(b.name);
      const id = newId();
      db.prepare('INSERT INTO shp_categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, b.name, b.sortOrder, at, at);
      audit(req, at, 'shp.category.create', 'shp.category', id, { name: b.name });
      return out(category(id));
    });
  });

  app.put('/api/shp/categories/:id', { config: { permission: 'shp.manage' } }, async (req) => {
    const b = categoryInput.parse(req.body);
    const at = stamp(clock);
    return tx(db, () => {
      const c = category(idOf(req));
      matchingVersion(req, c, 'category');
      sameName(b.name, c.id);
      db.prepare('UPDATE shp_categories SET name = ?, sort_order = ?, version = version + 1, updated_at = ? WHERE id = ?').run(b.name, b.sortOrder, at, c.id);
      audit(req, at, 'shp.category.update', 'shp.category', c.id, { from: c.name, name: b.name });
      return out(category(c.id));
    });
  });

  for (const [path, active] of [['hide', 0], ['show', 1]] as const) {
    app.post(`/api/shp/categories/:id/${path}`, { config: { permission: 'shp.manage' } }, async (req) => {
      const at = stamp(clock);
      return tx(db, () => {
        const c = category(idOf(req));
        matchingVersion(req, c, 'category');
        // Hiding a category that shown products use would leave them with nowhere to be listed.
        if (!active && c.products > 0) throw conflict('CATEGORY_IN_USE', `${c.products} shown product(s) use ${c.name}. Move or hide them first.`);
        db.prepare('UPDATE shp_categories SET is_active = ?, version = version + 1, updated_at = ? WHERE id = ?').run(active, at, c.id);
        audit(req, at, `shp.category.${path}`, 'shp.category', c.id, { name: c.name });
        return out(category(c.id));
      });
    });
  }

  /** Pieces on hand, held by online orders and available, per size × colour, with the moves that made them. */
  app.get('/api/shp/products/:id/stock', { config: { permission: 'shp.view' } }, async (req) => {
    const p = db.prepare('SELECT id, name, made_to_order FROM shp_products WHERE id = ?').get(idOf(req)) as { id: string; name: string; made_to_order: number } | undefined;
    if (!p) throw notFound('The product');
    return {
      productId: p.id, name: p.name, madeToOrder: p.made_to_order === 1,
      lines: stockOf(db, [p.id], clock.now().getTime()).get(p.id) ?? [],
      moves: db.prepare(`SELECT m.id, m.size, m.colour, m.qty, m.reason, m.note, m.at, u.display_name AS userName FROM shp_stock_moves m
        JOIN users u ON u.id = m.user_id WHERE m.product_id = ? ORDER BY m.at DESC, m.rowid DESC LIMIT 100`).all(p.id),
    };
  });

  app.post('/api/shp/products/:id/stock', { config: { permission: 'shp.stock' } }, async (req) => {
    const b = stockInput.parse(req.body);
    const user = currentUser(req);
    const at = stamp(clock);
    return tx(db, () => {
      const p = db.prepare('SELECT id, name, made_to_order FROM shp_products WHERE id = ?').get(idOf(req)) as { id: string; name: string; made_to_order: number } | undefined;
      if (!p) throw notFound('The product');
      if (p.made_to_order) throw new AppError('MADE_TO_ORDER', `${p.name} is made to order, so the shop keeps no stock of it.`, 400);
      const now = stockOf(db, [p.id], clock.now().getTime()).get(p.id) ?? [];
      const insert = db.prepare('INSERT INTO shp_stock_moves (id, product_id, size, colour, qty, reason, note, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const moved: { size: string; colour: string; qty: number }[] = [];
      for (const l of b.lines) {
        const line = now.find((s) => s.size === l.size && s.colour === l.colour);
        if (!line) throw new AppError('ITEM', `${p.name} does not come in ${l.colour}, size ${l.size}.`, 400);
        // A count sets what is on the shelf: the move is the difference from what the system had.
        const qty = b.mode === 'in' ? l.qty : l.qty - line.onHand;
        if (qty === 0) continue;
        insert.run(newId(), p.id, l.size, l.colour, qty, b.mode === 'in' ? 'stock_in' : 'count', b.note ?? null, user.userId, at);
        moved.push({ size: l.size, colour: l.colour, qty });
      }
      if (!moved.length) throw new AppError('NOTHING_TO_RECORD', b.mode === 'in' ? 'Type how many pieces came in.' : 'The count is the same as what is on hand: nothing to record.', 400);
      audit(req, at, b.mode === 'in' ? 'shp.stock.in' : 'shp.stock.count', 'shp.product', p.id, { name: p.name, moves: moved, note: b.note ?? null });
      return { lines: stockOf(db, [p.id], clock.now().getTime()).get(p.id) ?? [] };
    });
  });
}
