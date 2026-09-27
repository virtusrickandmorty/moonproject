import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
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
}
