import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { listLoans, loanLedger } from './loans.ts';

export function loanRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** The loan register: each loan with principal, paid, balance (from the ledger) and the next instalment due. */
  app.get('/api/loan/loans', { config: { permission: 'loan.loans.view' } }, async (req) => {
    const q = z.object({ status: z.enum(['posted', 'cancelled']).optional() }).strict().parse(req.query);
    return listLoans(db, q.status);
  });

  /** One loan: its position, the schedule with the payment of each paid instalment, and the loan ledger. */
  app.get<{ Params: { id: string } }>('/api/loan/loans/:id', { config: { permission: 'loan.ledger.view' } }, async (req) => loanLedger(db, req.params.id));
}
