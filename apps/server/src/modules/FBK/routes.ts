/** Customer ratings: staff see them and copy a job order's link; the customer opens the link and rates. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isBusinessDate } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { publicRating, rate, ratingForJobOrder, ratingsBetween, requestFor } from './ratings.ts';

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store');
const period = z.object({ from: z.string().refine(isBusinessDate), to: z.string().refine(isBusinessDate) }).partial().strict();

export function fbkRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  // Staff.
  app.get('/api/fbk/ratings', { config: { permission: 'fbk.view' } }, async (req) => {
    const q = period.parse(req.query);
    const to = q.to ?? today(clock);
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    return ratingsBetween(db, from, to);
  });
  app.get<{ Params: { id: string } }>('/api/fbk/job-orders/:id', { config: { permission: 'fbk.view' } }, async (req) => ratingForJobOrder(db, req.params.id));
  app.post<{ Params: { id: string } }>('/api/fbk/job-orders/:id/link', { config: { permission: 'fbk.ask' } }, async (req) =>
    write(() => { requestFor(db, req.params.id, who(req)); return ratingForJobOrder(db, req.params.id); }));

  // The customer: anyone with the link, no sign-in.
  app.get<{ Params: { token: string } }>('/api/fbk/r/:token', { config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return publicRating(db, req.params.token);
  });
  app.post<{ Params: { token: string } }>('/api/fbk/r/:token', { bodyLimit: 8 * 1024, config: { permission: 'public' } }, async (req, reply) => {
    noStore(reply);
    return tx(db, () => rate(db, req.params.token, req.body, stamp(clock)));
  });
}
