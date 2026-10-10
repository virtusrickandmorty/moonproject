import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { pageAsked } from '../../platform/paging.ts';
import { home, notifications } from './home.ts';
import { ownerHealth } from './health.ts';
import { ownerCharts } from './charts.ts';
import { homeCards } from './cards.ts';

const view = { config: { permission: 'dash.view' } };
const readInput = z.object({ id: z.string().min(1).max(200) }).strict();

export function dashRoutes(app: FastifyInstance, { db, clock, registry, practice, host }: AppDeps): void {
  const where = { practice, host };
  app.get('/api/dash/home', view, async (req) => home(db, clock, registry, currentUser(req), where));
  /** The home's cards, each only for those who may see what it reads (the owner's request, Oct 2026). */
  app.get('/api/dash/cards', view, async (req) => homeCards(db, today(clock), currentUser(req)));
  app.get('/api/dash/owner-health', { config: { permission: 'dash.home.owner' } }, async () => ownerHealth(db, today(clock)));
  app.get('/api/dash/owner-charts', { config: { permission: 'rpt.books.view' } }, async () => ownerCharts(db, today(clock)));
  // A page of them when asked (?limit&offset, and ?unread=1 for only the unread ones): the whole list can be thousands of lines.
  app.get('/api/dash/notifications', view, async (req) => {
    const q = req.query as Record<string, unknown>;
    const all = notifications(db, clock, registry, currentUser(req), where);
    const asked = pageAsked(q);
    if (!asked) return all;
    return (q.unread === '1' ? all.filter((n) => !n.read) : all).slice(asked.offset, asked.offset + asked.limit);
  });
  app.post('/api/dash/notifications/read', view, async (req) => {
    const { id } = readInput.parse(req.body);
    const user = currentUser(req);
    if (!notifications(db, clock, registry, user, where).some((n) => n.id === id)) throw notFound('The notification');
    tx(db, () => db.prepare(`INSERT INTO dash_notification_reads (user_id, notification_key, read_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, notification_key) DO UPDATE SET read_at = excluded.read_at`).run(user.userId, id, stamp(clock)));
    return { ok: true };
  });
}
