import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { today } from '../../platform/clock.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { BACKDATE_PERMISSION } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { PAY_GROUPS, employeesInGroup } from '../EMP/public.ts';
import { runDoc } from './doctypes/run.ts';
import { releaseStatus } from './doctypes/release.ts';
import { addDays, periodEndOf } from './run-calc.ts';
import { hdmfRateAt, payRulesAt, phicRateAt, sssRateAt, wtaxTableAt } from './statutory.ts';

export function payRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /**
   * Payslips of a run (F4): per employee the earning lines, deductions, net pay, the cash-advance balance after the run,
   * and year-to-date gross pay and tax from recorded runs up to this one.
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
      `SELECT COALESCE(SUM(e.gross_cents), 0) AS grossCents, COALESCE(SUM(e.wtax_cents), 0) AS wtaxCents FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id
       JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND e.employee_id = ? AND r.period_end BETWEEN ? AND ?`,
    );
    return {
      number: head.number, status: head.status, payDate: head.payDate, payGroup: run.payGroup, periodStart: run.periodStart, periodEnd: run.periodEnd, contributionMonth: run.contributionMonth,
      employees: run.employees.map((e) => ({
        ...e, caBalanceAfterCents: caAfter.get(ca, e.employeeId, head.postedAt) as number,
        ytd: ytd.get(e.employeeId, `${run.periodEnd.slice(0, 4)}-01-01`, run.periodEnd) as { grossCents: number; wtaxCents: number },
      })),
    };
  });

  /** Who in a run still has net pay to release (the release form). */
  app.get<{ Params: { id: string } }>('/api/pay/runs/:id/release-status', { config: { permission: 'pay.release.post' } }, async (req) => releaseStatus(db, req.params.id));

  /** Recorded runs with net pay not yet released, newest first (the release form's picker). */
  app.get('/api/pay/runs/to-release', { config: { permission: 'pay.release.post' } }, async () => {
    const runs = db
      .prepare(`SELECT d.id, d.number, r.pay_group AS payGroup, r.period_start AS periodStart, r.period_end AS periodEnd FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' ORDER BY d.number DESC LIMIT 50`)
      .all() as { id: string; number: string; payGroup: string; periodStart: string; periodEnd: string }[];
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

  /** The statutory tables and pay rules in force today (F1), for the accountant to check. */
  app.get('/api/pay/statutory', { config: { permission: 'pay.run.view' } }, async () => {
    const d = today(clock);
    return {
      asOf: d, sss: sssRateAt(db, d), phic: phicRateAt(db, d), hdmf: hdmfRateAt(db, d), rules: payRulesAt(db, d) ?? null,
      wtax: { weekly: wtaxTableAt(db, 'weekly', d), semiMonthly: wtaxTableAt(db, 'semi_monthly', d), monthly: wtaxTableAt(db, 'monthly', d) },
    };
  });
}
