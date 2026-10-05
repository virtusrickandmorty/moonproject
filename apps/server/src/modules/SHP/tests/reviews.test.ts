/**
 * Ratings and reviews: only the buyer of a completed online order (by its secret link) rates its items, once each; the
 * website shows them under the first name and initial; staff hide one with a reason and can show it again.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { shownName } from '../reviews.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
let env: TestEnv;
let owner: Client;
let encoder: Client;
let tee = '';
let placed = { number: '', token: '' };
let orderId = '';
let version = 2;

const send = (url: string, payload: object) => env.app.inject({ method: 'POST', url, payload, remoteAddress: '10.0.0.9' });
const review = (extra: object = {}) => send(`/api/shp/orders/${placed.number}/reviews`, { token: placed.token, productId: tee, rating: 5, title: 'Great fit', body: 'Soft cloth and the print held up after washing.', ...extra });
const shown = async () => (await env.app.inject({ method: 'GET', url: '/api/shp/reviews' })).json() as { productId: string; rating: number; name: string; body: string }[];
const move = async (to: 'ready' | 'completed') => { expect((await encoder.post(`/api/shp/admin/orders/${orderId}/move`, { to, version })).statusCode).toBe(200); version++; };

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  const walkIn = seedCustomers(env.db, encoder.userId).school;
  const category = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
  tee = ((await owner.post('/api/shp/products', {
    name: 'Sample classic tee', categoryId: category, shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2, badge: '',
    summary: 'A made-up tee for the tests.', sortOrder: 1, features: [], sizes: ['M'], colours: [{ name: 'White', hex: '#ffffff' }],
  })).json() as { id: string }).id;
  await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 3 }] });
  await owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample Garments', cashPlaceId: cashPlaceId(env.db, '1111'), qr: { name: 'qr.png', data: PNG } });
  placed = (await send('/api/shp/orders', { name: 'Sample Juan Buyer', email: 'buyer@example.com', phone: '0917 000 0000', fulfilment: 'pickup', consent: true,
    lines: [{ productId: tee, size: 'M', colour: 'White', qty: 1 }] })).json() as { number: string; token: string };
  await send(`/api/shp/orders/${placed.number}/payment`, { token: placed.token, reference: 'REF 123456', proof: { name: 'proof.png', data: PNG } });
  orderId = ((await encoder.get('/api/shp/admin/orders')).json() as { rows: { id: string }[] }).rows[0]!.id;
  version = 2;
  expect((await encoder.post(`/api/shp/admin/orders/${orderId}/confirm`, { customerId: walkIn, invoiceNumber: '9002', crNumber: '9102', version })).statusCode).toBe(200);
  version++;
});

describe('reviews', () => {
  it('open once the order is completed, one per item, shown under the first name and initial', async () => {
    expect((await review()).json().code).toBe('NOT_COMPLETED');
    await move('ready');
    await move('completed');
    expect((await review({ token: 'wrong-token-123' })).statusCode).toBe(404);
    expect((await review({ productId: 'not-on-the-order' })).statusCode).toBe(404);
    expect((await review({ rating: 6 })).statusCode).toBe(400);
    expect((await review({ body: 'ok' })).statusCode).toBe(400);
    expect((await review()).statusCode).toBe(200);
    expect((await review()).json().code).toBe('ALREADY_REVIEWED');
    const status = (await env.app.inject({ method: 'GET', url: `/api/shp/orders/${placed.number}?t=${placed.token}` })).json() as { reviewed: string[] };
    expect(status.reviewed).toEqual([tee]);
    expect(await shown()).toEqual([expect.objectContaining({ productId: tee, rating: 5, name: 'Sample B.' })]);
    expect(JSON.stringify(await shown())).not.toContain('Juan');
  });

  it('are hidden by staff with a reason, shown again, and never changed or deleted', async () => {
    await move('ready');
    await move('completed');
    await review();
    const [r] = (await encoder.get('/api/shp/admin/reviews')).json() as { id: string; version: number; buyer: string }[];
    expect(r!.buyer).toBe('Sample Juan Buyer');
    expect((await env.app.inject({ method: 'GET', url: '/api/shp/admin/reviews' })).statusCode).toBe(401);
    expect((await encoder.post(`/api/shp/admin/reviews/${r!.id}/hide`, { hidden: true, version: 1 })).statusCode).toBe(400);
    expect((await encoder.post(`/api/shp/admin/reviews/${r!.id}/hide`, { hidden: true, reason: 'Wrong product', version: 1 })).statusCode).toBe(200);
    expect(await shown()).toEqual([]);
    expect((await encoder.post(`/api/shp/admin/reviews/${r!.id}/hide`, { hidden: false, version: 1 })).json().code).toBe('STALE');
    expect((await encoder.post(`/api/shp/admin/reviews/${r!.id}/hide`, { hidden: false, version: 2 })).statusCode).toBe(200);
    expect(await shown()).toHaveLength(1);
    expect(() => env.db.prepare('UPDATE shp_reviews SET rating = 1').run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare('DELETE FROM shp_reviews').run()).toThrow();
  });

  it('show a name without the surname', () => {
    expect(shownName('Juan dela Cruz')).toBe('Juan C.');
    expect(shownName('  Ana  ')).toBe('Ana');
  });
});
