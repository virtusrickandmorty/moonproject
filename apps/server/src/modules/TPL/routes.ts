/**
 * TPL routes: stock programs and items, restocks, putting pieces into stock, counts, the stock card, and deliveries with
 * their invoice (a delivery receipt and a quick sale on terms, recorded and cancelled together).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, manilaDate, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { cancelDocument, clockGuard, engineEnv, postDocument, previewDocument, type Actor, type EngineEnv, type PreviewResult } from '../../engine/documents/lifecycle.ts';
import { findIdempotent, requestHash, storeIdempotent } from '../../engine/idempotency.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { saleDocType, saleOpenCents } from '../QS/public.ts';
import { cancellingTogether, deliveryDoc, invoiceOf, recordingWithInvoice, type Delivery } from './doctypes/delivery.ts';
import { addItem, changeItem, changeProgram, createProgram, item, itemLabel, itemsOf, openBalance, program, programList } from './programs.ts';
import { belowReorder, countItem, openRestocks, putIntoStock, restock, stockCard } from './stock.ts';

const actorOf = (req: FastifyRequest): Actor => ({ userId: currentUser(req).userId, permissions: currentUser(req).permissions });
const id = z.object({ id: z.uuid() }).strict();
const deliveryBody = z.object({ delivery: z.unknown(), expectedTotalCents: z.number().int() }).strict();

/** The invoice a delivery carries: its pieces at the program's price, the delivery fee as a service, on the client's terms. */
export const invoiceFor = (d: Delivery, number?: string) => ({
  customerId: d.customerId,
  invoiceNumber: d.invoiceNumber,
  termsDays: d.termsDays,
  lines: [
    ...d.lines.map((l) => ({ kind: l.kind, description: itemLabel(l), qty: l.qty, unitPriceCents: l.unitPriceCents, discountCents: 0 })),
    ...(d.feeCents > 0 ? [{ kind: 'service' as const, description: 'Delivery fee', qty: 1, unitPriceCents: d.feeCents, discountCents: 0 }] : []),
  ],
  note: number ? `Delivered on ${number} from the client's stock (TPL)` : 'Delivered from the client\'s stock (TPL)',
});

/** Records a delivery and its invoice in the caller's transaction. */
export function recordDelivery(env: EngineEnv, actor: Actor, raw: unknown, expectedTotalCents: number) {
  return tx(env.db, () => {
    recordingWithInvoice.on = true;
    let dr;
    try { dr = postDocument(env, deliveryDoc, actor, { input: raw, expectedTotalCents }); } finally { recordingWithInvoice.on = false; }
    const d = deliveryDoc.load(env.db, dr.id);
    const sale = postDocument(env, saleDocType(), actor, { input: invoiceFor(d, dr.number), expectedTotalCents: d.totalCents });
    env.db.prepare('INSERT INTO tpl_delivery_invoices (document_id, sale_id) VALUES (?, ?)').run(dr.id, sale.id);
    return { delivery: dr, invoice: sale };
  });
}

/** Cancels a delivery and its invoice together (its pieces are back in stock); refused while a payment stands on the invoice. */
export function cancelDelivery(env: EngineEnv, actor: Actor, deliveryId: string, reason: string) {
  const saleId = invoiceOf(env.db, deliveryId);
  cancellingTogether.add(deliveryId);
  try {
    return tx(env.db, () => {
      const invoice = saleId && env.db.prepare(`SELECT status FROM documents WHERE id = ?`).pluck().get(saleId) === 'posted' ? cancelDocument(env, saleDocType(), actor, saleId, reason) : null;
      const delivery = cancelDocument(env, deliveryDoc, actor, deliveryId, reason);
      return { delivery, invoice };
    });
  } finally {
    cancellingTogether.delete(deliveryId);
  }
}

export function tplRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const env: EngineEnv = engineEnv(deps);
  const who = (req: FastifyRequest) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const write = <T>(fn: () => T) => tx(db, () => { clockGuard({ db, clock }); return fn(); });

  /** Same Idempotency-Key -> same response, one delivery (N-02). */
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

  // Programs and items.
  app.get('/api/tpl/programs', { config: { permission: 'tpl.view' } }, async () => ({ rows: programList(db, today(clock)) }));
  app.post('/api/tpl/programs', { config: { permission: 'tpl.program.manage' } }, async (req) => write(() => createProgram(db, req.body, who(req))));
  app.get<{ Params: { id: string } }>('/api/tpl/programs/:id', { config: { permission: 'tpl.view' } }, async (req) => {
    const { id: pid } = id.parse(req.params);
    const p = program(db, pid);
    if (!p) throw notFound('The stock program');
    const deliveries = db.prepare(`SELECT d.id, d.number, d.status, d.business_date AS date, d.total_cents AS totalCents, t.invoice_number AS invoiceNumber, t.due_date AS dueDate,
        t.delivered_by AS deliveredBy, (SELECT SUM(qty) FROM tpl_delivery_lines l WHERE l.document_id = d.id) AS pieces, x.sale_id AS invoiceId
        FROM tpl_deliveries t JOIN documents d ON d.id = t.document_id LEFT JOIN tpl_delivery_invoices x ON x.document_id = t.document_id
        WHERE t.program_id = ? ORDER BY d.number DESC LIMIT 50`).all(pid);
    return { program: p, items: itemsOf(db, pid), money: openBalance(db, p.customerId, today(clock)), restocks: openRestocks(db, pid), deliveries };
  });
  app.put<{ Params: { id: string } }>('/api/tpl/programs/:id', { config: { permission: 'tpl.program.manage' } }, async (req) =>
    write(() => changeProgram(db, id.parse(req.params).id, req.body, who(req))));
  app.post<{ Params: { id: string } }>('/api/tpl/programs/:id/items', { config: { permission: 'tpl.program.manage' } }, async (req) =>
    write(() => addItem(db, id.parse(req.params).id, req.body, who(req))));
  app.put<{ Params: { id: string } }>('/api/tpl/items/:id', { config: { permission: 'tpl.program.manage' } }, async (req) =>
    write(() => changeItem(db, id.parse(req.params).id, req.body, who(req))));

  // Stock.
  app.get<{ Params: { id: string } }>('/api/tpl/items/:id/card', { config: { permission: 'tpl.view' } }, async (req) => stockCard(db, id.parse(req.params).id));
  app.post<{ Params: { id: string } }>('/api/tpl/items/:id/count', { config: { permission: 'tpl.count' } }, async (req) =>
    write(() => countItem(db, { ...(req.body as object), itemId: id.parse(req.params).id }, who(req))));
  /** What to restock: the items at or below their reorder level, with how many to make to get back above it. */
  app.get<{ Params: { id: string } }>('/api/tpl/programs/:id/restock', { config: { permission: 'tpl.view' } }, async (req) =>
    ({ items: belowReorder(db, id.parse(req.params).id) }));
  app.post('/api/tpl/restocks', { config: { permission: 'jo.post' } }, async (req) => write(() => restock(env, actorOf(req), req.body, who(req))));
  app.post('/api/tpl/put-in', { config: { permission: 'tpl.stock' } }, async (req) => write(() => putIntoStock(db, req.body, who(req))));

  // Deliveries.
  const shown = (actor: Actor, r: PreviewResult) => ({ summary: r.summary, issues: r.issues, journal: actor.permissions.has('acc.journal.view') ? r.journal : undefined });
  /** The confirm step: the delivery and the invoice it will carry, as they would be recorded (nothing is written). */
  app.post('/api/tpl/deliveries/preview', { config: { permission: 'tpl.deliver' } }, async (req) => {
    const actor = actorOf(req);
    const dr = previewDocument(env, deliveryDoc, actor, (req.body as { delivery?: unknown })?.delivery);
    const d = dr.doc as Delivery;
    const blocked = dr.issues.some((i) => i.level === 'error');
    const invoice = blocked ? null : previewDocument(env, saleDocType(), actor, invoiceFor(d));
    return { totalCents: dr.totalCents, dueDate: d.dueDate, delivery: shown(actor, dr), invoice: invoice && shown(actor, invoice) };
  });
  app.post('/api/tpl/deliveries', { config: { permission: 'tpl.deliver' } }, async (req, reply) => {
    const body = deliveryBody.parse(req.body);
    return idempotent(req, reply, (actor) => recordDelivery(env, actor, body.delivery, body.expectedTotalCents));
  });
  app.post<{ Params: { id: string } }>('/api/tpl/deliveries/:id/cancel', { config: { permission: 'qs.cancel' } }, async (req, reply) => {
    const { reason } = z.object({ reason: z.string() }).strict().parse(req.body);
    const did = id.parse(req.params).id;
    return idempotent(req, reply, (actor) => cancelDelivery(env, actor, did, reason));
  });

  /** The home card: items to restock and TPL invoices falling due in the next 7 days or past due. */
  app.get('/api/tpl/home', { config: { permission: 'tpl.view' } }, async () => {
    const day = today(clock);
    const week = manilaDate(new Date(Date.parse(`${day}T00:00:00+08:00`) + 7 * 86_400_000));
    const programs = db.prepare('SELECT id FROM tpl_programs WHERE is_active = 1').pluck().all() as string[];
    const restock = programs.flatMap((pid) => { const p = program(db, pid)!; return belowReorder(db, pid).map((i) => ({ programId: pid, customerName: p.customerName, item: itemLabel(i), onHand: i.onHand, reorderLevel: i.reorderLevel })); });
    const due = (db.prepare(`SELECT d.id AS invoiceId, d.number, t.customer_name AS customerName, t.due_date AS dueDate, t.program_id AS programId FROM tpl_delivery_invoices x
        JOIN tpl_deliveries t ON t.document_id = x.document_id JOIN documents d ON d.id = x.sale_id WHERE d.status = 'posted' AND t.due_date <= ? ORDER BY t.due_date`).all(week) as { invoiceId: string; number: string; customerName: string; dueDate: string; programId: string }[])
      .map((r) => ({ ...r, openCents: saleOpenCents(db, r.invoiceId), overdue: r.dueDate < day }))
      .filter((r) => r.openCents > 0);
    return { restock, due };
  });

  /** One item, for the count and stock card dialogs. */
  app.get<{ Params: { id: string } }>('/api/tpl/items/:id', { config: { permission: 'tpl.view' } }, async (req) => {
    const it = item(db, id.parse(req.params).id);
    if (!it) throw notFound('The item');
    return it;
  });
}

