import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type TestEnv } from '../../../../test/helpers.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env?.db.close(); env = undefined; });

describe('global search', () => {
  it('finds every kind and accepts document numbers without spaces or punctuation', async () => {
    env = await createTestEnv();
    const owner = await env.as('owner');
    const customer = (await owner.post('/api/cus/customers', { kind: 'organization', displayName: 'Navigation Academy' })).json();
    await owner.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Navigation Wearer' });
    await owner.post('/api/pur/suppliers', { name: 'Navigation Textiles', registeredName: 'Navigation Textiles Inc.', isVatRegistered: false });
    addEmployee(env.db, 'Navigation Employee');
    const input = { customerId: customer.id, dueInDays: 5, priority: 'normal', paymentTerms: 'cod', lines: [
      { kind: 'made_to_order', description: 'Sample shirts', qty: 2, unitPriceCents: 10_000, discountCents: 0, roster: [] },
    ] };
    const jo = await owner.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 20_000 }, idem());
    expect(jo.statusCode).toBe(200);

    const names = (await owner.get('/api/nav/search?q=navigation')).json() as { kind: string }[];
    expect(new Set(names.map((x) => x.kind))).toEqual(new Set(['Customer', 'Wearer', 'Supplier', 'Employee']));
    for (const q of ['JO-000001', 'jo 000001', 'jo000001']) {
      const results = (await owner.get(`/api/nav/search?q=${encodeURIComponent(q)}`)).json() as { kind: string; label: string }[];
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'Job order', label: 'JO-000001' }),
        expect.objectContaining({ kind: 'Document' }),
      ]));
    }
  });

  it('filters each source by its own view permission and validates the query', async () => {
    env = await createTestEnv();
    const production = await env.as('production');
    expect((await production.get('/api/nav/search?q=x')).statusCode).toBe(400);
    const results = (await production.get('/api/nav/search?q=sample')).json() as { kind: string }[];
    expect(results.every((x) => !['Customer', 'Job order', 'Supplier', 'Employee'].includes(x.kind))).toBe(true);
    expect((await production.get('/api/nav/search?q=sample')).statusCode).toBe(200);
  });
});
