import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

describe('PUR Suppliers and Supplies', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(() => {
    env.db.close();
  });

  it('can create and view a supplier', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Supplier A',
      registeredName: 'Supplier A Inc.',
      tin: '123-456-789-000',
      isVatRegistered: true,
      ewtClass: 'goods_1',
      paymentTermsDays: 30
    };

    const res = await api.post('/api/pur/suppliers', input);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();

    // Check audit trail
    const audit = env.db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(body.id) as any;
    expect(audit).toBeDefined();
    expect(audit.action).toBe('pur.supplier.create');

    const viewRes = await api.get('/api/pur/suppliers');
    expect(viewRes.statusCode).toBe(200);
    const suppliers = viewRes.json();
    expect(suppliers.length).toBe(1);
    expect(suppliers[0].name).toBe('Supplier A');
  });

  it('can edit a supplier with version check', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Supplier B',
      registeredName: 'Supplier B Inc.',
      isVatRegistered: false,
    };
    const createRes = await api.post('/api/pur/suppliers', input);
    const { id, version } = createRes.json();

    const editInput = { ...input, name: 'Supplier B Edit' };

    // Missing If-Match
    const failRes = await api.put(`/api/pur/suppliers/${id}`, editInput);
    expect(failRes.statusCode).toBe(428);

    // Bad version
    const failRes2 = await api.put(`/api/pur/suppliers/${id}`, editInput, { 'if-match': '"99"' });
    expect(failRes2.statusCode).toBe(409);

    // Correct version
    const editRes = await api.put(`/api/pur/suppliers/${id}`, editInput, { 'if-match': `"${version}"` });
    expect(editRes.statusCode).toBe(200);

    const viewRes = await api.get('/api/pur/suppliers');
    const suppliers = viewRes.json();
    expect(suppliers.find((s: any) => s.id === id).name).toBe('Supplier B Edit');
  });

  it('cannot edit an inactive supplier', async () => {
    const api = await env.as('accountant');
    const input = { name: 'Supplier C', registeredName: 'Supplier C Inc.', isVatRegistered: false };
    const createRes = await api.post('/api/pur/suppliers', input);
    const { id, version } = createRes.json();

    await api.post(`/api/pur/suppliers/${id}/deactivate`, {});

    const editRes = await api.put(`/api/pur/suppliers/${id}`, { ...input, name: 'x' }, { 'if-match': `"${version + 1}"` });
    expect(editRes.statusCode).toBe(400);
  });

  it('cannot deactivate an unknown supplier', async () => {
    const api = await env.as('accountant');
    const deactRes = await api.post(`/api/pur/suppliers/9999/deactivate`, {});
    expect(deactRes.statusCode).toBe(404);
  });

  it('can create and view a supply', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Cotton Fabric',
      unit: 'yard',
      category: 'materials',
      lastPurchaseCostCents: 15000,
    };

    const res = await api.post('/api/pur/supplies', input);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();

    // Check audit trail
    const audit = env.db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').get(body.id) as any;
    expect(audit).toBeDefined();
    expect(audit.action).toBe('pur.supply.create');

    const viewRes = await api.get('/api/pur/supplies');
    expect(viewRes.statusCode).toBe(200);
    const supplies = viewRes.json();
    expect(supplies.length).toBe(1);
    expect(supplies[0].name).toBe('Cotton Fabric');
  });

  it('can edit and deactivate a supply', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Old Name',
      unit: 'meter',
      category: 'ready_made',
      lastPurchaseCostCents: 15000,
    };

    const res = await api.post('/api/pur/supplies', input);
    const { id, version } = res.json();

    // Update name but attempt to change lastPurchaseCostCents (should be ignored)
    const updateInput = {
      ...input,
      name: 'New Name',
      lastPurchaseCostCents: 99999,
    };

    const editRes = await api.put(`/api/pur/supplies/${id}`, updateInput, { 'if-match': `"${version}"` });
    expect(editRes.statusCode).toBe(200);

    let viewRes = await api.get('/api/pur/supplies');
    let supplies = viewRes.json();
    expect(supplies.find((s: any) => s.id === id).name).toBe('New Name');
    expect(supplies.find((s: any) => s.id === id).last_purchase_cost_cents).toBe(15000);

    const deactRes = await api.post(`/api/pur/supplies/${id}/deactivate`, {});
    expect(deactRes.statusCode).toBe(200);

    viewRes = await api.get('/api/pur/supplies');
    supplies = viewRes.json();
    expect(supplies.find((s: any) => s.id === id)).toBeUndefined();
  });

  it('encoder cannot edit suppliers', async () => {
    const api = await env.as('encoder');

    const input = {
      name: 'Supplier X',
      registeredName: 'Supplier X Inc.',
      isVatRegistered: false,
    };

    const res = await api.post('/api/pur/suppliers', input);
    expect(res.statusCode).toBe(403);
  });

  it('unsigned user gets 401', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/pur/suppliers' });
    expect(res.statusCode).toBe(401);
  });
});
