/** A new job order tells production to choose its steps (the owner's request, Oct 2026); the notice goes once it is routed. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, production: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv();
  [encoder, production] = [await env.as('encoder'), await env.as('production')];
  c = seedCustomers(env.db, encoder.userId);
});

const toRoute = async (who: Client) => ((await who.get('/api/dash/notifications')).json() as { kind: string; id: string; label: string; href?: string; detail?: string }[])
  .filter((n) => n.kind === 'jo-to-route');

it('tells production about a new job order until each of its items has production steps', async () => {
  const lines = [1, 2].map((n) => ({ kind: 'made_to_order', description: `Team shirt ${n}`, qty: 5, unitPriceCents: 30_000, discountCents: 0, roster: [] }));
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: 300_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json() as { id: string; number: string };

  expect(await toRoute(production)).toEqual([expect.objectContaining({ id: `jo-to-route:${jo.id}`, label: `New job order ${jo.number}: choose its production steps`, href: '/prd/board', detail: expect.stringContaining('2 items') })]);

  const setup = (line: number) => production.post(`/api/prd/jobs/${jo.id}/lines/${line}/setup`, { templateId: 1, stepIds: [6, 8], complexity: 'standard' });
  expect((await setup(1)).statusCode).toBe(200);
  expect((await toRoute(production))[0]?.detail).toContain('1 item');
  expect((await setup(2)).statusCode).toBe(200);
  expect(await toRoute(production)).toEqual([]);
});
