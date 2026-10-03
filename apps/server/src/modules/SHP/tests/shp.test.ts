import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import type { ProductInput } from '../routes.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const jersey = (extra: Partial<ProductInput> = {}): ProductInput => ({
  name: 'Sample team jersey', category: 'Jerseys', shape: 'jersey', priceCents: 55_000, madeToOrder: true, minQty: 10, leadDays: 14,
  badge: 'Best seller', summary: 'A made-up jersey for the tests.', sortOrder: 1, features: ['Names and numbers'],
  sizes: ['XL', 'S', 'M'], colours: [{ name: 'Royal', hex: '#1F3BB3' }], ...extra,
});

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv(); });
const publicList = async () => (await env.app.inject({ method: 'GET', url: '/api/shp/products' })).json() as { id: string; name: string; sizes: string[]; photoUrl: string | null }[];

describe('website shop products', () => {
  it('staff add and change a product, and the website shows the current version without signing in', async () => {
    const owner = await env.as('owner');
    const made = await owner.post('/api/shp/products', jersey());
    expect(made.statusCode, made.body).toBe(200);
    const p = made.json() as { id: string; version: number; sizes: string[]; colours: { hex: string }[] };
    expect(p.sizes).toEqual(['S', 'M', 'XL']);
    expect(p.colours[0]!.hex).toBe('#1f3bb3');

    const changed = await owner.put(`/api/shp/products/${p.id}`, jersey({ name: 'Renamed jersey', sizes: ['L'], features: [] }), { 'if-match': '1' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ version: 2, name: 'Renamed jersey', sizes: ['L'], features: [] });
    expect((await owner.put(`/api/shp/products/${p.id}`, jersey(), { 'if-match': '1' })).statusCode).toBe(409);
    expect(await publicList()).toMatchObject([{ id: p.id, name: 'Renamed jersey', sizes: ['L'] }]);
  });

  it('hides and shows a product, keeping its lists', async () => {
    const owner = await env.as('owner');
    const p = (await owner.post('/api/shp/products', jersey())).json() as { id: string };
    expect((await owner.post(`/api/shp/products/${p.id}/hide`, {}, { 'if-match': '1' })).json()).toMatchObject({ isActive: false, version: 2, sizes: ['S', 'M', 'XL'] });
    expect(await publicList()).toEqual([]);
    expect((await owner.post(`/api/shp/products/${p.id}/show`, {}, { 'if-match': '2' })).json()).toMatchObject({ isActive: true, sizes: ['S', 'M', 'XL'] });
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
