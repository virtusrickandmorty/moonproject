/** The home's cards (the owner's request, Oct 2026): each role gets the cards it may see, read from the same data as the reports. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from '../../PRD/tests/emp-fixture.ts';

let env: TestEnv;
let encoder: Client, production: Client, owner: Client;
let c: ReturnType<typeof seedCustomers>;
let w: ReturnType<typeof seedEmployees>;
beforeEach(async () => {
  env = await createTestEnv();
  [encoder, production, owner] = [await env.as('encoder'), await env.as('production'), await env.as('owner')];
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

type Cards = {
  asOf: string; kpis: { key: string; value: number }[]; jobs: { total: number; toRoute: number; rows: { number: string; status: string; step: string | null; dueDate: string }[] } | null;
  activity: { today: number; workersToday: number; days: { pieces: number }[] } | null; calendar: { days: { date: string; due: number }[] } | null; stages: { key: string; count: number }[] | null;
};
const cards = async (who: Client) => (await who.get('/api/dash/cards')).json() as Cards;

it('gives each role its cards: money for the owner, the floor for production, and follows a job order from route to work', async () => {
  const order = (description: string) => encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 5, priority: 'rush', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description, qty: 4, unitPriceCents: 30_000, discountCents: 0, roster: [] }] }, expectedTotalCents: 120_000 }, idem());
  const a = (await order('Team shirt')).json() as { id: string; number: string };
  const b = (await order('Shorts')).json() as { id: string; number: string };
  expect((await production.post(`/api/prd/jobs/${a.id}/lines/1/setup`, { templateId: 1, stepIds: [6, 8], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  const input = { jobOrderId: a.id, stepId: 6, rows: [{ lineNo: 1, employeeId: w.sewer1, pieces: 3 }] };
  const p = await production.post('/api/docs/prd.entry/preview', { input });
  expect((await production.post('/api/docs/prd.entry/post', { input, expectedTotalCents: p.json().totalCents }, idem())).statusCode).toBe(200);

  const mine = await cards(owner);
  expect(mine.kpis.map((k) => k.key)).toEqual(['sales', 'collections', 'open', 'cash']);
  expect(mine.kpis.find((k) => k.key === 'open')!.value).toBe(2);
  expect(mine.jobs!.rows.map((r) => [r.number, r.status, r.step])).toEqual([[a.number, 'in_production', 'Sewing'], [b.number, 'to_route', null]]);
  expect(mine.stages!.map((s) => [s.key, s.count])).toEqual([['not_started', 1], ['in_production', 1], ['ready', 0], ['released', 0]]);
  // The calendar is this month's: the job orders due in it (5 days out may be next month).
  expect(mine.calendar!.days.reduce((n, d) => n + d.due, 0)).toBe(mine.jobs!.rows.filter((r) => r.dueDate.startsWith(mine.asOf.slice(0, 7))).length);

  const floor = await cards(production);
  expect(floor.kpis.map((k) => k.key)).toEqual(['open', 'in_production', 'ready', 'pieces']); // no money for production
  expect(floor.activity).toMatchObject({ today: 3, workersToday: 1 });
  expect(floor.activity!.days).toHaveLength(7);

  // Sales (encoders) have the accountant's access since the owner's decision of 6 Oct 2026, so they see the money too.
  expect((await cards(encoder)).kpis.map((k) => k.key)).toEqual(['sales', 'collections', 'open', 'cash']);
});
