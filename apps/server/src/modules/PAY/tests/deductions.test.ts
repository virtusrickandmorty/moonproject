/**
 * Other deductions typed on a payroll run (the owner's request, Oct 2026): an amount, what it is for and where it goes
 * (other income, or money owed to the shop paid back), taken off net pay last, after tax, contributions, loans, the cash
 * advance and damage charges, never below the minimum net pay. Gross and taxable pay stay as they are.
 */
import { expect, it } from 'vitest';
import { releaseStatus } from '../doctypes/release.ts';
import { runDoc } from '../doctypes/run.ts';
import { journal, partyBalance, world } from './world.ts';

/** Ana, ₱600 a day, present Sep 16-25 (8 workdays, ₱4,800), on the semi-monthly daily-paid run of Sep 16-30. */
async function ana() {
  const w = await world('2026-09-30');
  const id = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  w.attend(['16', '17', '18', '19', '21', '22', '23', '24'].map((d) => ({ employeeId: id, date: `2026-09-${d}`, status: 'present' })));
  return { w, id };
}
type Employee = { grossCents: number; taxableCents: number; netCents: number; deductionCents: number; deductions: { lineNo: number; goesTo: string; reason: string; wantedCents: number; amountCents: number }[] };
const run = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-09-16' };

it('takes the deductions off net pay only, books each where it goes, and the release pays what is left', async () => {
  const { w, id } = await ana();
  const plain = (w.preview(runDoc, run).doc as { employees: Employee[] }).employees[0]!;
  const input = { ...run, deductions: [
    { employeeId: id, goesTo: 'other_income' as const, amountCents: 35_000, reason: 'Two company polo shirts' },
    { employeeId: id, goesTo: 'owed_to_shop' as const, amountCents: 20_000, reason: 'Phone bill the shop paid for her' },
  ] };
  const e = (w.preview(runDoc, input).doc as { employees: Employee[] }).employees[0]!;
  expect([e.grossCents, e.taxableCents]).toEqual([plain.grossCents, plain.taxableCents]); // not pay: tax and shares unchanged
  expect(e.deductionCents).toBe(55_000);
  expect(e.netCents).toBe(plain.netCents - 55_000);
  expect(e.deductions).toEqual([
    { lineNo: 1, goesTo: 'other_income', reason: 'Two company polo shirts', wantedCents: 35_000, amountCents: 35_000 },
    { lineNo: 2, goesTo: 'owed_to_shop', reason: 'Phone bill the shop paid for her', wantedCents: 20_000, amountCents: 20_000 },
  ]);

  const r = w.record(runDoc, input);
  const lines = journal(w.env, r.id);
  expect(lines).toContain('7103 Cr 350.00');
  expect(lines).toContain('1290 Cr 200.00');
  expect(partyBalance(w.env, '1290', id)).toBe(-20_000);
  // Recorded and read back: the same deductions and net pay, which the release pays.
  const doc = runDoc.load(w.db, r.id);
  expect(runDoc.toInput!(doc).deductions).toEqual(input.deductions);
  expect(doc.employees[0]!.netCents).toBe(e.netCents);
  expect(releaseStatus(w.db, r.id)).toEqual([expect.objectContaining({ employeeId: id, netCents: e.netCents })]);
  w.cancel(runDoc, r.id);
  expect(partyBalance(w.env, '1290', id)).toBe(0);
});

it('takes only what the pay allows above the minimum net pay, with a warning; a deduction is for someone on the run', async () => {
  const { w, id } = await ana();
  const pre = w.preview(runDoc, { ...run, deductions: [{ employeeId: id, goesTo: 'other_income', amountCents: 1_000_000, reason: 'Sewing machine bought from the shop' }] });
  const e = (pre.doc as { employees: Employee[] }).employees[0]!;
  expect(e.deductions[0]!.amountCents).toBeLessThan(1_000_000);
  expect(e.netCents).toBeGreaterThanOrEqual(0);
  expect(pre.issues.find((i) => i.code === 'DEDUCTION_REDUCED')?.message).toContain('of the ₱10,000.00 deduction for "Sewing machine bought from the shop" is taken');
  const stranger = w.person('Ben Uy', { payType: 'daily', payGroup: 'WEEKLY_DAILY', dailyRateCents: 60_000 });
  const off = w.preview(runDoc, { ...run, deductions: [{ employeeId: stranger, goesTo: 'other_income', amountCents: 10_000, reason: 'Canteen for the week' }] });
  expect(off.issues.filter((i) => i.level === 'error').map((i) => i.code)).toEqual(['NOT_IN_RUN']);
});
