/**
 * A repayment applied to one cash advance (the owner's request, Nov 2026: "select the cash advance owed where to apply so
 * that in the next payroll it will not be deducted"). Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { codes, fails, world } from '../../PAY/tests/world.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { advanceDoc } from '../doctypes/advance.ts';
import { repaymentDoc } from '../doctypes/repayment.ts';
import { advanceSchedule } from '../public.ts';

const daily = { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true } as const;

async function shop() {
  const w = await world('2026-09-14');
  const ana = w.person('Ana Tahi', daily);
  const cash = cashPlaceId(w.db, '1101');
  const older = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 500_000, installmentCents: 50_000 }); // ₱5,000, ₱500 a payroll
  w.at('2026-09-15');
  const newer = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 }); // ₱2,000, ₱1,000 a payroll
  const repay = (amountCents: number, advanceId?: string) => ({ employeeId: ana, cashPlaceId: cash, amountCents, ...(advanceId ? { advanceId } : {}) });
  return { ...w, ana, cash, older, newer, repay };
}
const plan = (w: Awaited<ReturnType<typeof shop>>) => {
  const s = advanceSchedule(w.db, w.ana);
  return { owed: s.outstandingCents, perPayroll: s.installmentCents, open: s.open.map((a) => [a.number, a.openCents]) };
};

describe('a repayment applied to one cash advance', () => {
  it('pays that advance: paid in full, the next payroll no longer deducts its instalment', async () => {
    const w = await shop();
    expect(plan(w).perPayroll).toBe(150_000);
    const input = w.repay(200_000, w.newer.id);
    expect(w.preview(repaymentDoc, input).summary).toBe(`This will record ₱2,000.00 paid back by Ana Tahi for ${w.newer.number} into Cash on hand (main cash box), leaving ₱5,000.00 owed on cash advances.`);
    w.record(repaymentDoc, input);
    expect(plan(w)).toEqual({ owed: 500_000, perPayroll: 50_000, open: [[w.older.number, 500_000]] });
    expect(advanceSchedule(w.db, w.ana).settlements.map((s) => s.advanceNumber)).toEqual([w.newer.number]);
  });

  it('the payroll after it deducts only the other advance', async () => {
    const w = await shop();
    w.at('2026-10-01');
    w.attend(['16', '17', '18', '19', '21', '22', '23', '24', '25', '26'].map((d) => ({ employeeId: w.ana, date: `2026-09-${d}`, status: 'present' })));
    w.record(repaymentDoc, w.repay(200_000, w.newer.id)); // paid on 1 October, before the payroll of 30 September is made
    const run = w.recordOn(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' }, '2026-09-30');
    expect(runDoc.load(w.db, run.id).employees[0]!.caCents).toBe(50_000); // the ₱5,000 advance's ₱500, not ₱1,500
  });

  it('leaves the plan as before when applied to none (the oldest advance is paid first)', async () => {
    const w = await shop();
    w.record(repaymentDoc, w.repay(200_000));
    expect(plan(w)).toEqual({ owed: 500_000, perPayroll: 150_000, open: [[w.newer.number, 200_000], [w.older.number, 300_000]] });
  });

  it('paid in part, the advance keeps its instalment until the rest is deducted', async () => {
    const w = await shop();
    w.record(repaymentDoc, w.repay(150_000, w.newer.id));
    expect(plan(w)).toEqual({ owed: 550_000, perPayroll: 150_000, open: [[w.newer.number, 50_000], [w.older.number, 500_000]] });
  });

  it('is never more than what is left of that advance, and only an advance the employee still owes on', async () => {
    const w = await shop();
    expect(codes(w.preview(repaymentDoc, w.repay(250_000, w.newer.id)).issues)).toEqual(['MORE_THAN_ADVANCE']);
    const ben = w.person('Ben Cruz', daily);
    const bens = w.record(advanceDoc, { employeeId: ben, cashPlaceId: w.cash, amountCents: 10_000, installmentCents: 10_000 });
    expect(codes(w.preview(repaymentDoc, w.repay(10_000, bens.id)).issues)).toEqual(['ADVANCE_NOT_OPEN']);
    w.record(repaymentDoc, w.repay(200_000, w.newer.id));
    expect(codes(w.preview(repaymentDoc, w.repay(1_000, w.newer.id)).issues)).toEqual(['ADVANCE_NOT_OPEN']); // already paid
  });

  it('keeps the advance from being cancelled first; cancelled itself, the advance is deducted again', async () => {
    const w = await shop();
    const r = w.record(repaymentDoc, w.repay(200_000, w.newer.id));
    fails(() => w.cancel(advanceDoc, w.newer.id), 'HAS_DEPENDENTS');
    w.cancel(repaymentDoc, r.id);
    expect(plan(w).perPayroll).toBe(150_000);
    w.cancel(advanceDoc, w.newer.id);
    expect(plan(w)).toEqual({ owed: 500_000, perPayroll: 50_000, open: [[w.older.number, 500_000]] });
  });

  it('keeps the advance it was applied to when loaded and edited', async () => {
    const w = await shop();
    const r = w.record(repaymentDoc, w.repay(100_000, w.newer.id));
    const loaded = repaymentDoc.load(w.db, r.id);
    expect(repaymentDoc.toInput!(loaded)).toEqual(w.repay(100_000, w.newer.id));
    expect(loaded.advanceNumber).toBe(w.newer.number);
  });
});
