/**
 * The weekly piece payroll's week (setting pay.week_start; the owner's decision, Oct 9, 2026): Monday to Saturday before,
 * Friday to Thursday from Friday, 9 October 2026. The week reaching the change ends the day before it; no day is in two
 * periods and none is left out.
 */
import { describe, expect, it } from 'vitest';
import { periodEndOf, weekStartOf, type WeekRule } from '../run-calc.ts';
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
