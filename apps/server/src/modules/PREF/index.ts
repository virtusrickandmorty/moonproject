/**
 * PREF: a person's own preferences for how the app looks to them. For now the order of the side menu, kept on the server
 * so it follows them to any PC and is never shared by two people on one browser. Nothing here is business data, and no
 * permission is needed: each person reads and saves only their own.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineModule } from '../../engine/documents/registry.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp } from '../../platform/clock.ts';
import type { AppDeps } from '../../app.ts';

const name = z.string().trim().min(1).max(60);
const path = z.string().regex(/^\/[A-Za-z0-9._/-]{0,120}$/, 'A screen address, like /cus.');
// subs: the sub-categories' order within each group (the owner's request, Oct 2026); optional for an older screen.
export const menuOrderInput = z.object({
  groups: z.array(name).max(20),
  items: z.record(name, z.array(path).max(200)),
  subs: z.record(name, z.array(name).max(20)).optional(),
}).strict().refine((o) => Object.keys(o.items).length <= 20 && Object.keys(o.subs ?? {}).length <= 20, 'Too many groups.');
export type MenuOrder = z.infer<typeof menuOrderInput>;

function prefRoutes(app: FastifyInstance, { db, clock }: AppDeps): void {
  /** The signed-in person's menu order; empty lists when they have not arranged it (the usual order). */
  app.get('/api/pref/menu', { config: { permission: 'authenticated' } }, async (req) => {
    const row = db.prepare('SELECT groups_json, items_json, subs_json FROM pref_menu_order WHERE user_id = ?').get(currentUser(req).userId) as
      { groups_json: string; items_json: string; subs_json: string } | undefined;
    return row
      ? { groups: JSON.parse(row.groups_json) as string[], items: JSON.parse(row.items_json) as Record<string, string[]>, subs: JSON.parse(row.subs_json) as Record<string, string[]> }
      : { groups: [], items: {}, subs: {} };
  });

  /** Saves the signed-in person's menu order (empty lists: back to the usual order). Only their own, ever. */
  app.put('/api/pref/menu', { config: { permission: 'authenticated' } }, async (req) => {
    const order = menuOrderInput.parse(req.body);
    const subs = order.subs ?? {};
    db.prepare(`INSERT INTO pref_menu_order (user_id, groups_json, items_json, subs_json, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET groups_json = excluded.groups_json, items_json = excluded.items_json, subs_json = excluded.subs_json, updated_at = excluded.updated_at`)
      .run(currentUser(req).userId, JSON.stringify(order.groups), JSON.stringify(order.items), JSON.stringify(subs), stamp(clock));
    return { ...order, subs };
  });
}

export default defineModule({
  code: 'PREF',
  name: 'Personal preferences',
  permissions: [],
  docTypes: [],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: prefRoutes,
});
