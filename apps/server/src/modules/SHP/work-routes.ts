/**
 * Shop work routes (the owner's request, Oct 2026): make a work order (restock, rework, change) that goes on the
 * production board, list the open ones, put finished pieces into the shop's stock, and give back pieces not worked on.
 * Making one records a job order, so it also needs jo.post (checked by the engine on the job order).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { clockGuard, engineEnv, type Actor } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { createWork, giveBack, openWork, putIntoShopStock, workState } from './work.ts';

export { carryWorkOver, workOf } from './work.ts';

const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });
const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

export function shpWorkRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const env = engineEnv(deps);
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const write = <T>(fn: () => T) => tx(db, () => { clockGuard({ db, clock }); return fn(); });

  app.get('/api/shp/work', { config: { permission: 'shp.view' } }, async () => openWork(db));
  app.get('/api/shp/work/:id', { config: { permission: 'shp.view' } }, async (req) => {
    const s = workState(db, idOf(req));
    if (!s) throw notFound('The shop work order');
    return s;
  });
  app.post('/api/shp/work', { config: { permission: 'shp.work' } }, async (req) => write(() => createWork(env, actorOf(req), req.body, who(req), clock.now().getTime())));
  app.post('/api/shp/work/:id/put-in', { config: { permission: 'shp.stock' } }, async (req) => write(() => putIntoShopStock(db, idOf(req), req.body, who(req))));
  app.post('/api/shp/work/:id/give-back', { config: { permission: 'shp.stock' } }, async (req) => write(() => giveBack(db, idOf(req), req.body, who(req))));
}
