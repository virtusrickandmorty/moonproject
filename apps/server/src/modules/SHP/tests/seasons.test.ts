/** The website's seasonal decorations (the owner's request, Oct 2026): the calendar, and the owner's Automatic / Off / pick. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { seasonOfDay } from '../seasons.ts';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv('2026-10-20T02:00:00Z'); });

const shown = async () => (await env.app.inject({ method: 'GET', url: '/api/shp/season' })).json().season as string | null;

it('the calendar: Halloween to Undas, Christmas over the new year, then none until Valentine\'s', () => {
  expect(['2026-10-14', '2026-10-15', '2026-10-31', '2026-11-02', '2026-11-03', '2026-12-25', '2027-01-06', '2027-01-07', '2027-02-14', '2027-04-09', '2027-06-12', '2027-08-01']
    .map(seasonOfDay)).toEqual([null, 'halloween', 'halloween', 'halloween', 'christmas', 'christmas', 'christmas', null, 'valentines', 'summer', 'school', null]);
});

it('shows the calendar\'s season to anyone; the owner or encoder can turn it off or pick one; others cannot', async () => {
  expect(await shown()).toBe('halloween'); // Automatic, on Oct 20
  const owner = await env.as('owner');
  const s = (await owner.get('/api/shp/season/settings')).json();
  expect(s).toMatchObject({ mode: 'auto', version: 0, shownToday: 'halloween', calendarToday: 'halloween' });

  expect((await (await env.as('production')).put('/api/shp/season/settings', { mode: 'off', version: 0 })).statusCode).toBe(403);
  expect((await owner.put('/api/shp/season/settings', { mode: 'christmas', version: 0 })).json()).toMatchObject({ mode: 'christmas', version: 1, shownToday: 'christmas' });
  expect(await shown()).toBe('christmas');
  // Someone else changed it meanwhile.
  expect((await owner.put('/api/shp/season/settings', { mode: 'off', version: 0 })).statusCode).toBe(409);
  expect((await (await env.as('encoder')).put('/api/shp/season/settings', { mode: 'off', version: 1 })).statusCode).toBe(200);
  expect(await shown()).toBe(null);
  expect((await owner.put('/api/shp/season/settings', { mode: 'easter', version: 2 })).statusCode).toBe(400);
});
