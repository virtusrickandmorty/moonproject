import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import type { ProductInput } from '../routes.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const jersey = (extra: Partial<ProductInput> = {}): ProductInput => ({
  name: 'Sample team jersey', categoryId: jerseys, shape: 'jersey', priceCents: 55_000, regularPriceCents: null, madeToOrder: true, minQty: 10, leadDays: 14,
  badge: 'Best seller', summary: 'A made-up jersey for the tests.', sortOrder: 1, features: ['Names and numbers'],
  sizes: ['XL', 'S', 'M'], colours: [{ name: 'Royal', hex: '#1F3BB3' }], ...extra,
});

let env: TestEnv;
let jerseys = '';
beforeEach(async () => {
  env = await createTestEnv();
  jerseys = ((await (await env.as('owner')).post('/api/shp/categories', { name: 'Jerseys', sortOrder: 1 })).json() as { id: string }).id;
});
const publicList = async () => (await env.app.inject({ method: 'GET', url: '/api/shp/products' })).json() as { id: string; name: string; sizes: string[]; photoUrl: string | null }[];

describe('website shop products', () => {
  it('staff add and change a product, and the website shows the current version without signing in', async () => {
    const owner = await env.as('owner');
    const made = await owner.post('/api/shp/products', jersey());
    expect(made.statusCode, made.body).toBe(200);
    const p = made.json() as { id: string; version: number; sizes: string[]; colours: { hex: string }[] };
    expect(p.sizes).toEqual(['XL', 'S', 'M']); // in the order given, like the colours
    expect(p.colours[0]!.hex).toBe('#1f3bb3');

    const changed = await owner.put(`/api/shp/products/${p.id}`, jersey({ name: 'Renamed jersey', sizes: ['L'], features: [] }), { 'if-match': '1' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ version: 2, name: 'Renamed jersey', sizes: ['L'], features: [] });
    expect((await owner.put(`/api/shp/products/${p.id}`, jersey(), { 'if-match': '1' })).statusCode).toBe(409);
    expect(await publicList()).toMatchObject([{ id: p.id, name: 'Renamed jersey', sizes: ['L'] }]);
  });

  it('puts a product on sale with its regular price shown beside it, and takes it off again', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey({ priceCents: 44_000, regularPriceCents: 55_000 }))).json() as { id: string };
    expect(await publicList()).toMatchObject([{ id: p.id, priceCents: 44_000, regularPriceCents: 55_000 }]);
    // The regular price must be above the price charged, or it is not a sale.
    expect((await owner.put(`/api/shp/products/${p.id}`, jersey({ priceCents: 55_000, regularPriceCents: 55_000 }), { 'if-match': '1' })).statusCode).toBe(400);
    expect((await owner.put(`/api/shp/products/${p.id}`, jersey({ priceCents: 55_000 }), { 'if-match': '1' })).statusCode).toBe(200);
    expect(await publicList()).toMatchObject([{ id: p.id, priceCents: 55_000, regularPriceCents: null }]);
  });

  it('hides and shows a product, keeping its lists', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey())).json() as { id: string };
    expect((await owner.post(`/api/shp/products/${p.id}/hide`, {}, { 'if-match': '1' })).json()).toMatchObject({ isActive: false, version: 2, sizes: ['XL', 'S', 'M'] });
    expect(await publicList()).toEqual([]);
    expect((await owner.post(`/api/shp/products/${p.id}/show`, {}, { 'if-match': '2' })).json()).toMatchObject({ isActive: true, sizes: ['XL', 'S', 'M'] });
    expect(await publicList()).toHaveLength(1);
  });

  it('takes a real photo, refuses anything else, and serves the current one to anyone', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey())).json() as { id: string };
    expect((await owner.post(`/api/shp/products/${p.id}/photo`, Buffer.from('MZ not a photo'), { 'content-type': 'application/octet-stream' })).statusCode).toBe(415);
    const withPhoto = await owner.post(`/api/shp/products/${p.id}/photo`, PNG, { 'content-type': 'application/octet-stream' });
    expect(withPhoto.statusCode, withPhoto.body).toBe(200);
    const url = (withPhoto.json() as { photoUrl: string }).photoUrl;
    const photo = await env.app.inject({ method: 'GET', url });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    await owner.post(`/api/shp/products/${p.id}/photo/remove`, {});
    expect((await env.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await publicList())[0]!.photoUrl).toBeNull();
  });

  it('does not serve the photo of a hidden product, and keeps a shown one for an hour', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey())).json() as { id: string };
    const url = ((await owner.post(`/api/shp/products/${p.id}/photo`, PNG, { 'content-type': 'application/octet-stream' })).json() as { photoUrl: string }).photoUrl;
    const shown = await env.app.inject({ method: 'GET', url });
    expect(shown.statusCode).toBe(200);
    expect(shown.headers['cache-control']).toBe('public, max-age=3600');
    expect((await owner.post(`/api/shp/products/${p.id}/hide`, {}, { 'if-match': '1' })).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await owner.post(`/api/shp/products/${p.id}/show`, {}, { 'if-match': '2' })).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url })).statusCode).toBe(200);
  });

  it('checks the input and the permissions', async () => {
    const owner = await env.as('owner');
    expect((await owner.post('/api/shp/products', jersey({ sizes: [] }))).statusCode).toBe(400);
    expect((await owner.post('/api/shp/products', { ...jersey(), priceCents: 1.5 })).statusCode).toBe(400);
    expect((await owner.post('/api/shp/products', { ...jersey(), colours: [{ name: 'Bad', hex: 'red' }] })).statusCode).toBe(400);
    expect((await (await env.as('accountant')).post('/api/shp/products', jersey())).statusCode).toBe(403);
    expect((await (await env.as('production')).get('/api/shp/admin/products')).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'GET', url: '/api/shp/admin/products' })).statusCode).toBe(401);
  });
});

describe('up to three photos, and sizes typed like the colours (the owner\'s request, Oct 2026)', () => {
  const up = (owner: Awaited<ReturnType<TestEnv['as']>>, id: string, slot: number) => owner.post(`/api/shp/products/${id}/photo?slot=${slot}`, PNG, { 'content-type': 'application/octet-stream' });
  type Shown = { photoUrl: string | null; photoUrls: string[] };

  it('keeps three photos, the first the main one; a removed one moves the others up; a fourth place is refused', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey())).json() as { id: string };
    for (const slot of [1, 2, 3]) expect((await up(owner, p.id, slot)).statusCode).toBe(200);
    expect((await up(owner, p.id, 4)).statusCode).toBe(400);
    const three = (await publicList())[0] as unknown as Shown;
    expect(three.photoUrls).toHaveLength(3);
    expect(three.photoUrl).toBe(three.photoUrls[0]);
    for (const url of three.photoUrls) expect((await env.app.inject({ method: 'GET', url })).statusCode).toBe(200);

    const after = (await owner.post(`/api/shp/products/${p.id}/photo/remove?slot=1`, {})).json() as Shown;
    expect(after.photoUrls).toEqual(three.photoUrls.slice(1)); // the second is the main one now
    expect(after.photoUrl).toBe(three.photoUrls[1]);
    // Slot 3 with two there takes the next free place.
    expect(((await up(owner, p.id, 3)).json() as Shown).photoUrls).toHaveLength(3);
  });

  it('takes any typed size, in the order given, each once; stock is kept by it', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey({ sizes: ['4', '6', '8', 'Free size'], madeToOrder: false }))).json() as { id: string; sizes: string[] };
    expect(p.sizes).toEqual(['4', '6', '8', 'Free size']);
    expect((await owner.post('/api/shp/products', jersey({ sizes: ['M', 'm'] }))).statusCode).toBe(400);
    expect((await owner.post('/api/shp/products', jersey({ sizes: ['x'.repeat(21)] }))).statusCode).toBe(400);
    const s = await owner.post(`/api/shp/products/${p.id}/stock`, { mode: 'in', lines: [{ size: '6', colour: 'Royal', qty: 3 }] });
    expect(s.statusCode, s.body).toBe(200);
    expect((s.json() as { lines: { size: string; onHand: number }[] }).lines.find((l) => l.size === '6')?.onHand).toBe(3);
  });
});
