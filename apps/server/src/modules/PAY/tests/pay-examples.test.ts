/**
 * G-25: the payroll research examples A, B, C and C2 (docs/research/payroll-examples.md, a copy of payroll-ph-2026.md
 * §13–14.3) run through PAY to the centavo. Where PAY differs from an example, the difference is written here as a
 * DECISION, flagged for the accountant. Made-up people; the piece rates are the example's illustrative ones.
 * Then the F1 holiday rules beyond the examples, worked out by hand: night differential, and the day-before rule for
 * an unworked regular holiday; with property tests of both.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyRate } from '@moonproject/shared';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { tx } from '../../../platform/db/driver.ts';
import { advanceDoc } from '../../CA/doctypes/advance.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';
import { runDoc } from '../doctypes/run.ts';
import { holidaysBetween } from '../../EMP/public.ts';
import { addDays, periodEndOf, workOut, type RunEmployee, type RunRequest } from '../run-calc.ts';
import { figures as form2316, yearParts } from '../year-end.ts';
import { sssMonthly, sssRateAt } from '../statutory.ts';
import { codes, journal, partyBalance, world } from './world.ts';

/** One employee's run: [gross, SSS EE, ER, EC, PhilHealth EE, ER, Pag-IBIG EE, ER, tax, cash advance, net, 13th month]. */
const figures = (e: RunEmployee) => [
  e.grossCents, e.sssEeCents, e.sssErCents, e.sssEcCents, e.phicEeCents, e.phicErCents, e.hdmfEeCents, e.hdmfErCents, e.wtaxCents, e.caCents, e.netCents, e.thirteenthCents,
];
const only = (db: Db, runId: string) => runDoc.load(db, runId).employees[0]!;
const clean = (db: Db) => expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);

describe('Example A: daily-paid sewer at ₱550 (an MWE), semi-monthly, August 2026', () => {
  it('both cutoffs as in §13 and §14.3; the month’s payables equal the monthly contributions', async () => {
    const w = await world('2026-08-15');
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    const day = (d: string, status = 'present', otMinutes?: number) => ({ employeeId: ana, date: `2026-08-${d}`, status, ...(otMinutes ? { otMinutes } : {}) });

    // Cutoff 1: 13 scheduled days (Aug 1, 3–8, 10–15), 12 worked, one unpaid absence. Gross 12 × 550 = 6,600.00.
    w.attend([...['01', '03', '04', '05', '06', '07', '08', '10', '11', '13', '14', '15'].map((d) => day(d)), day('12', 'absent')]);
    const c1 = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-08-01' });
    expect(codes(c1.warnings, 'warning')).toEqual([]);
    expect(only(w.db, c1.id).lines.map((l) => [l.description, l.amountCents])).toEqual([['Days worked', 660_000]]);
    // SSS MSC 6,500 (325 / 650 / EC 10); PhilHealth on 550 × 313/12 = 14,345.83 (358.65 each); Pag-IBIG 2% (132 each);
    // an MWE pays no tax. Net 6,600 − 815.65 = 5,784.35; 13th month 6,600 / 12 = 550.00.
    expect(figures(only(w.db, c1.id))).toEqual([660_000, 32_500, 65_000, 1_000, 35_865, 35_865, 13_200, 13_200, 0, 0, 578_435, 55_000]);
    // §14.3 "Example A, cutoff 1": debits 8,300.65 = credits 8,300.65.
    expect(journal(w.env, c1.id)).toEqual(['2110 Cr 5,784.35', '2111 Cr 550.00', '2401 Cr 985.00', '2402 Cr 717.30', '2403 Cr 264.00', '5202 Dr 6,600.00', '5203 Dr 1,150.65', '5204 Dr 550.00']);

    // A cash advance given during cutoff 2, deducted ₱500 per payroll.
    w.at('2026-08-20');
    w.record(advanceDoc, { employeeId: ana, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 100_000, installmentCents: 50_000 });

    // Cutoff 2: worked Aug 17–22 and 24–29; Aug 21 is a special day, worked; Aug 31 a regular holiday, not worked; 2 h OT on Aug 26.
    w.at('2026-08-31');
    w.attend([
      ...['17', '18', '19', '20', '22', '24', '25', '27', '28', '29'].map((d) => day(d)),
      day('21', 'holiday_worked'), day('26', 'present', 120), day('31', 'holiday_off'),
    ]);
    const c2 = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-08-16' });
    expect(codes(c2.warnings, 'warning')).toEqual([]);
    // DECISION (presentation only): the example lists Aug 21's basic day as a line of its own (6,050.00 + 550.00); PAY
    // adds it to "Days worked" (12 days, 6,600.00). Same amounts, same 13th-month base; the 30% premium is its own line.
    expect(only(w.db, c2.id).lines.map((l) => [l.description, l.qty, l.amountCents])).toEqual([
      ['Days worked', 12_000, 660_000],
      ['Special day worked, premium (30%)', 1_000, 16_500],
      ['Overtime (125% of the hourly rate)', 120, 17_188], // 550 / 8 × 125% × 2 h = 171.875
      ['Regular holiday, not worked (100%)', 1_000, 55_000],
    ]);
    // Aug 31 is paid because Aug 29, the last workday before it, was worked (Aug 30 is Sunday, a rest day with nothing
    // typed): the day-before rule below.
    // Gross 7,486.88; month-to-date 14,086.88 → SSS MSC 14,000 (+375 / +750 / EC +0); PhilHealth already taken;
    // Pag-IBIG +68 each; CA 500. Net 7,486.88 − 375 − 68 − 500 = 6,543.88; 13th month (6,050 + 550) / 12 = 550.00.
    expect(figures(only(w.db, c2.id))).toEqual([748_688, 37_500, 75_000, 0, 0, 0, 6_800, 6_800, 0, 50_000, 654_388, 55_000]);
    // §14.3 "Example A, cutoff 2": debits 8,854.88 = credits 8,854.88.
    expect(journal(w.env, c2.id)).toEqual(['1210 Cr 500.00', '2110 Cr 6,543.88', '2111 Cr 550.00', '2401 Cr 1,125.00', '2403 Cr 136.00', '5202 Dr 7,486.88', '5203 Dr 818.00', '5204 Dr 550.00']);

    // To remit for August: SSS 2,110.00, PhilHealth 717.30, Pag-IBIG 400.00. Employer cost on top of gross 1,150.65 + 818.00 = 1,968.65.
    expect(['2401', '2402', '2403'].map((code) => -partyBalance(w.env, code, ana))).toEqual([211_000, 71_730, 40_000]);
    clean(w.db);
  });
});

describe('Example B: piece-rate sewer, weekly (Mon–Sat, paid Saturday), September 2026', () => {
  it('four weeks as in §13 and §14.3: holiday pay on Aug 31, the month-to-date true-up, tax in W2, the CA in W4', async () => {
    const w = await world('2026-08-22');
    const eli = w.person('Eli Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    const cs = seedCustomers(w.db, w.userId);
    const garments = ['Jersey (NBA cut)', 'Shorts', 'Polo'];
    const jo = w.record(jobOrderDoc, {
      customerId: cs.school, dueInDays: 60, priority: 'normal', paymentTerms: 'full',
      lines: garments.map((description) => ({ kind: 'made_to_order' as const, description, qty: 2_000, unitPriceCents: 30_000, discountCents: 0, roster: [] })),
    }).id;
    garments.forEach((garmentType, i) => tx(w.db, () => setupLine(w.db, jo, i + 1, { templateId: 1, stepIds: [4, 6, 8], garmentType, complexity: 'standard' }, w.who())));
    const [JERSEY, SHORTS, POLO] = [1, 2, 3] as const;
    const rate = { [JERSEY]: 2_800, [SHORTS]: 1_800, [POLO]: 4_500 }; // the example's illustrative rates: ₱28, ₱18, ₱45 a piece
    /** Sewing recorded on a day (a piece row is dated the day it is recorded). */
    const sew = (date: string, rows: [1 | 2 | 3, number][]) => {
      w.at(date);
      w.record(entryDoc, {
        jobOrderId: jo, stepId: 6, overCapReason: 'Cut earlier by the old shop (made up)',
        rows: rows.map(([lineNo, pieces]) => ({ lineNo, employeeId: eli, pieces, rateCents: rate[lineNo], rateReason: 'Illustrative rate of payroll Example B' })),
      });
    };
    const week = (start: string, end: string, attended?: string[]) => {
      w.at(end);
      if (attended) w.attend(attended.map((date) => ({ employeeId: eli, date, status: date === '2026-08-31' ? 'holiday_off' : 'present' })));
      return w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: start });
    };
    const days = (from: number, to: number, month = '09') => Array.from({ length: to - from + 1 }, (_, i) => `2026-${month}-${String(from + i).padStart(2, '0')}`);

    // The last 7 workdays before the Aug 31 holiday: Aug 22 and 24–29 earned 5,145.00 (21 polos, then 25 jerseys a day),
    // paid by August's weekly runs.
    sew('2026-08-22', [[POLO, 21]]);
    week('2026-08-17', '2026-08-22');
    for (const d of days(24, 29, '08')) sew(d, [[JERSEY, 25]]);
    week('2026-08-24', '2026-08-29');

    // W1 (Aug 31–Sep 5): jerseys 90 × 28 = 2,520; shorts 60 × 18 = 1,080; holiday pay for Aug 31 = 5,145 / 7 = 735.00 ≥ 550.
    sew('2026-09-01', [[JERSEY, 90]]);
    sew('2026-09-03', [[SHORTS, 60]]);
    const w1 = week('2026-08-31', '2026-09-05', ['2026-08-31', ...days(1, 5)]);
    expect(only(w.db, w1.id).lines.map((l) => [l.description, l.amountCents])).toEqual([
      ['Regular holiday, not worked (100% of average of the last 7 workdays)', 73_500],
      [expect.stringContaining('Sewing 2026-09-01, 90 pcs'), 252_000],
      [expect.stringContaining('Sewing 2026-09-03, 60 pcs'), 108_000],
    ]);
    // Gross 4,335.00, basic 3,600.00. SSS MSC 5,000 (250 / 500 / EC 10); PhilHealth on max(3,600; 14,345.83) (358.65 each);
    // Pag-IBIG 2% of 4,335 (86.70 each); taxable 4,335 − 695.35 = 3,639.65, below the weekly 4,808 (no tax).
    expect(figures(only(w.db, w1.id))).toEqual([433_500, 25_000, 50_000, 1_000, 35_865, 35_865, 8_670, 8_670, 0, 0, 363_965, 30_000]);
    expect([only(w.db, w1.id).phicBasisCents, only(w.db, w1.id).taxableCents]).toEqual([1_434_583, 363_965]);
    // DECISION (accountant): holiday pay of a piece worker is not tied to a job order, so it goes to 5202 with other
    // production pay, not 5201 (the example shows no W1 journal).
    expect(journal(w.env, w1.id)).toEqual(['2110 Cr 3,639.65', '2111 Cr 300.00', '2401 Cr 760.00', '2402 Cr 717.30', '2403 Cr 173.40', '5201 Dr 3,600.00', '5202 Dr 735.00', '5203 Dr 955.35', '5204 Dr 300.00']);

    // W2 (Sep 7–12): polo 70 × 45 = 3,150; jerseys 60 × 28 = 1,680; shorts 58 × 18 = 1,044. Gross 5,874.00.
    sew('2026-09-07', [[POLO, 70]]);
    sew('2026-09-09', [[JERSEY, 60], [SHORTS, 58]]);
    const w2 = week('2026-09-07', '2026-09-12', days(7, 12));
    // Month-to-date 10,209 → MSC 10,000 (+250 / +500 / EC +0); PhilHealth basis still 14,345.83 (0); Pag-IBIG to the ₱200
    // cap (+113.30 each); taxable 5,874 − 363.30 = 5,510.70 → 15% × (5,510.70 − 4,808) = 105.41. Net 5,405.29.
    expect(figures(only(w.db, w2.id))).toEqual([587_400, 25_000, 50_000, 0, 0, 0, 11_330, 11_330, 10_541, 0, 540_529, 48_950]);
    // §14.3 "Example B, W2" (debits 6,487.30 = credits 6,487.30) plus the 13th-month accrual 489.50 that it omits for brevity.
    expect(journal(w.env, w2.id)).toEqual(['2110 Cr 5,405.29', '2111 Cr 489.50', '2310 Cr 105.41', '2401 Cr 750.00', '2403 Cr 226.60', '5201 Dr 5,874.00', '5203 Dr 613.30', '5204 Dr 489.50']);
    // DECISION (accountant, the example's FLAG): a piece worker is not an MWE unless the pay profile says so, so W2
    // withholds 105.41 although the year's tax is ₱0; the year-end adjustment that refunds it by Jan 25 is not built yet.

    // W3 (Sep 14–19): jerseys 75 × 28 = 2,100; shorts 68 × 18 = 1,224. Gross 3,324.00, over 6 days = 554 a day ≥ 550: no warning.
    sew('2026-09-14', [[JERSEY, 75], [SHORTS, 68]]);
    const w3 = week('2026-09-14', '2026-09-19', days(14, 19));
    expect(codes(w3.warnings, 'warning')).toEqual([]);
    // Month-to-date 13,533 → MSC 13,500 (+175 / +350 / EC +0); PhilHealth and Pag-IBIG already taken; no tax. Net 3,149.00.
    expect(figures(only(w.db, w3.id))).toEqual([332_400, 17_500, 35_000, 0, 0, 0, 0, 0, 0, 0, 314_900, 27_700]);
    expect(journal(w.env, w3.id)).toEqual(['2110 Cr 3,149.00', '2111 Cr 277.00', '2401 Cr 525.00', '5201 Dr 3,324.00', '5203 Dr 350.00', '5204 Dr 277.00']);

    // W4 (Sep 21–26): polo 60 × 45 = 2,700; jerseys 50 × 28 = 1,400; shorts 47 × 18 = 846. Gross 4,946.00; a ₱1,000 CA instalment.
    w.at('2026-09-21');
    w.record(advanceDoc, { employeeId: eli, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 300_000, installmentCents: 100_000 });
    sew('2026-09-21', [[POLO, 60]]);
    sew('2026-09-22', [[JERSEY, 50], [SHORTS, 47]]);
    const w4 = week('2026-09-21', '2026-09-26', days(21, 26));
    // Month-to-date 18,479 → MSC 18,500 (+250 / +500 / EC +20); PhilHealth on the month's basic 17,744 → 443.60, +84.95;
    // taxable 4,946 − 334.95 = 4,611.05 (no tax). Net 4,946 − 250 − 84.95 − 1,000 = 3,611.05; 13th month 4,946 / 12 = 412.17.
    expect(figures(only(w.db, w4.id))).toEqual([494_600, 25_000, 50_000, 2_000, 8_495, 8_495, 0, 0, 0, 100_000, 361_105, 41_217]);
    // §14.3 "Example B, W4": debits 5,550.95 = credits 5,550.95, plus the 13th-month accrual 412.17.
    expect(journal(w.env, w4.id)).toEqual(['1210 Cr 1,000.00', '2110 Cr 3,611.05', '2111 Cr 412.17', '2401 Cr 770.00', '2402 Cr 169.90', '5201 Dr 4,946.00', '5203 Dr 604.95', '5204 Dr 412.17']);

    // September: SSS EE 925 / ER 1,850 / EC 30 (= SSS on 18,479 alone), PhilHealth 443.60 each (= 17,744 × 2.5%),
    // Pag-IBIG 200 each, tax 105.41.
    const sep = w.db
      .prepare(
        `SELECT SUM(e.sss_ee_cents), SUM(e.sss_er_cents), SUM(e.sss_ec_cents), SUM(e.phic_ee_cents), SUM(e.phic_er_cents), SUM(e.hdmf_ee_cents), SUM(e.hdmf_er_cents), SUM(e.wtax_cents)
         FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id WHERE r.contribution_month = '2026-09'`,
      )
      .raw()
      .get();
    expect(sep).toEqual([92_500, 185_000, 3_000, 44_360, 44_360, 20_000, 20_000, 10_541]);
    // DECISION (accountant): the PhilHealth basis of a piece worker is the month's piece pay but at least the minimum
    // wage's monthly equivalent (550 × 313/12), as the example does, once they earn any piece pay in the month. F1 only
    // names PhilHealth's own ₱10,000 floor; with that floor W1 would take 250.00 and W4 123.65 (the month still 443.60).
    // Piece holiday pay counts the last 7 days with piece work or attendance marked worked, in the 31 days before the
    // holiday; a piece worker's overtime and work on a holiday are still added by hand (ADD_BY_HAND).
    clean(w.db);
  });
});

describe('Example C: monthly office employee at ₱15,000, semi-monthly, September 2026', () => {
  it('both cutoffs as in §13 (cutoff 2 is G-24, with the 13th-month accrual)', async () => {
    const w = await world('2026-09-15');
    w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    const c1 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    // SSS on 7,500 (375 / 750 / EC 10); PhilHealth on 15,000 (375 each); Pag-IBIG 150 each; taxable 7,500 − 900 = 6,600 (no tax).
    expect(figures(only(w.db, c1.id))).toEqual([750_000, 37_500, 75_000, 1_000, 37_500, 37_500, 15_000, 15_000, 0, 0, 660_000, 62_500]);
    expect(only(w.db, c1.id).taxableCents).toBe(660_000);
    w.at('2026-09-30');
    const c2 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    // SSS to MSC 15,000 (+375 / +750 / EC +20); Pag-IBIG +50 each; taxable 7,500 − 425 = 7,075 (no tax). Net 7,075.00.
    expect(figures(only(w.db, c2.id))).toEqual([750_000, 37_500, 75_000, 2_000, 0, 0, 5_000, 5_000, 0, 0, 707_500, 62_500]);
    // §14.3 "Example C, cutoff 2" (debits 8,320.00 = credits 8,320.00) plus the ACC-18 accrual 625.00 (PLAN I2 G-24).
    expect(journal(w.env, c2.id)).toEqual(['2110 Cr 7,075.00', '2111 Cr 625.00', '2401 Cr 1,145.00', '2403 Cr 100.00', '6101 Dr 7,500.00', '6102 Dr 820.00', '6103 Dr 625.00']);
    clean(w.db);
  });

  it('an absence at the daily equivalent: 15,000 × 12 / 313 = 575.08 (6-day week) or / 261 = 689.66 (5-day week)', async () => {
    const w = await world('2026-09-15');
    const six = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    const five = w.person('Dan Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000, workweekDays: 5 }, { costCentre: 'office' });
    w.attend([six, five].map((employeeId) => ({ employeeId, date: '2026-09-02', status: 'absent' })));
    const run = w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' }).doc as { employees: RunEmployee[] };
    // DECISION (accountant): the factor follows each employee's workweek on the pay profile; the example calls it an accountant setting.
    expect(run.employees.map((e) => e.lines.find((l) => l.kind === 'absence')!.amountCents)).toEqual([-57_508, -68_966]);
  });
});

describe('Example C2: ₱35,000 a month, semi-monthly: the tax path (INCREMENTAL)', () => {
  it('cutoff 1 withholds 769.95 and cutoff 2 931.20: 1,701.15 for the month', async () => {
    const w = await world('2026-09-15');
    w.person('Dee Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_500_000 }, { costCentre: 'office' });
    const c1 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    // SSS on 17,500 (875 / 1,750 / EC 30); PhilHealth on 35,000 (875 each); Pag-IBIG on the ₱10,000 cap (200 each);
    // taxable 17,500 − 1,950 = 15,550 → 15% × (15,550 − 10,417) = 769.95. Net 14,780.05; 13th month 17,500 / 12 = 1,458.33.
    expect(figures(only(w.db, c1.id))).toEqual([1_750_000, 87_500, 175_000, 3_000, 87_500, 87_500, 20_000, 20_000, 76_995, 0, 1_478_005, 145_833]);
    expect(only(w.db, c1.id).taxableCents).toBe(1_555_000);
    expect(journal(w.env, c1.id)).toEqual(['2110 Cr 14,780.05', '2111 Cr 1,458.33', '2310 Cr 769.95', '2401 Cr 2,655.00', '2402 Cr 1,750.00', '2403 Cr 400.00', '6101 Dr 17,500.00', '6102 Dr 2,855.00', '6103 Dr 1,458.33']);

    w.at('2026-09-30');
    const c2 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    // SSS to MSC 35,000 (+875 / +1,750 / EC +0); taxable 17,500 − 875 = 16,625 → 15% × 6,208 = 931.20. Net 15,693.80.
    expect(figures(only(w.db, c2.id))).toEqual([1_750_000, 87_500, 175_000, 0, 0, 0, 0, 0, 93_120, 0, 1_569_380, 145_833]);
    expect(only(w.db, c2.id).taxableCents).toBe(1_662_500);
    expect(journal(w.env, c2.id)).toEqual(['2110 Cr 15,693.80', '2111 Cr 1,458.33', '2310 Cr 931.20', '2401 Cr 2,625.00', '6101 Dr 17,500.00', '6102 Dr 1,750.00', '6103 Dr 1,458.33']);

    // The month's SSS: MSC 35,000, of which 15,000 is MPF; EE 1,750 = regular 1,000 + MPF 750; ER 3,500 + EC 30.
    const sss = sssMonthly(sssRateAt(w.db, '2026-09-01'), 3_500_000);
    expect([sss.mscCents, sss.mpfMscCents, sss.ee, applyRate(sss.mscCents - sss.mpfMscCents, 500), sss.er, sss.ec]).toEqual([3_500_000, 1_500_000, 175_000, 100_000, 350_000, 3_000]);
    expect(only(w.db, c1.id).wtaxCents + only(w.db, c2.id).wtaxCents).toBe(170_115);
    // DECISION (accountant): runs withhold per cutoff on the semi-monthly table (INCREMENTAL, ACC-21), 1,701.15 for the
    // month. The monthly-table check (1,701.30) and the annual one (1,701.25 a month, ₱1.20 more by December) belong to
    // the year-end adjustment, which is not built yet; LAST_RUN_ONLY is not built.
    clean(w.db);
  });
});

describe('night differential (F1): 10% of the hourly rate for work between 10 PM and 6 AM, of the day’s rate', () => {
  it('₱1,000/day, not an MWE, 16–31 August: ordinary days, a special day and a regular holiday; an MWE’s is exempt', async () => {
    const w = await world('2026-08-31');
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    const ben = w.person('Ben Gabi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 100_000 });
    const day = (d: string, status = 'present', more: { otMinutes?: number; nightMinutes?: number } = {}) => ({ employeeId: ben, date: `2026-08-${d}`, status, ...more });
    w.attend([
      day('17', 'present', { nightMinutes: 480 }), day('18', 'present', { otMinutes: 120, nightMinutes: 180 }), ...['19', '20', '22', '24', '25', '26', '27', '28', '29'].map((d) => day(d)),
      day('21', 'holiday_worked', { nightMinutes: 120 }), day('31', 'holiday_worked', { nightMinutes: 240 }),
      { employeeId: ana, date: '2026-08-17', status: 'present', nightMinutes: 480 }, ...['18', '19', '20', '22'].map((d) => ({ employeeId: ana, date: `2026-08-${d}`, status: 'present' })),
    ]);
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-08-16' });
    expect(codes(run.warnings, 'warning')).toEqual([]);
    const [a, b] = runDoc.load(w.db, run.id).employees;
    // Ben's hourly rate is 1,000 / 8 = 125.00.
    //   Aug 17 and 18, ordinary days: 8 h + 3 h = 11 h at 10% × 125 = 12.50 an hour → 137.50 (660 minutes).
    //   Aug 18 overtime: 2 h at 125% × 125 = 312.50; its night hours are paid at the day's 10% (see the PR's list).
    //   Aug 21, special day worked (130%): 2 h at 10% × 130% = 13% × 125 = 16.25 an hour → 32.50; premium 30% = 300.00.
    //   Aug 31, regular holiday worked (200%): 4 h at 10% × 200% = 20% × 125 = 25.00 an hour → 100.00; premium 100% = 1,000.00.
    //   Days worked: 13 × 1,000 = 13,000.00 (Aug 17–22, 24–29, 31). Gross 14,882.50.
    expect(b!.lines.map((l) => [l.kind, l.description, l.qty, l.amountCents])).toEqual([
      ['basic', 'Days worked', 13_000, 1_300_000],
      ['night', 'Night differential (10% of the hourly rate)', 660, 13_750],
      ['ot', 'Overtime (125% of the hourly rate)', 120, 31_250],
      ['holiday', 'Special day worked, premium (30%)', 1_000, 30_000],
      ['night', 'Night differential (13% of the hourly rate)', 120, 3_250],
      ['holiday', 'Regular holiday worked, premium (100%)', 1_000, 100_000],
      ['night', 'Night differential (20% of the hourly rate)', 240, 10_000],
    ]);
    expect([b!.grossCents, b!.lines.filter((l) => l.kind === 'night').every((l) => l.taxable && !l.thirteenthBase)]).toEqual([1_488_250, true]);
    // Stored as 'ot' lines (0001's kinds) marked in pay_run_night_diff (0006), and loaded back as night differential.
    expect(w.db.prepare(`SELECT l.kind, COUNT(*) FROM pay_run_night_diff n JOIN pay_run_lines l ON l.id = n.run_line_id GROUP BY l.kind`).raw().all()).toEqual([['ot', 4]]);

    // Ana, ₱550 an MWE, 5 days (2,750.00) with 8 h at night on Aug 17: 10% × 550 / 8 × 8 = 55.00, tax-exempt (RR 11-2018)
    // like her minimum wage; on the 2316 it is item 32.
    expect(a!.lines.map((l) => [l.description, l.amountCents, l.taxable])).toEqual([['Days worked', 275_000, false], ['Night differential (10% of the hourly rate)', 5_500, false]]);
    expect([a!.grossCents, a!.taxableCents]).toEqual([280_500, 0]);
    const f = form2316(yearParts(w.db, ana, 2026), true);
    expect([f.i29BasicSmwCents, f.i32NightMweCents, f.i38NonTaxableCents - f.i36SharesCents]).toEqual([275_000, 5_500, 280_500]);
    clean(w.db);
  });
});

describe('the day before an unworked regular holiday (F1, DOLE): present or on paid leave on the last workday', () => {
  it('₱600/day, 1–15 April 2026: Maundy Thursday and Good Friday in a row, Black Saturday (special), Araw ng Kagitingan', async () => {
    const w = await world('2026-04-15');
    const pay = { payType: 'daily' as const, payGroup: 'SEMI_DAILY' as const, dailyRateCents: 60_000 };
    const cy = w.person('Cy Una', pay);
    const di = w.person('Di Liban', pay);
    const ed = w.person('Ed Pasok', pay);
    const fe = w.person('Fe Lima', { ...pay, workweekDays: 5 });
    const days = (employeeId: string, marks: Record<string, string>) => Object.entries(marks).map(([d, status]) => ({ employeeId, date: `2026-04-${d}`, status }));
    const worked = Object.fromEntries(['06', '07', '10', '11', '13', '14', '15'].map((d) => [d, 'present']));
    w.attend([
      ...days(cy, { '01': 'present', '02': 'holiday_off', '03': 'holiday_off', '04': 'holiday_off', ...worked, '08': 'present', '09': 'holiday_off' }),
      ...days(di, { '01': 'absent', '02': 'holiday_off', '03': 'holiday_off', ...worked, '08': 'leave', '09': 'holiday_off' }),
      ...days(ed, { '01': 'absent', '02': 'holiday_worked', '03': 'holiday_off', ...worked, '08': 'unpaid_leave', '09': 'holiday_off' }),
      ...days(fe, { '01': 'present', '02': 'holiday_off', '03': 'holiday_off', '06': 'present', '07': 'present', '09': 'holiday_off' }),
    ]);
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-04-01' });
    const [c, d, e, f] = runDoc.load(w.db, run.id).employees;
    const lines = (x: RunEmployee | undefined) => x!.lines.map((l) => [l.description, l.qty, l.amountCents]);
    // Cy worked Wed Apr 1: Apr 2 is paid, and Apr 3 too (going back past Apr 2, a holiday off, to Apr 1). Apr 4 is a
    // special day: no work, no pay. Apr 9 is paid (Apr 8 worked). 9 days × 600 = 5,400 + 3 holidays × 600 = 1,800 → 7,200.
    expect(lines(c)).toEqual([['Days worked', 9_000, 540_000], ['Regular holiday, not worked (100%)', 3_000, 180_000]]);
    // Di was absent Apr 1: neither Apr 2 nor Apr 3 is paid (two holidays in a row go by the workday before the first),
    // each a ₱0 line with the reason. Apr 8 on paid leave (SIL): Apr 9 is paid. 7 days 4,200 + SIL 600 + Apr 9 600 → 5,400.
    const absent = 'not paid: absent on 2026-04-01, the last workday before it';
    expect(lines(d)).toEqual([
      [`Regular holiday 2026-04-02 (Maundy Thursday), ${absent}`, 1_000, 0], [`Regular holiday 2026-04-03 (Good Friday), ${absent}`, 1_000, 0],
      ['Days worked', 7_000, 420_000], ['Paid leave (SIL)', 1_000, 60_000], ['Regular holiday, not worked (100%)', 1_000, 60_000],
    ]);
    // Ed was absent Apr 1 but worked Apr 2 (200%: a day of basic pay + the 100% premium), so Apr 3 is paid. Unpaid leave on
    // Apr 8: Apr 9 is not. 8 days 4,800 + premium 600 + Apr 3 600 → 6,000.
    expect(lines(e)).toEqual([
      ['Days worked', 8_000, 480_000], ['Regular holiday worked, premium (100%)', 1_000, 60_000], ['Regular holiday, not worked (100%)', 1_000, 60_000],
      ['Regular holiday 2026-04-09 (Araw ng Kagitingan), not paid: on unpaid leave on 2026-04-08, the last workday before it', 1_000, 0],
    ]);
    // Fe (5-day week) has nothing typed on Wed Apr 8, a workday: Apr 9 is not paid until it is typed. 3 days 1,800 + 2 × 600 → 3,000.
    expect(lines(f)).toEqual([
      ['Days worked', 3_000, 180_000], ['Regular holiday, not worked (100%)', 2_000, 120_000],
      ['Regular holiday 2026-04-09 (Araw ng Kagitingan), not paid: nothing is typed on 2026-04-08, the last workday before it (type that day, then work the payroll out again)', 1_000, 0],
    ]);
    expect([c, d, e, f].map((x) => x!.grossCents)).toEqual([720_000, 540_000, 600_000, 300_000]);
    expect(codes(run.warnings, 'warning')).toEqual(['HOLIDAY_NOT_PAID', 'HOLIDAY_NOT_PAID', 'HOLIDAY_NOT_PAID', 'HOLIDAY_NOT_PAID']);
    expect(run.warnings.find((i) => i.code === 'HOLIDAY_NOT_PAID')!.message).toBe(`Di Liban: Maundy Thursday (2026-04-02) is not paid, ${absent.slice('not paid: '.length)}.`);
    clean(w.db);
  });
});

describe('property: night minutes and the day before a holiday (PLAN I1.3)', () => {
  const REGULAR = ['2026-01-01', '2026-03-20', '2026-04-02', '2026-04-03', '2026-04-09', '2026-05-01', '2026-05-27', '2026-06-12', '2026-08-31', '2026-11-30', '2026-12-25', '2026-12-30'];
  const request = (payGroup: RunRequest['payGroup'], periodStart: string): RunRequest => {
    const periodEnd = periodEndOf(payGroup, periodStart)!;
    return { payGroup, periodStart, periodEnd, payDate: periodEnd, manual: [], caOverrides: new Map(), skipped: new Set() };
  };
  const one = (db: Db, q: RunRequest) => workOut(db, q).employees[0]!;
  const withoutNight = (e: RunEmployee) => e.lines.filter((l) => l.kind !== 'night').map(({ lineNo: _, ...l }) => l);

  it('pay never goes down when night minutes are added, and only night differential lines change', async () => {
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const w = await world('2026-09-30');
        const payType = g(() => fc.constantFrom('daily', 'mixed', 'monthly', 'piece') as fc.Arbitrary<'daily' | 'mixed' | 'monthly' | 'piece'>);
        const payGroup = payType === 'monthly' ? 'SEMI_MONTHLY' : 'SEMI_DAILY';
        const rate = payType === 'monthly' ? { monthlyRateCents: g(() => fc.integer({ min: 1_000_000, max: 8_000_000 })) } : payType === 'piece' ? {} : { dailyRateCents: g(() => fc.integer({ min: 55_000, max: 250_000 })) };
        const isMwe = g(() => fc.boolean());
        const id = w.person('Gi Gabi', { payType, payGroup, ...rate, isMwe, workweekDays: g(() => fc.constantFrom(5 as const, 6 as const)) });
        const q = request(payGroup, '2026-08-16'); // Aug 21 special, Aug 31 regular
        const holidays = new Set(holidaysBetween(w.db, q.periodStart, q.periodEnd).map((h) => h.date));
        const days = Array.from({ length: 16 }, (_, i) => addDays(q.periodStart, i)).map((date) => {
          const status = g(() => fc.constantFrom(...(holidays.has(date) ? ['holiday_off', 'holiday_worked', 'rest_day', 'rest_day_worked'] : ['present', 'present', 'half_day', 'absent', 'rest_day', 'unpaid_leave', 'rest_day_worked'])));
          const otMinutes = ['present', 'holiday_worked', 'rest_day_worked'].includes(status) ? g(() => fc.constantFrom(0, 60, 150)) : 0;
          return { employeeId: id, date, status, ...(otMinutes ? { otMinutes } : {}) };
        });
        w.attend(days);
        const before = one(w.db, q);
        const night = days.filter((d) => ['present', 'half_day', 'holiday_worked', 'rest_day_worked'].includes(d.status)).map((d) => ({ ...d, nightMinutes: g(() => fc.integer({ min: 0, max: 480 })) }));
        if (night.length) w.attend(night);
        const after = one(w.db, q);
        expect(withoutNight(after)).toEqual(withoutNight(before));
        expect(after.grossCents).toBeGreaterThanOrEqual(before.grossCents);
        const minutes = night.reduce((s, d) => s + d.nightMinutes, 0);
        // Paid per piece: night differential is added by hand (no hourly rate), so the pay stays as it was.
        if (payType !== 'piece' && minutes > 0) expect(after.grossCents).toBeGreaterThan(before.grossCents);
        if (isMwe) expect(after.taxableCents).toBe(before.taxableCents); // exempt for a minimum wage earner
        await w.env.app.close();
      }),
      { numRuns: 25 },
    );
  });

  it('an unworked regular holiday after an absence (past rest days) pays nothing; after a day worked it pays a day', async () => {
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const holiday = g(() => fc.constantFrom(...REGULAR));
        const gap = g(() => fc.integer({ min: 0, max: 3 })); // rest days typed between the last workday and the holiday
        const last = addDays(holiday, -gap - 1);
        const w = await world('2026-12-31');
        if (holidaysBetween(w.db, last, last).length) {
          await w.env.app.close();
          fc.pre(false); // the last workday cannot be a holiday for this test (absence is not a holiday status)
        }
        const payType = g(() => fc.constantFrom('daily', 'mixed', 'piece') as fc.Arbitrary<'daily' | 'mixed' | 'piece'>);
        const dailyRateCents = g(() => fc.integer({ min: 55_000, max: 250_000 }));
        const id = w.person('Hu Liban', { payType, payGroup: 'SEMI_DAILY', ...(payType === 'piece' ? {} : { dailyRateCents }), workweekDays: g(() => fc.constantFrom(5 as const, 6 as const)) });
        const mark = (date: string, status: string) => w.attend([{ employeeId: id, date, status }]);
        const why = g(() => fc.constantFrom('absent', 'unpaid_leave'));
        w.attend([{ employeeId: id, date: last, status: why }, ...Array.from({ length: gap }, (_, i) => ({ employeeId: id, date: addDays(last, i + 1), status: 'rest_day' })), { employeeId: id, date: holiday, status: 'holiday_off' }]);
        const q = request('SEMI_DAILY', `${holiday.slice(0, 8)}${holiday.slice(8) <= '15' ? '01' : '16'}`);
        const off = workOut(w.db, q);
        const line = off.employees[0]!.lines.find((l) => l.description.startsWith(`Regular holiday ${holiday} (`))!;
        expect([line.amountCents, line.description.includes(why === 'absent' ? `absent on ${last}` : `on unpaid leave on ${last}`)]).toEqual([0, true]);
        expect(off.notes.map((n) => n.code)).toContain('HOLIDAY_NOT_PAID');
        mark(holiday, 'rest_day');
        expect(off.employees[0]!.grossCents).toBe(one(w.db, q).grossCents); // the same as not a holiday at all
        // The contrast: worked on the last workday, the holiday pays a day (a piece worker with no piece work: the minimum wage).
        mark(last, 'present');
        const restDay = one(w.db, q).grossCents;
        mark(holiday, 'holiday_off');
        expect(one(w.db, q).grossCents - restDay).toBe(payType === 'piece' ? 55_000 : dailyRateCents);
        await w.env.app.close();
      }),
      { numRuns: 30 },
    );
  });
});
