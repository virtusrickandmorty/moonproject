import type { FastifyInstance } from 'fastify';
import { badRequest, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { runMonth, thirteenthMonth } from '../PAY/public.ts';
import { SCHEMES, isMonth, remittedForRun, schemeCheck, statMonths } from './ledger.ts';
import { monthLists } from './lists.ts';

export function statRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** The remittance check of the latest 12 months with payrolls or remittances: per scheme, recorded, remitted and left. */
  app.get('/api/stat/months', { config: { permission: 'stat.view' } }, async () =>
    statMonths(db).slice(0, 12).map((month) => ({ month, check: SCHEMES.map((s) => schemeCheck(db, s, month)) })),
  );

  /** One month's SSS, PhilHealth and Pag-IBIG lists, the 1601-C worksheet and the remittance check. */
  app.get<{ Params: { month: string } }>('/api/stat/months/:month', { config: { permission: 'stat.view' } }, async (req) => {
    if (!isMonth(req.params.month)) throw badRequest('MONTH', 'Use a month like 2026-09.');
    return monthLists(db, req.params.month, currentUser(req).permissions.has('emp.view_ids'));
  });

  /** D6: what of a payroll run's month is already remitted, for the warning on the run's screen before a cancel. */
  app.get<{ Params: { id: string } }>('/api/stat/runs/:id/remitted', { config: { permission: 'pay.run.view' } }, async (req) => {
    const run = runMonth(db, req.params.id);
    if (!run) throw notFound('The payroll run');
    return { month: run.contributionMonth, remitted: run.status === 'posted' ? remittedForRun(db, req.params.id, run.contributionMonth) : [] };
  });

  /** D6: what of a 13th-month pay's own month is already remitted, for the warning on its screen before a cancel. */
  app.get<{ Params: { id: string } }>('/api/stat/thirteenths/:id/remitted', { config: { permission: 'pay.thirteenth.view' } }, async (req) => {
    const t = thirteenthMonth(db, req.params.id);
    if (!t) throw notFound('The 13th-month pay');
    return { month: t.month, remitted: t.status === 'posted' ? remittedForRun(db, req.params.id, t.month) : [] };
  });
}
