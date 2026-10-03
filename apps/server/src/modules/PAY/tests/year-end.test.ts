/**
 * Year-end tax adjustment (PLAN F3, BIR RR 11-2018, RMC 21-2010), pay before Virtus and the 2316 / 1604-C data
 * (F4): goldens to the centavo (over-withheld: refund; under-withheld: deficiency within net pay; net pay too small; a
 * weekly piece worker whose weekly tax is all refunded; an MWE with overtime; pay before Virtus and a previous
 * employer; 13th-month pay above ₱90,000), the refusals (not December; a second adjustment while the first stands; the
 * run cancelled and done again), and the API. Every figure is worked out by hand. Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { tx } from '../../../platform/db/driver.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';
import { payOfMonth } from '../public.ts';
import { employee } from '../../EMP/public.ts';
import { runDoc } from '../doctypes/run.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { thirteenthDoc } from '../doctypes/thirteenth.ts';
import { addPrior, updatePrior } from '../prior.ts';
import type { RunEmployee } from '../run-calc.ts';
import { data2316 } from '../year-end.ts';
import { codes, fails, journal, partyBalance, world } from './world.ts';

type World = Awaited<ReturnType<typeof world>>;
const office = { costCentre: 'office' as const };
const clean = (db: Db) => expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
const only = (db: Db, runId: string, employeeId: string) => runDoc.load(db, runId).employees.find((e) => e.employeeId === employeeId)!;
/** [gross, EE shares, tax withheld, refund, net] of one employee on a run. */
const pay = (e: RunEmployee) => [e.grossCents, e.sssEeCents + e.phicEeCents + e.hdmfEeCents, e.wtaxCents, e.wtaxRefundCents, e.netCents];
const zero = { benefitsCents: 0, deMinimisCents: 0, sssCents: 0, phicCents: 0, hdmfCents: 0, otherNontaxCents: 0, taxableCents: 0, wtaxCents: 0 };
/** Pay before Virtus for 2026 (source 'before' unless given), recorded as the accountant would. */
function prior(w: World, employeeId: string, p: Partial<typeof zero> & { source?: 'before' | 'previous'; employerName?: string }) {
  const v = { ...zero, ...p };
  const grossCents = v.benefitsCents + v.deMinimisCents + v.sssCents + v.phicCents + v.hdmfCents + v.otherNontaxCents + v.taxableCents;
  return tx(w.db, () => addPrior(w.db, { employeeId, year: 2026, source: 'before', ...v, grossCents }, w.who()));
}
/** The December runs of a semi-monthly group: 1–15 as usual, 16–31 with the year-end adjustment (dated its last day). */
function december(w: World, payGroup: 'SEMI_MONTHLY') {
  w.at('2026-12-15');
  const first = w.record(runDoc, { payGroup, periodStart: '2026-12-01' });
  w.at('2026-12-31');
  const input = { payGroup, periodStart: '2026-12-16', yearEnd: true };
  const preview = w.preview(runDoc, input);
  return { first, preview, last: w.record(runDoc, input) };
}
// A ₱30,000 a month office employee in December: 1–15 gross 15,000.00, SSS 750 (MSC 15,000), PhilHealth 750 (all of
// the month's, on the monthly rate), Pag-IBIG 200 → taxable 13,300.00 → semi-monthly table 15% over 10,417 = 432.45.
// 16–31: SSS 1,500 − 750 = 750 more (MSC 30,000), nothing more for PhilHealth or Pag-IBIG. December taxable
// 13,300.00 + 14,250.00 = 27,550.00. Jan–Nov before Virtus: 11 × 30,000 = 330,000.00 gross, shares 11 × 2,450.00,
// taxable 303,050.00. Year: 330,600.00 taxable → 15% of 80,600.00 = 12,090.00 tax due.
const JAN_NOV = { sssCents: 1_650_000, phicCents: 825_000, hdmfCents: 220_000, taxableCents: 30_305_000 };

describe('year-end adjustment goldens', () => {
  it('over-withheld: the excess is refunded on the last run (Dr 2310 / Cr 2110), released with net pay, and less to remit', async () => {
    const w = await world('2026-12-01');
    const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
    prior(w, olga, { ...JAN_NOV, wtaxCents: 4_000_000 }); // ₱40,000 withheld by the old payroll
    const { first, preview, last } = december(w, 'SEMI_MONTHLY');
    expect(pay(only(w.db, first.id, olga))).toEqual([1_500_000, 170_000, 43_245, 0, 1_286_755]);
    // Withheld before: 40,000 + 432.45 = 40,432.45; tax due 12,090.00 → refund 28,342.45. Net 15,000 − 750 + 28,342.45.
    const e = only(w.db, last.id, olga);
    expect(pay(e)).toEqual([1_500_000, 75_000, 0, 2_834_245, 4_259_245]);
    expect(e.yearEnd).toEqual({ year: 2026, taxableCents: 33_060_000, benefitsTaxableCents: 0, annualTaxCents: 1_209_000, withheldBeforeCents: 4_043_245, deficiencyCents: 0, withheldCents: 0, shortCents: 0, refundCents: 2_834_245 });
    expect(preview.summary).toContain('refunding ₱28,342.45');
    // Debits 15,000 + ER 1,500 + 13th 1,250 + refund 28,342.45 = 46,092.45 = credits 2,250 + 1,250 + 42,592.45.
    expect(journal(w.env, last.id)).toEqual(['2110 Cr 42,592.45', '2111 Cr 1,250.00', '2310 Dr 28,342.45', '2401 Cr 2,250.00', '6101 Dr 15,000.00', '6102 Dr 1,500.00', '6103 Dr 1,250.00']);
    // December's 2310 for Olga: 432.45 withheld − 28,342.45 refunded; the 1601-C worksheet's figure is net of it too.
    expect(-partyBalance(w.env, '2310', olga)).toBe(43_245 - 2_834_245);
    expect(payOfMonth(w.db, '2026-12').find((p) => p.employeeId === olga)).toMatchObject({ wtaxCents: 43_245 - 2_834_245, wtaxRefundCents: 2_834_245 });
    // The release pays net pay with the refund.
    w.at('2027-01-02');
    const rel = w.record(releaseDoc, { runId: last.id, employeeIds: [olga], tenders: [{ cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 4_259_245 }] });
    expect(journal(w.env, rel.id)).toEqual(['1101 Cr 42,592.45', '2110 Dr 42,592.45']);
    // The 2316: tax due = tax withheld as adjusted; one employer all year, so substituted filing.
    const d = data2316(w.db, employee(w.db, olga)!, 2026, false);
    expect(d.figures).toMatchObject({ i19GrossCents: 36_000_000, i36SharesCents: 2_940_000, i21TaxableCents: 33_060_000, i24TaxDueCents: 1_209_000, i26WithheldCents: 1_209_000, withheldJanNovCents: 4_000_000, withheldDecemberCents: 43_245, refundedCents: 2_834_245 });
    expect([d.substitutedFiling, d.yearEnd?.number]).toEqual([true, last.number]);
    clean(w.db);
  });

  it('under-withheld: the deficiency is withheld on the last run (Cr 2310), within net pay', async () => {
    const w = await world('2026-12-01');
    const uri = w.person('Uri Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
    prior(w, uri, { ...JAN_NOV, wtaxCents: 500_000 });
    const { last } = december(w, 'SEMI_MONTHLY');
    // Withheld before 5,000 + 432.45 = 5,432.45; due 12,090.00 → 6,657.55 withheld; net 15,000 − 750 − 6,657.55.
    const e = only(w.db, last.id, uri);
    expect(pay(e)).toEqual([1_500_000, 75_000, 665_755, 0, 759_245]);
    expect(e.yearEnd).toMatchObject({ annualTaxCents: 1_209_000, withheldBeforeCents: 543_245, deficiencyCents: 665_755, withheldCents: 665_755, shortCents: 0, refundCents: 0 });
    expect(journal(w.env, last.id)).toEqual(['2110 Cr 7,592.45', '2111 Cr 1,250.00', '2310 Cr 6,657.55', '2401 Cr 2,250.00', '6101 Dr 15,000.00', '6102 Dr 1,500.00', '6103 Dr 1,250.00']);
    expect(data2316(w.db, employee(w.db, uri)!, 2026, false).figures).toMatchObject({ i24TaxDueCents: 1_209_000, i26WithheldCents: 1_209_000 });
    clean(w.db);
  });

  it('net pay too small: all of it goes to the tax; the rest is a warning naming the amount', async () => {
    const w = await world('2026-12-01');
    const nora = w.person('Nora Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
    // Jan–Nov taxable 1,073,050.00 with nothing withheld. Year 1,100,600.00 → 102,500 + 25% of 300,600 = 177,650.00.
    prior(w, nora, { ...JAN_NOV, taxableCents: 107_305_000, wtaxCents: 0 });
    const { preview, last } = december(w, 'SEMI_MONTHLY');
    // Due 177,650 − 432.45 = 177,217.55; the pay after shares is 14,250.00, so 162,967.55 is not withheld.
    expect(pay(only(w.db, last.id, nora))).toEqual([1_500_000, 75_000, 1_425_000, 0, 0]);
    expect(only(w.db, last.id, nora).yearEnd).toMatchObject({ annualTaxCents: 17_765_000, deficiencyCents: 17_721_755, withheldCents: 1_425_000, shortCents: 16_296_755 });
    const short = preview.issues.find((i) => i.code === 'YEAR_END_SHORT')!;
    expect(short.message).toContain('₱162,967.55 is not withheld');
    expect(journal(w.env, last.id)).toContain('2310 Cr 14,250.00');
    clean(w.db);
  });

  it('a weekly piece worker whose weekly tax is all refunded', async () => {
    const w = await world('2026-12-01');
    const pia = w.person('Pia Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    prior(w, pia, { sssCents: 550_000, phicCents: 275_000, hdmfCents: 220_000, taxableCents: 9_955_000 }); // Jan–Nov: 110,000.00, no tax
    const cs = seedCustomers(w.db, w.userId);
    const jo = w.record(jobOrderDoc, {
      customerId: cs.school, dueInDays: 60, priority: 'normal', paymentTerms: 'full',
      lines: ['Jersey', 'Polo'].map((description) => ({ kind: 'made_to_order' as const, description, qty: 2_000, unitPriceCents: 30_000, discountCents: 0, roster: [] })),
    }).id;
    ['Jersey', 'Polo'].forEach((garmentType, i) => tx(w.db, () => setupLine(w.db, jo, i + 1, { templateId: 1, stepIds: [4, 6, 8], garmentType, complexity: 'standard' }, w.who())));
    const sew = (date: string, lineNo: 1 | 2, pieces: number, rateCents: number) => {
      w.at(date);
      w.record(entryDoc, { jobOrderId: jo, stepId: 6, overCapReason: 'Cut earlier by the old shop (made up)', rows: [{ lineNo, employeeId: pia, pieces, rateCents, rateReason: 'Made-up rate' }] });
    };
    // Week Dec 14–19: 300 polos × 45 = 13,500.00. SSS MSC 13,500 (675); PhilHealth on the minimum wage's 14,345.83 (358.65);
    // Pag-IBIG 200 → taxable 12,266.35 → weekly table 432.60 + 20% over 7,692 = 1,347.47.
    sew('2026-12-16', 2, 300, 4_500);
    w.at('2026-12-19');
    const week1 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-12-14' });
    expect(pay(only(w.db, week1.id, pia))).toEqual([1_350_000, 123_365, 134_747, 0, 1_091_888]);
    // Week Dec 21–26, the year-end run: 100 jerseys × 28 = 2,800.00. SSS MSC 16,500 (+150), PhilHealth on 16,300 (+48.85).
    // Year taxable 99,550 + 12,266.35 + 2,601.15 = 114,417.50: no tax, so the 1,347.47 comes back.
    sew('2026-12-22', 1, 100, 2_800);
    w.at('2026-12-26');
    const week2 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-12-21', yearEnd: true });
    const e = only(w.db, week2.id, pia);
    expect(pay(e)).toEqual([280_000, 19_885, 0, 134_747, 394_862]);
    expect(e.yearEnd).toMatchObject({ taxableCents: 11_441_750, annualTaxCents: 0, withheldBeforeCents: 134_747, refundCents: 134_747 });
    expect(journal(w.env, week2.id)).toContain('2310 Dr 1,347.47');
    expect(partyBalance(w.env, '2310', pia)).toBe(0);
    clean(w.db);
  });

  it('an MWE with overtime: no tax on the minimum wage and overtime, only on other taxable pay', async () => {
    const w = await world('2026-12-01');
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    // Jan–Nov: minimum wage, holiday and overtime pay 138,000.00, shares 9,000.00, other taxable pay 255,000.00, no tax.
    prior(w, ana, { sssCents: 550_000, phicCents: 250_000, hdmfCents: 100_000, otherNontaxCents: 13_800_000, taxableCents: 25_500_000 });
    const day = (d: string, otMinutes?: number) => ({ employeeId: ana, date: `2026-12-${d}`, status: 'present', ...(otMinutes ? { otMinutes } : {}) });
    w.at('2026-12-15');
    w.attend([...['01', '03', '04', '05', '07', '09', '10', '11', '12', '14', '15'].map((d) => day(d)), day('02', 120)]);
    const first = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-12-01' });
    w.at('2026-12-31');
    w.attend([...['17', '18', '19', '21', '22', '23', '26', '28', '29'].map((d) => day(d)), day('16', 60)]);
    const last = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-12-16', yearEnd: true, lines: [{ employeeId: ana, kind: 'allowance', amountCents: 100_000, reason: 'Christmas allowance (made up)' }] });
    // 1–15: 12 days 6,600.00 + 2 h overtime 171.88, all exempt: no tax. SSS 350 (MSC 7,000), PhilHealth 358.65, Pag-IBIG 135.44.
    expect(pay(only(w.db, first.id, ana))).toEqual([677_188, 84_409, 0, 0, 592_779]);
    // 16–31: 10 days 5,500.00 + 1 h overtime 85.94 (exempt) + allowance 1,000.00 (taxable). SSS +325 (MSC 13,500), Pag-IBIG +64.56.
    // Year taxable: 255,000 + 1,000 = 256,000.00 → 15% of 6,000 = 900.00, none withheld before: 900.00 now.
    const e = only(w.db, last.id, ana);
    expect(pay(e)).toEqual([658_594, 38_956, 90_000, 0, 529_638]);
    expect(e.yearEnd).toMatchObject({ taxableCents: 25_600_000, annualTaxCents: 90_000, withheldBeforeCents: 0, deficiencyCents: 90_000, withheldCents: 90_000 });
    const d = data2316(w.db, employee(w.db, ana)!, 2026, false);
    expect(d.isMwe).toBe(true);
    expect(d.smw).toEqual({ perDayCents: 55_000, factor: 313, perMonthCents: 1_434_583, perYearCents: 17_215_000 });
    // Item 29: 12,100.00 of minimum wage + 138,000.00 before Virtus; item 31 overtime 257.82; item 36 only the
    // shares before Virtus (an MWE's payroll shares stay inside the minimum wage, as on the 1601-C).
    expect(d.figures).toMatchObject({
      i29BasicSmwCents: 15_010_000, i30HolidayMweCents: 0, i31OvertimeMweCents: 25_782, i36SharesCents: 900_000, i39BasicCents: 25_500_000, i51OtherCents: 100_000,
      i52TaxableCents: 25_600_000, i19GrossCents: 41_535_782, i24TaxDueCents: 90_000, i26WithheldCents: 90_000,
    });
    clean(w.db);
  });

  it('pay before Virtus and a previous employer: both counted; no substituted filing', async () => {
    const w = await world('2026-12-01');
    const pedro = w.person('Pedro Bago', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 4_000_000 }, { ...office, hireDate: '2026-06-01' });
    prior(w, pedro, { source: 'previous', employerName: 'Made-up Trading Co.', sssCents: 500_000, phicCents: 375_000, hdmfCents: 100_000, taxableCents: 14_025_000, wtaxCents: 500_000 });
    prior(w, pedro, { sssCents: 1_050_000, phicCents: 600_000, hdmfCents: 120_000, taxableCents: 22_230_000, wtaxCents: 2_100_000 }); // Jun–Nov here
    const { first, last } = december(w, 'SEMI_MONTHLY');
    // 1–15: 20,000.00 − SSS 1,000 − PhilHealth 1,000 − Pag-IBIG 200 → 17,800.00 → 937.50 + 20% over 16,667 = 1,164.10.
    expect(pay(only(w.db, first.id, pedro))).toEqual([2_000_000, 220_000, 116_410, 0, 1_663_590]);
    // 16–31: SSS +750 (MSC 35,000). Year: 140,250 + 222,300 + 17,800 + 19,250 = 399,600.00 → 15% of 149,600 = 22,440.00;
    // withheld 5,000 + 21,000 + 1,164.10 = 27,164.10 → 4,724.10 refunded.
    expect(pay(only(w.db, last.id, pedro))).toEqual([2_000_000, 75_000, 0, 472_410, 2_397_410]);
    const d = data2316(w.db, employee(w.db, pedro)!, 2026, false);
    expect(d.figures).toMatchObject({
      i21TaxableCents: 25_935_000, i22PreviousTaxableCents: 14_025_000, i23GrossTaxableCents: 39_960_000, i24TaxDueCents: 2_244_000,
      i25aPresentWithheldCents: 1_744_000, i25bPreviousWithheldCents: 500_000, i26WithheldCents: 2_244_000, withheldJanNovCents: 2_100_000, withheldDecemberCents: 116_410, refundedCents: 472_410,
    });
    expect([d.periodFrom, d.substitutedFiling, d.previousEmployer]).toEqual(['2026-06-01', false, { name: 'Made-up Trading Co.', tin: null }]);
    clean(w.db);
  });

  it('13th-month pay above ₱90,000: the part above the ceiling is taxed in the year; TH13 cancel waits for the adjustment', async () => {
    const w = await world('2026-12-01');
    const mia = w.person('Mia Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 12_000_000 }, office);
    // Jan–Nov: 11 × 120,000; shares 11 × (1,750 + 2,500 + 200); tax 11 × 20,762.55 (monthly table on 115,550.00).
    prior(w, mia, { sssCents: 1_925_000, phicCents: 2_750_000, hdmfCents: 220_000, taxableCents: 127_105_000, wtaxCents: 22_838_805 });
    w.at('2026-12-15');
    const first = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-01' });
    // 60,000 − 1,750 − 2,500 − 200 = 55,550.00 → 4,270.70 + 25% over 33,333 = 9,824.95.
    expect(only(w.db, first.id, mia).wtaxCents).toBe(982_495);
    // 13th month of 110,000.00 (agreed): 20,000.00 above the ceiling; monthly table on 75,550.00 less on 55,550.00 = 4,444.15.
    w.at('2026-12-20');
    const th = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026, amounts: [{ employeeId: mia, amountCents: 11_000_000, reason: 'Agreed for the whole year (made up)' }] });
    expect(thirteenthDoc.load(w.db, th.id).employees[0]).toMatchObject({ taxableCents: 2_000_000, wtaxCents: 444_415 });
    w.at('2026-12-31');
    const last = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true });
    // Year: 1,271,050 + 55,550 + 60,000 + 20,000 = 1,406,600.00 → 102,500 + 25% of 606,600 = 254,150.00; withheld
    // 228,388.05 + 9,824.95 + 4,444.15 = 242,657.15 → 11,492.85 more.
    const e = only(w.db, last.id, mia);
    expect(pay(e)).toEqual([6_000_000, 0, 1_149_285, 0, 4_850_715]);
    expect(e.yearEnd).toMatchObject({ taxableCents: 140_660_000, benefitsTaxableCents: 2_000_000, annualTaxCents: 25_415_000, withheldBeforeCents: 24_265_715 });
    expect(data2316(w.db, employee(w.db, mia)!, 2026, false).figures).toMatchObject({ i34BenefitsCents: 9_000_000, i48TaxableBenefitsCents: 2_000_000, i24TaxDueCents: 25_415_000, i26WithheldCents: 25_415_000 });
    expect((fails(() => w.cancel(thirteenthDoc, th.id), 'HAS_DEPENDENTS') as { number: string }[]).map((x) => x.number)).toEqual([last.number]);
    clean(w.db);
  });
});

describe('year-end adjustment refusals', () => {
  it('only on a run ending in December; once per employee and year while it stands; earlier runs and pay before Virtus wait for it', async () => {
    const w = await world('2026-11-30');
    const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
    const row = prior(w, olga, { ...JAN_NOV, wtaxCents: 4_000_000 });
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-11-16', yearEnd: true }).issues)).toEqual(['YEAR_END_NOT_DECEMBER']);
    w.at('2026-12-15');
    const early = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-01', yearEnd: true });
    w.at('2026-12-31');
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true }).issues)).toEqual(['YEAR_END_DONE']);
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16' }).issues, 'warning')).toContain('AFTER_YEAR_END');
    fails(() => tx(w.db, () => updatePrior(w.db, row.id, '1', { wtaxCents: 3_000_000, taxableCents: 30_305_000 }, w.who())), 'YEAR_END_DONE');
    fails(() => tx(w.db, () => updatePrior(w.db, row.id, '1', { wtaxCents: 3_000_000 }, w.who())), 'YEAR_END_DONE');
    // An encoder may not tick it (the accountant's permission).
    const ctx = { db: w.db, businessDate: '2026-12-31', at: '2026-12-31T10:00:00.000+08:00', userId: w.userId, can: (p: string) => p !== 'pay.yearend.run' };
    const doc = runDoc.compute({ payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true }, ctx);
    expect(codes(runDoc.validate(doc, ctx))).toContain('YEAR_END_ACCOUNTANT');
    // Cancelled, the second run may do it.
    w.cancel(runDoc, early.id);
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true }).issues)).toEqual([]);
    clean(w.db);
  });

  it('the year-end run cancelled and done again: the same figures and journal; the cancel mirrors the refund; earlier runs wait for it', async () => {
    const w = await world('2026-12-01');
    const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
    const row = prior(w, olga, { ...JAN_NOV, wtaxCents: 4_000_000 });
    const { first, last } = december(w, 'SEMI_MONTHLY');
    const before = journal(w.env, last.id);
    expect((fails(() => w.cancel(runDoc, first.id), 'HAS_DEPENDENTS') as { number: string }[]).map((x) => x.number)).toEqual([last.number]);
    w.cancel(runDoc, last.id);
    expect(journal(w.env, last.id, 'reversal')).toEqual(['2110 Dr 42,592.45', '2111 Dr 1,250.00', '2310 Cr 28,342.45', '2401 Dr 2,250.00', '6101 Cr 15,000.00', '6102 Cr 1,500.00', '6103 Cr 1,250.00']);
    expect(-partyBalance(w.env, '2310', olga)).toBe(43_245);
    // Pay before Virtus may change again once nothing counted it; changed back, the redo is the same.
    const changed = tx(w.db, () => updatePrior(w.db, row.id, '1', { note: 'Checked against the old payroll (made up)' }, w.who()));
    expect(changed.version).toBe(2);
    const again = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true });
    expect(journal(w.env, again.id)).toEqual(before);
    expect(pay(only(w.db, again.id, olga))).toEqual([1_500_000, 75_000, 0, 2_834_245, 4_259_245]);
    const audit = w.db.prepare(`SELECT action FROM audit_log WHERE entity_type = 'pay.prior' ORDER BY seq`).pluck().all();
    expect(audit).toEqual(['pay.prior.add', 'pay.prior.update']);
    expect(() => w.db.prepare('DELETE FROM pay_prior_pay').run()).toThrow(/NO_DELETE/);
    clean(w.db);
  });
});

describe('pay before Virtus, 2316 and alphalist through the API', () => {
  it('the accountant records and changes pay before Virtus (If-Match); the encoder and owner may not; 2316 and the 1604-C CSV', async () => {
    const w = await world('2026-12-01');
    const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    const acc = await w.env.as('accountant');
    const enc = await w.env.as('encoder');
    const owner = await w.env.as('owner');
    const body = { employeeId: olga, year: 2026, source: 'before', grossCents: 33_000_000, ...JAN_NOV, benefitsCents: 0, deMinimisCents: 0, otherNontaxCents: 0, wtaxCents: 4_000_000 };
    expect((await enc.post('/api/pay/prior', body)).statusCode).toBe(403);
    expect((await owner.get('/api/pay/prior')).statusCode).toBe(403);
    expect((await acc.post('/api/pay/prior', { ...body, grossCents: 1 })).json().code).toBe('PARTS_NOT_GROSS');
    expect((await acc.post('/api/pay/prior', { ...body, source: 'previous' })).json().code).toBe('EMPLOYER_NEEDED');
    expect((await acc.post('/api/pay/prior', { ...body, employerName: 'Someone' })).json().code).toBe('NOT_PREVIOUS');
    const made = (await acc.post('/api/pay/prior', body)).json();
    expect(made).toMatchObject({ version: 1, taxableCents: 30_305_000, employeeName: 'Olga Opisina' });
    expect((await acc.post('/api/pay/prior', body)).json().code).toBe('DUPLICATE');
    expect((await acc.put(`/api/pay/prior/${made.id}`, { wtaxCents: 1 })).statusCode).toBe(428);
    expect((await acc.put(`/api/pay/prior/${made.id}`, { wtaxCents: 1 }, { 'if-match': '9' })).json().code).toBe('VERSION_CHANGED');
    expect((await acc.put(`/api/pay/prior/${made.id}`, { wtaxCents: 3_900_000 }, { 'if-match': '1' })).json()).toMatchObject({ version: 2, wtaxCents: 3_900_000 });
    expect((await acc.get(`/api/pay/prior?employeeId=${olga}`)).json()).toHaveLength(1);

    const { last } = december(w, 'SEMI_MONTHLY');
    expect(only(w.db, last.id, olga).wtaxRefundCents).toBe(2_834_245 - 100_000);
    const acc2 = await w.env.as('accountant'); // a new day: sign in again
    expect((await (await w.env.as('encoder')).get('/api/pay/2316?year=2026')).statusCode).toBe(403);
    const all = (await acc2.get('/api/pay/2316?year=2026')).json();
    expect(all.map((d: { name: string }) => d.name)).toEqual(['Olga Opisina']); // Ana has no pay in 2026
    const one = (await acc2.get(`/api/pay/2316?year=2026&employeeId=${olga}`)).json();
    expect(one.figures).toMatchObject({ i24TaxDueCents: 1_209_000, i26WithheldCents: 1_209_000 });
    expect((await acc2.get(`/api/pay/2316?year=2026&employeeId=${ana}`)).json().figures.i19GrossCents).toBe(0);
    expect((await acc2.get('/api/pay/2316?year=2031')).json().code).toBe('BAD_YEAR');
    const list = (await acc2.get('/api/pay/alphalist?year=2026')).json();
    expect([list.schedule1.length, list.schedule2.length, list.columns1.length, list.schedule1[0].length]).toEqual([1, 0, 27, 27]);
    const csv = await acc2.get('/api/pay/alphalist?year=2026&format=csv&schedule=1');
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Olga Opisina"');
    expect(lines[1]).toContain('"360000.00"'); // gross compensation, present employer
    expect(lines[1]!.endsWith('"12090.00","Yes"')).toBe(true);
    const both = (await acc2.get('/api/pay/alphalist?year=2026&format=csv')).body;
    expect(both).toContain('Schedule 2: minimum wage earners');
    clean(w.db);
  });
});
