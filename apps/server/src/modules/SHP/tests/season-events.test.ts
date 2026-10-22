/** The shop's own events in the website's decorations (the owner's request, Oct 2026). */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { smallPng } from '../../../../test/pictures.ts';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv('2026-11-14T02:00:00Z'); }); // Nov 14: Christmas season by the calendar

const shown = async () => (await env.app.inject({ method: 'GET', url: '/api/shp/season' })).json() as { season: string | null; event: Record<string, unknown> | null };
const anniversary = { name: 'Shop anniversary', startsOn: '2026-11-13', endsOn: '2026-11-16', eyebrow: '4th anniversary', title: 'Thank you,', highlight: 'Silang!',
  text: '10% off made-to-order jerseys this weekend.', barText: 'Anniversary weekend: 10% off jerseys', theme: 'gold', art: 'none', shower: 'confetti', doodles: 'party',
  button: 'quote', buttonLabel: 'Get a quote' };

it('an event on today\'s date shows instead of the season while Automatic; a season picked by hand or Off shows none', async () => {
  expect(await shown()).toEqual({ season: 'christmas', event: null });
  const owner = await env.as('owner');
  const made = await owner.post('/api/shp/season/events', anniversary);
  expect(made.statusCode, made.body).toBe(200);
  const e = made.json();
  const now = await shown();
  expect(now.season).toBeNull();
  expect(now.event).toMatchObject({ id: e.id, eyebrow: '4th anniversary', title: 'Thank you,', highlight: 'Silang!', theme: 'gold', shower: 'confetti', doodles: 'party', hasPicture: false });
  expect(now.event).not.toHaveProperty('name'); // what the website needs only
  expect((await owner.get('/api/shp/season/settings')).json()).toMatchObject({ eventToday: 'Shop anniversary', events: [{ name: 'Shop anniversary' }] });

  // A season picked by hand wins; Off shows nothing; Automatic again shows the event.
  expect((await owner.put('/api/shp/season/settings', { mode: 'summer', version: 0 })).statusCode).toBe(200);
  expect(await shown()).toEqual({ season: 'summer', event: null });
  expect((await owner.put('/api/shp/season/settings', { mode: 'auto', version: 1 })).statusCode).toBe(200);
  expect((await shown()).event).toMatchObject({ id: e.id });

  // Hidden, or outside its dates: the season again.
  const hidden = await owner.put(`/api/shp/season/events/${e.id}`, { ...anniversary, isActive: false }, { 'if-match': '1' });
  expect(hidden.statusCode, hidden.body).toBe(200);
  expect(await shown()).toEqual({ season: 'christmas', event: null });
  expect((await owner.put(`/api/shp/season/events/${e.id}`, { ...anniversary, isActive: true }, { 'if-match': '1' })).statusCode).toBe(409); // an old version
});

it('keeps its own picture for the banner, served while the event shows; checks its words and the picture', async () => {
  const owner = await env.as('owner');
  const png = smallPng();
  const made = await owner.post('/api/shp/season/events', { ...anniversary, art: 'picture', picture: `data:image/png;base64,${png.toString('base64')}` });
  expect(made.statusCode, made.body).toBe(200);
  const pic = await env.app.inject({ method: 'GET', url: `/api/shp/season/events/${made.json().id}/picture` });
  expect(pic.statusCode).toBe(200);
  expect(pic.headers['content-type']).toBe('image/png');
  expect(pic.rawPayload.equals(png)).toBe(true);

  expect((await owner.post('/api/shp/season/events', { ...anniversary, art: 'picture' })).json().code).toBe('PICTURE');
  expect((await owner.post('/api/shp/season/events', { ...anniversary, endsOn: '2026-11-01' })).statusCode).toBe(400);
  expect((await owner.post('/api/shp/season/events', { ...anniversary, picture: 'data:image/png;base64,PHN2Zz4=' })).statusCode).toBe(415); // not a picture
  expect((await (await env.as('production')).post('/api/shp/season/events', anniversary)).statusCode).toBe(403);
});
