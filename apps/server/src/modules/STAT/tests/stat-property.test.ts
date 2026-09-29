/**
 * Property test (PLAN I1.3) over random attendance, payroll runs, remittances and cancels of both. After every step:
 * each month's SSS, PhilHealth and Pag-IBIG list and 1601-C tax add up to what its payrolls credited on the ledger; the
 * check's balance is the sum of the employees' payables; every line on 2401–2403 and 2310 belongs to a month (so the
 * accounts equal the months' balances); a remittance stores what it computed and never clears more than was payable;
 * penalties go to 6290 only, never to a payable; L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { createTestEnv, createUser } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { addEmployee, addPay } from '../../EMP/tests/fixture.ts';
import { holidaysBetween } from '../../EMP/public.ts';
import { saveAttendance } from '../../EMP/time.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { addDays, periodEndOf } from '../../PAY/run-calc.ts';
import { remittanceDoc } from '../doctypes/remittance.ts';
import { SCHEME, SCHEMES, payableByEmployee, statMonths } from '../ledger.ts';
import { monthLists } from '../lists.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED']);
const NOTHING = ['No period has anyone to pay', 'Nothing to remit'];

describe('statutory property test (PLAN I1.3)', () => {
  it('random payrolls, remittances and cancels keep the lists, the remittance check and the ledger in step', async () => {
    const stats = { runs: 0, remittances: 0, penalties: 0, cancels: 0, refused: 0, cancelledAfterRemittance: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-08-03T02:00:00Z'); // Monday 3 August, Manila
        const db = t.db;
        const userId = createUser(db, 'prop-owner', ['owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const record = <I>(def: DocTypeDef<I>, input: I, businessDate?: string) =>
          postDocument(e, def, actor, { input, businessDate, expectedTotalCents: previewDocument(e, def, actor, input, businessDate).totalCents });
        const staff = { ana: addEmployee(db, 'Ana Araw'), ben: addEmployee(db, 'Ben Halo'), cy: addEmployee(db, 'Cy Buwan', { costCentre: 'office' }) };
        addPay(db, staff.ana, userId, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
        addPay(db, staff.ben, userId, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: g(() => fc.integer({ min: 60_000, max: 250_000 })) });
        addPay(db, staff.cy, userId, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: g(() => fc.integer({ min: 1_000_000, max: 8_000_000 })) });
        const ids = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];

        const steps = g(() => fc.array(fc.constantFrom('tick', 'tick', 'attend', 'attend', 'attend', 'run', 'run', 'remit', 'remit', 'cancelRun', 'cancelRemit'), { minLength: 20, maxLength: 70 }));
        for (const step of steps) {
          try {
            if (step === 'tick') t.clock.set(`${addDays(today(t.clock), g(() => fc.integer({ min: 2, max: 8 })))}T02:00:00Z`);
            else if (step === 'attend') {
              const who = g(() => fc.constantFrom(...Object.values(staff)));
              const date = addDays(today(t.clock), -g(() => fc.integer({ min: 0, max: 10 })));
              const holiday = holidaysBetween(db, date, date).length > 0;
              const status = g(() => fc.constantFrom(...(holiday ? ['holiday_off', 'holiday_worked'] : ['present', 'present', 'present', 'half_day', 'absent', 'rest_day_worked'])));
              tx(db, () => saveAttendance(db, { days: [{ employeeId: who, date, status }] }, { userId, at: stamp(t.clock), today: today(t.clock), can: () => true }));
            } else if (step === 'run') {
              const input = g(() => runDoc.arbitrary(db));
              const end = periodEndOf(input.payGroup, input.periodStart)!;
              record(runDoc, input, end < today(t.clock) && g(() => fc.boolean()) ? end : undefined);
              stats.runs++;
            } else if (step === 'remit') {
              const input = g(() => remittanceDoc.arbitrary(db));
              const computed = remittanceDoc.compute(input, ctx());
              const p = record(remittanceDoc, input);
              stats.remittances++;
              expect(remittanceDoc.load(db, p.id)).toEqual(computed);
              expect(remittanceDoc.toInput(remittanceDoc.load(db, p.id))).toEqual(input);
              // The employees' debits less any year-end refunds taken off (credits) are the amount paid.
              expect(computed.lines.reduce((s, l) => s + l.amountCents, 0) + computed.adjustments.reduce((s, a) => s + a.debitCents - a.creditCents, 0)).toBe(input.amountCents);
              expect(computed.totalCents).toBe(input.amountCents + (input.penaltyCents ?? 0));
              if (input.penaltyCents) stats.penalties++;
            } else {
              const [def, type] = step === 'cancelRun' ? [runDoc, 'pay.run'] : [remittanceDoc, 'stat.remittance'];
              const open = ids(type);
              if (open.length) {
                cancelDocument(e, def as DocTypeDef, actor, g(() => fc.constantFrom(...open)), 'Recorded by mistake, redo it');
                stats.cancels++;
              }
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
            if (err instanceof AppError) stats.refused++;
          }

          const perAccount = new Map<string, number>();
          for (const month of statMonths(db)) {
            const lists = monthLists(db, month, false);
            const totals = [lists.sss.totalCents, lists.phic.totalCents, lists.hdmf.totalCents, lists.tax.taxWithheldCents - lists.tax.yearEndRefundCents];
            expect(lists.check.map((c) => c.recordedCents), `${step} ${month}`).toEqual(totals);
            expect(lists.tax.totalCompensationCents - lists.tax.nonTaxableCents).toBe(lists.tax.taxableCents);
            for (const c of lists.check) {
              const payable = [...payableByEmployee(db, c.scheme, month).values()];
              expect(payable.reduce((s, x) => s + x, 0), `${step} ${month} ${c.scheme}`).toBe(c.balanceCents);
              perAccount.set(c.scheme, (perAccount.get(c.scheme) ?? 0) + c.balanceCents);
            }
          }
          // Every line on the payables belongs to a month's payroll or remittance.
          for (const scheme of SCHEMES) {
            const gl = db
              .prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = ?`)
              .pluck()
              .get(SCHEME[scheme].role) as number;
            expect(gl, `${step} ${scheme}`).toBe(perAccount.get(scheme) ?? 0);
          }
          // 6290 holds exactly the penalties of the remittances still recorded.
          const penalties = db.prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = 'PENALTIES'`).pluck().get();
          const recorded = db.prepare(`SELECT COALESCE(SUM(s.penalty_cents), 0) FROM stat_remittances s JOIN documents d ON d.id = s.document_id WHERE d.status = 'posted'`).pluck().get();
          expect(penalties, step).toBe(recorded);
        }
        stats.cancelledAfterRemittance += statMonths(db).reduce((n, m) => n + monthLists(db, m, false).check.filter((c) => c.cancelledAfter.length > 0).length, 0);
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 20, endOnFailure: true },
    );
    expect(stats.runs).toBeGreaterThan(0);
    expect(stats.penalties).toBeGreaterThan(0);
  });
});
