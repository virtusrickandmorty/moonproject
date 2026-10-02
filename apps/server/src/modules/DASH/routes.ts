import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { home, notifications } from './home.ts';
import { ownerHealth } from './health.ts';

const view = { config: { permission: 'dash.view' } };
const readInput = z.object({ id: z.string().min(1).max(200) }).strict();

export function dashRoutes(app: FastifyInstance, { db, clock, registry, practice, host }: AppDeps): void {
  const where = { practice, host };
  app.get('/api/dash/home', view, async (req) => home(db, clock, registry, currentUser(req), where));
  app.get('/api/dash/owner-health', { config: { permission: 'dash.home.owner' } }, async () => ownerHealth(db, today(clock)));
  app.get('/api/dash/notifications', view, async (req) => notifications(db, clock, registry, currentUser(req), where));
  app.post('/api/dash/notifications/read', view, async (req) => {
    const { id } = readInput.parse(req.body);
    const user = currentUser(req);
    if (!notifications(db, clock, registry, user, where).some((n) => n.id === id)) throw notFound('The notification');
    tx(db, () => db.prepare(`INSERT INTO dash_notification_reads (user_id, notification_key, read_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, notification_key) DO UPDATE SET read_at = excluded.read_at`).run(user.userId, id, stamp(clock)));
    return { ok: true };
  });
}
