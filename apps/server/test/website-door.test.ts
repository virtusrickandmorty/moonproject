/**
 * The website's own door (the owner's request, Nov 2026, platform/website-door.ts): www.virtusgarments.com answers the
 * website and its public API only; the ERP's pages move to erp.virtusgarments.com and its sign-in and data are refused.
 * The ERP's door answers everything, as before. Here a test header stands for the website's port.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../src/platform/db/driver.ts';
import { fixedClock } from '../src/platform/clock.ts';
import { buildApp } from '../src/app.ts';
import { loadModules } from '../src/modules/load.ts';
import { TEST_SCRYPT_N } from './helpers.ts';

const INDEX = '<!doctype html><title>Virtus</title><div id="root"></div>';
const ERP = 'https://erp.example.test';
let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'moonproject-door-'));
  const dist = join(dir, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log("app");');
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
  writeFileSync(join(dist, 'site.webmanifest'), JSON.stringify({ id: '/', name: 'Virtus Garments', short_name: 'Virtus', start_url: '/' }));
  ({ app } = buildApp({
    db: openDb(':memory:'), clock: fixedClock('2026-09-28T02:00:00Z'), modules: await loadModules(), config: { scryptN: TEST_SCRYPT_N }, webRoot: dist,
    websiteDoor: { isWebsite: (raw) => raw.headers['x-test-door'] === 'website', erpUrl: ERP },
  }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const site = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, headers: { 'x-test-door': 'website' }, ...(payload ? { payload } : {}) });
const erp = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, ...(payload ? { payload } : {}) });

describe("the website's door", () => {
  it('serves the website, a customer link page and the built files', async () => {
    for (const url of ['/', '/shop', '/services', '/track', '/order/WEB-000123', `/l/${'a'.repeat(24)}`, `/p/${'b'.repeat(24)}`, `/r/${'c'.repeat(24)}?x=1`]) {
      const r = await site('GET', url);
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toBe(INDEX);
    }
    expect((await site('GET', '/assets/app-abc123.js')).statusCode).toBe(200);
    expect((await site('GET', '/favicon.svg')).body).toBe('<svg/>');
    expect((await site('GET', '/assets/gone-old.js')).statusCode).toBe(404);
  });

  it('sends every other page to the same page on the ERP address', async () => {
    for (const url of ['/sign-in', '/floor', '/docs/jo.job_order', '/docs/qs.sale/123?recorded=1', '/account/password']) {
      const r = await site('GET', url);
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location, url).toBe(`${ERP}${url}`);
    }
  });

  it('answers the public website API, never the staff sign-in, the set-up or anything that needs a session', async () => {
    expect((await site('GET', '/api/shp/products')).statusCode).toBe(200);
    expect((await site('GET', '/api/health')).statusCode).toBe(200);
    expect((await site('GET', '/robots.txt')).statusCode).toBe(200);
    for (const [method, url, body] of [
      ['POST', '/api/auth/login', { username: 'owner', password: 'not-this-one' }], ['GET', '/api/setup/status'], ['POST', '/api/setup/first-owner', { username: 'x', displayName: 'X', password: 'a long enough password' }],
      ['GET', '/api/auth/me'], ['GET', '/api/settings'], ['GET', '/api/docs/jo.job_order'], ['POST', '/api/nothing/here'],
    ] as const) {
      const r = await site(method, url, body);
      expect(r.statusCode, url).toBe(403);
      expect(r.json(), url).toMatchObject({ code: 'ERP_ADDRESS', details: { erpUrl: ERP } });
    }
  });
});

describe("the ERP's door", () => {
  it('answers everything as before', async () => {
    expect((await erp('GET', '/api/setup/status')).statusCode).toBe(200);
    expect((await erp('GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await erp('GET', '/docs/jo.job_order')).body).toBe(INDEX);
    expect((await erp('GET', '/sign-in')).statusCode).toBe(200);
  });

  it('keeps search engines off the ERP address', async () => {
    const r = await app.inject({ method: 'GET', url: '/robots.txt', headers: { host: 'erp.virtusgarments.com' } });
    expect(r.body).toBe('User-agent: *\nDisallow: /\n');
    const www = await app.inject({ method: 'GET', url: '/robots.txt', headers: { host: 'www.virtusgarments.com' } });
    expect(www.body).toContain('Sitemap: http://www.virtusgarments.com/sitemap.xml');
  });
});

describe('the phone app', () => {
  it('installed from the ERP address it is the ERP app; from the website the website', async () => {
    const at = (host: string, door = {}) => app.inject({ method: 'GET', url: '/site.webmanifest', headers: { host, ...door } });
    const erpApp = await at('erp.virtusgarments.com');
    expect(erpApp.headers['content-type']).toMatch(/^application\/manifest\+json/);
    expect(erpApp.json()).toMatchObject({ name: 'Virtus ERP', short_name: 'Virtus ERP', start_url: '/' });
    expect((await at('www.virtusgarments.com', { 'x-test-door': 'website' })).json()).toMatchObject({ name: 'Virtus Garments', short_name: 'Virtus' });
  });
});
