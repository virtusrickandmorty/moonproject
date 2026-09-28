import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, forbidden } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard, postDocument } from '../../engine/documents/lifecycle.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../../engine/idempotency.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { cashBook, createPlace, place, placesFor, seesBalance, updatePlaceSettings } from './places.ts';
import { bankAdjustmentDoc } from './doctypes/bank-adjustment.ts';
import * as recon from './recon.ts';

const adjustBody = z
  .object({ statementLineIds: z.array(z.number().int().positive()).min(1).max(50), input: z.unknown(), expectedTotalCents: z.number().int(), businessDate: z.string().optional() })
  .strict();

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

  // Bank reconciliation (E10). It shows its bank's balance, so every route also needs that balance to be visible (OWN-27).
  const view = { config: { permission: 'cash.recon.view' } };
  const manage = { config: { permission: 'cash.recon.manage' } };
  type ById = { Params: { id: string } };
  const seeBank = (req: FastifyRequest, bankId: unknown) => {
    const p = typeof bankId === 'number' ? place(db, bankId) : undefined;
    if (p && !seesBalance(p, can(req))) throw forbidden('cash.balances.view_all');
  };
  const seeRecon = (req: FastifyRequest<ById>) => seeBank(req, db.prepare('SELECT account_id FROM cash_recons WHERE id = ?').pluck().get(req.params.id));
  /** A change to one reconciliation, after checking its bank. */
  const onRecon = <T>(req: FastifyRequest<ById>, fn: () => T) => (seeRecon(req), write(fn));
  app.get('/api/cash/recons', view, async (req) => recon.listRecons(db).filter((r) => seesBalance(place(db, r.bankId)!, can(req))));
  app.get<ById>('/api/cash/recons/:id', view, async (req) => (seeRecon(req), recon.reconReport(db, req.params.id)));
  app.post('/api/cash/recons', manage, async (req) => {
    seeBank(req, (req.body as { bankId?: unknown } | undefined)?.bankId);
    return write(() => recon.createRecon(db, req.body, who(req), today(clock)));
  });
  app.put<ById>('/api/cash/recons/:id', manage, async (req) => onRecon(req, () => recon.setEndingBalance(db, req.params.id, req.body, who(req))));
  app.post<ById>('/api/cash/recons/:id/lines', manage, async (req) => onRecon(req, () => recon.addLines(db, req.params.id, req.body, who(req))));
  app.post<{ Params: { id: string; lineId: string } }>('/api/cash/recons/:id/lines/:lineId/void', manage, async (req) =>
    onRecon(req, () => recon.voidLine(db, req.params.id, Number(req.params.lineId), who(req))),
  );
  app.post<ById>('/api/cash/recons/:id/match', manage, async (req) =>
    onRecon(req, () => (recon.matchLines(db, req.params.id, req.body, who(req)), recon.reconReport(db, req.params.id))),
  );
  app.post<ById>('/api/cash/recons/:id/unmatch', manage, async (req) => onRecon(req, () => recon.unmatch(db, req.params.id, req.body, who(req))));
  app.post<ById>('/api/cash/recons/:id/finish', manage, async (req) => onRecon(req, () => recon.finishRecon(db, req.params.id, who(req))));
  /** Reopening a finished (locked) month is the accountant's, with a reason. */
  app.post<ById>('/api/cash/recons/:id/reopen', { config: { permission: 'cash.recon.reopen' } }, async (req) =>
    onRecon(req, () => recon.reopenRecon(db, req.params.id, req.body, who(req))),
  );

  /**
   * An unmatched bank charge or interest becomes a Bank Adjustment (BADJ-) matched to its statement lines, in one
   * transaction: if the lines and the adjustment differ, nothing is recorded. Needs an Idempotency-Key, like posting.
   */
  app.post<ById>('/api/cash/recons/:id/adjust', manage, async (req, reply) => {
    const u = currentUser(req);
    const body = adjustBody.parse(req.body);
    seeRecon(req);
    return idempotent(req, reply, () => {
      const posted = postDocument({ db, clock }, bankAdjustmentDoc, { userId: u.userId, permissions: u.permissions }, { input: body.input, expectedTotalCents: body.expectedTotalCents, ...(body.businessDate ? { businessDate: body.businessDate } : {}) });
      const matchNo = recon.matchAdjustment(db, req.params.id, posted.id, body.statementLineIds, who(req));
      return { ...posted, matchNo };
    });
  });

  /** Same Idempotency-Key -> same response, one document (N-02), as on the document routes. */
  function idempotent(req: FastifyRequest, reply: FastifyReply, run: () => unknown) {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Missing Idempotency-Key header.', 400);
    const userId = currentUser(req).userId;
    const route = `${req.method} ${req.url}`;
    const hash = requestHash(route, req.body);
    const out = tx(db, () => {
      const prior = findIdempotent(db, key, userId, hash);
      if (prior) return prior;
      const body = run();
      storeIdempotent(db, key, userId, route, hash, { status: 200, body }, stamp(clock));
      return { status: 200, body };
    });
    return reply.code(out.status).send(out.body);
  }
}
