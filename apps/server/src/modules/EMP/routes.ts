import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden, isBusinessDate, notFound, toCsv, type CsvCell } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { activeEmployees } from './public.ts';
import { addPayProfile, createEmployee, employeeRecord, listEmployees, masked, payHistory, payProfileAt, separateEmployee, updateEmployee, type Who } from './employees.ts';
import { ATTENDANCE, addHoliday, attendanceBetween, checkRange, deactivateHoliday, holidaysBetween, holidaysOf, paidDaysBetween, saveAttendance, silOf } from './time.ts';
import { leaveBalances } from './leave-balances.ts';

const dateQ = z.string().refine(isBusinessDate);

export function empRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest): Who => {
    const u = currentUser(req);
    return { userId: u.userId, at: stamp(clock), today: today(clock), can: (p) => u.permissions.has(p) };
  };
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));
  const can = (req: FastifyRequest, p: string) => currentUser(req).permissions.has(p);

  app.get('/api/emp/employees', { config: { permission: 'emp.view' } }, async (req) => {
    const q = z.object({ search: z.string().max(100).optional(), status: z.enum(['active', 'separated', 'all']).optional() }).strict().parse(req.query);
    return listEmployees(db, { search: q.search?.trim() ?? '', status: q.status ?? 'active' });
  });

  app.get('/api/emp/leave-balances', { config: { permission: 'emp.view' } }, async (req, reply) => {
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), format: z.literal('csv').optional() }).strict().parse(req.query);
    const year = q.year ?? Number(today(clock).slice(0, 4));
    const result = leaveBalances(db, year);
    if (q.format !== 'csv') return result;
    reply.header('Content-Disposition', `attachment; filename="leave-balances-${year}.csv"`);
    reply.type('text/csv; charset=utf-8');
    return toCsv([
      ['Employee code', 'Employee', 'Hired', 'Separated', 'SIL earned', 'Days used', 'Paid in cash', 'Left'],
      ...result.rows.map((r): CsvCell[] => [r.code, r.fullName, r.hireDate, r.separatedOn ?? '', r.earned, r.used, r.paid, r.left]),
      ['TOTAL', '', '', '', result.totals.earned, result.totals.used, result.totals.paid, result.totals.left],
    ]);
  });

  /**
   * One employee: the record (government IDs masked without emp.view_ids), pay type and group, SIL this year, and the pay
   * history with rates only for pay.view_rates (C6, N-05).
   */
  app.get<{ Params: { id: string } }>('/api/emp/employees/:id', { config: { permission: 'emp.view' } }, async (req) => {
    const e = employeeRecord(db, req.params.id);
    if (!e) throw notFound('The employee');
    const now = today(clock);
    const pay = payProfileAt(db, e.id, e.separatedOn ?? now) ?? null;
    return {
      employee: masked(e, can(req, 'emp.view_ids')),
      pay: pay && { payType: pay.payType, payGroup: pay.payGroup, workweekDays: pay.workweekDays, effectiveFrom: pay.effectiveFrom },
      payHistory: can(req, 'pay.view_rates') ? payHistory(db, e.id) : null,
      sil: silOf(db, e.id, Number(now.slice(0, 4))),
    };
  });

  app.post('/api/emp/employees', { config: { permission: 'emp.manage' } }, async (req) => write(() => createEmployee(db, req.body, who(req))));

  app.put<{ Params: { id: string } }>('/api/emp/employees/:id', { config: { permission: 'emp.manage' } }, async (req) =>
    write(() => masked(updateEmployee(db, req.params.id, req.headers['if-match'], req.body, who(req)), can(req, 'emp.view_ids'))),
  );

  app.post<{ Params: { id: string } }>('/api/emp/employees/:id/separate', { config: { permission: 'emp.manage' } }, async (req) =>
    write(() => masked(separateEmployee(db, req.params.id, req.headers['if-match'], req.body, who(req)), can(req, 'emp.view_ids'))),
  );

  /** A new pay profile: needs emp.pay and pay.view_rates (whoever sets pay sees it). */
  app.post<{ Params: { id: string } }>('/api/emp/employees/:id/pay', { config: { permission: 'emp.pay' } }, async (req) => {
    if (!can(req, 'pay.view_rates')) throw forbidden('pay.view_rates');
    return write(() => addPayProfile(db, req.params.id, req.body, who(req)));
  });

  /**
   * The attendance grid: employees in service in the range, the holidays in it, each typed day (at most 31 days), and the
   * days recorded payroll runs paid (locked until the run is cancelled).
   */
  app.get('/api/emp/attendance', { config: { permission: 'emp.view' } }, async (req) => {
    const q = z.object({ from: dateQ, to: dateQ }).strict().safeParse(req.query);
    if (!q.success) throw badRequest('BAD_DATE', 'Pick the dates to show, like 2026-09-16 to 2026-09-30.');
    const { from, to } = q.data;
    checkRange(from, to);
    const employees = listEmployees(db, { search: '', status: 'all' })
      .filter((e) => e.hireDate <= to && (!e.separatedOn || e.separatedOn >= from))
      .map(({ id, code, fullName, hireDate, separatedOn }) => ({ id, code, fullName, hireDate, separatedOn }));
    return { from, to, today: today(clock), statuses: ATTENDANCE, holidays: holidaysBetween(db, from, to), employees, days: attendanceBetween(db, from, to), paid: paidDaysBetween(db, from, to) };
  });

  app.post('/api/emp/attendance', { config: { permission: 'emp.attendance' } }, async (req) => write(() => saveAttendance(db, req.body, who(req))));

  app.get('/api/emp/holidays', { config: { permission: 'emp.view' } }, async (req) => {
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).strict().parse(req.query);
    const year = q.year ?? Number(today(clock).slice(0, 4));
    return { year, holidays: holidaysOf(db, year) };
  });
  app.post('/api/emp/holidays', { config: { permission: 'emp.holidays' } }, async (req) => write(() => addHoliday(db, req.body, who(req))));
  app.post<{ Params: { id: string } }>('/api/emp/holidays/:id/deactivate', { config: { permission: 'emp.holidays' } }, async (req) =>
    write(() => deactivateHoliday(db, Number(req.params.id), req.body, who(req))),
  );

  /** Active employees for pickers (no pay, no IDs). */
  app.get('/api/emp/active', { config: { permission: 'emp.view' } }, async () => activeEmployees(db).map(({ id, code, name, costCentre }) => ({ id, code, name, costCentre })));
}
