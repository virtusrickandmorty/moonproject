/**
 * K23 property test (PLAN I1.3): random December year-end adjustments (refunds and deficiencies) for three people, a
 * January payroll, and random withholding-tax remittances (full or partial, of December or January) and cancels. After
 * every step: a remittance stores what it computed, pays exactly its amount net of the refunds it takes off, and never
 * more than the month's net; the check's balance is the sum of the employees' payables; 2310 on the ledger equals the
 * months' balances; no year-end refund is ever called over-remitted. Once everything due is remitted in full, every
 * employee's 2310 for both months is zero. L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { addPrior } from '../../PAY/prior.ts';
import { world } from '../../PAY/tests/world.ts';
import { remittanceDoc } from '../doctypes/remittance.ts';
import { dueOf, payableByEmployee, schemeCheck, statMonths } from '../ledger.ts';

const MONTHS = ['2026-12', '2027-01'];

describe('K23: year-end refunds in the withholding-tax remittance, property test (PLAN I1.3)', () => {
  it('random refunds, remittances and cancels keep December and January net, in step with 2310, and zero once paid', async () => {
    const stats = { remittances: 0, carried: 0, cancels: 0 };
    await fc.assert(
      fc.asyncProperty(
        // Withheld before Moonproject: each person's December 2310 comes to 12,090.00 less it (a deficiency or a refund).
        // Anywhere from 0 to 25,000.00 each, or (half the time) December's refunds above its tax by 0.01 to 3,022.20, which
        // January's tax (1,007.40 each) covers.
        fc.oneof(
          fc.array(fc.integer({ min: 0, max: 2_500_000 }), { minLength: 3, maxLength: 3 }),
          fc.tuple(fc.integer({ min: -50_000, max: 150_000 }), fc.integer({ min: -50_000, max: 150_000 }), fc.integer({ min: 1, max: 302_220 })).map(([a, b, excess]) => [1_209_000 + a, 1_209_000 + b, 1_209_000 + excess - a - b]),
        ),
        fc.array(fc.oneof(fc.constant('remit' as const), fc.constant('remit' as const), fc.constant('cancel' as const)), { minLength: 2, maxLength: 8 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 1_000_000 })),
        async (withheldBefore, steps, dice) => {
          const w = await world('2026-12-01');
          const roll = () => dice.next().value as number;
          for (const [i, wtaxCents] of withheldBefore.entries()) {
            const id = w.person(`Pat${i} Opisina`, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, { costCentre: 'office' });
            tx(w.db, () =>
              addPrior(w.db, {
                employeeId: id, year: 2026, source: 'before', grossCents: 33_000_000, benefitsCents: 0, deMinimisCents: 0, sssCents: 1_650_000, phicCents: 825_000, hdmfCents: 220_000,
                otherNontaxCents: 0, taxableCents: 30_305_000, wtaxCents,
              }, w.who()),
            );
          }
          w.at('2026-12-15');
          w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-01' });
          w.at('2026-12-31');
          w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true });
          w.at('2027-01-15');
          w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2027-01-01' });
          w.at('2027-01-31');
          w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2027-01-16' });
          w.at('2027-02-10');
          const bdo = cashPlaceId(w.db, '1111');
          const ctx = () => ({ db: w.db, businessDate: today(w.env.clock), at: stamp(w.env.clock), userId: w.userId, can: () => true });

          const check = () => {
            let total = 0;
            for (const month of statMonths(w.db)) {
              const c = schemeCheck(w.db, 'WTAX', month);
              expect([...payableByEmployee(w.db, 'WTAX', month).values()].reduce((s, x) => s + x, 0), month).toBe(c.balanceCents);
              expect(c.overRemitted, month).toEqual([]); // only refunds and remittances here: nothing is ever over-remitted
              total += c.balanceCents;
            }
            const gl = w.db.prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = 'WTC_PAYABLE'`).pluck().get();
            expect(gl).toBe(total);
          };
          check();
          for (const step of steps) {
            if (step === 'remit') {
              const due = MONTHS.map((month) => ({ month, cents: dueOf(w.db, 'WTAX', month) })).filter((d) => d.cents > 0);
              if (!due.length) continue;
              const d = due[roll() % due.length]!;
              const amountCents = roll() % 2 ? d.cents : 1 + (roll() % d.cents);
              const input = { scheme: 'WTAX' as const, month: d.month, cashPlaceId: bdo, amountCents, reference: `eFPS ${roll()}` };
              const computed = remittanceDoc.compute(input, ctx());
              expect(computed.payableCents).toBe(d.cents);
              const p = w.record(remittanceDoc, input);
              stats.remittances++;
              if (computed.adjustments.some((a) => a.month !== d.month)) stats.carried++;
              expect(remittanceDoc.load(w.db, p.id)).toEqual(computed);
              expect(computed.lines.reduce((s, l) => s + l.amountCents, 0) + computed.adjustments.reduce((s, a) => s + a.debitCents - a.creditCents, 0)).toBe(amountCents);
              // One more centavo than the net is refused.
              expect(remittanceDoc.validate(remittanceDoc.compute({ ...input, amountCents: dueOf(w.db, 'WTAX', d.month) + 1 }, ctx()), ctx()).some((i) => i.level === 'error')).toBe(true);
            } else {
              const open = w.db.prepare(`SELECT id FROM documents WHERE doc_type = 'stat.remittance' AND status = 'posted' ORDER BY number`).pluck().all() as string[];
              if (!open.length) continue;
              try {
                w.cancel(remittanceDoc, open[roll() % open.length]!);
                stats.cancels++;
              } catch (e) {
                if (!(e instanceof AppError)) throw e;
              }
            }
            check();
          }
          // Pay whatever is still due, in full, oldest month first: both months end at zero for everyone.
          for (const month of MONTHS) {
            const cents = dueOf(w.db, 'WTAX', month);
            if (cents === 0) continue;
            const p = w.record(remittanceDoc, { scheme: 'WTAX', month, cashPlaceId: bdo, amountCents: cents, reference: `eFPS final ${month}` });
            if (remittanceDoc.load(w.db, p.id).adjustments.some((a) => a.month !== month)) stats.carried++;
          }
          const left = MONTHS.map((m) => dueOf(w.db, 'WTAX', m));
          const net = MONTHS.map((m) => schemeCheck(w.db, 'WTAX', m));
          // A December whose refunds are more than December's and January's tax together is still carried (nothing to pay).
          if (net[1]!.carriedInCents === 0 && net[0]!.carriedOutCents === 0) {
            for (const m of MONTHS) expect([...payableByEmployee(w.db, 'WTAX', m).values()].every((x) => x === 0), m).toBe(true);
          }
          expect(left).toEqual([0, 0]);
          check();
          expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
          await w.env.app.close();
        },
      ),
      { numRuns: 12, endOnFailure: true },
    );
    expect(stats.remittances).toBeGreaterThan(0);
    expect(stats.carried).toBeGreaterThan(0); // some December was taken off January's remittance
  });
});
