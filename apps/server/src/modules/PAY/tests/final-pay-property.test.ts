/**
 * Property test (PLAN I1.3) for the final pay: random pay, separation day, leave taken, cash advance, government loan and
 * tax before Virtus. On the final pay: net pay = gross − shares − tax − loans − cash advance + refund, never below
 * zero; the cash advance takes all the pay left unless less is owed, and what is still owed is warned; the leave is used
 * up; what is stored equals what was computed; L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { tx } from '../../../platform/db/driver.ts';
import { advanceDoc } from '../../CA/doctypes/advance.ts';
import { silOf } from '../../EMP/public.ts';
import { separateEmployee } from '../../EMP/employees.ts';
import { runDoc, type Run } from '../doctypes/run.ts';
import { registerLoan } from '../loans.ts';
import { addPrior } from '../prior.ts';
import { world } from './world.ts';

const LEAVE_DAYS = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'];

describe('final pay property test (PLAN I1.3)', () => {
  it('net pay = gross − shares − tax − loans − CA + refund, never below zero', async () => {
    const stats = { caLeft: 0, refunds: 0, deficiencies: 0, loansLeft: 0 };
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          monthly: fc.boolean(),
          rateCents: fc.integer({ min: 55_000, max: 150_000 }), // daily; × 26 for a monthly rate
          lastDay: fc.integer({ min: 16, max: 30 }),
          leaveTaken: fc.integer({ min: 0, max: 5 }),
          caCents: fc.option(fc.integer({ min: 1, max: 4_000_000 }), { nil: undefined }),
          loanCents: fc.option(fc.integer({ min: 1, max: 300_000 }), { nil: undefined }),
          before: fc.option(fc.record({ taxableCents: fc.integer({ min: 0, max: 60_000_000 }), wtaxCents: fc.integer({ min: 0, max: 5_000_000 }) }), { nil: undefined }),
        }),
        async (p) => {
          const w = await world('2026-09-01');
          const profile = p.monthly
            ? { payType: 'monthly' as const, payGroup: 'SEMI_MONTHLY' as const, monthlyRateCents: p.rateCents * 26 }
            : { payType: 'daily' as const, payGroup: 'SEMI_DAILY' as const, dailyRateCents: p.rateCents };
          const id = w.person('Pat Umalis', profile, { costCentre: 'office', hireDate: '2024-01-08' });
          if (p.leaveTaken) w.attend(LEAVE_DAYS.slice(0, p.leaveTaken).map((date) => ({ employeeId: id, date, status: 'leave' })));
          if (p.before) {
            const v = { benefitsCents: 0, deMinimisCents: 0, sssCents: 0, phicCents: 0, hdmfCents: 0, otherNontaxCents: 0, ...p.before };
            tx(w.db, () => addPrior(w.db, { employeeId: id, year: 2026, source: 'before', ...v, grossCents: v.taxableCents }, w.who()));
          }
          if (p.caCents) w.record(advanceDoc, { employeeId: id, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: p.caCents, installmentCents: Math.min(p.caCents, 100_000) });
          if (p.loanCents) {
            tx(w.db, () => registerLoan(w.db, { employeeId: id, kind: 'SSS_SALARY', loanNo: '0301-555-01', amortizationCents: p.loanCents, firstMonth: '2026-09', lastMonth: '2027-08' }, w.who()));
          }
          const lastDay = `2026-09-${p.lastDay}`;
          w.at(lastDay);
          const days = Array.from({ length: p.lastDay - 15 }, (_, i) => `2026-09-${16 + i}`).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
          w.attend(days.map((date) => ({ employeeId: id, date, status: 'present' })));
          tx(w.db, () => separateEmployee(w.db, id, '1', { separatedOn: lastDay, reason: 'Resigned (made up for the test)' }, w.who()));
          w.at('2026-09-30');
          const input = { payGroup: profile.payGroup, periodStart: '2026-09-16' };
          const preview = w.preview(runDoc, input);
          const posted = w.record(runDoc, input);
          const stored = runDoc.load(w.db, posted.id);
          expect(stored).toEqual(preview.doc as Run);
          const e = stored.employees[0]!;
          const shares = e.sssEeCents + e.phicEeCents + e.hdmfEeCents;
          expect(e.netCents).toBe(e.grossCents - shares - e.wtaxCents - e.loanCents - e.caCents + e.wtaxRefundCents);
          expect(e.netCents).toBeGreaterThanOrEqual(0);
          // The cash advance takes the pay left after shares, tax and loans (the refund stays with the employee).
          const payLeft = e.grossCents - shares - e.wtaxCents - e.loanCents;
          expect(e.caCents).toBe(Math.min(p.caCents ?? 0, payLeft));
          expect(e.final).toMatchObject({ separatedOn: lastDay, caLeftCents: (p.caCents ?? 0) - e.caCents });
          expect(preview.issues.some((i) => i.code === 'CA_LEFT')).toBe(e.final!.caLeftCents > 0);
          expect(preview.issues.some((i) => i.code === 'LOAN_LEFT')).toBe(e.final!.loansLeftCents > 0);
          // Unused leave: the days left, de minimis; used up once paid.
          const leave = e.lines.filter((l) => l.kind === 'unused_leave');
          expect(leave.reduce((s, l) => s + l.qty, 0)).toBe((5 - p.leaveTaken) * 1000);
          expect(leave.every((l) => !l.taxable && !l.thirteenthBase)).toBe(true);
          expect(silOf(w.db, id, 2026).left).toBe(0);
          expect(e.yearEnd!.refundCents === 0 || e.yearEnd!.deficiencyCents === 0).toBe(true);
          if (e.final!.caLeftCents) stats.caLeft++;
          if (e.final!.loansLeftCents) stats.loansLeft++;
          if (e.wtaxRefundCents) stats.refunds++;
          if (e.yearEnd!.deficiencyCents) stats.deficiencies++;
          expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
          await w.env.app.close();
        },
      ),
      { numRuns: 20, endOnFailure: true, seed: 2416 },
    );
    expect(Object.values(stats).every((n) => n > 0)).toBe(true);
  });
});
