/**
 * The production steps on the customer's order link (the owner's request, Nov 2026): while the job order is being made,
 * each item shows its steps, done, now or later, in the item's own order. A step marked not needed is left out; never the
 * pieces, the workers or the rates. Made-up people only.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedEmployees } from '../../PRD/tests/emp-fixture.ts';

let env: TestEnv, owner: Client, production: Client;
let polo: string;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  production = await env.as('production');
  polo = (await owner.post('/api/cat/items', { code: 'POL-1', name: 'Made-up polo', class: 'made_to_order_garment', garmentType: 'Polo', unit: 'pc', setComponents: 1 })).json().id as string;
});

const pub = async (method: 'GET' | 'POST', url: string, payload?: object, ip = '203.0.113.30') => {
  const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: ip });
  return { status: r.statusCode, body: r.json() };
};
const [LAYOUT, CUTTING, SEWING, PACKING] = [1, 4, 6, 8];

it("shows each item's production steps on the order link while it is being made", async () => {
  const w = seedEmployees(env.db);
  const link = (await owner.post('/api/olk/links', { kind: 'team', title: 'Made-up League polos', closesOn: '2026-10-05', items: [{ itemId: polo, sizing: 'size' }] })).json();
  const p = (row: number, backName: string, size: string) => ({ row, backName, number: String(row), gender: 'male', pieces: [{ lineNo: 1, qty: 1, size }] });
  const coach = (await pub('POST', `/api/olk/l/${link.token}/answers`, { name: 'Made-up Coach', gender: 'male', mobile: '09180000000', email: 'coach@example.test', address: 'Made-up Gym',
    people: [p(1, 'CRUZ', 'L'), p(2, 'SANTOS', 'M')] })).body;
  const prepared = (await owner.post(`/api/olk/links/${link.id}/job-order`, { responseIds: [coach.id], together: true })).json();
  const lines = prepared.lines.map((l: { kind: string; description: string; qty: number; roster: { name: string; personId?: string }[] }) => ({ kind: l.kind, description: l.description, qty: l.qty,
    unitPriceCents: 50_000, discountCents: 0, roster: l.roster.map(({ name, ...r }) => (r.personId ? r : { name, ...r })) }));
  const posted = await owner.post('/api/docs/jo.job_order/post', { input: { customerId: prepared.customer.id, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', notes: prepared.notes, lines },
    expectedTotalCents: 100_000 }, idem());
  expect(posted.statusCode, posted.body).toBe(200);
  const jo = posted.json().id as string;
  const steps = async () => (await pub('GET', `/api/olk/l/${link.token}/answers/${coach.key}`)).body.orders[0].lines[0].steps;

  expect(await steps()).toBeUndefined(); // before the shop sets up the item's steps

  const set = await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [LAYOUT, CUTTING, SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' });
  expect(set.statusCode, set.body).toBe(200);
  expect(await steps()).toEqual([
    { name: 'Layout / Sampling', state: 'later' }, { name: 'Cutting', state: 'later' }, { name: 'Sewing', state: 'later' }, { name: 'Packing', state: 'later' }]);

  // Layout not needed: left out. One of the two cut: cutting is being worked on now.
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${LAYOUT}/not-needed`, { reason: 'Made-up: no sample' })).statusCode).toBe(200);
  const cut = async (pieces: number, employeeId = w.cutter) => {
    const input = { jobOrderId: jo, stepId: CUTTING, rows: [{ lineNo: 1, employeeId, pieces }] };
    const pv = await production.post('/api/docs/prd.entry/preview', { input });
    expect(pv.statusCode, pv.body).toBe(200);
    const r = await production.post("/api/docs/prd.entry/post", { input, expectedTotalCents: pv.json().totalCents }, idem());
    expect(r.statusCode, r.body).toBe(200);
  };
  await cut(1);
  expect(await steps()).toEqual([{ name: 'Cutting', state: 'now' }, { name: 'Sewing', state: 'later' }, { name: 'Packing', state: 'later' }]);
  await cut(1, w.sewer1); // another worker cut the second one
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${CUTTING}/complete`, {})).statusCode).toBeLessThan(500);
  expect((await steps())[0]).toEqual({ name: 'Cutting', state: 'done' });

  const orders = (await pub('GET', `/api/olk/l/${link.token}/answers/${coach.key}`)).body.orders;
  expect(orders[0].stage).toBe('in_production');
  expect(JSON.stringify(orders)).not.toMatch(/Cents|pieces|employee|lineNo/);
});
