/**
 * Daily-paid staff moved from the semi-monthly 26th–10th / 11th–25th periods to the Friday-to-Thursday weeks of the
 * piece workers (the owner's request, Oct 2026): the move starts the day after the last paid day, even if that is in
 * the past, and the first weekly payroll pays only the days the old group's did not.
 */
import { expect, it } from 'vitest';
import { addPayProfile } from '../../EMP/employees.ts';
import { runDoc } from '../doctypes/run.ts';
import { world } from './world.ts';

type Employee = { employeeId: string; grossCents: number };
const days = (list: string[]) => list.map((d) => `2026-10-${d}`);

it('moves a daily-paid employee to the weekly group after the last paid day, and the first week pays only the days left', async () => {
  const w = await world('2026-10-31', { fridayWeeks: true, cutoff1025: true });
  const id = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  // Mon-Sat Oct 16-29, Sundays off.
  w.attend(days(['16', '17', '19', '20', '21', '22', '23', '24', '26', '27', '28', '29']).map((date) => ({ employeeId: id, date, status: 'present' })));
  w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-10-16' }); // pays Oct 16-25

  const move = { payType: 'daily', dailyRateCents: 60_000, payGroup: 'WEEKLY_DAILY', workweekDays: 6, isMwe: false, reason: 'Weekly cut-off like the piece workers' };
  // Not on a day already paid, nor with a new rate in the past.
  expect(() => addPayProfile(w.db, id, { ...move, effectiveFrom: '2026-10-25' }, w.who())).toThrow(/today or later/);
  expect(() => addPayProfile(w.db, id, { ...move, effectiveFrom: '2026-10-26', dailyRateCents: 65_000 }, w.who())).toThrow(/today or later/);
  addPayProfile(w.db, id, { ...move, effectiveFrom: '2026-10-26' }, w.who());

  // The week of Oct 23-29 pays Oct 26-29 (4 days), not the 23rd-25th the semi-monthly run paid.
  const week = w.preview(runDoc, { payGroup: 'WEEKLY_DAILY', periodStart: '2026-10-23' });
  expect(week.issues.filter((i) => i.level === 'error')).toEqual([]);
  expect((week.doc as { employees: Employee[] }).employees).toEqual([expect.objectContaining({ employeeId: id, grossCents: 240_000 })]);
  w.record(runDoc, { payGroup: 'WEEKLY_DAILY', periodStart: '2026-10-23' });
  // The semi-monthly period of Oct 26 - Nov 10 no longer has her.
  expect((w.preview(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-10-26' }).doc as { employees: Employee[] }).employees).toEqual([]);
});
