/** robots.txt and sitemap.xml: the public website is listed under the address the visitor used; private pages are kept out. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv(); });
const get = (url: string, host = 'shop.example.ph') => env.app.inject({ method: 'GET', url, headers: { host } });

describe('search engines', () => {
  it('may read the website and the shop data it shows, but not order pages, checkout, sign-in or the rest of the API', async () => {
    const res = await get('/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('Allow: /api/shp/products');
    for (const path of ['/api/', '/order/', '/checkout', '/sign-in']) expect(res.body).toContain(`Disallow: ${path}`);
    expect(res.body).toContain('Sitemap: http://shop.example.ph/sitemap.xml');
  });

  it('get a sitemap of the public pages, and a made-up host never reaches it', async () => {
    const res = await get('/sitemap.xml');
    expect(res.headers['content-type']).toMatch(/^application\/xml/);
    for (const path of ['/', '/services', '/about', '/support']) expect(res.body).toContain(`<loc>http://shop.example.ph${path}</loc>`);
    expect(res.body).not.toContain('/order/');
    expect((await get('/sitemap.xml', 'evil.example/<script>')).body).toContain('<loc>http://localhost/</loc>');
  });
});
