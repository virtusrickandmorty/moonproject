import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { today } from '../../platform/clock.ts';
import { lateInstalments, paymentsOf } from './late.ts';
import { financingToRecord, listLoans, loanLedger } from './loans.ts';

export function loanRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** The loan register: each loan with principal, paid, balance (from the ledger) and the next instalment due. */
  app.get('/api/loan/loans', { config: { permission: 'loan.loans.view' } }, async (req) => {
    const q = z.object({ status: z.enum(['posted', 'cancelled']).optional() }).strict().parse(req.query);
    return listLoans(db, q.status);
  });

  /** Asset purchases with a financed part not yet in the loan register, to record their financing (schedule and payments). */
  app.get('/api/loan/financed-assets', { config: { permission: 'loan.in.create' } }, async () => financingToRecord(db));

  /** One loan: its position, the schedule with the payment of each paid instalment, and the loan ledger. */
  app.get<{ Params: { id: string } }>('/api/loan/loans/:id', { config: { permission: 'loan.ledger.view' } }, async (req) => loanLedger(db, req.params.id));

  /** Instalments past their due date with no recorded payment, across the loans still owing (the server's today). */
  app.get('/api/loan/late', { config: { permission: 'loan.loans.view' } }, async () => lateInstalments(db, today(clock)));

  /** One loan's payments as documents, newest first. */
  app.get<{ Params: { id: string } }>('/api/loan/loans/:id/payments', { config: { permission: 'loan.ledger.view' } }, async (req) => paymentsOf(db, req.params.id));
}
