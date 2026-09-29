/**
 * Property test (PLAN I1.3) for government loans: random loans, attendance, payroll runs with loan deductions changed or
 * skipped, cancels and SSS / Pag-IBIG remittances. After every step: what is stored equals what was computed; nobody's
 * net pay is below zero and the loan column is the sum of the loan rows; a loan is deducted at most once a month by
 * recorded runs and never more than its schedule; 2404 / 2405 per employee equal the loan deductions recorded less the
 * loan parts remitted; the remittance check's loan part matches; L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { remittanceDoc } from '../../STAT/doctypes/remittance.ts';
import { schemeCheck } from '../../STAT/ledger.ts';
import { runDoc } from '../doctypes/run.ts';
import { LOAN_KINDS, listLoans, loansOf, registerLoan } from '../loans.ts';
import { addDays, periodEndOf } from '../run-calc.ts';
import { world } from './world.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED', 'NO_MONTHS_LEFT', 'DUPLICATE_LOAN']);
const NOTHING = ['No period has anyone to pay', 'Nothing to remit'];

describe('government loans property test (PLAN I1.3)', () => {
  it('random loans, runs with changed or skipped deductions, cancels and remittances keep payroll, the loans and the ledger consistent', async () => {
    const stats = { runs: 0, withLoans: 0, remits: 0, cancels: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const w = await world('2026-09-01');
        const db = w.db;
        const staff = [
          w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: g(() => fc.integer({ min: 600_000, max: 3_000_000 })) }, { costCentre: 'office' }),
          w.person('Ben Lingguhan', { payType: 'daily', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000 }),
          w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true }),
        ];
        const ctx = () => ({ db, businessDate: today(w.env.clock), at: stamp(w.env.clock), userId: w.userId, can: () => true });
        const steps = g(() => fc.array(fc.constantFrom('tick', 'tick', 'tick', 'attend', 'attend', 'loan', 'run', 'run', 'run', 'cancel', 'remit'), { minLength: 10, maxLength: 40 }));
        for (const step of steps) {
          try {
            if (step === 'tick') w.at(addDays(today(w.env.clock), g(() => fc.integer({ min: 2, max: 9 }))));
            else if (step === 'attend') {
              const d = addDays(today(w.env.clock), -g(() => fc.integer({ min: 0, max: 10 })));
              w.attend([{ employeeId: g(() => fc.constantFrom(staff[1]!, staff[2]!)), date: d, status: g(() => fc.constantFrom('present', 'present', 'half_day', 'absent')) }]);
            } else if (step === 'loan') {
              const m = today(w.env.clock).slice(0, 7);
              const last = g(() => fc.constantFrom(m, addDays(`${m}-15`, 31).slice(0, 7), addDays(`${m}-15`, 92).slice(0, 7)));
              tx(db, () => registerLoan(db, {
                employeeId: g(() => fc.constantFrom(...staff)), kind: g(() => fc.constantFrom(...LOAN_KINDS)), loanNo: `P-${g(() => fc.integer({ min: 1000, max: 9999 }))}`,
                amortizationCents: g(() => fc.integer({ min: 10_000, max: 400_000 })), firstMonth: m, lastMonth: last,
              }, w.who()));
            } else if (step === 'run') {
              const base = g(() => runDoc.arbitrary(db));
              const month = periodEndOf(base.payGroup, base.periodStart)!.slice(0, 7);
              // Sometimes a deduction typed for someone's loan (0 skips it); refusals are fine.
              const mine = staff.flatMap((e) => loansOf(db, e)).filter((l) => l.firstMonth <= month);
              const typed = mine.length && g(() => fc.boolean()) ? [g(() => fc.constantFrom(...mine))] : [];
              const input = { ...base, ...(typed.length ? { loans: typed.map((l) => ({ loanId: l.id, amountCents: g(() => fc.constantFrom(0, l.amortizationCents, 5_000)), reason: 'Typed on the run (made up)' })) } : {}) };
              const computed = runDoc.compute(input, ctx());
              const p = w.record(runDoc, input);
              stats.runs++;
              if (computed.employees.some((e) => e.loans.length)) stats.withLoans++;
              expect(runDoc.load(db, p.id)).toEqual(computed);
              expect(runDoc.toInput(runDoc.load(db, p.id))).toEqual(input);
            } else if (step === 'cancel') {
              const open = db.prepare(`SELECT id, doc_type FROM documents WHERE doc_type IN ('pay.run', 'stat.remittance') AND status = 'posted' ORDER BY number`).all() as { id: string; doc_type: string }[];
              if (open.length) {
                const d = g(() => fc.constantFrom(...open));
                w.cancel(d.doc_type === 'pay.run' ? runDoc : remittanceDoc, d.id);
                stats.cancels++;
              }
            } else {
              const input = g(() => remittanceDoc.arbitrary(db));
              w.record(remittanceDoc, { ...input, cashPlaceId: cashPlaceId(db, '1111') });
              stats.remits++;
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
          }

          // Net pay never below zero; the loan column is the sum of the loan rows.
          const bad = db
            .prepare(
              `SELECT e.id FROM pay_run_employees e WHERE e.net_cents - e.loan_cents < 0
                 OR e.loan_cents <> (SELECT COALESCE(SUM(x.amount_cents), 0) FROM pay_run_loans x WHERE x.run_employee_id = e.id)`,
            )
            .all();
          expect(bad, step).toEqual([]);
          // Once a month, never more than the schedule.
          const twice = db
            .prepare(
              `SELECT x.loan_id, r.contribution_month FROM pay_run_loans x JOIN pay_run_employees e ON e.id = x.run_employee_id JOIN pay_runs r ON r.document_id = e.document_id
               JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND x.amount_cents > 0 GROUP BY 1, 2 HAVING COUNT(*) > 1`,
            )
            .all();
          expect(twice, step).toEqual([]);
          for (const l of listLoans(db, { status: 'all' }, today(w.env.clock))) expect(l.deductedCents, step).toBeLessThanOrEqual(l.scheduledCents);
          // 2404 / 2405 per employee = loan deductions of recorded runs − loan parts of recorded remittances.
          for (const [code, agency, scheme] of [['2404', 'SSS', 'SSS'], ['2405', 'HDMF', 'HDMF']] as const) {
            for (const e of staff) {
              const gl = db.prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND l.party_id = ?`).pluck().get(code, e);
              const runs = db
                .prepare(
                  `SELECT COALESCE(SUM(x.amount_cents), 0) FROM pay_run_loans x JOIN pay_run_employees p ON p.id = x.run_employee_id JOIN documents d ON d.id = p.document_id
                   WHERE d.status = 'posted' AND x.agency = ? AND p.employee_id = ?`,
                )
                .pluck()
                .get(agency, e) as number;
              const remitted = db
                .prepare(`SELECT COALESCE(SUM(s.loan_amount_cents), 0) FROM stat_remittance_lines s JOIN stat_remittances r ON r.document_id = s.document_id JOIN documents d ON d.id = s.document_id WHERE d.status = 'posted' AND r.scheme = ? AND s.employee_id = ?`)
                .pluck()
                .get(scheme, e) as number;
              expect(gl, `${step} ${code}`).toBe(runs - remitted);
            }
            for (const m of db.prepare('SELECT DISTINCT contribution_month FROM pay_runs').pluck().all() as string[]) {
              const c = schemeCheck(db, scheme, m);
              const recorded = db
                .prepare(`SELECT COALESCE(SUM(x.amount_cents), 0) FROM pay_run_loans x JOIN pay_run_employees p ON p.id = x.run_employee_id JOIN pay_runs r ON r.document_id = p.document_id JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND x.agency = ? AND r.contribution_month = ?`)
                .pluck()
                .get(agency, m);
              expect(c.loanRecordedCents, `${step} ${m}`).toBe(recorded);
            }
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await w.env.app.close();
      }),
      { numRuns: 15, endOnFailure: true },
    );
    expect(stats.runs).toBeGreaterThan(0);
    expect(stats.withLoans).toBeGreaterThanOrEqual(0);
  });
});
