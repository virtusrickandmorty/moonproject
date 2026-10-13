/** Notifications come newest first, each with the moment it first came up (the owner's request, Oct 2026). */
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

type Note = { kind: string; id: string; at: string };
const notes = async (who: Client) => ((await who.get('/api/dash/notifications')).json() as Note[]).filter((n) => n.kind === 'jo-to-route');
const newJobOrder = async () => {
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 5, unitPriceCents: 30_000, discountCents: 0, roster: [] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: 150_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as { id: string }).id;
};

it('puts the newest notification on top and keeps the time each one first came up', async () => {
  const first = await newJobOrder();
  const [one] = await notes(production);
  expect(one).toMatchObject({ id: `jo-to-route:${first}`, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*\+08:00$/) });

  env.clock.advance(10 * 60_000);
  const second = await newJobOrder();
  const list = await notes(production);
  expect(list.map((n) => n.id)).toEqual([`jo-to-route:${second}`, `jo-to-route:${first}`]);
  expect(list[1]!.at).toBe(one!.at); // the older one keeps its time
  expect(list[0]!.at > list[1]!.at).toBe(true);
});
