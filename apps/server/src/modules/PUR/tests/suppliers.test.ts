import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

describe('PUR Suppliers and Supplies', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    env.db.close();
    await env.app.close();
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
    expect(audit.user_id).toBe(api.userId);
    expect(audit.at).toContain('+08:00'); // Check for stamp() usage (local time)

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

    await api.post(`/api/pur/suppliers/${id}/deactivate`, {}, { 'if-match': `"${version}"` });

    const editRes = await api.put(`/api/pur/suppliers/${id}`, { ...input, name: 'x' }, { 'if-match': `"${version + 1}"` });
    expect(editRes.statusCode).toBe(400);
  });

  it('cannot deactivate an unknown supplier', async () => {
    const api = await env.as('accountant');
    const deactRes = await api.post(`/api/pur/suppliers/9999/deactivate`, {}, { 'if-match': '"1"' });
    expect(deactRes.statusCode).toBe(404);
  });

  it('can create and view a supply', async () => {
    const api = await env.as('accountant');

    const input = {
      name: 'Cotton Fabric',
      unit: 'yard',
      category: 'materials',
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
    };

    const res = await api.post('/api/pur/supplies', input);
    const { id, version } = res.json();

    // Update name
    const updateInput = {
      ...input,
      name: 'New Name',
    };

    const editRes = await api.put(`/api/pur/supplies/${id}`, updateInput, { 'if-match': `"${version}"` });
    expect(editRes.statusCode).toBe(200);

    let viewRes = await api.get('/api/pur/supplies');
    let supplies = viewRes.json();
    expect(supplies.find((s: any) => s.id === id).name).toBe('New Name');
    expect(supplies.find((s: any) => s.id === id).last_purchase_cost_cents).toBe(0); // Kept 0

    const deactRes = await api.post(`/api/pur/supplies/${id}/deactivate`, {}, { 'if-match': `"${version + 1}"` });
    expect(deactRes.statusCode).toBe(200);

    viewRes = await api.get('/api/pur/supplies');
    supplies = viewRes.json();
    expect(supplies.find((s: any) => s.id === id)).toBeUndefined();
  });

  it('can manage supplier contacts', async () => {
    const api = await env.as('accountant');

    // Create supplier
    const supInput = { name: 'Supplier X', registeredName: 'Supplier X Inc.', isVatRegistered: false };
    const supRes = await api.post('/api/pur/suppliers', supInput);
    const supId = supRes.json().id;

    // Create contact
    const contactInput = { name: 'John Doe', phone: '+639171234567', isActive: true };
    const contactRes = await api.post(`/api/pur/suppliers/${supId}/contacts`, contactInput);
    expect(contactRes.statusCode).toBe(200);
    const contactId = contactRes.json().id;

    // View contact
    const viewRes = await api.get(`/api/pur/suppliers/${supId}/contacts`);
    expect(viewRes.statusCode).toBe(200);
    const contacts = viewRes.json();
    expect(contacts.length).toBe(1);
    expect(contacts[0].name).toBe('John Doe');

    // Deactivate contact
    const deactRes = await api.post(`/api/pur/suppliers/${supId}/contacts/${contactId}/deactivate`, {});
    expect(deactRes.statusCode).toBe(200);

    const viewRes2 = await api.get(`/api/pur/suppliers/${supId}/contacts`);
    expect(viewRes2.json().length).toBe(0);
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
