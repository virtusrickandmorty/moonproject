/**
 * The weekly piece payroll's week (setting pay.week_start; the owner's decision, Oct 9, 2026): Monday to Saturday before,
 * Friday to Thursday from Friday, 9 October 2026. The week reaching the change ends the day before it; no day is in two
 * periods and none is left out.
 */
import { describe, expect, it } from 'vitest';
import { periodEndOf, semiStartOf, weekStartOf, type PeriodRule, type WeekRule } from '../run-calc.ts';
import { runDoc } from '../doctypes/run.ts';
import { world } from './world.ts';

const SHOP: WeekRule = { startsOn: (day) => (day >= '2026-10-09' ? 'friday' : 'monday'), changes: ['2026-10-09'] };

describe('weekly periods across the change to Friday weeks', () => {
  it('Monday to Saturday before, Friday to Thursday after; the straddling week ends the day before the change', () => {
    expect(periodEndOf('WEEKLY_PIECE', '2026-09-28', SHOP)).toBe('2026-10-03'); // Mon–Sat
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-05', SHOP)).toBe('2026-10-08'); // Mon–Thu: cut at the change
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-09', SHOP)).toBe('2026-10-15'); // Fri–Thu
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-16', SHOP)).toBe('2026-10-22');
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-12', SHOP)).toBeUndefined(); // a Monday no longer opens a week
    expect(weekStartOf('2026-10-13', SHOP)).toBe('2026-10-09');
    expect(weekStartOf('2026-10-07', SHOP)).toBe('2026-10-05');
    expect(weekStartOf('2026-10-04', SHOP)).toBeUndefined(); // a Sunday under Monday-to-Saturday weeks
    expect(periodEndOf('SEMI_DAILY', '2026-10-01', SHOP)).toBe('2026-10-15'); // the other groups do not change
  });
  it('a change day that is not a Friday opens a short week to the Thursday', () => {
    const odd: WeekRule = { startsOn: (day) => (day >= '2026-10-07' ? 'friday' : 'monday'), changes: ['2026-10-07'] };
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-05', odd)).toBe('2026-10-06');
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-07', odd)).toBe('2026-10-08');
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-09', odd)).toBe('2026-10-15');
  });
});

it('the shop as shipped pays a Friday-to-Thursday week and refuses a Monday start after the change', async () => {
  const w = await world('2026-10-23', { fridayWeeks: true });
  const ben = w.person('Ben Lingguhan', { payType: 'daily', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000 });
  w.attend(['16', '17', '19', '20', '21', '22'].map((d) => ({ employeeId: ben, date: `2026-10-${d}`, status: 'present' })));
  const run = w.preview(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-10-16' });
  expect(run.issues.filter((i) => i.level === 'error')).toEqual([]);
  expect((run.doc as { periodEnd: string }).periodEnd).toBe('2026-10-22');
  expect(w.preview(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-10-12' }).issues).toContainEqual(expect.objectContaining({ code: 'PERIOD', message: 'A weekly payroll starts on a Friday (Friday to Thursday).' }));
});

it('a weekly run leaves off whoever has nothing to pay that week, and names them', async () => {
  const w = await world('2026-09-28');
  const ben = w.person('Ben Lingguhan', { payType: 'daily', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000 });
  w.person('Cora Walangtrabaho', { payType: 'daily', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000 });
  w.attend(['21', '22'].map((d) => ({ employeeId: ben, date: `2026-09-${d}`, status: 'present' })));
  const run = w.preview(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-21' });
  expect((run.doc as { employees: { name: string }[] }).employees.map((e) => e.name)).toEqual(['Ben Lingguhan']);
  expect(run.issues).toContainEqual(expect.objectContaining({ code: 'NOTHING_TO_PAY', message: 'Nothing to pay this week, so not on this run: Cora Walangtrabaho.' }));
});

describe('semi-monthly cut-offs on the 10th and 25th from Oct 16, 2026 (the owner\'s decision, Oct 9, 2026)', () => {
  const CUT: PeriodRule = { startsOn: () => 'monday', changes: [], semi: (day) => (day >= '2026-10-16' ? '10_25' : 'calendar'), semiChanges: ['2026-10-16'] };
  it('1–15 and 16–end before; Oct 16–25 to switch; then 26th–10th and 11th–25th, across month and year ends', () => {
    expect(periodEndOf('SEMI_MONTHLY', '2026-10-01', CUT)).toBe('2026-10-15');
    expect(periodEndOf('SEMI_MONTHLY', '2026-10-16', CUT)).toBe('2026-10-25'); // the short switch-over period
    expect(periodEndOf('SEMI_MONTHLY', '2026-10-26', CUT)).toBe('2026-11-10');
    expect(periodEndOf('SEMI_DAILY', '2026-11-11', CUT)).toBe('2026-11-25');
    expect(periodEndOf('SEMI_MONTHLY', '2026-12-26', CUT)).toBe('2027-01-10');
    expect(periodEndOf('SEMI_MONTHLY', '2027-02-11', CUT)).toBe('2027-02-25');
    expect(periodEndOf('SEMI_MONTHLY', '2026-11-01', CUT)).toBeUndefined(); // the 1st and 16th no longer open a period
    expect(periodEndOf('SEMI_MONTHLY', '2026-11-16', CUT)).toBeUndefined();
    expect([semiStartOf('2026-11-05', CUT), semiStartOf('2026-10-20', CUT), semiStartOf('2026-10-03', CUT)]).toEqual(['2026-10-26', '2026-10-16', '2026-10-01']);
    expect(periodEndOf('WEEKLY_PIECE', '2026-10-19', CUT)).toBe('2026-10-24'); // the weekly group keeps its own rule
  });
});

it('the shop as shipped pays Oct 26 – Nov 10 in November and refuses a period starting on the 1st after the change', async () => {
  const w = await world('2026-11-12', { fridayWeeks: true, cutoff1025: true });
  w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
  const run = w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-26' });
  expect(run.issues.filter((i) => i.level === 'error')).toEqual([]);
  expect(run.doc as { periodEnd: string; contributionMonth: string }).toMatchObject({ periodEnd: '2026-11-10', contributionMonth: '2026-11' });
  expect(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-11-01' }).issues).toContainEqual(expect.objectContaining({ code: 'PERIOD', message: 'A semi-monthly payroll starts on the 26th or the 11th (26th to 10th, 11th to 25th).' }));
});

it('as shipped, Friday weeks start on Oct 2, 2026: Sep 28 – Oct 1, then Oct 2–8, Oct 9–15', async () => {
  const w = await world('2026-10-20', { fridayWeeks: true });
  const { periodRuleOf } = await import('../run-calc.ts');
  const rule = periodRuleOf(w.db);
  expect(rule.changes).toEqual(['2026-10-02']); // the Oct 9 version repeats Friday: no change on that day
  expect(['2026-09-28', '2026-10-02', '2026-10-09'].map((d) => periodEndOf('WEEKLY_PIECE', d, rule))).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
  expect(periodEndOf('WEEKLY_PIECE', '2026-10-05', rule)).toBeUndefined();
});

it('a weekly daily-paid group: its own Friday-to-Thursday run on the weekly tax table, apart from the piece-rate run', async () => {
  const w = await world('2026-10-23', { fridayWeeks: true });
  const dina = w.person('Dina Lingguhan', { payType: 'daily', payGroup: 'WEEKLY_DAILY', dailyRateCents: 60_000 });
  w.person('Pia Piraso', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
  w.attend(['16', '17', '19', '20', '21', '22'].map((d) => ({ employeeId: dina, date: `2026-10-${d}`, status: 'present' })));
  const run = w.preview(runDoc, { payGroup: 'WEEKLY_DAILY', periodStart: '2026-10-16' });
  expect(run.issues.filter((i) => i.level === 'error')).toEqual([]);
  const doc = run.doc as { periodEnd: string; taxFrequency: string; employees: { name: string; grossCents: number }[] };
  expect([doc.periodEnd, doc.taxFrequency]).toEqual(['2026-10-22', 'weekly']);
  expect(doc.employees.map((e) => [e.name, e.grossCents])).toEqual([['Dina Lingguhan', 6 * 60_000]]);
  const piece = w.preview(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-10-16' }).doc as { employees: { name: string }[] };
  expect(piece.employees.map((e) => e.name)).not.toContain('Dina Lingguhan');
});
