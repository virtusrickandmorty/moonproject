/**
 * The customer's order status on their own links (the owner's request, Nov 2026): once the shop makes the job order from an
 * order link answer, that person's link shows where it is, with their own wearers and sizes; once a design is approved,
 * the design link shows the order's status with every wearer. Never a price. Made-up people only.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv, owner: Client;
let polo: string;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  polo = (await owner.post('/api/cat/items', { code: 'POL-1', name: 'Made-up polo', class: 'made_to_order_garment', garmentType: 'Polo', unit: 'pc', setComponents: 1 })).json().id as string;
});

const pub = async (method: 'GET' | 'POST', url: string, payload?: object, ip = '203.0.113.20') => {
  const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: ip });
  return { status: r.statusCode, body: r.json() };
};
type Row = { name: string; personId?: string };
/** Records the job order as the form would: a wearer, or a one-off name. */
async function record(p: { customer: { id: string }; notes: string; lines: { kind: string; description: string; qty: number; roster: Row[] }[] }) {
  const lines = p.lines.map((l) => ({ kind: l.kind, description: l.description, qty: l.qty, unitPriceCents: 50_000, discountCents: 0,
    roster: l.roster.map(({ name, ...r }) => (r.personId ? r : { name, ...r })) }));
  const r = await owner.post('/api/docs/jo.job_order/post', { input: { customerId: p.customer.id, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', notes: p.notes, lines },
    expectedTotalCents: lines.reduce((s, l) => s + l.qty * 50_000, 0) }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}

it("a group member's own link shows the job order made from their answer: its status and their own pieces only, after the link closes too", async () => {
  const school = (await owner.post('/api/cus/customers', { kind: 'organization', displayName: 'Made-up Clinic' })).json().id as string;
  const link = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Clinic polos', closesOn: '2026-10-10', customerId: school, items: [{ itemId: polo, sizing: 'size' }] })).json();
  const member = (name: string, email: string, size: string) => ({ name, gender: 'female', mobile: '0917 000 0000', email, address: '12 Made-up St.',
    people: [{ row: 0, gender: 'female', pieces: [{ lineNo: 1, qty: 1, size }] }] });
  const ana = (await pub('POST', `/api/olk/l/${link.token}/answers`, member('Made-up Ana', 'ana@example.test', 'M'))).body;
  const bea = (await pub('POST', `/api/olk/l/${link.token}/answers`, member('Made-up Bea', 'bea@example.test', 'L'), '203.0.113.21')).body;
  const mine = async (key: string) => (await pub('GET', `/api/olk/l/${link.token}/answers/${key}`)).body;
  expect((await mine(ana.key)).orders).toEqual([]); // no job order yet

  const prepared = (await owner.post(`/api/olk/links/${link.id}/job-order`, { responseIds: [ana.id, bea.id], together: true })).json();
  const jo = await record(prepared);
  expect((await owner.post(`/api/olk/links/${link.id}/close`, {})).json().open).toBe(false);
  const page = (await pub('GET', `/api/olk/l/${link.token}`)).body;
  expect(page.closedOn).not.toBe(page.closesOn); // closed early: the day it closed, not the day it was set to

  const a = await mine(ana.key);
  expect(a.orders).toEqual([{ number: jo.number, stage: 'open', stageLabel: expect.any(String), placedAt: expect.any(String), dueDate: expect.any(String),
    lines: [{ description: 'Made-up polo', qty: 1, wearers: [{ name: 'Made-up Ana', measured: false, size: 'M', qty: 1 }] }] }]);
  expect((await mine(bea.key)).orders[0].lines[0].wearers).toEqual([{ name: 'Made-up Bea', measured: false, size: 'L', qty: 1 }]);
  expect(JSON.stringify(a.orders)).not.toMatch(/Cents|Bea/);
});

it('a team coach sees every player; the design link shows the order with its wearers once the design is approved', async () => {
  const encoder = await env.as('encoder');
  const c = seedCustomers(env.db, encoder.userId);
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 2, unitPriceCents: 50_000, discountCents: 0,
    roster: [{ name: 'Made-up Cruz', sizeMode: 'preset', size: 'L', jerseyName: 'CRUZ', jerseyNumber: '7', qty: 1 }, { name: 'Made-up Reyes', sizeMode: 'preset', size: 'M', qty: 1 }] }] };
  const jo = (await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 100_000 }, idem())).json() as { id: string; number: string };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
  const proof = (await encoder.post(`/api/prf/job-orders/${jo.id}`, { files: [{ name: 'front.png', data: PNG }] })).json() as { token: string };

  expect((await pub('GET', `/api/prf/p/${proof.token}`)).body.order).toBeUndefined(); // not before it is approved
  const approved = await pub('POST', `/api/prf/p/${proof.token}/answer`, { answer: 'approved', name: 'Made-up Coach' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  expect(approved.body.order).toMatchObject({ number: jo.number, lines: [{ description: 'Team jersey set', qty: 2, wearers: [
    { name: 'Made-up Cruz', measured: false, size: 'L', jerseyName: 'CRUZ', jerseyNumber: '7', qty: 1 }, { name: 'Made-up Reyes', measured: false, size: 'M', qty: 1 }] }] });
  expect((await pub('GET', `/api/prf/p/${proof.token}`)).body.order.number).toBe(jo.number);
  expect(JSON.stringify(approved.body)).not.toMatch(/Cents/);

  // A team list: the coach's own link shows every player of the answer.
  const link = (await owner.post('/api/olk/links', { kind: 'team', title: 'Made-up League jerseys', closesOn: '2026-10-05', items: [{ itemId: polo, sizing: 'size' }] })).json();
  const p = (row: number, backName: string, size: string) => ({ row, backName, number: String(row), gender: 'male', pieces: [{ lineNo: 1, qty: 1, size }] });
  const coach = (await pub('POST', `/api/olk/l/${link.token}/answers`, { name: 'Made-up Coach', gender: 'male', mobile: '09180000000', email: 'coach@example.test', address: 'Made-up Gym',
    people: [p(1, 'CRUZ', 'L'), p(2, 'SANTOS', 'M')] })).body;
  const team = await record((await owner.post(`/api/olk/links/${link.id}/job-order`, { responseIds: [coach.id], together: true })).json());
  const seen = (await pub('GET', `/api/olk/l/${link.token}/answers/${coach.key}`)).body.orders;
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ number: team.number, lines: [{ qty: 2, wearers: [
    { name: 'CRUZ', jerseyName: 'CRUZ', jerseyNumber: '1', size: 'L' }, { name: 'SANTOS', jerseyName: 'SANTOS', jerseyNumber: '2', size: 'M' }] }] });
});
