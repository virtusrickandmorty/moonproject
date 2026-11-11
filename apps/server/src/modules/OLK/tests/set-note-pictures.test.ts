/**
 * Order links (the owner's requests, Nov 2026): a set may be one size on top and another below; the shop's note and pictures
 * of the design show at the top of the link. Made-up people only.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv, owner: Client;
let set: string, shirt: string;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  set = (await owner.post('/api/cat/items', { code: 'SET-1', name: 'Made-up jersey set', class: 'made_to_order_garment', garmentType: 'Jersey set', unit: 'set', setComponents: 2 })).json().id as string;
  shirt = (await owner.post('/api/cat/items', { code: 'SHI-1', name: 'Made-up shirt', class: 'made_to_order_garment', garmentType: 'Shirt', unit: 'pc', setComponents: 1 })).json().id as string;
});
const pub = async (method: 'GET' | 'POST', url: string, payload?: object) => {
  const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: '203.0.113.40' });
  return { status: r.statusCode, body: r.statusCode < 300 && r.headers['content-type']?.toString().startsWith('application/json') ? r.json() : r.body, type: r.headers['content-type'] };
};
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

it("lets a set's lower part be another size, and carries it to the job order", async () => {
  expect(set).toBeTruthy();
  const link = (await owner.post('/api/olk/links', { kind: 'team', title: 'Made-up Eagles sets', closesOn: '2026-10-05', items: [{ itemId: set, sizing: 'size' }, { itemId: shirt, sizing: 'size' }] })).json();
  const page = (await pub('GET', `/api/olk/l/${link.token}`)).body;
  expect(page.items.map((it: { isSet?: boolean }) => !!it.isSet)).toEqual([true, false]);

  const answer = (pieces: object[]) => ({ name: 'Made-up Coach', gender: 'male', mobile: '09180000000', email: 'coach@example.test', address: 'Made-up Gym',
    people: [{ row: 1, backName: 'CRUZ', number: '7', gender: 'male', pieces }] });
  const notSet = await pub('POST', `/api/olk/l/${link.token}/answers`, answer([{ lineNo: 2, qty: 1, size: 'L', lowerSize: 'M' }]));
  expect(notSet.status).toBe(400);
  expect(notSet.body).toContain('one size, not a top and a lower size');
  const sent = await pub('POST', `/api/olk/l/${link.token}/answers`, answer([{ lineNo: 1, qty: 1, size: 'L', lowerSize: 'M' }, { lineNo: 2, qty: 1, size: 'L' }]));
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.people[0].pieces).toEqual([{ lineNo: 1, qty: 1, size: 'L', lowerSize: 'M' }, { lineNo: 2, qty: 1, size: 'L' }]);
  // The same size below as on top keeps one size.
  const same = await pub('POST', `/api/olk/l/${link.token}/answers`, { ...answer([{ lineNo: 1, qty: 1, size: 'S', lowerSize: 'S' }]), email: 'other@example.test' });
  expect(same.body.people[0].pieces).toEqual([{ lineNo: 1, qty: 1, size: 'S' }]);

  const detail = (await owner.get(`/api/olk/links/${link.id}`)).json();
  expect(detail.totals[0].sizes).toEqual(expect.arrayContaining([{ size: 'L top / M lower', qty: 1 }, { size: 'S', qty: 1 }]));
  const prepared = (await owner.post(`/api/olk/links/${link.id}/job-order`, { responseIds: [sent.body.id], together: true })).json();
  expect(prepared.lines[0].roster[0]).toMatchObject({ size: 'L', lowerSize: 'M' });
  expect(prepared.lines[1].roster[0]).not.toHaveProperty('lowerSize');
});

it("shows the shop's note and the design pictures at the top of the link; staff change them any time", async () => {
  const link = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Clinic polos', closesOn: '2026-10-05', note: 'Made-up: send your sizes by Friday.', items: [{ itemId: shirt, sizing: 'size' }] })).json();
  expect(link.note).toBe('Made-up: send your sizes by Friday.');
  let page = (await pub('GET', `/api/olk/l/${link.token}`)).body;
  expect(page).toMatchObject({ note: 'Made-up: send your sizes by Friday.', pictures: [] });

  const added = await owner.post(`/api/olk/links/${link.id}/pictures`, { name: 'front.png', data: PNG });
  expect(added.statusCode, added.body).toBe(200);
  const [pic] = added.json().pictures as string[];
  page = (await pub('GET', `/api/olk/l/${link.token}`)).body;
  expect(page.pictures).toEqual([pic]);
  const served = await pub('GET', `/api/olk/l/${link.token}/pictures/${pic}`);
  expect([served.status, served.type]).toEqual([200, 'image/png']);
  expect((await pub('GET', `/api/olk/l/not-this-link-token-abcdefgh/pictures/${pic}`)).status).toBe(404); // only through its own link
  expect((await owner.get(`/api/olk/pictures/${pic}`)).statusCode).toBe(200);

  expect((await owner.post(`/api/olk/links/${link.id}/pictures`, { name: 'notes.txt', data: Buffer.from('not a picture').toString('base64') })).statusCode).toBe(415);
  for (let i = 0; i < 5; i++) await owner.post(`/api/olk/links/${link.id}/pictures`, { name: `p${i}.png`, data: PNG });
  expect((await owner.post(`/api/olk/links/${link.id}/pictures`, { name: 'seventh.png', data: PNG })).json()).toMatchObject({ code: 'TOO_MANY_PICTURES' });

  const off = (await owner.post(`/api/olk/links/${link.id}/pictures/${pic}/remove`, {})).json();
  expect(off.pictures).not.toContain(pic);
  expect((await pub('GET', `/api/olk/l/${link.token}/pictures/${pic}`)).status).toBe(404);
  expect((await owner.put(`/api/olk/links/${link.id}/note`, { note: '' })).json().note).toBe('');
  page = (await pub('GET', `/api/olk/l/${link.token}`)).body;
  expect(page).not.toHaveProperty('note');
  expect(env.db.prepare("SELECT COUNT(*) FROM audit_log WHERE action LIKE 'olk.link.%'").pluck().get()).toBe(9); // made, 6 pictures, one off, the note
  expect((await (await env.as('encoder')).post(`/api/olk/links/${link.id}/pictures`, { name: 'x.png', data: PNG })).statusCode).toBe(200); // the encoder manages links
  expect((await (await env.as('production')).put(`/api/olk/links/${link.id}/note`, { note: 'x' })).statusCode).toBe(403);
});
