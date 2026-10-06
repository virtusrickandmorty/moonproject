import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

const MESSAGE = 'Too many requests. Try again in a few minutes.';
const ADDRESS = '10.20.0.1';
let env: TestEnv;
beforeEach(async () => { env = await createTestEnv(); });
afterEach(async () => { await env.app.close(); env.db.close(); });

const publicRoutes = [
  ['GET', '/api/shp/products', 120],
  ['GET', '/api/shp/photos/sample', 120],
  ['GET', '/api/shp/reviews', 120],
  ['GET', '/api/shp/payment', 120],
  ['GET', '/api/shp/payment/qr/1', 120],
  ['GET', '/api/shp/delivery-fee', 120],
  ['GET', '/api/shp/orders/WEB-000001', 120],
  ['GET', '/robots.txt', 120],
  ['GET', '/sitemap.xml', 120],
  ['GET', '/', 120],
  ['GET', '/shop', 120],
  ['GET', '/services', 120],
  ['GET', '/about', 120],
  ['GET', '/support', 120],
  ['GET', '/track', 120],
  ['GET', '/checkout', 120],
  ['GET', '/orders', 120],
  ['GET', '/order/WEB-000001', 120],
  ['POST', '/api/shp/orders', 30],
  ['POST', '/api/shp/orders/WEB-000001/payment', 30],
  ['POST', '/api/shp/orders/WEB-000001/cancel', 30],
  ['POST', '/api/shp/orders/WEB-000001/reviews', 30],
  ['POST', '/api/shp/track', 20],
] as const;

describe('public shop request limits', () => {
  it('refuses oversized public forms before validation, including picture forms', async () => {
    const forms: [string, number][] = [
      ['/api/shp/orders', 32 * 1024],
      ['/api/shp/orders/WEB-000001/cancel', 4 * 1024],
      ['/api/shp/orders/WEB-000001/reviews', 8 * 1024],
      ['/api/shp/track', 4 * 1024],
      ['/api/shp/orders/WEB-000001/payment', Math.ceil(4 * 1024 * 1024 / 3) * 4 + 4 + 16 * 1024],
    ];
    for (const [url, bytes] of forms) {
      const res = await env.app.inject({ method: 'POST', url, remoteAddress: ADDRESS,
        headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ text: 'a'.repeat(bytes) }) });
      expect(res.statusCode, url).toBe(413);
      expect(res.json().code).toBe('FST_ERR_CTP_BODY_TOO_LARGE');
    }
  });

  it.each(publicRoutes)('limits %s %s per address', async (method, url, limit) => {
    const request = (address = ADDRESS) => env.app.inject({ method, url, remoteAddress: address,
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, payload: '{' } : {}) });
    for (let i = 0; i < limit; i++) expect((await request()).statusCode).not.toBe(429);
    const refused = await request();
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: MESSAGE });
    expect((await request('10.20.0.2')).statusCode).not.toBe(429);
    env.clock.advance(10 * 60_000);
    expect((await request()).statusCode).not.toBe(429);
  });

  it('shares the public allowance across routes and keeps staff routes outside it', async () => {
    const staff = await env.as('owner');
    for (let i = 0; i < 120; i++) {
      expect((await env.app.inject({ method: 'GET', url: i % 2 ? '/api/shp/products' : '/api/shp/reviews' })).statusCode).toBe(200);
    }
    expect((await env.app.inject({ method: 'GET', url: '/api/shp/payment' })).statusCode).toBe(429);
    for (let i = 0; i < 121; i++) expect((await staff.get('/api/shp/admin/products')).statusCode).toBe(200);
    // Staff form parsing still uses the server's normal body limit, even when public requests are exhausted.
    const staffForm = await staff.post('/api/shp/products', { text: 'a'.repeat(40 * 1024) });
    expect(staffForm.statusCode).toBe(400);
    expect(staffForm.json().code).toBe('INVALID_INPUT');
    expect((await env.app.inject({ method: 'GET', url: '/api/sup/messages' })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'GET', url: '/shp/products' })).statusCode).not.toBe(429);
    expect((await env.app.inject({ method: 'GET', url: '/sign-in' })).statusCode).not.toBe(429);
  });
});
