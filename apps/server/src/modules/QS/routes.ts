import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, conflict } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { cancelDocument, engineEnv, postDocument, previewDocument, reissueDocument, type Actor, type EngineEnv, type PreviewResult } from '../../engine/documents/lifecycle.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../../engine/idempotency.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { collectionDoc, salePayments } from '../COL/public.ts';
import { saleDoc, type Sale } from './doctypes/sale.ts';
import { collectionFor, counterPayment, receivedIssue, recordCounterSale, type CounterPayment as Payment } from './record.ts';

const payment = counterPayment();
const previewBody = z.object({ sale: z.unknown(), payment }).strict();
const postBody = previewBody.extend({ expectedTotalCents: z.number().int() }).strict();
const cancelBody = z.object({ reason: z.string() }).strict();
const reissueBody = postBody.extend({ reason: z.string() }).strict();

const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });

/** Runs fn and rolls back whatever it wrote: a preview that needs the sale recorded to check its payment. */
function rolledBack<T>(db: Db, fn: () => T): T {
  const undo = Symbol('undo');
  let out: T | undefined;
  try {
    db.transaction(() => {
      out = fn();
      throw undo;
    }).immediate();
  } catch (e) {
    if (e !== undo) throw e;
  }
  return out as T;
}

export function qsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const env: EngineEnv = engineEnv(deps);

  /** Same Idempotency-Key -> same response, one quick sale (N-02). */
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

  const record = (actor: Actor, saleInput: unknown, p: Payment, post: (input: unknown) => { id: string; totalCents: number }) =>
    recordCounterSale(env, actor, p, post, saleInput);

  /** The sale's own payments go with it; a payment that also pays other things must be cancelled on its own first. */
  function cancelPayments(actor: Actor, saleId: string, reason: string) {
    for (const c of salePayments(db, saleId).filter((p) => p.status === 'posted')) {
      if (!c.paysOnlyThis) throw conflict('HAS_DEPENDENTS', `${c.number} also pays other things. Cancel it on its own first.`, [c]);
      cancelDocument(env, collectionDoc, actor, c.id, reason);
    }
  }

  const shown = (actor: Actor, r: PreviewResult) => ({ summary: r.summary, issues: r.issues, journal: actor.permissions.has('acc.journal.view') ? r.journal : undefined });

  /**
   * The confirm dialog: the sale, "write these on the booklet" (D4.4) and the payment as they would be recorded.
   * The payment is checked against the sale recorded for a moment and rolled back, so nothing is written.
   */
  app.post('/api/qs/sales/preview', { config: { permission: 'qs.create' } }, async (req) => {
    const body = previewBody.parse(req.body);
    const actor = actorOf(req);
    const sale = previewDocument(env, saleDoc, actor, body.sale);
    const d = sale.doc as Sale;
    const booklet = { vatableSalesCents: d.vatableSalesCents, vatCents: d.vatCents, discountCents: d.discountCents, totalCents: d.grossCents };
    if (sale.issues.some((i) => i.level === 'error')) return { totalCents: sale.totalCents, booklet, sale: shown(actor, sale), payment: null };
    const pay = rolledBack(db, () => {
      const s = postDocument(env, saleDoc, actor, { input: body.sale, expectedTotalCents: sale.totalCents });
      return previewDocument(env, collectionDoc, actor, collectionFor({ ...s, customerId: d.customerId }, body.payment));
    });
    const received = receivedIssue(body.payment, sale.totalCents);
    return { totalCents: sale.totalCents, booklet, sale: shown(actor, sale), payment: { ...shown(actor, pay), issues: [...(received ? [received] : []), ...pay.issues] } };
  });

  /** Records the sale (IR-) and its payment (COL-) in one transaction (QS-SALE). */
  app.post('/api/qs/sales', { config: { permission: 'qs.post' } }, async (req, reply) => {
    const body = postBody.parse(req.body);
    return idempotent(req, reply, (actor) => record(actor, body.sale, body.payment, (input) => postDocument(env, saleDoc, actor, { input, expectedTotalCents: body.expectedTotalCents })));
  });

  /** Cancels the sale and its payment together (E6), both mirrored with today's date. */
  app.post<{ Params: { id: string } }>('/api/qs/sales/:id/cancel', { config: { permission: 'qs.cancel' } }, async (req, reply) => {
    const { reason } = cancelBody.parse(req.body);
    return idempotent(req, reply, (actor) => {
      cancelPayments(actor, req.params.id, reason);
      return cancelDocument(env, saleDoc, actor, req.params.id, reason);
    });
  });

  /** Edit = cancel the sale and its payment, and record the replacement sale (new number, linked) with its payment. */
  app.post<{ Params: { id: string } }>('/api/qs/sales/:id/reissue', { config: { permission: 'qs.cancel' } }, async (req, reply) => {
    const body = reissueBody.parse(req.body);
    return idempotent(req, reply, (actor) => {
      cancelPayments(actor, req.params.id, body.reason);
      return record(actor, body.sale, body.payment, (input) => reissueDocument(env, saleDoc, actor, req.params.id, { input, expectedTotalCents: body.expectedTotalCents, reason: body.reason }));
    });
  });

  /** A quick sale's payments, cancelled ones included, for its view. */
  app.get<{ Params: { id: string } }>('/api/qs/sales/:id/payments', { config: { permission: 'qs.view' } }, async (req) =>
    salePayments(db, req.params.id).map(({ paysOnlyThis: _, ...p }) => p),
  );
}
