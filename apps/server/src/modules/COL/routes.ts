import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { customerRef } from '../CUS/public.ts';
import { jobOrdersOf, joMoney } from '../JO/public.ts';
import { openSalesOf } from '../QS/public.ts';
import { depositsHeld } from './ledger.ts';

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

  /** What can be paid back to a customer, for the refund form: deposits held per JO (cancelled JOs too, D6) and unapplied money. */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/refundable', { config: { permission: 'col.refund' } }, async (req) => {
    const c = customer(req.params.id);
    const jobOrders = jobOrdersOf(db, c.id, true)
      .map((jo) => ({ id: jo.id, number: jo.number, status: jo.status, depositsHeldCents: depositsHeld(db, c.id, jo.id) }))
      .filter((jo) => jo.depositsHeldCents > 0);
    return { customerId: c.id, customerName: c.display_name, jobOrders, unappliedCents: depositsHeld(db, c.id, null) };
  });
}
