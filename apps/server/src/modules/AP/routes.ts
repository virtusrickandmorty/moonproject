import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { today } from '../../platform/clock.ts';
import { z } from 'zod';
import { bill, owedOnBill, supplierBalances, supplierLedger } from './ledger.ts';
import { purchasesOverview } from './overview.ts';

const owedQuery = z.object({ ids: z.string().max(200 * 37) }).strict();

export function apRoutes(app: FastifyInstance, deps: AppDeps): void {
  /**
   * Whether the bills on a page of the bill list are paid (the owner's request, Nov 2026): for each, what is still owed from
   * the ledger and its due date. `ids`: the bills' ids, comma separated, at most 200.
   */
  app.get<{ Querystring: { ids?: string } }>('/api/ap/bills/owed', { config: { permission: 'ap.bill.view' } }, async (req) => {
    const ids = [...new Set(owedQuery.parse(req.query).ids.split(',').filter(Boolean))].slice(0, 200);
    return ids.flatMap((id) => {
      const b = bill(deps.db, id);
      return b && b.status === 'posted' ? [{ id, owedCents: owedOnBill(deps.db, id), payableCents: b.payableCents, dueDate: b.dueDate }] : [];
    });
  });

  const { db, clock } = deps;

  /** The purchases and expenses overview: what waits at each step from order to payment, and this month's costs. */
  app.get('/api/ap/overview', { config: { permission: 'ap.ledger.view' } }, async () => purchasesOverview(db, today(clock)));

  /** AP by supplier: every supplier with something owed in 2101 (PLAN E9). */
  app.get('/api/ap/suppliers', { config: { permission: 'ap.ledger.view' } }, async () => supplierBalances(db));

  /** One supplier's bills (with what is still owed on each), payments and balance, all from the ledger. */
  app.get<{ Params: { id: string } }>('/api/ap/suppliers/:id', { config: { permission: 'ap.ledger.view' } }, async (req) => {
    const ledger = supplierLedger(db, req.params.id);
    if (!ledger) throw notFound('The supplier');
    return ledger;
  });
}
