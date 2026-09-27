import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { customerRef } from '../CUS/public.ts';
import { jobOrdersOf, joMoney } from '../JO/public.ts';
import { depositsHeld } from './ledger.ts';

export function colRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** What a customer can pay on, for the collection form: JOs with a balance due, oldest due first, and unapplied money held. */
  app.get<{ Params: { id: string } }>('/api/col/customers/:id/open-items', { config: { permission: 'col.create' } }, async (req) => {
    const c = customerRef(db, req.params.id);
    if (!c) throw notFound('The customer');
    const jobOrders = jobOrdersOf(db, c.id)
      .map((jo) => {
        const m = joMoney(db, jo.id);
        return { id: jo.id, number: jo.number, dueDate: jo.dueDate, totalCents: jo.totalCents, balanceDueCents: m.balanceDueCents, depositsHeldCents: m.depositsHeldCents };
      })
      .filter((jo) => jo.balanceDueCents > 0);
    return { customerId: c.id, customerName: c.display_name, jobOrders, unappliedCents: depositsHeld(db, c.id, null) };
  });
}
