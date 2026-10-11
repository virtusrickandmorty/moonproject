/**
 * The practice shop lets a payroll be tried on a period that has not ended (the owner's request, Oct 2026: to test adding
 * payrolls); the real shop still waits for the period to end (PERIOD_OPEN). Practice is per database, never per process.
 */
import { expect, it } from 'vitest';
import { runDoc } from '../doctypes/run.ts';
import { markPractice } from '../practice.ts';
import { codes, world } from './world.ts';

it('the real shop refuses a period still under way; the practice shop allows it with a warning and offers it on the form', async () => {
  const real = await world('2026-09-30');
  real.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  const open = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-10-01' };
  expect(codes(real.preview(runDoc, open).issues)).toEqual(['PERIOD_OPEN']);

  const practice = await world('2026-09-30');
  markPractice(practice.db);
  const ana = practice.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  practice.attend([{ employeeId: ana, date: '2026-09-30', status: 'present' }]);
  const tried = practice.preview(runDoc, open).issues;
  expect(codes(tried)).not.toContain('PERIOD_OPEN');
  expect(codes(tried, 'warning')).toContain('PRACTICE_PERIOD_OPEN');

  const owner = await practice.env.as('owner');
  const periods = (await owner.get('/api/pay/periods?payGroup=SEMI_DAILY')).json() as { periodStart: string; notEnded?: true }[];
  expect(periods.filter((p) => p.notEnded).map((p) => p.periodStart)).toEqual(['2026-10-16', '2026-10-01']);
  const realOwner = await real.env.as('owner');
  expect(((await realOwner.get('/api/pay/periods?payGroup=SEMI_DAILY')).json() as { notEnded?: true }[]).some((p) => p.notEnded)).toBe(false);
});
