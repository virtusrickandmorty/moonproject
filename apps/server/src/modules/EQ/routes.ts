import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { allBalances, officerTransactionsOf, ownerMoneyOf } from './register.ts';
import { createPerson, listPeople, officerBalances, officerLedger, person, setPersonActive, updatePerson, type Who } from './people.ts';

export function eqRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest): Who => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));

  /** The register, for pickers (active only unless ?all=1). */
  app.get('/api/eq/people', { config: { permission: 'eq.people.view' } }, async (req) => {
    const q = z.object({ all: z.enum(['0', '1']).optional() }).strict().parse(req.query);
    return listPeople(db, q.all === '1');
  });

  app.post('/api/eq/people', { config: { permission: 'eq.people.edit' } }, async (req) => write(() => createPerson(db, req.body, who(req))));

  app.put<{ Params: { id: string } }>('/api/eq/people/:id', { config: { permission: 'eq.people.edit' } }, async (req) =>
    write(() => updatePerson(db, req.params.id, req.headers['if-match'], req.body, who(req))),
  );

  app.post<{ Params: { id: string } }>('/api/eq/people/:id/deactivate', { config: { permission: 'eq.people.edit' } }, async (req) =>
    write(() => setPersonActive(db, req.params.id, req.headers['if-match'], false, who(req))),
  );

  app.post<{ Params: { id: string } }>('/api/eq/people/:id/activate', { config: { permission: 'eq.people.edit' } }, async (req) =>
    write(() => setPersonActive(db, req.params.id, req.headers['if-match'], true, who(req))),
  );

  /** The officer ledger: what the person owes the company (1220) and is owed (2501), from the ledger (NR-2). */
  app.get<{ Params: { id: string } }>('/api/eq/people/:id/ledger', { config: { permission: 'eq.ledger.view' } }, async (req) => {
    const p = person(db, req.params.id);
    if (!p) throw notFound('The person');
    const b = officerBalances(db, p.id);
    return { person: p, ...b, netCents: b.dueFromCents - b.dueToCents, lines: officerLedger(db, p.id) };
  });

  /** What every person owes the company, is owed and still has to pay on a subscription, from the ledger. */
  app.get('/api/eq/balances', { config: { permission: 'eq.ledger.view' } }, async () => allBalances(db));

  /** One person's owner money documents. */
  app.get<{ Params: { id: string } }>('/api/eq/people/:id/owner-money', { config: { permission: 'eq.own.view' } }, async (req) => ownerMoneyOf(db, req.params.id));

  /** One person's officer money out and back. */
  app.get<{ Params: { id: string } }>('/api/eq/people/:id/officer-transactions', { config: { permission: 'eq.ofc.view' } }, async (req) => officerTransactionsOf(db, req.params.id));
}
