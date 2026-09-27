/** F1 calculators against the plan's figures (PLAN I1.1 "statutory calculators"), on the seeded tables. */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { hdmfMonthly, hdmfRateAt, phicDailyBasis, phicMonthly, phicRateAt, sssMonthly, sssRateAt, withholding, wtaxTableAt } from '../statutory.ts';
import { periodEndOf } from '../run-calc.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
const P = (pesos: number) => Math.round(pesos * 100);

describe('SSS (Circular 2024-006)', () => {
  it('MSC from ₱5,000 to ₱35,000 in ₱500 steps; EE 5%, ER 10%; EC ₱10 up to ₱14,500, else ₱30', () => {
    const r = sssRateAt(env.db, '2026-09-01');
    const at = (comp: number) => {
      const s = sssMonthly(r, P(comp));
      return [s.mscCents / 100, s.ee / 100, s.er / 100, s.ec / 100];
    };
    expect(at(15_000)).toEqual([15_000, 750, 1_500, 30]);
    expect(at(7_500)).toEqual([7_500, 375, 750, 10]);
    expect(at(1_200)).toEqual([5_000, 250, 500, 10]);
    expect([at(5_249.99)[0], at(5_250)[0], at(14_749.99), at(14_750)[3]]).toEqual([5_000, 5_500, [14_500, 725, 1_450, 10], 30]);
    expect(at(34_749.99)[0]).toBe(34_500);
    expect(at(80_000)).toEqual([35_000, 1_750, 3_500, 30]); // max ER + EC ₱3,530, EE ₱1,750
    expect(sssMonthly(r, P(35_000)).mpfMscCents).toBe(P(15_000)); // the part above ₱20,000 is MPF
    expect(at(0)).toEqual([0, 0, 0, 0]);
  });
});

describe('PhilHealth (5%, floor ₱10,000, ceiling ₱100,000)', () => {
  it('split equally; a daily rate counts × 313/12 (6-day week) or × 261/12', () => {
    const r = phicRateAt(env.db, '2026-09-01');
    expect(phicMonthly(r, P(15_000))).toEqual({ basisCents: P(15_000), ee: P(375), er: P(375) });
    expect(phicMonthly(r, P(1_200))).toEqual({ basisCents: P(10_000), ee: P(250), er: P(250) });
    expect(phicMonthly(r, P(150_000))).toEqual({ basisCents: P(100_000), ee: P(2_500), er: P(2_500) });
    expect(phicDailyBasis(r, P(550), 6)).toBe(1_434_583); // ₱14,345.83
    expect(phicMonthly(r, phicDailyBasis(r, P(550), 6)).ee).toBe(35_865); // ₱358.65
    expect(phicDailyBasis(r, P(1_000), 5)).toBe(P(21_750));
  });
});

describe('Pag-IBIG (Circular 460)', () => {
  it('EE 2% (1% up to ₱1,500), ER 2%, on up to ₱10,000', () => {
    const r = hdmfRateAt(env.db, '2026-09-01');
    expect(hdmfMonthly(r, P(1_500))).toEqual({ ee: P(15), er: P(30) });
    expect(hdmfMonthly(r, P(1_500.01))).toEqual({ ee: P(30), er: P(30) });
    expect(hdmfMonthly(r, P(7_500))).toEqual({ ee: P(150), er: P(150) });
    expect(hdmfMonthly(r, P(15_000))).toEqual({ ee: P(200), er: P(200) });
  });
});

describe('withholding tax (RR 11-2018 Annex E)', () => {
  it('weekly, semi-monthly and monthly tables', () => {
    const tax = (f: 'weekly' | 'semi_monthly' | 'monthly', pesos: number) => withholding(wtaxTableAt(env.db, f, '2026-09-30'), P(pesos)) / 100;
    expect([tax('semi_monthly', 10_417), tax('semi_monthly', 16_667), tax('semi_monthly', 20_000), tax('semi_monthly', 12_734.17)]).toEqual([0, 937.5, 1_604.1, 347.58]);
    expect([tax('monthly', 20_833), tax('monthly', 25_000), tax('monthly', 33_333), tax('monthly', 66_667), tax('monthly', 700_000)]).toEqual([0, 625.05, 1_875, 8_541.8, 195_208.35]);
    expect([tax('weekly', 4_808), tax('weekly', 5_000), tax('weekly', 7_692), tax('weekly', 40_000)]).toEqual([0, 28.8, 432.6, 8_201.85]);
    expect(tax('semi_monthly', 0)).toBe(0);
  });
});

describe('pay periods (F2)', () => {
  it('weekly Monday to Saturday; semi-monthly 1–15 and 16 to the end of the month', () => {
    expect(periodEndOf('WEEKLY_PIECE', '2026-09-21')).toBe('2026-09-26');
    expect(periodEndOf('WEEKLY_PIECE', '2026-09-22')).toBeUndefined();
    expect(periodEndOf('SEMI_DAILY', '2026-09-01')).toBe('2026-09-15');
    expect([periodEndOf('SEMI_MONTHLY', '2026-09-16'), periodEndOf('SEMI_MONTHLY', '2026-02-16'), periodEndOf('SEMI_MONTHLY', '2028-02-16'), periodEndOf('SEMI_MONTHLY', '2026-12-16')]).toEqual([
      '2026-09-30', '2026-02-28', '2028-02-29', '2026-12-31',
    ]);
    expect(periodEndOf('SEMI_DAILY', '2026-09-05')).toBeUndefined();
  });
});
