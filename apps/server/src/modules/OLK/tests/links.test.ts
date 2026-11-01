/** Order links (the owner's request, Nov 2026): staff make a link, the customer fills it in, staff review it. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
let top: string, pants: string, jersey: string;
const anon = () => env.app;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const item = async (code: string, name: string) => (await owner.post('/api/cat/items', { code, name, class: 'made_to_order_garment', garmentType: name, unit: 'pc', setComponents: 1 })).json().id as string;
  [top, pants, jersey] = [await item('TOP-1', 'Scrub top'), await item('PNT-1', 'Scrub pants'), await item('JRS-1', 'Team jersey')];
});

const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
  const r = await anon().inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: '203.0.113.7' });
  return { status: r.statusCode, body: r.json() };
};
const member = (o: object = {}) => ({
  name: 'Made-up Member', gender: 'female', mobile: '0917 000 0000', email: 'member@example.test', address: '12 Made-up St., Sta. Cruz',
  people: [{ row: 0, gender: 'female', pieces: [{ lineNo: 1, qty: 2, size: 'M' }, { lineNo: 2, qty: 2 }], measures: { lowerWaist: 30, hips: 39, lowerLength: 39 }, itemMeasures: [] }],
  ...o,
});

async function groupLink() {
  const r = await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Clinic uniforms', closesOn: '2026-10-10', payOwn: true,
    items: [{ itemId: top, sizing: 'size' }, { itemId: pants, sizing: 'measure', fields: ['lowerWaist', 'hips', 'lowerLength'] }] });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; token: string };
}

it('a group link: each member gives their details, sizes and measurements; staff see them with the totals', async () => {
  const link = await groupLink();
  const page = await call('GET', `/api/olk/l/${link.token}`);
  expect(page.body).toMatchObject({ kind: 'group', title: 'Made-up Clinic uniforms', open: true, payOwn: true,
    items: [{ lineNo: 1, name: 'Scrub top', sizing: 'size', fields: [] }, { lineNo: 2, name: 'Scrub pants', sizing: 'measure', fields: ['lowerWaist', 'hips', 'lowerLength'] }] });
  expect(page.body.guide.find((g: { key: string }) => g.key === 'hips').how).toMatch(/fullest part of the hips/);

  const sent = await call('POST', `/api/olk/l/${link.token}/answers`, member());
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.key).toMatch(/^[\w-]{20,}$/);
  expect(sent.body.mobile).toBe('+639170000000');

  const detail = (await owner.get(`/api/olk/links/${link.id}`)).json();
  expect(detail.responses).toHaveLength(1);
  expect(detail.responses[0].people[0]).toMatchObject({ gender: 'female', measures: { lowerWaist: 30, hips: 39, lowerLength: 39 } });
  expect(detail.totals).toEqual([
    { lineNo: 1, name: 'Scrub top', sizes: [{ size: 'M', qty: 2 }], qty: 2 },
    { lineNo: 2, name: 'Scrub pants', sizes: [{ size: 'Measured', qty: 2 }], qty: 2 },
  ]);
});

it('asks for every measurement a made-to-measure item needs, unless they will be measured at the shop; keeps an item\'s own length', async () => {
  const link = await groupLink();
  const missing = await call('POST', `/api/olk/l/${link.token}/answers`, member({ people: [{ ...member().people[0], measures: { lowerWaist: 30 } }] }));
  expect(missing.body).toMatchObject({ code: 'MEASURES', message: 'Your order: type hips, pants length for Scrub pants, or tick "measure me at the shop".' });
  const atShop = await call('POST', `/api/olk/l/${link.token}/answers`, member({ people: [{ ...member().people[0], measures: {}, measureAtShop: true }] }));
  expect(atShop.status).toBe(200);
  // The pants' own length differs from the person's: kept beside it; the same value is not kept twice.
  const own = await call('POST', `/api/olk/l/${link.token}/answers`, member({ people: [{ ...member().people[0],
    itemMeasures: [{ lineNo: 2, field: 'lowerLength', value: 40.5 }, { lineNo: 2, field: 'hips', value: 39 }] }] }));
  expect(own.body.people[0].itemMeasures).toEqual([{ lineNo: 2, field: 'lowerLength', value: 40.5 }]);
  expect((await call('POST', `/api/olk/l/${link.token}/answers`, member({ email: 'not-an-email' }))).body.code).toBe('EMAIL');
  expect((await call('POST', `/api/olk/l/${link.token}/answers`, member({ people: [{ ...member().people[0], pieces: [{ lineNo: 1, qty: 1, size: 'HUGE' }] }] }))).body.code).toBe('SIZE');
});

it('an answer is changed with its own key until the link closes; each change is kept as a new version', async () => {
  const link = await groupLink();
  const { body: first } = await call('POST', `/api/olk/l/${link.token}/answers`, member());
  const changed = await call('PUT', `/api/olk/l/${link.token}/answers/${first.key}`, member({ people: [{ ...member().people[0], pieces: [{ lineNo: 1, qty: 3, size: 'L' }] }] }));
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  expect(changed.body).toMatchObject({ changes: 1, people: [{ pieces: [{ lineNo: 1, qty: 3, size: 'L' }] }] });
  expect((await call('GET', `/api/olk/l/${link.token}/answers/${first.key}`)).body.people[0].pieces).toEqual([{ lineNo: 1, qty: 3, size: 'L' }]);
  expect(env.db.prepare('SELECT COUNT(DISTINCT version) FROM olk_pieces').pluck().get()).toBe(2); // the first is kept
  expect((await call('GET', `/api/olk/l/${link.token}/answers/wrong-key-wrong-key-123`)).status).toBe(404);

  expect((await owner.post(`/api/olk/links/${link.id}/close`, {})).json().open).toBe(false);
  expect((await call('PUT', `/api/olk/l/${link.token}/answers/${first.key}`, member())).body.code).toBe('LINK_CLOSED');
  expect((await call('POST', `/api/olk/l/${link.token}/answers`, member())).body.code).toBe('LINK_CLOSED');
  expect((await owner.post(`/api/olk/links/${link.id}/closes-on`, { closesOn: '2026-10-20' })).json().open).toBe(true);
});

it('a team list: one person gives every player; staff see a number used twice', async () => {
  const r = await owner.post('/api/olk/links', { kind: 'team', title: 'Made-up League jerseys', closesOn: '2026-10-05', items: [{ itemId: jersey, sizing: 'size' }] });
  const link = r.json();
  const player = (row: number, backName: string, number: string, size: string, gender = 'male') => ({ row, backName, number, gender, pieces: [{ lineNo: 1, qty: 1, size }] });
  const sent = await call('POST', `/api/olk/l/${link.token}/answers`, { name: 'Made-up Coach', gender: 'male', mobile: '09180000000', email: 'coach@example.test', address: 'Made-up Gym, Mabini',
    people: [player(1, 'cruz', '7', 'L'), player(2, 'SANTOS', '10', 'S', 'female'), player(3, 'REYES', '10', 'M')] });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.people.map((p: { backName: string }) => p.backName)).toEqual(['CRUZ', 'SANTOS', 'REYES']);
  const detail = (await owner.get(`/api/olk/links/${link.id}`)).json();
  expect(detail.responses[0].checks).toEqual(['Number 10 is used 2 times (SANTOS, REYES)']);
  expect(detail.totals[0]).toMatchObject({ name: 'Team jersey', qty: 3 });
  expect((await call('POST', `/api/olk/l/${link.token}/answers`, { name: 'X Coach', gender: 'male', mobile: '09180000000', email: 'c@example.test', address: 'Made-up Gym', people: [{ row: 1, gender: 'male', pieces: [{ lineNo: 1, qty: 1, size: 'M' }] }] })).body.code).toBe('BACK_NAME');
  expect((await owner.get('/api/olk/links')).json()[0]).toMatchObject({ title: 'Made-up League jerseys', answers: 1, people: 3, open: true });
});

it('needs sign-in and permission for the staff side, and a real link for the customer side', async () => {
  expect((await anon().inject({ method: 'GET', url: '/api/olk/links' })).statusCode).toBe(401);
  expect((await call('GET', '/api/olk/l/no-such-link-at-all-000')).status).toBe(404);
  const tv = await env.as('tv');
  expect((await tv.get('/api/olk/links')).statusCode).toBe(403);
});
