import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { employee } from '../EMP/public.ts';
import { advanceSchedule } from './public.ts';

export function caRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** What an employee owes on cash advances (GL 1210), the open advances and the deduction per payroll. */
  app.get<{ Params: { id: string } }>('/api/ca/employees/:id', { config: { permission: 'ca.view' } }, async (req) => {
    const e = employee(db, req.params.id);
    if (!e) throw notFound('The employee');
    return { employeeId: e.id, name: e.name, ...advanceSchedule(db, e.id) };
  });
}
