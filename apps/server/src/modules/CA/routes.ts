import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { employee } from '../EMP/public.ts';
import { writeoffAccounts } from './doctypes/writeoff.ts';
import { advanceSchedule, owing } from './public.ts';

export function caRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** Who owes on cash advances today, separated employees included (the repayment and write-off forms pick from it). */
  app.get('/api/ca/employees', { config: { permission: 'ca.view' } }, async () => owing(db));

  /**
   * What an employee owes on cash advances (GL 1210), the open advances, the deduction per payroll, and the repayments
   * and write-offs with the balance after each.
   */
  app.get<{ Params: { id: string } }>('/api/ca/employees/:id', { config: { permission: 'ca.view' } }, async (req) => {
    const e = employee(db, req.params.id);
    if (!e) throw notFound('The employee');
    return { employeeId: e.id, name: e.name, active: e.active, ...advanceSchedule(db, e.id) };
  });

  /** The operating expense accounts a write-off may be charged to. */
  app.get('/api/ca/writeoff-accounts', { config: { permission: 'ca.writeoff' } }, async () => writeoffAccounts(db));
}
