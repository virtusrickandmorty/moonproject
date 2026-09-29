import { describe, expect, it } from 'vitest';
import { createTestEnv, idem } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';

describe('NAV global search', () => {
  it('finds each permitted kind and accepts spaced document numbers', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const accountant = await env.as('accountant');
    const customer = seedCustomers(env.db, encoder.userId);
    addEmployee(env.db, 'Morgan Sampleworker');
    const supplier = await accountant.post('/api/pur/suppliers', { name: 'Sample Thread House', registeredName: 'Sample Thread House', isVatRegistered: false });
    expect(supplier.statusCode, supplier.body).toBe(200);
    const order = await encoder.post('/api/docs/jo.job_order/post', { input: {
      customerId: customer.school, dueInDays: 8, priority: 'normal', paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Searchable uniforms', qty: 1, unitPriceCents: 10_000, discountCents: 0,
        roster: [{ personId: customer.ari, sizeMode: 'preset', size: 'M', qty: 1 }] }],
    }, expectedTotalCents: 10_000 }, idem());
    expect(order.statusCode, order.body).toBe(200);
    const search = async (q: string) => (await accountant.get(`/api/nav/search?q=${encodeURIComponent(q)}`)).json() as { kind: string; label: string }[];
    expect((await search('test school')).map((x) => x.kind)).toEqual(expect.arrayContaining(['customer', 'job_order']));
    expect((await search('ari')).map((x) => x.kind)).toContain('wearer');
    expect((await search('sample thread')).map((x) => x.kind)).toContain('supplier');
    expect((await search('morgan')).map((x) => x.kind)).toContain('employee');
    const number = order.json().number as string;
    expect((await search(number.toLowerCase().replace('-', ' '))).map((x) => x.kind)).toEqual(expect.arrayContaining(['job_order', 'document']));
    env.db.close();
  });

  it('filters result kinds by their source permission', async () => {
    const env = await createTestEnv();
    const production = await env.as('production');
    const encoder = await env.as('encoder');
    seedCustomers(env.db, encoder.userId);
    const response = await production.get('/api/nav/search?q=test');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([]);
    expect((await production.get('/api/prd/tv')).statusCode).toBe(200);
    env.db.close();
  });
});
