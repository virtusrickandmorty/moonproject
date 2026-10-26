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

    const names = (await owner.get('/api/nav/search?q=navigation')).json() as { kind: string; label: string }[];
    // The job order is found by its customer's name too, through its summary (the owner's request, 26 Oct 2026).
    expect(new Set(names.map((x) => x.kind))).toEqual(new Set(['Customer', 'Wearer', 'Supplier', 'Employee', 'Document']));
    expect(names).toContainEqual(expect.objectContaining({ kind: 'Document', label: 'JO-000001 · Job Order' }));
    for (const q of ['JO-000001', 'jo 000001', 'jo000001']) {
      const results = (await owner.get(`/api/nav/search?q=${encodeURIComponent(q)}`)).json() as { kind: string; label: string }[];
      expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'Job order', label: 'JO-000001' })]));
      expect(results.filter((r) => r.label.startsWith('JO-000001'))).toHaveLength(1); // shown once, as the job order
    }
  });

  it('finds supplies, price list items, owners and officers, cash accounts and documents by their words', async () => {
    env = await createTestEnv();
    const owner = await env.as('owner'), accountant = await env.as('accountant');
    await accountant.post('/api/pur/supplies', { name: 'Navigation twill', unit: 'yard', category: 'materials' });
    const supplier = (await accountant.post('/api/pur/suppliers', { name: 'Sample Thread House', registeredName: 'Sample Thread House Inc.', isVatRegistered: false })).json();
    await owner.post('/api/eq/people', { name: 'Navigation Owner', isStockholder: true, isOfficer: true, position: 'Treasurer', holderKind: 'individual' });
    const kinds = async (q: string, c = owner) => ((await c.get(`/api/nav/search?q=${encodeURIComponent(q)}`)).json() as { kind: string; label: string; href: string }[]);
    expect(await kinds('navigation')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Supply', label: 'Navigation twill' }),
      expect.objectContaining({ kind: 'Owner or officer', label: 'Navigation Owner' }),
    ]));
    expect(await kinds('treasurer')).toContainEqual(expect.objectContaining({ kind: 'Owner or officer' }));
    expect(await kinds('petty')).toContainEqual(expect.objectContaining({ kind: 'Cash account', label: 'Petty cash fund', href: expect.stringMatching(/^\/cash\/book\?place=\d+$/) }));
    // A purchase order found by its supplier's name, in its summary.
    const twill = env.db.prepare("SELECT id FROM pur_supplies WHERE name = 'Navigation twill'").pluck().get() as string;
    expect((await accountant.post('/api/docs/pur.po/post', { input: { supplierId: supplier.id, lines: [{ supplyId: twill, qty: 1, unitCostCents: 100 }] }, expectedTotalCents: 100 }, idem())).statusCode).toBe(200);
    expect(await kinds('thread house')).toContainEqual(expect.objectContaining({ kind: 'Document', label: 'PO-000001 · Purchase Order' }));
    // Production sees none of these: each kind follows its own view permission.
    expect((await kinds('navigation', await env.as('production'))).map((r) => r.kind)).not.toContain('Owner or officer');
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
