/** The job order list: the document list's rows with each balance due, and a search that reads what was ordered. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from './cus-fixture.ts';
import { searchWords } from '../list.ts';

let env: TestEnv;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

async function jobOrder(descriptions: string[], unitPriceCents = 50_000, customerId = c.school): Promise<{ id: string; number: string }> {
  const lines = descriptions.map((description) => ({ kind: 'made_to_order', description, qty: 2, unitPriceCents, discountCents: 0, roster: [] }));
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines },
    expectedTotalCents: lines.length * 2 * unitPriceCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
type Row = { id: string; number: string; status: string; totalCents: number; balanceDueCents: number; matchedItem: string | null };
const list = async (query = '') => (await encoder.get(`/api/jo/list${query}`)).json() as Row[];
const numbers = async (q: string) => (await list(`?q=${encodeURIComponent(q)}`)).map((r) => r.number);

describe('job order list', () => {
  it('shows each balance due as the job order view works it out, nothing for a cancelled one, newest first', async () => {
    const first = await jobOrder(['Team jersey set'], 50_000);
    const second = await jobOrder(['Polo shirt'], 30_000);
    const cancelled = await jobOrder(['Cap'], 10_000);
    expect((await encoder.post(`/api/docs/jo.job_order/${cancelled.id}/cancel`, { reason: 'Customer changed their mind' }, idem())).statusCode).toBe(200);

    const rows = await list();
    expect(rows.map((r) => r.number)).toEqual([cancelled.number, second.number, first.number]);
    for (const r of rows.filter((x) => x.status === 'posted')) {
      const status = (await encoder.get(`/api/jo/orders/${r.id}/status`)).json() as { money: { balanceDueCents: number } };
      expect(r.balanceDueCents).toBe(status.money.balanceDueCents);
      expect(r.balanceDueCents).toBe(r.totalCents);
    }
    expect(rows[0]).toMatchObject({ status: 'cancelled', balanceDueCents: 0 });
    expect((await list('?status=posted&limit=1')).map((r) => r.number)).toEqual([second.number]);
  });

  it('finds an order by words of its items, in any order, plural or singular, hyphenated or not', async () => {
    const rowing = await jobOrder(['Jersey for the rowing team', 'Shorts']);
    const shirts = await jobOrder(['T-shirt, white, school logo']);
    await jobOrder(['Embroidered cap']);

    expect(await numbers('rowing jerseys')).toEqual([rowing.number]);
    expect(await numbers('TEAM jersey')).toEqual([rowing.number]);
    expect(await numbers('tshirt')).toEqual([shirts.number]);
    expect(await numbers('t shirts logo')).toEqual([shirts.number]);
    expect(await numbers('jersey cap')).toEqual([]); // every word has to be found
    expect(await numbers(shirts.number)).toEqual([shirts.number]); // the number and the customer still work
    expect((await list('?q=rowing+jersey'))[0]!.matchedItem).toBe('Jersey for the rowing team');
    expect((await list(`?q=${shirts.number}`))[0]!.matchedItem).toBeNull();
    expect((await encoder.get('/api/jo/list/counts?q=shirt')).json()).toEqual({ all: 1, posted: 1, cancelled: 0 });
    expect((await encoder.get('/api/jo/list/counts')).json()).toEqual({ all: 3, posted: 3, cancelled: 0 });
  });

  it('takes typed wildcards literally and refuses a long search or a wrong date', async () => {
    await jobOrder(['Hoodie']);
    expect(await numbers('%')).toEqual([]);
    expect(await numbers('_oodie')).toEqual([]);
    expect((await encoder.get(`/api/jo/list?q=${'x'.repeat(101)}`)).statusCode).toBe(400);
    expect((await encoder.get('/api/jo/list?from=2026-13-01')).statusCode).toBe(400);
  });

  it('needs the job order view permission', async () => {
    const production = await env.as('production');
    expect((await production.get('/api/jo/list')).statusCode).toBe(403);
    expect((await production.get('/api/jo/list/counts')).statusCode).toBe(403);
  });

  it('reads each word as typed and without its plural ending', () => {
    expect(searchWords('Rowing  Jerseys, boxes ')).toEqual(['rowing', 'jersey', 'box']);
    expect(searchWords('dress polos')).toEqual(['dress', 'polo']);
  });
});
