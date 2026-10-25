import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { today } from '../../platform/clock.ts';
import { supplierBalances, supplierLedger } from './ledger.ts';
import { purchasesOverview } from './overview.ts';

export function apRoutes(app: FastifyInstance, deps: AppDeps): void {
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
