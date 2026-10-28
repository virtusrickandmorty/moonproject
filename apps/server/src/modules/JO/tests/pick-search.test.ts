/**
 * The job order and release pickers search word by word (the owner's request, Oct 28, 2026): every typed word, in any
 * order, in the number, customer, contact or items (job orders) or the invoice number (releases); the one numbered as
 * typed first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
});
afterEach(async () => { await env.app.close(); env.db.close(); });

async function jobOrder(customerId: string, description: string, qty = 2): Promise<{ id: string; number: string }> {
  const input = { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description, qty, unitPriceCents: 50_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: qty * 50_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to })).statusCode).toBe(200);
  return { id: r.json().id, number: r.json().number };
}
const orders = async (q: string) => ((await encoder.get(`/api/jo/pick/orders?q=${encodeURIComponent(q)}`)).json() as { number: string }[]).map((r) => r.number);
const releases = async (q: string) => ((await encoder.get(`/api/jo/pick/releases?q=${encodeURIComponent(q)}`)).json() as { number: string }[]).map((r) => r.number);

describe('job order and release search', () => {
  it('finds job orders by every word in any order, by the items on them, and the one numbered as typed first', async () => {
    const polo = await jobOrder(c.school, 'Embroidered polo shirt'); // JO-000001
    const jersey = await jobOrder(c.other, 'Basketball jersey set'); // JO-000002
    expect(await orders('school moonlight')).toEqual([polo.number]);
    expect(await orders('jersey')).toEqual([jersey.number]);
    expect(await orders('lantern basketball')).toEqual([jersey.number]);
    expect(await orders('polo lantern')).toEqual([]);
    expect((await orders('2'))[0]).toBe(jersey.number);
    expect((await orders('000001'))[0]).toBe(polo.number);
  });

  it('finds releases by the invoice number written on them, and by number without the prefix', async () => {
    const jo = await jobOrder(c.school, 'Team jersey');
    const body = { release: { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 2 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 },
      invoice: { invoiceNumber: '0777' }, expectedTotalCents: 100_000 };
    const res = await accountant.post('/api/jo/releases', body, idem());
    expect(res.statusCode, res.body).toBe(200);
    const rel = res.json().release.number as string;
    expect(await releases('0777')).toEqual([rel]);
    expect(await releases('moonlight 0777')).toEqual([rel]);
    expect(await releases('1')).toEqual([rel]);
    expect(await releases('0778')).toEqual([]);
  });
});
