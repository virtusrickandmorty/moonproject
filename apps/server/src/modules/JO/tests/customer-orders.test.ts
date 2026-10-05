/** A customer's orders for the Customers screen: recorded job orders, newest first, with stage and balance due. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

async function jobOrder(customerId: string, unitPriceCents: number): Promise<{ id: string; number: string }> {
  const input = { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 10, unitPriceCents, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 10 * unitPriceCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
type Order = { kind: string; docType: string; number: string; stage: string; totalCents: number; balanceDueCents: number };
const ordersOf = async (customerId: string, as = encoder) => (await as.get(`/api/jo/customers/${customerId}/orders`)).json() as Order[];

describe("a customer's orders", () => {
  it('lists recorded job orders newest first, with stage and balance, and leaves out cancelled ones and other customers', async () => {
    const first = await jobOrder(c.school, 50_000);
    const second = await jobOrder(c.school, 60_000);
    const cancelled = await jobOrder(c.school, 70_000);
    await jobOrder(c.other, 80_000);
    expect((await encoder.post(`/api/docs/jo.job_order/${cancelled.id}/cancel`, { reason: 'Customer changed their mind' }, idem())).statusCode).toBe(200);
    await encoder.post(`/api/jo/orders/${second.id}/stage`, { from: 'open', to: 'in_production' });

    const orders = await ordersOf(c.school);
    expect(orders.map((o) => o.number)).toEqual([second.number, first.number]);
    expect(orders[0]).toMatchObject({ kind: 'job_order', docType: 'jo.job_order', stage: 'In production', totalCents: 600_000, balanceDueCents: 600_000 });
    expect(orders[1]).toMatchObject({ stage: 'Open', totalCents: 500_000 });
  });

  it('needs the job order view permission', async () => {
    expect((await (await env.as('production')).get(`/api/jo/customers/${c.school}/orders`)).statusCode).toBe(403);
    expect(await ordersOf(c.school)).toEqual([]);
  });
});
