import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { supplierBalances, supplierLedger } from './ledger.ts';

export function apRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** AP by supplier: every supplier with something owed in 2101 (PLAN E9). */
  app.get('/api/ap/suppliers', { config: { permission: 'ap.ledger.view' } }, async () => supplierBalances(db));

  /** One supplier's bills (with what is still owed on each), payments and balance, all from the ledger. */
  app.get<{ Params: { id: string } }>('/api/ap/suppliers/:id', { config: { permission: 'ap.ledger.view' } }, async (req) => {
    const ledger = supplierLedger(db, req.params.id);
    if (!ledger) throw notFound('The supplier');
    return ledger;
  });
}
