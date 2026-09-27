import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { today } from '../../../platform/clock.ts';
import { newId } from '@moonproject/shared';

describe('SZR Sizer Tracker', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    env.db.close();
    await env.app.close();
  });

  it('can create and view a sizer set', async () => {
    const api = await env.as('encoder');

    const input = {
      code: 'SET-A',
      garmentType: 'T-Shirt',
      sizesIncluded: 'XS, S, M, L, XL',
      status: 'in shop',
    };

    const res = await api.post('/api/szr/sets', input);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();

    const viewRes = await api.get('/api/szr/sets');
    expect(viewRes.statusCode).toBe(200);
    const sets = viewRes.json();
    expect(sets.length).toBe(1);
    expect(sets[0].code).toBe('SET-A');
  });

  it('can edit a set with version check', async () => {
    const api = await env.as('encoder');

    const input = {
      code: 'SET-B',
      garmentType: 'Polo',
      sizesIncluded: 'S, M, L',
      status: 'in shop',
    };
    const createRes = await api.post('/api/szr/sets', input);
    const { id, version } = createRes.json();

    const editInput = { ...input, garmentType: 'Polo Shirt' };

    // Missing If-Match
    const failRes = await api.put(`/api/szr/sets/${id}`, editInput);
    expect(failRes.statusCode).toBe(428);

    // Bad version
    const failRes2 = await api.put(`/api/szr/sets/${id}`, editInput, { 'if-match': '"99"' });
    expect(failRes2.statusCode).toBe(409);

    // Correct version
    const editRes = await api.put(`/api/szr/sets/${id}`, editInput, { 'if-match': `"${version}"` });
    expect(editRes.statusCode).toBe(200);

    const viewRes = await api.get(`/api/szr/sets/${id}`);
    const setRecord = viewRes.json();
    expect(setRecord.garment_type).toBe('Polo Shirt');
  });

  it('cannot edit an inactive set', async () => {
    const api = await env.as('encoder');
    const input = { code: 'SET-C', garmentType: 'Shorts', sizesIncluded: 'M', status: 'in shop' };
    const createRes = await api.post('/api/szr/sets', input);
    const { id, version } = createRes.json();

    await api.post(`/api/szr/sets/${id}/deactivate`, {}, { 'if-match': `"${version}"` });

    const editRes = await api.put(`/api/szr/sets/${id}`, { ...input, garmentType: 'Pants' }, { 'if-match': `"${version + 1}"` });
    expect(editRes.statusCode).toBe(400);
  });

  it('can create a loan, updating set status to lent', async () => {
    const api = await env.as('encoder');

    // Create customer first
    const custId = newId();
    env.db.prepare('INSERT INTO cus_customers (id, code, kind, display_name, registered_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(custId, 'CUS-999', 'person', 'Test Customer', 'Test Customer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    const setInput = { code: 'SET-L', garmentType: 'Jacket', sizesIncluded: 'M', status: 'in shop' };
    const createSetRes = await api.post('/api/szr/sets', setInput);
    const setId = createSetRes.json().id;

    // Create loan
    const todayDate = today(env.clock);
    const expectedReturn = todayDate.substring(0, 8) + (parseInt(todayDate.substring(8, 10)) + 2).toString().padStart(2, '0'); // approx +2 days
    const loanInput = {
      setId,
      customerId: custId,
      expectedReturnDate: expectedReturn,
    };

    const loanRes = await api.post('/api/szr/loans', loanInput);
    expect(loanRes.statusCode).toBe(200);
    const loanId = loanRes.json().id;

    // Check loan creation
    const loansRes = await api.get('/api/szr/loans');
    const loans = loansRes.json();
    expect(loans.length).toBe(1);
    expect(loans[0].customer_id).toBe(custId);
    expect(loans[0].date_out).toBe(todayDate);

    // Check set status
    const setRes = await api.get(`/api/szr/sets/${setId}`);
    expect(setRes.json().status).toBe('lent');
  });

  it('can return a loan, updating set status and recording condition', async () => {
    const api = await env.as('encoder');

    const custId = newId();
    env.db.prepare('INSERT INTO cus_customers (id, code, kind, display_name, registered_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(custId, 'CUS-998', 'person', 'Test Customer 2', 'Test Customer 2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    const setInput = { code: 'SET-R', garmentType: 'Vest', sizesIncluded: 'M', status: 'in shop' };
    const setId = (await api.post('/api/szr/sets', setInput)).json().id;

    const expectedReturn = '2030-01-01';
    const loanId = (await api.post('/api/szr/loans', { setId, customerId: custId, expectedReturnDate: expectedReturn })).json().id;

    // Return loan
    const returnInput = {
      status: 'in shop',
      conditionOnReturn: 'Good condition',
    };
    const returnRes = await api.post(`/api/szr/loans/${loanId}/return`, returnInput);
    expect(returnRes.statusCode).toBe(200);

    // Check loan status
    const loansRes = await api.get('/api/szr/loans');
    const returnedLoan = loansRes.json().find((l: any) => l.id === loanId);
    expect(returnedLoan.returned_date).toBeDefined();
    expect(returnedLoan.condition_on_return).toBe('Good condition');

    // Check set status
    const setRes = await api.get(`/api/szr/sets/${setId}`);
    expect(setRes.json().status).toBe('in shop');
  });

  it('lists overdue loans correctly', async () => {
    const api = await env.as('encoder');

    const custId = newId();
    env.db.prepare('INSERT INTO cus_customers (id, code, kind, display_name, registered_name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(custId, 'CUS-997', 'person', 'Test Customer 3', 'Test Customer 3', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    const setInput = { code: 'SET-O', garmentType: 'Cap', sizesIncluded: 'One Size', status: 'in shop' };
    const setId = (await api.post('/api/szr/sets', setInput)).json().id;

    const todayDate = today(env.clock);
    const pastDate = '2020-01-01';

    // Directly insert an overdue loan (bypassing normal endpoint which prevents past dates)
    const loanId = newId();
    env.db.prepare(`
      INSERT INTO szr_loans (id, set_id, customer_id, date_out, expected_return_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(loanId, setId, custId, '2019-12-01', pastDate, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    env.db.prepare("UPDATE szr_sets SET status = 'lent' WHERE id = ?").run(setId);

    const overdueRes = await api.get('/api/szr/loans/overdue');
    expect(overdueRes.statusCode).toBe(200);
    const overdueLoans = overdueRes.json();

    expect(overdueLoans.length).toBeGreaterThanOrEqual(1);
    expect(overdueLoans.find((l: any) => l.id === loanId)).toBeDefined();
  });

  it('production role cannot edit sets or loans (403 test)', async () => {
    const api = await env.as('production');

    const setInput = {
      code: 'SET-PROD',
      garmentType: 'T-Shirt',
      sizesIncluded: 'M',
      status: 'in shop',
    };

    const res = await api.post('/api/szr/sets', setInput);
    expect(res.statusCode).toBe(403);
  });

  it('unsigned user gets 401', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/szr/sets' });
    expect(res.statusCode).toBe(401);
  });
});
