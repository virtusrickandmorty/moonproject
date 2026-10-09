import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx, type Db } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard, engineEnv, postDocument, previewDocument, type Actor } from '../../engine/documents/lifecycle.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../../engine/idempotency.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { activeChart, activeWearers, customerWearers } from './cus.ts';
import { STAGES, STAGE_LABELS, changeStage, currentStage, isAbandoned, movesFrom, stageHistory } from './stages.ts';
import { MODE_WORDS, depositModeOn, modeKeptIssue } from '../COL/public.ts';
import { saleInvoicesOf, saleOpenCents } from '../QS/public.ts';
import { jobOrderRef, jobOrdersOf, joMoney, leftPiecesAll, rosterOf, stagesAll } from './public.ts';
import { finishedWearers, lineProduction } from '../PRD/public.ts';
import { dpInvoiceDoc } from './doctypes/dp-invoice.ts';
import { joListRoutes } from './list.ts';
import { lineState, releasableQty, releaseDoc, releasedWearers, type Release } from './doctypes/release.ts';
import { awaitingInvoice, invoiceFigures, invoiceRecordDoc, invoiceRecordInput } from './doctypes/invoice-record.ts';

const stageBody = z.object({ from: z.enum(STAGES), to: z.enum(STAGES), reason: z.string().max(500).optional() }).strict();
/** Release + its invoice record in one action (PLAN E4). invoice: null = "invoice to follow" (D3 release gate). */
const releaseBody = z.object({ release: z.unknown(), invoice: invoiceRecordInput.omit({ releaseId: true }).nullable(), expectedTotalCents: z.number().int() }).strict();
const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });
const searchOf = (req: FastifyRequest) => String((req.query as { q?: unknown }).q ?? '').trim().toLowerCase().slice(0, 100);

/** Releases as the invoice record form picks them: by number, with the invoice already recorded for each, if any. */
const RELEASES = `SELECT d.id, d.number, d.business_date AS date, d.status, d.total_cents AS totalCents, r.job_order_id AS jobOrderId, j.number AS jobOrderNumber,
    o.customer_name AS customerName, inv.id AS invoiceId, inv.number AS invoiceRecordNumber, inv.invoice_number AS invoiceNumber
  FROM jo_releases r JOIN documents d ON d.id = r.document_id JOIN documents j ON j.id = r.job_order_id JOIN jo_orders o ON o.document_id = r.job_order_id
  LEFT JOIN (SELECT i.release_id, x.id, x.number, i.invoice_number FROM jo_invoice_records i JOIN documents x ON x.id = i.document_id WHERE x.status = 'posted') inv
    ON inv.release_id = r.document_id`;
type ReleaseRow = { id: string; number: string; date: string; status: string; totalCents: number; jobOrderId: string; jobOrderNumber: string; customerName: string;
  invoiceId: string | null; invoiceRecordNumber: string | null; invoiceNumber: string | null };
const releasePick = ({ invoiceId, invoiceRecordNumber, invoiceNumber, ...r }: ReleaseRow) => ({
  ...r,
  invoice: invoiceId ? { id: invoiceId, number: invoiceRecordNumber!, invoiceNumber: invoiceNumber! } : null,
});

/** "Write these on the booklet" (D4.4): in downpayment VAT mode C the booklet shows the sale less the downpayments already invoiced (D3). */
const bookletOf = (f: ReturnType<typeof invoiceFigures>) => ({
  vatRateBp: f.vatRateBp, listCents: f.listCents, discountCents: f.discountCents, discountNetCents: f.discountNetCents, salesCents: f.salesCents,
  ...f.booklet, downpaymentsInvoicedCents: f.dpAppliedCents, depositVatMode: f.depositVatMode, depositVatCents: f.depositVatCents,
});

/** The downpayment invoices of a job order with their booklet numbers, cancelled ones marked (read-only). */
const dpInvoicesOf = (db: Db, jobOrderId: string) =>
  db
    .prepare(
      `SELECT d.id, d.number, d.status, i.invoice_number AS invoiceNumber, i.gross_cents AS amountCents, i.vat_cents AS vatCents
       FROM jo_dp_invoices i JOIN documents d ON d.id = i.document_id WHERE i.job_order_id = ? ORDER BY d.number`,
    )
    .all(jobOrderId) as { id: string; number: string; status: 'posted' | 'cancelled'; invoiceNumber: string; amountCents: number; vatCents: number }[];

/** The job order's downpayment VAT mode today, the setting in force, and (in words) why the job order keeps a mode other than the setting (read-only, COL). */
function depositVatOf(db: Db, jo: { id: string; number: string }, date: string) {
  const m = depositModeOn(db, jo.id, date);
  return { mode: m.mode, words: MODE_WORDS[m.mode], setting: m.setting, settingWords: MODE_WORDS[m.setting], lockedBy: m.lockedBy, kept: modeKeptIssue(m, jo.number, 'jobOrderId')?.message ?? null };
}

/** The refusals of the downpayment invoice that do not depend on what is typed: the job order is cancelled, abandoned or not in mode C (the server's own words). */
const JOB_ORDER_REFUSALS = new Set(['JOB_ORDER', 'JO_CANCELLED', 'JO_ABANDONED', 'DEPOSIT_VAT_MODE']);

export function joRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  joListRoutes(app, db);

  /** What the JO view shows beside the document: stage, allowed moves, history, and money (all derived, NR-2). */
  /**
   * Everything one customer has ordered, newest first, for the Customers screen: recorded job orders with their stage and
   * balance due, and (for those who may see them) quick sales. Cancelled ones are left out: an edit is a cancel plus a
   * reissue, so they would show every edited order twice.
   */
  app.get<{ Params: { id: string } }>('/api/jo/customers/:id/orders', { config: { permission: 'jo.view' } }, async (req) => {
    const docOf = db.prepare('SELECT business_date AS date, doc_type AS docType FROM documents WHERE id = ?');
    const orders = jobOrdersOf(db, req.params.id).map((jo) => ({
      kind: 'job_order' as const, ...(docOf.get(jo.id) as { date: string; docType: string }), id: jo.id, number: jo.number, dueDate: jo.dueDate, totalCents: jo.totalCents,
      stage: STAGE_LABELS[currentStage(db, jo.id)], balanceDueCents: joMoney(db, jo.id).balanceDueCents,
    }));
    const sales = currentUser(req).permissions.has('qs.view') ? saleInvoicesOf(db, req.params.id).map((s) => ({
      kind: 'quick_sale' as const, docType: 'qs.sale', id: s.id, number: s.number, date: s.businessDate, dueDate: null, totalCents: s.totalCents,
      stage: null, balanceDueCents: saleOpenCents(db, s.id),
    })) : [];
    return [...orders, ...sales].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  });

  app.get<{ Params: { id: string } }>('/api/jo/orders/:id/status', { config: { permission: 'jo.view' } }, async (req) => {
    const stage = currentStage(db, req.params.id);
    const money = joMoney(db, req.params.id);
    // readyQty: the pieces that may go out now (finished every step, or all once the line or the job order is done); ready: some.
    const may = releasableQty(db, req.params.id);
    // wearers: the line's wearer list for the release form (the owner's request, Oct 2026): who already went out (on which
    // release), and who went through every step (ready; unknown when production does not track them by wearer).
    const out = releasedWearers(db, req.params.id);
    // awaitingSteps: a made item with no production steps chosen yet (the release form greys it; the owner's request, Oct 2026).
    const made = lineProduction(db, req.params.id);
    const lines = lineState(db, req.params.id).map(({ lineNo, kind, description, qty, releasedQty }) => {
      const readyQty = may.get(lineNo) ?? 0;
      const roster = rosterOf(db, req.params.id, lineNo);
      const finished = roster.length > 0 ? finishedWearers(db, req.params.id, lineNo) : null;
      const gone = out.get(lineNo) ?? new Map<number, string>();
      const wearers = roster.map((w) => ({ rowNo: w.rowNo, wearerName: w.wearerName, size: w.size, jerseyNumber: w.jerseyNumber, qty: w.qty,
        releasedOn: gone.get(w.rowNo) ?? null, ready: finished ? finished.has(w.rowNo) : null }));
      const awaitingSteps = kind !== 'ready_made' && made.get(lineNo) === 'none';
      return { lineNo, description, qty, releasedQty, leftQty: qty - releasedQty, ready: readyQty > 0 && !awaitingSteps, readyQty: awaitingSteps ? 0 : readyQty, awaitingSteps, ...(wearers.length ? { wearers } : {}) };
    });
    // An abandoned job order is closed; its label says why (D5 DEP-FORFEIT).
    const stageLabel = stage === 'closed' && isAbandoned(db, req.params.id) ? 'Abandoned (deposit forfeited)' : STAGE_LABELS[stage];
    const jo = jobOrderRef(db, req.params.id)!;
    const docType = db.prepare('SELECT doc_type FROM documents WHERE id = ?').pluck().get(jo.id) as string;
    const jobOrder = { id: jo.id, number: jo.number, docType, status: jo.status, customerId: jo.customerId, customerName: jo.customerName, dueDate: jo.dueDate };
    return {
      jobOrder, stage, stageLabel, moves: movesFrom(stage), history: stageHistory(db, req.params.id), money, lines, awaitingInvoice: awaitingInvoice(db, req.params.id),
      depositVat: depositVatOf(db, jo, today(clock)), dpInvoices: dpInvoicesOf(db, req.params.id),
    };
  });

  /**
   * What the downpayment invoice form shows for one job order (read-only): the downpayment asked, what is already invoiced,
   * the money already held that the invoice applies, and the server's own refusal when the job order cannot take a
   * downpayment invoice (cancelled, abandoned, or not in downpayment VAT mode C).
   */
  app.get<{ Params: { id: string } }>('/api/jo/orders/:id/dp-info', { config: { permission: 'jo.invoice' } }, async (req) => {
    const jo = jobOrderRef(db, req.params.id);
    if (!jo) throw notFound('The job order');
    const money = joMoney(db, jo.id);
    const dpInvoices = dpInvoicesOf(db, jo.id);
    const dpInvoicedCents = dpInvoices.filter((i) => i.status === 'posted').reduce((s, i) => s + i.amountCents, 0);
    const probe = previewDocument({ db, clock }, dpInvoiceDoc, actorOf(req), { jobOrderId: jo.id, invoiceNumber: '1', amountCents: 1 });
    const refusal = probe.issues.find((i) => i.level === 'error' && JOB_ORDER_REFUSALS.has(i.code));
    return {
      jobOrder: { id: jo.id, number: jo.number, customerName: jo.customerName, totalCents: jo.totalCents },
      requiredDownpaymentCents: money.requiredDownpaymentCents,
      dpInvoicedCents,
      notInvoicedCents: money.notInvoicedCents,
      depositsHeldCents: money.depositsHeldCents,
      depositVat: depositVatOf(db, jo, today(clock)),
      dpInvoices,
      refusal: refusal?.message ?? null,
    };
  });

  /**
   * Job orders to pick on the release form (read-only): by number or customer name; with nothing typed, the ones with
   * pieces left to release, oldest due first.
   */
  app.get('/api/jo/pick/orders', { config: { permission: 'jo.view' } }, async (req) => {
    const q = searchOf(req);
    // Stages and pieces left are read for all orders at once; a balance is worked out only for the 20 that are shown.
    const stages = stagesAll(db);
    const left = leftPiecesAll(db);
    const rows: { id: string; number: string; customerName: string; dueDate: string; stageLabel: string; leftPieces: number; balanceDueCents: number }[] = [];
    for (const jo of jobOrdersOf(db)) {
      if (q && !jo.number.toLowerCase().includes(q) && !jo.customerName.toLowerCase().includes(q)) continue;
      const leftPieces = left.get(jo.id) ?? 0;
      if (!q && leftPieces <= 0) continue;
      rows.push({ id: jo.id, number: jo.number, customerName: jo.customerName, dueDate: jo.dueDate, stageLabel: STAGE_LABELS[stages.get(jo.id) ?? 'open'], leftPieces, balanceDueCents: joMoney(db, jo.id).balanceDueCents });
      if (rows.length === 20) break;
    }
    return rows;
  });

  /** Releases to pick on the invoice record form (read-only): by release, job order or customer; with nothing typed, the ones waiting for their invoice. */
  app.get('/api/jo/pick/releases', { config: { permission: 'jo.view' } }, async (req) => {
    const q = searchOf(req);
    const rows = q
      ? (db.prepare(`${RELEASES} WHERE lower(d.number) LIKE @q OR lower(j.number) LIKE @q OR lower(o.customer_name) LIKE @q ORDER BY d.number DESC LIMIT 20`).all({ q: `%${q}%` }) as ReleaseRow[])
      : (db.prepare(`${RELEASES} WHERE d.status = 'posted' AND inv.id IS NULL ORDER BY d.number LIMIT 20`).all() as ReleaseRow[]);
    return rows.map(releasePick);
  });

  /** One release with what goes on the booklet for it (read-only): the invoice record form's "write these on the booklet". */
  app.get<{ Params: { id: string } }>('/api/jo/releases/:id/invoice-info', { config: { permission: 'jo.view' } }, async (req) => {
    const row = db.prepare(`${RELEASES} WHERE r.document_id = ?`).get(req.params.id) as ReleaseRow | undefined;
    if (!row) throw notFound('The release');
    const r = releaseDoc.load(db, row.id);
    const f = invoiceFigures(db, r.jobOrderId, r.lines, today(clock));
    return { release: releasePick(row), lines: r.lines, booklet: bookletOf(f), depositAppliedCents: f.depositAppliedCents };
  });

  /** A customer's groups and active wearers with the size on file, for the job order form's roster (read-only). */
  app.get<{ Params: { id: string } }>('/api/jo/customers/:id/wearers', { config: { permission: 'jo.create' } }, async (req) => customerWearers(db, req.params.id));

  /**
   * The release as it would be recorded, and "write these on the booklet": the invoice figures for what is released
   * (D4.4). In downpayment VAT mode C the booklet shows the sale less the downpayments already invoiced (D3).
   */
  app.post('/api/jo/releases/preview', { config: { permission: 'jo.release' } }, async (req) => {
    const body = z.object({ release: z.unknown() }).strict().parse(req.body);
    const release = previewDocument({ db, clock }, releaseDoc, actorOf(req), body.release);
    const r = release.doc as Release;
    const f = invoiceFigures(db, r.jobOrderId, r.lines, today(clock));
    return { release: { ...release, journal: undefined }, booklet: bookletOf(f), depositAppliedCents: f.depositAppliedCents };
  });

  /** Records the release (REL-) and, unless the invoice is to follow, its invoice record, in one transaction. */
  app.post('/api/jo/releases', { config: { permission: 'jo.release' } }, async (req, reply) => {
    const body = releaseBody.parse(req.body);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Missing Idempotency-Key header.', 400);
    const actor = actorOf(req);
    const env = engineEnv(deps);
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
