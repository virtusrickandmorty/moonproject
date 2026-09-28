import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { customerRef } from '../CUS/public.ts';
import { STAGE_LABELS, awaitingInvoice, currentStage, isAbandoned, jobOrdersOf, joMoney, liveReplacementOf } from '../JO/public.ts';
import { openSalesOf } from '../QS/public.ts';
import { depositsHeld } from './ledger.ts';
import { invoicesOf, memosOn, owedCents, writeOffsOn } from './credits.ts';

export function colRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const customer = (id: string) => {
    const c = customerRef(db, id);
    if (!c) throw notFound('The customer');
    return c;
  };

  /**
   * What a customer can pay on, for the collection form: JOs with a balance due, oldest due first; quick sales with
   * money still owed, oldest first; and unapplied money held.
   */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/open-items', { config: { permission: 'col.create' } }, async (req) => {
    const c = customer(req.params.id);
    const jobOrders = jobOrdersOf(db, c.id)
      .map((jo) => {
        const m = joMoney(db, jo.id);
        return { id: jo.id, number: jo.number, dueDate: jo.dueDate, totalCents: jo.totalCents, balanceDueCents: m.balanceDueCents, depositsHeldCents: m.depositsHeldCents };
      })
      .filter((jo) => jo.balanceDueCents > 0);
    const quickSales = openSalesOf(db, c.id).map((s) => ({ id: s.id, number: s.number, invoiceNumber: s.invoiceNumber, businessDate: s.businessDate, totalCents: s.totalCents, openCents: s.openCents }));
    return { customerId: c.id, customerName: c.display_name, jobOrders, quickSales, unappliedCents: depositsHeld(db, c.id, null) };
  });

  /** Deposits held per JO, cancelled JOs too (D6: they can still be refunded or moved). */
  const heldPerJo = (customerId: string) =>
    jobOrdersOf(db, customerId, true)
      .map((jo) => ({ id: jo.id, number: jo.number, status: jo.status, depositsHeldCents: depositsHeld(db, customerId, jo.id) }))
      .filter((jo) => jo.depositsHeldCents > 0);

  /** What can be paid back to a customer, for the refund form: deposits held per JO and unapplied money. */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/refundable', { config: { permission: 'col.refund' } }, async (req) => {
    const c = customer(req.params.id);
    return { customerId: c.id, customerName: c.display_name, jobOrders: heldPerJo(c.id), unappliedCents: depositsHeld(db, c.id, null) };
  });

  /**
   * A customer's recorded invoices (release invoices and quick sales) for the credit memo, write-off and 2307 forms: what
   * each still owes, what credit memos left of it, and its write-off if any.
   */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/invoices', { config: { permission: 'col.view' } }, async (req) => {
    const c = customer(req.params.id);
    const invoices = invoicesOf(db, c.id).map((i) => ({
      id: i.id, kind: i.kind, number: i.number, invoiceNumber: i.invoiceNumber, businessDate: i.businessDate, jobOrderNumber: i.jobOrderNumber,
      grossCents: i.grossCents, vatCents: i.vatCents, owedCents: owedCents(db, i), creditableCents: i.grossCents - memosOn(db, i.id).amountCents,
      writtenOff: writeOffsOn(db, i.arRefId).find((w) => w.invoiceId === i.id)?.number ?? null,
    }));
    return { customerId: c.id, customerName: c.display_name, invoices };
  });

  /**
   * For the deposit forfeit form (D5 DEP-FORFEIT): job orders with a deposit held, cancelled ones too (D6), with their
   * stage, and whether one can be forfeited (not released, no release waiting for its invoice).
   */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/forfeitable', { config: { permission: 'col.forfeit' } }, async (req) => {
    const c = customer(req.params.id);
    const jobOrders = heldPerJo(c.id).map((jo) => {
      const stage = currentStage(db, jo.id);
      const abandoned = stage === 'closed' && isAbandoned(db, jo.id);
      const blocked = (stage === 'released' || stage === 'closed') && !abandoned ? 'Released to the customer: refund or move its money instead.'
        : awaitingInvoice(db, jo.id).length > 0 ? 'A release still waits for its invoice.' : null;
      return { ...jo, stageLabel: abandoned ? 'Abandoned' : STAGE_LABELS[stage], blocked };
    });
    return { customerId: c.id, customerName: c.display_name, jobOrders };
  });

  /**
   * For the deposit transfer form (D5 DEP-XFER, D6): money held (per JO, with where an edited JO lives on now, and
   * unapplied money) and the recorded JOs it can go to, those with a balance due, oldest due first.
   */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/transferable', { config: { permission: 'col.transfer' } }, async (req) => {
    const c = customer(req.params.id);
    const held = heldPerJo(c.id).map((jo) => {
      const next = jo.status === 'cancelled' ? liveReplacementOf(db, jo.id) : null;
      return { ...jo, replacement: next && { id: next.id, number: next.number } };
    });
    const jobOrders = jobOrdersOf(db, c.id)
      .map((jo) => ({ id: jo.id, number: jo.number, dueDate: jo.dueDate, totalCents: jo.totalCents, balanceDueCents: joMoney(db, jo.id).balanceDueCents }))
      .filter((jo) => jo.balanceDueCents > 0);
    return { customerId: c.id, customerName: c.display_name, held, unappliedCents: depositsHeld(db, c.id, null), jobOrders };
  });
}
