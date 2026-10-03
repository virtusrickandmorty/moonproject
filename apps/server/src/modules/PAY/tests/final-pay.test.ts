/**
 * Final pay on separation, unused SIL paid in cash and the attendance lock (PLAN E11, F1 SIL, F3): goldens to the
 * centavo (a monthly employee separated mid-month with 3 unused SIL days, a cash advance and an over-withheld tax refund;
 * a piece worker separated with a tax deficiency; December's "Pay unused leave" for everyone), the refusals (a paid
 * attendance day changed; the same leave paid twice; a holiday or a separation inside paid days), the cancel mirroring
 * and unlocking, the 13th-month pay of one separated employee, and the API. Every figure is worked out by hand.
 * Made-up people only.
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
import { advanceDoc } from '../../CA/doctypes/advance.ts';
import { caBalance } from '../../CA/public.ts';
import { employee, markSilPaid, silOf } from '../../EMP/public.ts';
import { separateEmployee } from '../../EMP/employees.ts';
import { addHoliday } from '../../EMP/time.ts';
import { runDoc } from '../doctypes/run.ts';
import { thirteenthDoc } from '../doctypes/thirteenth.ts';
import { addPrior } from '../prior.ts';
import { payOfMonth } from '../public.ts';
import type { RunEmployee } from '../run-calc.ts';
import { data2316 } from '../year-end.ts';
import { codes, fails, journal, partyBalance, world } from './world.ts';

type World = Awaited<ReturnType<typeof world>>;
const office = { costCentre: 'office' as const, hireDate: '2024-01-08' };
const clean = (db: Db) => expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
const only = (db: Db, runId: string, employeeId: string) => runDoc.load(db, runId).employees.find((e) => e.employeeId === employeeId)!;
/** [gross, EE shares, tax withheld, CA, refund, net] of one employee on a run. */
const pay = (e: RunEmployee) => [e.grossCents, e.sssEeCents + e.phicEeCents + e.hdmfEeCents, e.wtaxCents, e.caCents, e.wtaxRefundCents, e.netCents];
const leaveLines = (e: RunEmployee) => e.lines.filter((l) => l.kind === 'unused_leave').map((l) => [l.description, l.qty / 1000, l.rateCents, l.amountCents, l.taxable]);
const zero = { benefitsCents: 0, deMinimisCents: 0, sssCents: 0, phicCents: 0, hdmfCents: 0, otherNontaxCents: 0, taxableCents: 0, wtaxCents: 0 };
function prior(w: World, employeeId: string, p: Partial<typeof zero>) {
  const v = { ...zero, ...p };
  const grossCents = v.benefitsCents + v.deMinimisCents + v.sssCents + v.phicCents + v.hdmfCents + v.otherNontaxCents + v.taxableCents;
  return tx(w.db, () => addPrior(w.db, { employeeId, year: 2026, source: 'before', ...v, grossCents }, w.who()));
}
/** Records the separation as the employee screen does (If-Match: the record's version). */
function separate(w: World, id: string, separatedOn: string) {
  const version = String(w.db.prepare('SELECT version FROM emp_employees WHERE id = ?').pluck().get(id));
  return tx(w.db, () => separateEmployee(w.db, id, version, { separatedOn, reason: 'Resigned to move to the province (made up)' }, w.who()));
}
/** Jan–Aug before Virtus for a ₱30,000 a month employee: 8 × 30,000 gross, shares 8 × (1,500 + 750 + 200). */
const JAN_AUG = { sssCents: 1_200_000, phicCents: 600_000, hdmfCents: 160_000, taxableCents: 22_040_000 };

/**
 * Olga, ₱30,000 a month (office, hired 2024), took 2 days of SIL in March, owes ₱15,000 on a cash advance and had
 * ₱5,000 withheld before Virtus; she leaves on Wed 2026-09-10. Her final pay is the Sep 1–15 run.
 */
async function olgaLeaves() {
  const w = await world('2026-09-01');
  const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
  const other = w.person('Oscar Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 2_000_000 }, office);
  w.attend(['2026-03-05', '2026-03-06'].map((date) => ({ employeeId: olga, date, status: 'leave' })));
  prior(w, olga, { ...JAN_AUG, wtaxCents: 500_000 });
  w.record(advanceDoc, { employeeId: olga, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 1_500_000, installmentCents: 100_000 });
  w.at('2026-09-10');
  w.attend(['01', '02', '03', '04', '05', '07', '08', '09', '10'].map((d) => ({ employeeId: olga, date: `2026-09-${d}`, status: 'present' })));
  separate(w, olga, '2026-09-10');
  w.at('2026-09-15');
  const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart: '2026-09-01' };
  const preview = w.preview(runDoc, input);
  return { w, olga, other, preview, run: w.record(runDoc, input) };
}

describe('final pay goldens', () => {
  it('a monthly employee separated mid-month: 3 unused SIL days, the whole cash advance as far as the pay allows, the year-end refund', async () => {
    const { w, olga, other, preview, run } = await olgaLeaves();
    const e = only(w.db, run.id, olga);
    // Salary 15,000 × 10 of 15 days = 10,000.00. Unused leave 5 − 2 = 3 days × 30,000 × 12 ÷ 313 (1,150.16) = 3,450.48,
    // de minimis (not taxable). Gross 13,450.48: SSS MSC 13,500 (EE 675, ER 1,350, EC 10); PhilHealth on 30,000 (750
    // each); Pag-IBIG 200 each. Year: 220,400 + 10,000 − 1,625 = 228,775.00, below ₱250,000: no tax, so the 5,000.00
    // withheld before comes back. Cash advance: all the pay after the shares, 11,825.48 of the 15,000.00 owed.
    expect(leaveLines(e)).toEqual([['Unused leave (SIL) 2026', 3, 115_016, 345_048, false]]);
    expect(pay(e)).toEqual([1_345_048, 162_500, 0, 1_182_548, 500_000, 500_000]);
    expect(e.yearEnd).toEqual({ year: 2026, taxableCents: 22_877_500, benefitsTaxableCents: 0, annualTaxCents: 0, withheldBeforeCents: 500_000, deficiencyCents: 0, withheldCents: 0, shortCents: 0, refundCents: 500_000 });
    expect(e.final).toEqual({ separatedOn: '2026-09-10', caLeftCents: 317_452, loansLeftCents: 0 });
    expect(e.thirteenthCents).toBe(83_333); // 10,000.00 ÷ 12: unused leave is not 13th-month basic pay
    expect(codes(preview.issues, 'warning')).toEqual(expect.arrayContaining(['FINAL_PAY', 'CA_LEFT']));
    expect(preview.issues.find((i) => i.code === 'CA_LEFT')!.message).toContain('₱3,174.52 of cash advances is still owed');
    expect(preview.summary).toContain('It pays ₱3,450.48 of unused leave in cash. It is the final pay of Olga Opisina.');
    // Oscar, still employed, gets an ordinary run: no unused leave, no adjustment, no final pay.
    expect([only(w.db, run.id, other).lines.length, only(w.db, run.id, other).yearEnd, only(w.db, run.id, other).final]).toEqual([1, undefined, undefined]);
    // Olga's part of the journal: 6101 13,450.48 + 6102 2,310.00 + 6103 833.33 + 2310 5,000.00 refund =
    // 2401 2,035.00 + 2402 1,500.00 + 2403 400.00 + 1210 11,825.48 + 2111 833.33 + 2110 5,000.00 = 21,593.81.
    // Oscar's: 6101 10,000.00 + 6102 1,710.00 (SSS 1,000 + EC 10, PhilHealth 500, Pag-IBIG 200) + 6103 833.33 =
    // 2401 1,510.00 + 2402 1,000.00 + 2403 400.00 + 2111 833.33 + 2110 8,800.00 = 12,543.33.
    expect(partyBalance(w.env, '1210', olga)).toBe(317_452);
    expect(caBalance(w.db, olga)).toBe(317_452);
    expect(-partyBalance(w.env, '2110', olga)).toBe(500_000);
    expect(partyBalance(w.env, '2310', olga)).toBe(500_000);
    expect(journal(w.env, run.id)).toEqual([
      '1210 Cr 11,825.48', '2110 Cr 13,800.00', '2111 Cr 1,666.66', '2310 Dr 5,000.00', '2401 Cr 3,545.00', '2402 Cr 2,500.00', '2403 Cr 800.00',
      '6101 Dr 23,450.48', '6102 Dr 4,020.00', '6103 Dr 1,666.66',
    ]);
    // The leave is used up; the 2316 is ready at once: the unused leave is de minimis (item 35), tax due = withheld.
    expect(silOf(w.db, olga, 2026)).toMatchObject({ used: 2, paid: 3, left: 0 });
    const d = data2316(w.db, employee(w.db, olga)!, 2026, false);
    expect([d.periodTo, d.separatedOn, d.yearEnd?.number, d.yearEnd?.refundCents]).toEqual(['2026-09-10', '2026-09-10', run.number, 500_000]);
    expect(d.figures).toMatchObject({ i35DeMinimisCents: 345_048, i39BasicCents: 22_877_500, i24TaxDueCents: 0, i26WithheldCents: 0, i19GrossCents: 25_345_048 });
    expect(payOfMonth(w.db, '2026-09').find((p) => p.employeeId === olga)).toMatchObject({ grossCents: 1_345_048, taxableCents: 837_500, deMinimisCents: 345_048 });
    clean(w.db);
  });

  it('a piece worker separated with a deficiency: withheld within the pay; the leave at the average daily pay', async () => {
    const w = await world('2026-09-01');
    const pia = w.person('Pia Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' }, { hireDate: '2024-01-08' });
    prior(w, pia, { taxableCents: 30_000_000, wtaxCents: 300_000 }); // Jan–Aug: 300,000.00 taxable, 3,000.00 withheld
    const cs = seedCustomers(w.db, w.userId);
    const jo = w.record(jobOrderDoc, {
      customerId: cs.school, dueInDays: 60, priority: 'normal', paymentTerms: 'full',
      lines: [{ kind: 'made_to_order' as const, description: 'Polo', qty: 2_000, unitPriceCents: 30_000, discountCents: 0, roster: [] }],
    }).id;
    tx(w.db, () => setupLine(w.db, jo, 1, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'Polo', complexity: 'standard' }, w.who()));
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      w.at(date);
      w.record(entryDoc, { jobOrderId: jo, stepId: 6, overCapReason: 'Cut earlier by the old shop (made up)', rows: [{ lineNo: 1, employeeId: pia, pieces: 30, rateCents: 4_500, rateReason: 'Made-up rate' }] });
    }
    separate(w, pia, '2026-09-09');
    w.at('2026-09-12');
    const run = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-07' });
    const e = only(w.db, run.id, pia);
    // Piece pay 3 × 30 × 45.00 = 4,050.00. Unused leave 5 days at the average of the last 3 workdays (1,350.00) =
    // 6,750.00, de minimis. Gross 10,800.00: SSS MSC 11,000 (EE 550, ER 1,100, EC 10); PhilHealth on the minimum wage's
    // 14,345.83 (358.65 each, the ER share rounded down); Pag-IBIG 200 each. Year: 300,000 + 4,050 − 1,108.65 =
    // 302,941.35 → 15% over 250,000 = 7,941.20; 3,000.00 withheld before → 4,941.20 withheld now.
    expect(leaveLines(e)).toEqual([['Unused leave (SIL) 2026 at the average of the last 3 workdays', 5, 135_000, 675_000, false]]);
    expect(pay(e)).toEqual([1_080_000, 110_865, 494_120, 0, 0, 475_015]);
    expect(e.yearEnd).toMatchObject({ taxableCents: 30_294_135, annualTaxCents: 794_120, withheldBeforeCents: 300_000, deficiencyCents: 494_120, withheldCents: 494_120, shortCents: 0 });
    expect(e.final).toEqual({ separatedOn: '2026-09-09', caLeftCents: 0, loansLeftCents: 0 });
    expect(journal(w.env, run.id)).toEqual([
      '2110 Cr 4,750.15', '2111 Cr 337.50', '2310 Cr 4,941.20', '2401 Cr 1,660.00', '2402 Cr 717.30', '2403 Cr 400.00',
      '5201 Dr 4,050.00', '5202 Dr 6,750.00', '5203 Dr 1,668.65', '5204 Dr 337.50',
    ]);
    expect(data2316(w.db, employee(w.db, pia)!, 2026, false).figures).toMatchObject({ i35DeMinimisCents: 675_000, i24TaxDueCents: 794_120, i26WithheldCents: 794_120 });
    clean(w.db);
  });

  it('December "Pay unused leave": everyone eligible is paid the days left; a new hire is not; only the accountant ticks it', async () => {
    const w = await world('2026-12-01');
    const dina = w.person('Dina Arawan', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 }, { hireDate: '2024-01-08' });
    const nena = w.person('Nena Bago', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 }, { hireDate: '2026-03-02' });
    w.attend([{ employeeId: dina, date: '2026-06-01', status: 'leave' }]);
    w.at('2026-12-31');
    w.attend([dina, nena].flatMap((employeeId) => ['16', '17', '18', '19'].map((d) => ({ employeeId, date: `2026-12-${d}`, status: 'present' }))));
    const input = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-12-16', unusedLeave: true };
    const ctx = { db: w.db, businessDate: '2026-12-31', at: '2026-12-31T10:00:00.000+08:00', userId: w.userId, can: (p: string) => p !== 'pay.yearend.run' };
    expect(codes(runDoc.validate(runDoc.compute(input, ctx), ctx))).toContain('UNUSED_LEAVE_ACCOUNTANT');
    const run = w.record(runDoc, input);
    const e = only(w.db, run.id, dina);
    // 4 days 2,400.00 + unused leave 5 − 1 = 4 days × 600.00 = 2,400.00. Gross 4,800.00: SSS MSC 5,000 (EE 250, ER 500,
    // EC 10); PhilHealth on 600 × 313 ÷ 12 = 15,650.00 (391.25 each); Pag-IBIG 96.00 each. Taxable 2,400 − 737.25:
    // below the semi-monthly table's zero bracket. Not a final pay: no year-end adjustment unless ticked.
    expect(leaveLines(e)).toEqual([['Unused leave (SIL) 2026', 4, 60_000, 240_000, false]]);
    expect(pay(e)).toEqual([480_000, 73_725, 0, 0, 0, 406_275]);
    expect([e.thirteenthCents, e.final, e.yearEnd]).toEqual([20_000, undefined, undefined]);
    expect(leaveLines(only(w.db, run.id, nena))).toEqual([]); // eligible from 2027-03-02
    expect(runDoc.load(w.db, run.id).unusedLeave).toBe(true);
    expect(silOf(w.db, dina, 2026)).toMatchObject({ used: 1, paid: 4, left: 0 });
    clean(w.db);
  });
});

describe('refusals', () => {
  it('a day a recorded payroll paid cannot be changed until it is cancelled; nor a holiday on it, nor a separation before it', async () => {
    const w = await world('2026-09-15');
    const dina = w.person('Dina Arawan', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
    w.attend(['01', '02', '03'].map((d) => ({ employeeId: dina, date: `2026-09-${d}`, status: 'present' })));
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-01' });
    const details = fails(() => w.attend([{ employeeId: dina, date: '2026-09-02', status: 'absent' }]), 'VALIDATION') as { code: string; message: string }[];
    expect(details.map((i) => [i.code, i.message])).toEqual([['PAID', `Dina Arawan on 2026-09-02 is paid by ${run.number}. Cancel ${run.number} first to change it.`]]);
    fails(() => w.attend([{ employeeId: dina, date: '2026-09-04', status: 'present' }]), 'VALIDATION'); // a day not typed yet, too
    expect(w.attend([{ employeeId: dina, date: '2026-09-02', status: 'present' }])).toEqual({ saved: 0, unchanged: 1 }); // unchanged is fine
    fails(() => tx(w.db, () => addHoliday(w.db, { date: '2026-09-07', name: 'Made-up local day', kind: 'special', source: 'Made-up municipal ordinance' }, w.who())), 'HOLIDAY_PAID');
    fails(() => separate(w, dina, '2026-09-10'), 'PAID_AFTER');
    // Cancelled, the days open again; the reversal mirrors the run.
    w.cancel(runDoc, run.id);
    expect(journal(w.env, run.id, 'reversal')).toEqual(journal(w.env, run.id).map((l) => l.replace(' Dr ', ' X ').replace(' Cr ', ' Dr ').replace(' X ', ' Cr ')));
    expect(w.attend([{ employeeId: dina, date: '2026-09-02', status: 'absent' }])).toEqual({ saved: 1, unchanged: 0 });
    clean(w.db);
  });

  it('the same leave is never paid twice: a second tick waits for the first run to be cancelled; leave taken after it is refused', async () => {
    const w = await world('2026-12-15');
    const dina = w.person('Dina Arawan', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
    w.attend(['01', '02'].map((d) => ({ employeeId: dina, date: `2026-12-${d}`, status: 'present' })));
    const first = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-12-01', unusedLeave: true });
    expect(leaveLines(only(w.db, first.id, dina))).toEqual([['Unused leave (SIL) 2026', 5, 60_000, 300_000, false]]);
    w.at('2026-12-22');
    expect((fails(() => w.attend([{ employeeId: dina, date: '2026-12-22', status: 'leave' }]), 'VALIDATION') as { code: string }[]).map((i) => i.code)).toEqual(['SIL_USED']);
    fails(() => tx(w.db, () => markSilPaid(w.db, { documentId: first.id, employeeId: dina, year: 2026, days: 1 })), 'SIL_PAID');
    w.at('2026-12-31');
    const again = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-12-16', unusedLeave: true };
    const refused = w.preview(runDoc, again).issues.find((i) => i.code === 'LEAVE_PAID')!;
    expect(refused.message).toBe(`${first.number} already paid Dina Arawan's unused 2026 leave. Cancel it first to redo it, or leave Dina Arawan out.`);
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-11-16', unusedLeave: true }).issues)).toContain('UNUSED_LEAVE_NOT_DECEMBER');
    w.cancel(runDoc, first.id);
    expect(silOf(w.db, dina, 2026)).toMatchObject({ paid: 0, left: 5 });
    const second = w.record(runDoc, again);
    expect(leaveLines(only(w.db, second.id, dina))).toEqual([['Unused leave (SIL) 2026', 5, 60_000, 300_000, false]]);
    clean(w.db);
  });
});

describe('cancel and the 13th month on separation', () => {
  it('cancelling the final pay mirrors it, unlocks the days, gives the leave and the cash advance back and undoes the 2316 adjustment', async () => {
    const { w, olga, run } = await olgaLeaves();
    const before = journal(w.env, run.id);
    w.cancel(runDoc, run.id);
    expect(journal(w.env, run.id, 'reversal')).toEqual(before.map((l) => l.replace(' Dr ', ' X ').replace(' Cr ', ' Dr ').replace(' X ', ' Cr ')));
    expect([caBalance(w.db, olga), partyBalance(w.env, '2310', olga), silOf(w.db, olga, 2026).left]).toEqual([1_500_000, 0, 3]);
    expect(data2316(w.db, employee(w.db, olga)!, 2026, false).yearEnd).toBeNull();
    expect(w.attend([{ employeeId: olga, date: '2026-09-09', status: 'absent' }])).toEqual({ saved: 1, unchanged: 0 });
    // Done again, the absence is deducted and the rest is as before.
    const again = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    expect(leaveLines(only(w.db, again.id, olga))).toEqual([['Unused leave (SIL) 2026', 3, 115_016, 345_048, false]]);
    expect(only(w.db, again.id, olga).lines.find((l) => l.kind === 'absence')!.amountCents).toBe(-115_016);
    clean(w.db);
  });

  it('the 13th month of one separated employee alone, after the final pay; the group’s later pays the others', async () => {
    const { w, olga, other, run } = await olgaLeaves();
    expect(codes(w.preview(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026, employeeId: other }).issues)).toEqual(['NOT_SEPARATED']);
    const th = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026, employeeId: olga });
    // One twelfth of the final pay's 10,000.00 salary (the unused leave is not basic pay): 833.33, all accrued on 2111.
    expect(thirteenthDoc.load(w.db, th.id)).toMatchObject({ employeeId: olga, totalCents: 83_333, employees: [{ employeeId: olga, basicCents: 1_000_000, accruedCents: 83_333, wtaxCents: 0 }] });
    expect(journal(w.env, th.id)).toEqual(['2110 Cr 833.33', '2111 Dr 833.33']);
    expect(codes(w.preview(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026, employeeId: olga }).issues)).toContain('DUPLICATE');
    // The exempt 13th month leaves the adjustment as it is: no warning; the 2316 counts it (item 34).
    expect(codes(w.preview(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026 }).issues, 'warning')).not.toContain('AFTER_YEAR_END');
    expect(data2316(w.db, employee(w.db, olga)!, 2026, false).figures).toMatchObject({ i34BenefitsCents: 83_333, i24TaxDueCents: 0, i26WithheldCents: 0 });
    w.at('2026-12-15');
    const group = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026 });
    expect(thirteenthDoc.load(w.db, group.id).employees.map((e) => e.employeeId)).toEqual([other]);
    // Both counted the run's basic pay (Olga's and Oscar's), so the run waits for both.
    expect((fails(() => w.cancel(runDoc, run.id), 'HAS_DEPENDENTS') as { number: string }[]).map((x) => x.number)).toEqual([th.number, group.number]);
    clean(w.db);
  });
});

describe('through the API', () => {
  it('the attendance grid shows the days a recorded payroll paid; the refusal names the run', async () => {
    const w = await world('2026-09-15');
    const dina = w.person('Dina Arawan', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
    w.attend([{ employeeId: dina, date: '2026-09-01', status: 'present' }]);
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-01' });
    const enc = await w.env.as('encoder');
    const grid = (await enc.get('/api/emp/attendance?from=2026-09-01&to=2026-09-15')).json();
    expect(grid.paid).toEqual([{ employeeId: dina, from: '2026-09-01', to: '2026-09-15', number: run.number }]);
    const r = await enc.post('/api/emp/attendance', { days: [{ employeeId: dina, date: '2026-09-01', status: 'absent' }] });
    expect([r.statusCode, r.json().details[0].code]).toEqual([422, 'PAID']);
    clean(w.db);
  });
});
