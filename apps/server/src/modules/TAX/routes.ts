import type { FastifyInstance, FastifyRequest } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { booklet, bookletUsage, listBooklets, registerBooklet, setBookletActive, type Who } from './booklets.ts';

export function taxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest): Who => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));
  /** Changing the register needs a fresh password: a booklet decides which paper counts as a real invoice. */
  const stepUp = (req: FastifyRequest) => requireStepUp(currentUser(req), clock);

  /** The register with each booklet's usage: numbers used, skipped and left. */
  app.get('/api/tax/booklets', { config: { permission: 'tax.booklets.view' } }, async () => listBooklets(db).map((b) => bookletUsage(db, b)));

  /** One booklet: every number used and by which document, and the skipped numbers. */
  app.get<{ Params: { id: string } }>('/api/tax/booklets/:id', { config: { permission: 'tax.booklets.view' } }, async (req) => {
    const b = booklet(db, req.params.id);
    if (!b) throw notFound('The booklet');
    return bookletUsage(db, b, true);
  });

  app.post('/api/tax/booklets', { config: { permission: 'tax.booklets.manage' } }, async (req) => {
    stepUp(req);
    return write(() => registerBooklet(db, req.body, who(req)));
  });

  app.post<{ Params: { id: string } }>('/api/tax/booklets/:id/retire', { config: { permission: 'tax.booklets.manage' } }, async (req) => {
    stepUp(req);
    return write(() => setBookletActive(db, req.params.id, req.headers['if-match'], false, req.body, who(req)));
  });

  app.post<{ Params: { id: string } }>('/api/tax/booklets/:id/activate', { config: { permission: 'tax.booklets.manage' } }, async (req) => {
    stepUp(req);
    return write(() => setBookletActive(db, req.params.id, req.headers['if-match'], true, req.body, who(req)));
  });
}
