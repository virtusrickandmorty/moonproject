/**
 * Property test (PLAN I1.3) for the year-end tax adjustment: random pay, pay before Virtus, a previous employer,
 * 13th-month pay and allowances. After the year-end run: the year's tax withheld equals the annual tax whenever net pay
 * allows (else it is short by exactly the amount warned, and net pay is nil); a refund and a deficiency never go
 * together; what is stored equals what was computed; the 2316's parts add up to the gross; L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { tx } from '../../../platform/db/driver.ts';
import { employee } from '../../EMP/public.ts';
import { runDoc, type Run } from '../doctypes/run.ts';
import { thirteenthDoc } from '../doctypes/thirteenth.ts';
import { addPrior } from '../prior.ts';
import { data2316 } from '../year-end.ts';
import { world } from './world.ts';

const pesos = (max: number) => fc.integer({ min: 0, max: max * 100 });

describe('year-end adjustment property test (PLAN I1.3)', () => {
  it('after the adjustment the year’s tax withheld equals the annual tax whenever net pay allows', async () => {
    const stats = { refunds: 0, deficiencies: 0, short: 0 };
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          monthlyCents: fc.integer({ min: 1_000_000, max: 25_000_000 }),
          mwe: fc.boolean(),
          before: fc.option(fc.record({ taxableCents: pesos(1_500_000), wtaxCents: pesos(400_000), sssCents: pesos(20_000), benefitsCents: pesos(90_000) }), { nil: undefined }),
          previous: fc.option(fc.record({ taxableCents: pesos(500_000), wtaxCents: pesos(100_000), benefitsCents: pesos(60_000) }), { nil: undefined }),
          // A 13th-month pay of nothing is refused (NOTHING), so a recorded one is at least 1 centavo.
          thirteenthCents: fc.option(fc.integer({ min: 1, max: 150_000_00 }), { nil: undefined }),
          allowanceCents: fc.option(fc.integer({ min: 1, max: 5_000_000 }), { nil: undefined }),
        }),
        async (p) => {
          const w = await world('2026-12-01');
          const id = w.person('Pat Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: p.monthlyCents, isMwe: p.mwe }, { costCentre: 'office' });
          const zero = { benefitsCents: 0, deMinimisCents: 0, sssCents: 0, phicCents: 0, hdmfCents: 0, otherNontaxCents: 0, taxableCents: 0, wtaxCents: 0 };
          const add = (source: 'before' | 'previous', v: Partial<typeof zero>) => {
            const r = { ...zero, ...v };
            const grossCents = r.benefitsCents + r.sssCents + r.taxableCents;
            tx(w.db, () => addPrior(w.db, { employeeId: id, year: 2026, source, ...r, grossCents, ...(source === 'previous' ? { employerName: 'Made-up Previous Co.' } : {}) }, w.who()));
          };
          if (p.before) add('before', p.before);
          if (p.previous) add('previous', p.previous);
          w.at('2026-12-15');
          w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-01' });
          if (p.thirteenthCents !== undefined) {
            w.at('2026-12-20');
            w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026, amounts: [{ employeeId: id, amountCents: p.thirteenthCents, reason: 'Agreed amount (made up)' }] });
          }
          w.at('2026-12-31');
          const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart: '2026-12-16', yearEnd: true, ...(p.allowanceCents ? { lines: [{ employeeId: id, kind: 'allowance' as const, amountCents: p.allowanceCents, reason: 'Year-end allowance (made up)' }] } : {}) };
          const computed = w.preview(runDoc, input).doc as Run;
          const posted = w.record(runDoc, input);
          const stored = runDoc.load(w.db, posted.id);
          expect(stored).toEqual(computed);
          const e = stored.employees[0]!;
          const y = e.yearEnd!;
          const f = data2316(w.db, employee(w.db, id)!, 2026, false).figures;
          expect(y.refundCents === 0 || y.deficiencyCents === 0).toBe(true);
          expect(f.i24TaxDueCents).toBe(y.annualTaxCents);
          if (y.shortCents === 0) expect(f.i26WithheldCents).toBe(f.i24TaxDueCents);
          else {
            expect(f.i26WithheldCents).toBe(f.i24TaxDueCents - y.shortCents);
            expect(e.netCents).toBe(0);
            stats.short++;
          }
          if (y.refundCents) stats.refunds++;
          if (y.deficiencyCents) stats.deficiencies++;
          expect(e.wtaxCents).toBe(y.withheldCents);
          expect(e.wtaxRefundCents).toBe(y.refundCents);
          expect(f.i19GrossCents).toBe(f.i20NonTaxableCents + f.i21TaxableCents);
          expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
          await w.env.app.close();
        },
      ),
      { numRuns: 25, endOnFailure: true },
    );
    expect(stats.refunds + stats.deficiencies).toBeGreaterThan(0);
  });
});
