import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

describe('PUR Suppliers and Supplies', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  it('can create and view a supplier', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Supplier A',
      registeredName: 'Supplier A Inc.',
      tin: '123-456-789-000',
      isVatRegistered: true,
      ewtClass: 'goods_1',
      paymentTerms: '30 days'
    };

    const res = await api.post('/api/pur/suppliers', input);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();

    const viewRes = await api.get('/api/pur/suppliers');
    expect(viewRes.statusCode).toBe(200);
    const suppliers = viewRes.json();
    expect(suppliers.length).toBe(1);
    expect(suppliers[0].name).toBe('Supplier A');
  });

  it('can edit a supplier', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Supplier B',
      registeredName: 'Supplier B Inc.',
      tin: '111-222-333-000',
      isVatRegistered: false,
      ewtClass: 'none',
    };
    const createRes = await api.post('/api/pur/suppliers', input);
    const id = createRes.json().id;

    const editInput = { ...input, name: 'Supplier B Edit' };
    const editRes = await api.put(`/api/pur/suppliers/${id}`, editInput);
    expect(editRes.statusCode).toBe(200);

    const viewRes = await api.get('/api/pur/suppliers');
    const suppliers = viewRes.json();
    expect(suppliers.find((s: any) => s.id === id).name).toBe('Supplier B Edit');
  });

  it('can deactivate a supplier', async () => {
    const api = await env.as('accountant');
    const input = {
      name: 'Supplier C',
      registeredName: 'Supplier C Inc.',
      tin: '444-555-666-000',
      isVatRegistered: false,
      ewtClass: 'none',
    };
    const createRes = await api.post('/api/pur/suppliers', input);
    const id = createRes.json().id;

    const deactRes = await api.post(`/api/pur/suppliers/${id}/deactivate`, {});
    expect(deactRes.statusCode).toBe(200);

    const viewRes = await api.get('/api/pur/suppliers');
    const suppliers = viewRes.json();
    expect(suppliers.find((s: any) => s.id === id)).toBeUndefined();
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

    const viewRes = await api.get('/api/pur/supplies');
    expect(viewRes.statusCode).toBe(200);
    const supplies = viewRes.json();
    expect(supplies.length).toBe(1);
    expect(supplies[0].name).toBe('Cotton Fabric');
  });

  it('encoder cannot edit suppliers', async () => {
    const api = await env.as('encoder');

    const input = {
      name: 'Supplier X',
      registeredName: 'Supplier X Inc.',
      tin: '000-000-000-000',
      isVatRegistered: false,
      ewtClass: 'none',
    };

    const res = await api.post('/api/pur/suppliers', input);
    expect(res.statusCode).toBe(403);
  });
});
