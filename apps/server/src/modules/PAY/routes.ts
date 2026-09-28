import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { BACKDATE_PERMISSION, clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { PAY_GROUPS, employeesInGroup } from '../EMP/public.ts';
import { runDoc } from './doctypes/run.ts';
import { releaseStatus } from './doctypes/release.ts';
import { addDays, periodEndOf } from './run-calc.ts';
import { listLoans, registerLoan, stopLoan, updateLoan, withTotals } from './loans.ts';
import { hdmfRateAt, payRulesAt, phicRateAt, sssRateAt, wtaxTableAt } from './statutory.ts';

export function payRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /**
   * Payslips of a run (F4): per employee the earning lines, deductions (each government loan with what is left of it),
   * net pay, the cash-advance balance after the run, year-to-date gross pay, tax and 13th-month accrual from recorded
   * runs up to this one, and the year's 13th-month pay once recorded (TH13-).
   */
  app.get<{ Params: { id: string } }>('/api/pay/runs/:id/payslips', { config: { permission: 'pay.run.view' } }, async (req) => {
    const head = db.prepare(`SELECT d.number, d.status, d.business_date AS payDate, d.posted_at AS postedAt FROM documents d WHERE d.id = ? AND d.doc_type = 'pay.run'`).get(req.params.id) as
      | { number: string; status: string; payDate: string; postedAt: string }
      | undefined;
    if (!head) throw notFound('The payroll run');
    const run = runDoc.load(db, req.params.id);
    const ca = resolveAccount(db, { role: 'EMP_ADVANCES' }).id;
    const caAfter = db.prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND l.party_type = 'employee' AND l.party_id = ? AND j.created_at <= ?`,
    ).pluck();
    const ytd = db.prepare(
      `SELECT COALESCE(SUM(e.gross_cents), 0) AS grossCents, COALESCE(SUM(e.wtax_cents), 0) AS wtaxCents, COALESCE(SUM(e.thirteenth_cents), 0) AS thirteenthCents
       FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id
       JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND e.employee_id = ? AND r.period_end BETWEEN ? AND ?`,
    );
    const thirteenth = db.prepare(
      `SELECT d.id, d.number, t.amount_cents AS amountCents FROM pay_thirteenth_employees t JOIN pay_thirteenths h ON h.document_id = t.document_id JOIN documents d ON d.id = t.document_id
       WHERE d.status = 'posted' AND h.year = ? AND t.employee_id = ? ORDER BY d.number`,
    );
    return {
      number: head.number, status: head.status, payDate: head.payDate, payGroup: run.payGroup, periodStart: run.periodStart, periodEnd: run.periodEnd, contributionMonth: run.contributionMonth,
      employees: run.employees.map((e) => ({
        ...e, caBalanceAfterCents: caAfter.get(ca, e.employeeId, head.postedAt) as number,
        ytd: ytd.get(e.employeeId, `${run.periodEnd.slice(0, 4)}-01-01`, run.periodEnd) as { grossCents: number; wtaxCents: number; thirteenthCents: number },
        thirteenthPaid: thirteenth.all(+run.periodEnd.slice(0, 4), e.employeeId) as { id: string; number: string; amountCents: number }[],
      })),
    };
  });

  /** Government loans (loans.ts): the register with what payroll deducted and what is left; `status=all` includes ended and stopped ones. */
  app.get('/api/pay/loans', { config: { permission: 'pay.loans.view' } }, async (req) => {
    const q = z.object({ employeeId: z.uuid().optional(), status: z.enum(['open', 'all']).optional() }).strict().parse(req.query);
    return listLoans(db, q, today(clock));
  });
  const who = (req: Parameters<typeof currentUser>[0]) => ({ userId: currentUser(req).userId, at: stamp(clock), today: today(clock) });
  const write = <T extends Parameters<typeof withTotals>[1]>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), withTotals(db, fn(), today(clock))));
  app.post('/api/pay/loans', { config: { permission: 'pay.loans.manage' } }, async (req) => write(() => registerLoan(db, req.body, who(req))));
  app.put<{ Params: { id: string } }>('/api/pay/loans/:id', { config: { permission: 'pay.loans.manage' } }, async (req) =>
    write(() => updateLoan(db, req.params.id, req.headers['if-match'], req.body, who(req))),
  );
  app.post<{ Params: { id: string } }>('/api/pay/loans/:id/stop', { config: { permission: 'pay.loans.manage' } }, async (req) =>
    write(() => stopLoan(db, req.params.id, req.headers['if-match'], req.body, who(req))),
  );

  /** Who in a run still has net pay to release (the release form). */
  app.get<{ Params: { id: string } }>('/api/pay/runs/:id/release-status', { config: { permission: 'pay.release.post' } }, async (req) => releaseStatus(db, req.params.id));

  /** Recorded runs and 13th-month pay with net pay not yet released, newest first (the release form's picker). */
  app.get('/api/pay/runs/to-release', { config: { permission: 'pay.release.post' } }, async () => {
    const runs = db
      .prepare(
        `SELECT id, number, kind, payGroup, periodStart, periodEnd FROM (
           SELECT d.id, d.number, d.posted_at, 'run' AS kind, r.pay_group AS payGroup, r.period_start AS periodStart, r.period_end AS periodEnd FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted'
           UNION ALL
           SELECT d.id, d.number, d.posted_at, 'thirteenth', t.pay_group, t.year || '-01-01', t.year || '-12-31' FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted'
         ) ORDER BY posted_at DESC, number DESC LIMIT 50`,
      )
      .all() as { id: string; number: string; kind: 'run' | 'thirteenth'; payGroup: string; periodStart: string; periodEnd: string }[];
    return runs.map((r) => ({ ...r, dueCents: releaseStatus(db, r.id).filter((s) => !s.releasedBy).reduce((s, x) => s + x.netCents, 0) })).filter((r) => r.dueCents > 0);
  });

  /**
   * The latest periods of a pay group (ended by today), whether each is recorded, and how many it would pay. `bookOn` is
   * the date the run form sends (PAY-1): the period's last day when that has passed and the user may backdate, else null
   * (today).
   */
  app.get('/api/pay/periods', { config: { permission: 'pay.run.create' } }, async (req) => {
    const { payGroup } = z.object({ payGroup: z.enum(PAY_GROUPS) }).strict().parse(req.query);
    const now = today(clock);
    const backdate = currentUser(req).permissions.has(BACKDATE_PERMISSION);
    const starts: string[] = [];
    for (let d = now; starts.length < 6 && d > addDays(now, -120); d = addDays(d, -1)) {
      const end = periodEndOf(payGroup, d);
      if (end && end <= now) starts.push(d);
    }
    const recorded = db.prepare(`SELECT d.id, d.number FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND r.pay_group = ? AND r.period_start = ?`);
    return starts.map((periodStart) => {
      const periodEnd = periodEndOf(payGroup, periodStart)!;
      return {
        periodStart, periodEnd, employees: employeesInGroup(db, payGroup, periodStart, periodEnd).length,
        recorded: (recorded.get(payGroup, periodStart) as { id: string; number: string } | undefined) ?? null, bookOn: backdate && periodEnd < now ? periodEnd : null,
      };
    });
  });

  /** The 13th-month pay form's years (this year, and last year early in January) and what each group has recorded. */
  app.get('/api/pay/thirteenth/years', { config: { permission: 'pay.thirteenth.create' } }, async () => {
    const year = +today(clock).slice(0, 4);
    const recorded = db
      .prepare(`SELECT t.pay_group AS payGroup, t.year, d.id, d.number FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted' AND t.year >= ? ORDER BY t.year DESC, d.number`)
      .all(year - 1) as { payGroup: string; year: number; id: string; number: string }[];
    return { years: [year, year - 1], recorded };
  });

  /** The statutory tables and pay rules in force today (F1), for the accountant to check. */
  app.get('/api/pay/statutory', { config: { permission: 'pay.run.view' } }, async () => {
    const d = today(clock);
    return {
      asOf: d, sss: sssRateAt(db, d), phic: phicRateAt(db, d), hdmf: hdmfRateAt(db, d), rules: payRulesAt(db, d) ?? null,
      wtax: { weekly: wtaxTableAt(db, 'weekly', d), semiMonthly: wtaxTableAt(db, 'semi_monthly', d), monthly: wtaxTableAt(db, 'monthly', d) },
    };
  });
}
