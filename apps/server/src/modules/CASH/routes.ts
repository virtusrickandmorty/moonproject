import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { cashBook, createPlace, placesFor, updatePlaceSettings } from './places.ts';

export function cashRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const can = (req: FastifyRequest) => {
    const u = currentUser(req);
    return (p: string) => u.permissions.has(p);
  };
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  /** Cash places with balances computed from the ledger (NR-2). Balances and account numbers hidden per OWN-27. */
  app.get('/api/cash/places', { config: { permission: 'cash.places.view' } }, async (req) => {
    const all = (req.query as { all?: string } | undefined)?.all === '1' && can(req)('cash.places.manage');
    return placesFor(db, can(req), all);
  });

  /** A new cash place (the Cash Accounts screen): a GL account in its kind's code range and its settings. */
  app.post('/api/cash/places', { config: { permission: 'cash.places.manage' } }, async (req) => write(() => createPlace(db, req.body, who(req))));

  app.put<{ Params: { id: string } }>('/api/cash/places/:id/settings', { config: { permission: 'cash.places.manage' } }, async (req) =>
    write(() => updatePlaceSettings(db, Number(req.params.id), req.headers['if-match'], req.body, who(req))),
  );

  /** The cash book of one place (`?from&to`), for users who may see its balance. */
  app.get<{ Params: { id: string } }>('/api/cash/places/:id/book', { config: { permission: 'cash.book.view' } }, async (req) =>
    cashBook(db, Number(req.params.id), req.query, can(req)),
  );
}
