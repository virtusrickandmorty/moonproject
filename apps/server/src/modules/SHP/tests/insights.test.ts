/** Website visitor insights (the owner's request, Oct 2026): anonymous events from the website, summarised for staff. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv('2026-10-20T02:00:00Z'); });

const send = (body: object, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile', ip = '10.30.0.1') => env.app.inject({ method: 'POST', url: '/api/shp/events',
  remoteAddress: ip, headers: { 'content-type': 'application/json', 'user-agent': ua }, payload: JSON.stringify(body) });

it('takes anonymous events from anyone and gives staff the visitors, the products looked at most, searches and where visitors come from', async () => {
  const a = { visitor: 'visitora1b2c3', session: 'sessiona1' }, b = { visitor: 'visitorb1b2c3', session: 'sessionb1' };
  expect((await send({ ...a, events: [{ kind: 'page', page: '/', source: 'facebook.com' }, { kind: 'product', productId: 'polo-1' }, { kind: 'product', productId: 'polo-1' },
    { kind: 'cart', productId: 'polo-1' }, { kind: 'search', query: 'Polo', results: 3 }, { kind: 'category', category: 'Uniforms' }] })).statusCode).toBe(204);
  expect((await send({ ...b, events: [{ kind: 'page', page: '/' }, { kind: 'page', page: '/services' }, { kind: 'product', productId: 'jersey-1' },
    { kind: 'search', query: 'hoodie', results: 0 }, { kind: 'quote' }] }, 'Mozilla/5.0 (Windows NT 10.0)')).statusCode).toBe(204);

  const owner = await env.as('owner');
  const s = (await owner.get('/api/shp/insights?days=7')).json();
  expect(s).toMatchObject({ visitors: 2, visits: 2, pageViews: 3, funnel: { product: 2, cart: 1, quote: 1 } });
  expect(s.products[0]).toMatchObject({ productId: 'polo-1', views: 2, viewers: 1, carts: 1 });
  expect(s.searches).toEqual(expect.arrayContaining([{ query: 'polo', times: 1, noResults: 0 }, { query: 'hoodie', times: 1, noResults: 1 }]));
  expect(s.sources).toEqual(expect.arrayContaining([{ source: 'facebook.com', visits: 1 }, { source: 'direct', visits: 1 }]));
  expect(s.devices).toEqual(expect.arrayContaining([{ device: 'phone', visitors: 1 }, { device: 'computer', visitors: 1 }]));
  expect(s.categories).toEqual([{ category: 'Uniforms', times: 1 }]);
  // Nothing that names the visitor or their address is kept.
  const cols = (env.db.prepare('PRAGMA table_info(shp_events)').all() as { name: string }[]).map((c) => c.name);
  expect(cols.some((c) => /ip|address|agent|name|email/.test(c))).toBe(false);
  // Staff only.
  expect((await env.app.inject({ method: 'GET', url: '/api/shp/insights' })).statusCode).toBe(401);
});

it('refuses what is not an event, and limits each address on its own allowance', async () => {
  expect((await send({ visitor: 'x', session: 'sessiona1', events: [{ kind: 'page', page: '/' }] })).statusCode).toBe(400);
  expect((await send({ visitor: 'visitora1b2c3', session: 'sessiona1', events: [{ kind: 'login', page: '/' }] })).statusCode).toBe(400);
  expect((await send({ visitor: 'visitora1b2c3', session: 'sessiona1', events: [{ kind: 'page', page: 'https://evil.example' }] })).statusCode).toBe(400);
  for (let i = 0; i < 57; i++) expect((await send({ visitor: 'visitora1b2c3', session: 'sessiona1', events: [{ kind: 'page', page: '/' }] })).statusCode).toBe(204);
  expect((await send({ visitor: 'visitora1b2c3', session: 'sessiona1', events: [{ kind: 'page', page: '/' }] })).statusCode).toBe(429);
  // The shop itself still answers that address: counting has its own allowance.
  expect((await env.app.inject({ method: 'GET', url: '/api/shp/products', remoteAddress: '10.30.0.1' })).statusCode).toBe(200);
});
