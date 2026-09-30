/** Routes for customer checks: checks on hand (deposit, returned by the bank) and the post-dated checks list (ACC-23). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { engineEnv, previewDocument, type Actor } from '../../engine/documents/lifecycle.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../../engine/idempotency.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { placesFor } from '../CASH/public.ts';
import { checkPlaceIds, checksAtBank, checksOnHand, daysBetween, depositBody, depositChecks, depositTransferInput, returnBody, returnCheck } from './checks.ts';
import { addPdc, getPdc, listPdcs, voidPdc } from './pdc.ts';

const depositPost = depositBody.extend({ expectedTotalCents: z.number().int() }).strict();

export function checkRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;
  const env = engineEnv(deps);
  const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock) });

  /** Same Idempotency-Key -> same response, one deposit or return (N-02). */
  function idempotent(req: FastifyRequest, reply: FastifyReply, run: (actor: Actor) => unknown) {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Missing Idempotency-Key header.', 400);
    const actor = actorOf(req);
    const route = `${req.method} ${req.url}`;
    const hash = requestHash(route, req.body);
    const out = tx(db, () => {
      const prior = findIdempotent(db, key, actor.userId, hash);
      if (prior) return prior;
      const res = { status: 200, body: run(actor) };
      storeIdempotent(db, key, actor.userId, route, hash, res, stamp(clock));
      return res;
    });
    return reply.code(out.status).send(out.body);
  }

  /**
   * Every check on hand with the days since it came, their total, and the ledger balance of the checks places for those
   * who may see it: the two agree when every check came in on a collection and left through this screen.
   */
  app.get('/api/col/checks', { config: { permission: 'col.checks.view' } }, async (req) => {
    const now = today(clock);
    const checks = checksOnHand(db).map((r) => ({
      collectionId: r.collectionId, collectionNumber: r.collectionNumber, lineNo: r.lineNo, receivedOn: r.receivedOn, days: daysBetween(r.receivedOn, now),
      customerId: r.customerId, customerName: r.customerName, cashPlaceId: r.cashPlaceId, cashPlaceName: r.cashPlaceName,
      checkNumber: r.checkNumber, bank: r.bank, checkDate: r.checkDate, amountCents: r.amountCents, returned: r.lastReturn,
    }));
    const u = currentUser(req);
    const places = checkPlaceIds(db);
    const seen = placesFor(db, (p) => u.permissions.has(p), true).filter((p) => places.has(p.id));
    const ledgerCents = seen.every((p) => p.balanceCents !== null) ? seen.reduce((s, p) => s + p.balanceCents!, 0) : null;
    return { asOf: now, checks, totalCents: checks.reduce((s, r) => s + r.amountCents, 0), ledgerCents };
  });

  /** The fund transfer the deposit would record, for the confirm dialog. */
  app.post('/api/col/checks/deposit/preview', { config: { permission: 'col.checks.deposit' } }, async (req) => {
    const body = depositBody.parse(req.body);
    const actor = actorOf(req);
    const { input } = depositTransferInput(db, body);
    const trf = registry.docType('cash.transfer')!;
    const r = previewDocument(env, trf, actor, input);
    return { totalCents: r.totalCents, summary: r.summary, issues: r.issues, journal: actor.permissions.has('acc.journal.view') ? r.journal : null, doc: r.doc };
  });

  /** Deposits the ticked checks: one fund transfer from Checks on hand to the bank, and the checks marked deposited. */
  app.post('/api/col/checks/deposit', { config: { permission: 'col.checks.deposit' } }, async (req, reply) => {
    const { expectedTotalCents, ...body } = depositPost.parse(req.body);
    return idempotent(req, reply, (actor) => depositChecks(env, registry, actor, body, expectedTotalCents, stamp(clock)));
  });

  /** A check the bank returned: back to Checks on hand, the bank's charge, and optionally its collection cancelled. */
  app.post('/api/col/checks/return', { config: { permission: 'col.checks.return' } }, async (req, reply) => {
    const body = returnBody.parse(req.body);
    return idempotent(req, reply, (actor) => returnCheck(env, registry, actor, body, stamp(clock)));
  });

  /** Checks now at the bank, newest deposit first, for "Returned by the bank". */
  app.get('/api/col/checks/at-bank', { config: { permission: 'col.checks.return' } }, async () =>
    checksAtBank(db).map((r) => ({
      collectionId: r.collectionId, collectionNumber: r.collectionNumber, lineNo: r.lineNo, customerName: r.customerName, cashPlaceName: r.cashPlaceName,
      checkNumber: r.checkNumber, bank: r.bank, checkDate: r.checkDate, amountCents: r.amountCents, deposit: r.lastDeposit!,
    })),
  );

  app.get('/api/col/pdcs', { config: { permission: 'col.checks.view' } }, async () => listPdcs(db, today(clock)));
  app.get<{ Params: { id: string } }>('/api/col/pdcs/:id', { config: { permission: 'col.checks.view' } }, async (req) => {
    const p = getPdc(db, req.params.id, today(clock));
    if (!p) throw new AppError('NOT_FOUND', 'The post-dated check was not found.', 404);
    return p;
  });
  app.post('/api/col/pdcs', { config: { permission: 'col.pdc.manage' } }, async (req) => tx(db, () => addPdc(db, req.body, who(req), today(clock))));
  app.post<{ Params: { id: string } }>('/api/col/pdcs/:id/void', { config: { permission: 'col.pdc.manage' } }, async (req) =>
    tx(db, () => voidPdc(db, req.params.id, req.body, who(req), today(clock))),
  );
}
