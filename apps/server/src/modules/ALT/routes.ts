/** ALT routes: receive a return, list and open returns, look up what came back, and management's decision. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { clockGuard, engineEnv, type Actor } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { decide, listReturns, receiveReturn, returnOf, sourceLines } from './alt.ts';

const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });
const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

export function altRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const env = engineEnv(deps);
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const write = <T>(fn: () => T) => tx(db, () => { clockGuard({ db, clock }); return fn(); });

  app.get('/api/alt/returns', { config: { permission: 'alt.view' } }, async (req) => {
    const q = z.object({ show: z.enum(['open', 'all']).optional() }).strict().parse(req.query);
    return listReturns(db, q.show !== 'all');
  });
  app.get('/api/alt/returns/:id', { config: { permission: 'alt.view' } }, async (req) => {
    const r = returnOf(db, idOf(req));
    if (!r) throw notFound('The return');
    return r;
  });
  app.get('/api/alt/source', { config: { permission: 'alt.receive' } }, async (req) => {
    const q = z.object({ kind: z.enum(['job_order', 'sale']), number: z.string().trim().min(1).max(40) }).strict().parse(req.query);
    return sourceLines(db, q.kind, q.number);
  });
  app.post('/api/alt/returns', { config: { permission: 'alt.receive' } }, async (req) => write(() => receiveReturn(db, req.body, who(req))));
  app.post('/api/alt/returns/:id/decision', { config: { permission: 'alt.decide' } }, async (req) =>
    write(() => decide(env, actorOf(req), idOf(req), req.body, who(req), clock.now().getTime())));
}
