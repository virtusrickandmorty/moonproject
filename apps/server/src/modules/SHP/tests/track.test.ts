/** The website's tracking page: an online order or a job order, by its number alone: the status, dates and how many pieces only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { LOOKUPS_PER_SENDER } from '../track.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
let env: TestEnv;
let owner: Client;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;
const track = (number: string, ip = '10.1.1.1', token?: string) => env.app.inject({ method: 'POST', url: '/api/shp/track', payload: { number, ...(token ? { token } : {}) }, remoteAddress: ip });

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

async function jobOrder(): Promise<{ id: string; number: string }> {
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 12, unitPriceCents: 50_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 600_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}

describe('tracking', () => {
  it('shows a job order recorded in the ERP by its number: status, dates and pieces, never a name, an amount or what the lines say', async () => {
    const jo = await jobOrder();
    await encoder.post(`/api/jo/orders/${jo.id}/stage`, { from: 'open', to: 'in_production' });
    const found = await track(jo.number.toLowerCase());
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json()).toMatchObject({ kind: 'job_order', number: jo.number, status: 'in_production', statusLabel: 'In production', pieces: 12 });
    const shown = JSON.stringify(found.json());
    expect(shown).not.toContain('Team jersey set'); // staff-written line descriptions are for the shop
    expect(found.json()).not.toHaveProperty('lines');
    expect(shown).not.toContain('Moonlight'); // the customer's name
    expect(shown).not.toMatch(/Cents/); // no amounts or balances
    expect((await track('JO-999999')).statusCode).toBe(404);
  });

  it('follows an edited job order to the copy that stands now', async () => {
    const jo = await jobOrder();
    const edited = await encoder.post(`/api/docs/jo.job_order/${jo.id}/reissue`, {
      input: { customerId: c.school, dueInDays: 20, priority: 'rush', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 14, unitPriceCents: 50_000, discountCents: 0, roster: [] }] },
      expectedTotalCents: 700_000, reason: 'Two more players joined' }, idem());
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await track(jo.number)).json()).toMatchObject({ number: edited.json().number, pieces: 14 });
  });

  it('shows an online order by its number alone as status, dates and pieces; its secret token also shows the items', async () => {
    const cat = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
    const tee = ((await owner.post('/api/shp/products', { name: 'Sample tee', categoryId: cat, shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2,
      badge: '', summary: 'A made-up tee.', sortOrder: 1, features: [], sizes: ['M'], colours: [{ name: 'White', hex: '#ffffff' }] })).json() as { id: string }).id;
    await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 5 }] });
    await owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample', cashPlaceId: cashPlaceId(env.db, '1111'), qr: { name: 'qr.png', data: PNG },
      deliveryOptions: [{ name: 'Metro Manila', feeCents: 15_000, places: ['Quezon City'] }] });
    const placed = (await env.app.inject({ method: 'POST', url: '/api/shp/orders', remoteAddress: '10.2.2.2', payload: {
      name: 'Sample Buyer', email: 'buyer@example.com', phone: '0918-555-0101', fulfilment: 'delivery', address: '1 Sample St, Brgy. Uno', city: 'Quezon City', province: 'Metro Manila', consent: true,
      lines: [{ productId: tee, size: 'M', colour: 'White', qty: 2 }] } })).json() as { number: string; token: string };
    expect(placed.number, JSON.stringify(placed)).toBeTruthy();
    const found = (await track(placed.number)).json();
    expect(found).toMatchObject({ kind: 'online', status: 'awaiting_payment', statusLabel: 'Waiting for your payment', pieces: 2 });
    expect(JSON.stringify(found)).not.toMatch(/Sample Buyer|0918|buyer@|Cents|Sample tee|White|"M"|Quezon|Metro Manila|delivery|pickup|lines/i);
    // A wrong token is the same as none; the right one shows the items, as the order page does.
    expect((await track(placed.number, '10.1.1.2', 'wrong-token-1234')).json()).not.toHaveProperty('lines');
    const full = (await track(placed.number, '10.1.1.3', placed.token)).json();
    expect(full).toMatchObject({ pieces: 2, fulfilment: 'delivery', deliveryOption: 'Metro Manila', lines: [{ description: 'Sample tee (White, M)', qty: 2 }] });
    expect(JSON.stringify(full)).not.toMatch(/Sample Buyer|0918|buyer@|Cents/);
  });

  it('limits how many lookups one sender makes', async () => {
    for (let i = 0; i < LOOKUPS_PER_SENDER; i++) expect((await track(`JO-${String(i).padStart(6, '0')}`, '10.9.9.9')).statusCode).toBe(404);
    expect((await track('JO-000001', '10.9.9.9')).statusCode).toBe(429);
    expect((await track('JO-000001', '10.9.9.8')).statusCode).toBe(404);
  });
});
