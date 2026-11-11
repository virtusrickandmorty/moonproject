/**
 * Players fill in their own details for the coach (the owner's request, Nov 2026): the coach makes a link for the players,
 * each sends their own row to the coach's list (never to the shop), and only the coach sends the whole list. Made-up people.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv, owner: Client;
let link: { id: string; token: string };
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const shirt = (await owner.post('/api/cat/items', { code: 'SHI-1', name: 'Made-up jersey', class: 'made_to_order_garment', garmentType: 'Jersey', unit: 'pc', setComponents: 1 })).json().id as string;
  link = (await owner.post('/api/olk/links', { kind: 'team', title: 'Made-up Eagles jerseys', closesOn: '2026-10-05', items: [{ itemId: shirt, sizing: 'size' }] })).json();
});
let ip = 10;
const pub = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
  const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: `203.0.113.${++ip}` });
  return { status: r.statusCode, body: r.json() };
};
const player = (backName: string, size: string, number = '7') => ({ backName, number, gender: 'male', pieces: [{ lineNo: 1, qty: 1, size }] });

it("collects each player's own row in the coach's list; only the coach's list reaches the shop", async () => {
  const base = `/api/olk/l/${link.token}`;
  const started = await pub('POST', `${base}/team`, { coachName: 'Coach Made-up' });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const { key, playerToken } = started.body as { key: string; playerToken: string };
  expect((await pub('GET', `${base}/players/${playerToken}`)).body).toEqual({ coachName: 'Coach Made-up' });

  // Two players send their rows; one changes theirs; a bad row is refused with the same checks as the coach's list.
  expect((await pub('POST', `${base}/players/${playerToken}`, player('CRUZ', 'XXXL'))).body.message).toContain('pick a size');
  const cruz = (await pub('POST', `${base}/players/${playerToken}`, player('CRUZ', 'M'))).body;
  const reyes = (await pub('POST', `${base}/players/${playerToken}`, player('REYES', 'L', '12'))).body;
  expect(cruz).toMatchObject({ key: expect.any(String), person: { backName: 'CRUZ', pieces: [{ size: 'M' }] }, onList: false, coachName: 'Coach Made-up' });
  expect((await pub('PUT', `${base}/players/${playerToken}/${cruz.key}`, player('CRUZ', 'L'))).body.person.pieces[0].size).toBe('L');
  expect((await pub('GET', `${base}/players/${playerToken}/${reyes.key}`)).body.person.backName).toBe('REYES'); // a player sees their own row only
  expect((await pub('GET', `${base}/players/${playerToken}/not-a-real-key-123`)).status).toBe(404);

  // Nothing reaches the shop yet.
  expect((await owner.get(`/api/olk/links/${link.id}`)).json().responses).toEqual([]);

  // The coach sees both, takes one off, and sends the list with the other.
  let list = (await pub('GET', `${base}/team/${key}`)).body;
  expect(list.entries.map((e: { person: { backName: string } }) => e.person.backName)).toEqual(['CRUZ', 'REYES']);
  list = (await pub('POST', `${base}/team/${key}/entries/${reyes.id}/remove`)).body;
  expect(list.entries.map((e: { id: string }) => e.id)).toEqual([cruz.id]);
  expect((await pub('PUT', `${base}/players/${playerToken}/${reyes.key}`, player('REYES', 'M'))).body.code).toBe('TAKEN_OFF');
  const sent = await pub('POST', `${base}/answers`, { name: 'Coach Made-up', gender: 'male', mobile: '09180000000', email: 'coach@example.test', address: 'Made-up Gym',
    people: [{ row: 1, ...player('CRUZ', 'L') }, { row: 2, ...player('SANTOS', 'S', '3') }], team: { key, entries: [cruz.id] } });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect((await pub('GET', `${base}/team/${key}`)).body.entries).toEqual([expect.objectContaining({ id: cruz.id, onList: true })]);
  expect((await pub('GET', `${base}/players/${playerToken}/${cruz.key}`)).body.onList).toBe(true);
  expect((await pub('PUT', `${base}/players/${playerToken}/${cruz.key}`, player('CRUZ', 'S'))).body.code).toBe('ON_LIST'); // the coach sent it
  const detail = (await owner.get(`/api/olk/links/${link.id}`)).json();
  expect(detail.responses).toHaveLength(1);
  expect(detail.responses[0].people.map((p: { backName: string }) => p.backName)).toEqual(['CRUZ', 'SANTOS']);

  // A row sent twice with the phone's own key (a retry) is one row; an answer too.
  const clientKey = 'made-up-phone-key-0123456789abcdef';
  const one = (await pub('POST', `${base}/players/${playerToken}`, { ...player('LIM', 'S', '5'), clientKey })).body;
  const two = (await pub('POST', `${base}/players/${playerToken}`, { ...player('LIM', 'S', '5'), clientKey })).body;
  expect([one.key, two.key, two.id]).toEqual([clientKey, clientKey, one.id]);
  const coachAgain = { name: 'Made-up Coach Two', gender: 'female', mobile: '09170000000', email: 'two@example.test', address: 'Made-up Court', people: [{ row: 1, ...player('DIAZ', 'M') }], clientKey: 'made-up-answer-key-0123456789abcd' };
  const a1 = (await pub('POST', `${base}/answers`, coachAgain)).body;
  const a2 = (await pub('POST', `${base}/answers`, coachAgain)).body;
  expect([a1.key, a2.id]).toEqual([coachAgain.clientKey, a1.id]);
  expect((await owner.get(`/api/olk/links/${link.id}`)).json().responses).toHaveLength(2);
  expect((await pub('POST', `${base}/answers`, { ...coachAgain, clientKey: 'short' })).status).toBe(400);

  // Another's key does nothing; the coach's list needs the coach's own key.
  expect((await pub('GET', `${base}/team/${cruz.key}`)).status).toBe(404);
});

it('is for open team lists only', async () => {
  const shirt = (await owner.post('/api/cat/items', { code: 'POL-1', name: 'Made-up polo', class: 'made_to_order_garment', garmentType: 'Polo', unit: 'pc', setComponents: 1 })).json().id as string;
  const group = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Clinic polos', closesOn: '2026-10-05', items: [{ itemId: shirt, sizing: 'size' }] })).json();
  expect((await pub('POST', `/api/olk/l/${group.token}/team`, {})).body.code).toBe('NOT_TEAM');
  const { key, playerToken } = (await pub('POST', `/api/olk/l/${link.token}/team`, {})).body;
  await owner.post(`/api/olk/links/${link.id}/close`, {});
  expect((await pub('POST', `/api/olk/l/${link.token}/players/${playerToken}`, player('CRUZ', 'M'))).body.code).toBe('LINK_CLOSED');
  expect((await pub('GET', `/api/olk/l/${link.token}/team/${key}`)).status).toBe(200); // the coach still sees the list
});
