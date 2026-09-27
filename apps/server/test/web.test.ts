/** The server serves the built web app (PLAN C1): files as they are, index.html for deep links, never for /api. */
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

const INDEX = '<!doctype html><title>Moonproject</title><div id="root"></div>';
let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'moonproject-web-'));
  const dist = join(dir, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log("app");');
  writeFileSync(join(dir, 'secret.txt'), 'outside the web root');
  ({ app } = buildApp({ db: openDb(':memory:'), clock: fixedClock('2026-09-28T02:00:00Z'), modules: await loadModules(), config: { scryptN: TEST_SCRYPT_N }, webRoot: dist }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('web app serving', () => {
  it('serves index.html and built files without a session', async () => {
    const home = await get('/');
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toMatch(/^text\/html/);
    expect(home.body).toBe(INDEX);
    const js = await get('/assets/app-abc123.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.body).toBe('console.log("app");');
    expect((await app.inject({ method: 'HEAD', url: '/' })).statusCode).toBe(200);
  });

  it('answers any other GET outside /api with index.html, so deep links load the app', async () => {
    for (const url of ['/jo/orders/123', '/docs/cash.trf/new?x=1', '/assets/gone.js', '/apiary']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toBe(INDEX);
    }
  });

  it('never answers /api with the web app', async () => {
    for (const url of ['/api', '/api/', '/api/no-such-route']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await get('/api/health')).json()).toMatchObject({ ok: true });
  });

  it('never serves a file outside the web root', async () => {
    for (const url of ['/../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt']) {
      const res = await get(url);
      expect(res.body, url).not.toContain('outside the web root');
    }
  });
});
