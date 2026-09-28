import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard, postDocument, previewDocument, type Actor } from '../../engine/documents/lifecycle.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../../engine/idempotency.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { activeChart, activeWearers } from './cus.ts';
import { STAGES, STAGE_LABELS, changeStage, currentStage, isAbandoned, movesFrom, stageHistory } from './stages.ts';
import { joMoney } from './public.ts';
import { lineState, releaseDoc, type Release } from './doctypes/release.ts';
import { awaitingInvoice, invoiceFigures, invoiceRecordDoc, invoiceRecordInput } from './doctypes/invoice-record.ts';

const stageBody = z.object({ from: z.enum(STAGES), to: z.enum(STAGES), reason: z.string().max(500).optional() }).strict();
/** Release + its invoice record in one action (PLAN E4). invoice: null = "invoice to follow" (D3 release gate). */
const releaseBody = z.object({ release: z.unknown(), invoice: invoiceRecordInput.omit({ releaseId: true }).nullable(), expectedTotalCents: z.number().int() }).strict();
const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });

export function joRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** What the JO view shows beside the document: stage, allowed moves, history, and money (all derived, NR-2). */
  app.get<{ Params: { id: string } }>('/api/jo/orders/:id/status', { config: { permission: 'jo.view' } }, async (req) => {
    const stage = currentStage(db, req.params.id);
    const money = joMoney(db, req.params.id);
    const lines = lineState(db, req.params.id).map(({ lineNo, description, qty, releasedQty }) => ({ lineNo, description, qty, releasedQty, leftQty: qty - releasedQty }));
    // An abandoned job order is closed; its label says why (D5 DEP-FORFEIT).
    const stageLabel = stage === 'closed' && isAbandoned(db, req.params.id) ? 'Abandoned (deposit forfeited)' : STAGE_LABELS[stage];
    return { stage, stageLabel, moves: movesFrom(stage), history: stageHistory(db, req.params.id), money, lines, awaitingInvoice: awaitingInvoice(db, req.params.id) };
  });

  /** The release as it would be recorded, and "write these on the booklet": the invoice figures for what is released (D4.4). */
  app.post('/api/jo/releases/preview', { config: { permission: 'jo.release' } }, async (req) => {
    const body = z.object({ release: z.unknown() }).strict().parse(req.body);
    const release = previewDocument({ db, clock }, releaseDoc, actorOf(req), body.release);
    const r = release.doc as Release;
    const { depositAppliedCents, ...booklet } = invoiceFigures(db, r.jobOrderId, r.lines, today(clock));
    return { release: { ...release, journal: undefined }, booklet, depositAppliedCents };
  });

  /** Records the release (REL-) and, unless the invoice is to follow, its invoice record, in one transaction. */
  app.post('/api/jo/releases', { config: { permission: 'jo.release' } }, async (req, reply) => {
    const body = releaseBody.parse(req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Missing Idempotency-Key header.', 400);
    const actor = actorOf(req);
    const env = { db, clock };
    const hash = requestHash('POST /api/jo/releases', req.body);
    const out = tx(db, () => {
      const prior = findIdempotent(db, key, actor.userId, hash);
      if (prior) return prior;
      const release = postDocument(env, releaseDoc, actor, { input: body.release, expectedTotalCents: body.expectedTotalCents });
      const invoice = body.invoice && postDocument(env, invoiceRecordDoc, actor, { input: { ...body.invoice, releaseId: release.id }, expectedTotalCents: body.expectedTotalCents });
      const res = { status: 200, body: { release, invoiceRecord: invoice } };
      storeIdempotent(db, key, actor.userId, 'POST /api/jo/releases', hash, res, stamp(clock));
      return res;
    });
    return reply.code(out.status).send(out.body);
  });

  app.post<{ Params: { id: string } }>('/api/jo/orders/:id/stage', { config: { permission: 'jo.stage' } }, async (req) => {
    const body = stageBody.parse(req.body);
    const who = { userId: currentUser(req).userId, at: stamp(clock) };
    return tx(db, () => {
      clockGuard({ db, clock });
      return changeStage(db, req.params.id, body, who);
    });
  });

  /** "Pull a whole group" (PLAN E4): roster rows for its active wearers; measured when an active chart exists. */
  app.get<{ Params: { id: string } }>('/api/jo/groups/:id/roster', { config: { permission: 'jo.create' } }, async (req) =>
    activeWearers(db, req.params.id).map((w) => ({
      personId: w.id,
      wearerName: w.name,
      sizeMode: activeChart(db, w.id) ? 'measured' : 'preset',
      ...(w.jerseyName ? { jerseyName: w.jerseyName.toUpperCase() } : {}),
      ...(w.jerseyNumber ? { jerseyNumber: w.jerseyNumber } : {}),
      qty: 1,
    })),
  );
}
