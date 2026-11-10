/**
 * Custom fit on an order link (the owner's request, Nov 2026): an item in standard sizes may let a person pick "Custom fit"
 * and give their own measurements instead of a size, and the shop gets an alert in the bell to check them.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
let polo: string, cap: string;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const item = async (code: string, name: string) => (await owner.post('/api/cat/items', { code, name, class: 'made_to_order_garment', garmentType: name, unit: 'pc', setComponents: 1 })).json().id as string;
  [polo, cap] = [await item('POL-1', 'Made-up polo'), await item('CAP-1', 'Made-up cap')];
});

const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
  const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: '203.0.113.9' });
  return { status: r.statusCode, body: r.json() };
};
const answer = (pieces: object[], o: object = {}) => ({
  name: 'Made-up Member', gender: 'male', mobile: '0917 000 0000', email: 'fit@example.test', address: '12 Made-up St., Sta. Cruz',
  people: [{ row: 0, gender: 'male', pieces, measures: { shoulder: 17, chest: 40, upperLength: 29 }, itemMeasures: [], ...o }],
});

async function link() {
  const r = await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Office polos', closesOn: '2026-10-10',
    items: [{ itemId: polo, sizing: 'size', customFit: true, fields: ['shoulder', 'chest', 'upperLength'] }, { itemId: cap, sizing: 'size' }] });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; token: string };
}

it('staff allow a custom fit on an item in sizes, with the measurements it then needs', async () => {
  const none = await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Office polos', closesOn: '2026-10-10', items: [{ itemId: polo, sizing: 'size', customFit: true }] });
  expect(none.json()).toMatchObject({ code: 'FIELDS', message: 'Made-up polo: pick the measurements a custom fit needs.' });
  const l = await link();
  expect((await call('GET', `/api/olk/l/${l.token}`)).body.items).toEqual([
    { lineNo: 1, name: 'Made-up polo', sizing: 'size', customFit: true, fields: ['shoulder', 'chest', 'upperLength'] },
    { lineNo: 2, name: 'Made-up cap', sizing: 'size', customFit: false, fields: [] }]);
});

it('a member picks custom fit instead of a size and gives the measurements; staff see it, the totals, the job order and the bell alert', async () => {
  const l = await link();
  const url = `/api/olk/l/${l.token}/answers`;
  // Only where staff allowed it; a custom fit or a size, not both; every measurement it needs, or measured at the shop.
  expect((await call('POST', url, answer([{ lineNo: 2, qty: 1, customFit: true }]))).body.code).toBe('CUSTOM_FIT');
  expect((await call('POST', url, answer([{ lineNo: 1, qty: 1, customFit: true, size: 'M' }]))).body.code).toBe('CUSTOM_FIT');
  expect((await call('POST', url, answer([{ lineNo: 1, qty: 1, customFit: true }], { measures: { chest: 40 } }))).body)
    .toMatchObject({ code: 'MEASURES', message: 'Your order: type shoulder, top length for Made-up polo, or tick "measure me at the shop".' });
  expect((await call('POST', url, answer([{ lineNo: 1, qty: 1, customFit: true }], { measures: {}, measureAtShop: true }))).status).toBe(200);

  const sent = await call('POST', url, answer([{ lineNo: 1, qty: 2, customFit: true }, { lineNo: 2, qty: 1, size: 'L' }]));
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.people[0].pieces).toEqual([{ lineNo: 1, qty: 2, customFit: true }, { lineNo: 2, qty: 1, size: 'L' }]);

  const d = (await owner.get(`/api/olk/links/${l.id}`)).json();
  expect(d.responses[1].checks).toContain('Custom fit: Made-up Member. Check the measurements before the job order');
  expect(d.totals[0]).toEqual({ lineNo: 1, name: 'Made-up polo', sizes: [{ size: 'Custom fit, measure at the shop', qty: 1 }, { size: 'Custom fit', qty: 2 }], qty: 3 });

  // The job order: the custom fit is made to the member's measurements (a wearer with a chart), the cap in its size.
  const jo = await owner.post(`/api/olk/links/${l.id}/job-order`, { responseIds: [sent.body.id], together: false });
  expect(jo.statusCode, jo.body).toBe(200);
  const [poloLine, capLine] = jo.json().lines;
  expect(poloLine.roster).toEqual([expect.objectContaining({ sizeMode: 'measured', qty: 2, notes: 'Custom fit', personId: expect.any(String) })]);
  expect(capLine.roster).toEqual([expect.objectContaining({ sizeMode: 'preset', size: 'L', qty: 1 })]);

  const bell = (await owner.get('/api/dash/notifications')).json();
  const fits = ((bell.items ?? bell) as { kind: string; label: string; detail?: string; href?: string }[]).filter((n) => n.kind === 'olk-custom-fit');
  expect(fits).toHaveLength(2);
  expect(fits).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Custom fit on "Made-up Office polos": Made-up Member', href: `/olk?open=${l.id}`,
    detail: 'Made-up polo · measurements given: check them' })]));
});
