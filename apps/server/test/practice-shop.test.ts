/**
 * Practice mode (PLAN C8, platform/practice): the practice shop beside the real one, everyone signing in to it as
 * themselves, its guards, and the owner's reset from the real shop.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../src/platform/clock.ts';
import { loadModules } from '../src/modules/load.ts';
import { PRACTICE_SESSION_COOKIE } from '../src/engine/security/sessions.ts';
import { practiceShop, practiceStart, type PracticeShop } from '../src/platform/practice/shop.ts';
import type { PracticeControl, PracticeStatus } from '../src/platform/practice/routes.ts';
import { PASSWORD, createTestEnv, createUser } from './helpers.ts';

let dir = '';
let shop: PracticeShop | undefined;
afterEach(async () => {
  await shop?.stop();
  shop = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const until = async (what: () => boolean, ms = 60_000) => {
  for (const end = Date.now() + ms; !what(); await new Promise((r) => setTimeout(r, 100))) if (Date.now() > end) throw new Error('timed out');
};

describe('practice mode', () => {
  it('makes the made-up days end yesterday', () => {
    expect(practiceStart('2026-10-15', 30)).toBe('2026-09-15');
    expect(practiceStart('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('runs a practice shop beside the real one: own data, real sign-ins, own cookie, no backups, and starts over on reset', async () => {
    dir = mkdtempSync(join(tmpdir(), 'moon-practice-shop-'));
    const clock = fixedClock('2026-10-15T02:00:00Z');
    const modules = await loadModules();
    const realEnv = await createTestEnv('2026-10-15T02:00:00Z'); // the real shop
    const owner = createUser(realEnv.db, 'maria', ['owner']);
    shop = practiceShop({ realDb: realEnv.db, folder: join(dir, 'practice'), host: '127.0.0.1', port: 0, clock, modules, days: 3, log: { info: () => {}, error: () => {} } });
    expect(shop.status()).toMatchObject({ state: 'preparing' });
    await shop.start();
    const first = shop.status();
    expect(first).toMatchObject({ state: 'ready', days: 3, message: null });
    const base = `http://127.0.0.1:${first.port}`;

    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, practice: true });
    // The real owner signs in with the real password; the practice shop gives its own cookie.
    const signIn = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'maria', password: PASSWORD }) });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get('set-cookie')).toContain(`${PRACTICE_SESSION_COOKIE}=`);
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0]!;
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ userId: owner, displayName: expect.any(String) });
    // Its made-up history is there, recorded by made-up users who can no longer sign in.
    const docs = await fetch(`${base}/api/docs/jo.job_order`, { headers: { cookie } });
    expect(docs.status).toBe(200);
    const [jo] = (await docs.json()) as { id: string }[];
    // Its printouts say they are not real documents.
    const csrf = (await signIn.clone().json()).csrfToken as string;
    const print = await fetch(`${base}/api/prt/print/jo.job_order/${jo!.id}`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ variant: 'document' }) });
    expect((await print.json()).html).toContain('PRACTICE ONLY · NOT A REAL DOCUMENT');
    const made = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'practice-owner', password: 'x'.repeat(20) }) });
    expect(made.status).toBe(401);
    // A user added to the real shop later can sign in to practice at once.
    createUser(realEnv.db, 'jun', ['encoder']);
    expect((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'jun', password: PASSWORD }) })).status).toBe(200);
    // Backups and restores are refused in the practice shop.
    const backup = await fetch(`${base}/api/bak/status`, { headers: { cookie } });
    expect([backup.status, (await backup.json()).code]).toEqual([403, 'PRACTICE']);

    // Starting over: the old shop answers until the new one is ready, then everything is new.
    clock.set('2026-10-16T02:00:00Z');
    shop.reset();
    expect(shop.status().state).toBe('preparing');
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    await until(() => shop!.status().state !== 'preparing');
    const second = shop.status();
    expect(second).toMatchObject({ state: 'ready', message: null });
    expect(second.preparedAt).not.toBe(first.preparedAt);
    const again = `http://127.0.0.1:${second.port}`;
    expect((await fetch(`${again}/api/auth/me`, { headers: { cookie } })).status).toBe(401); // the old sessions went with the old data
    expect((await fetch(`${again}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'maria', password: PASSWORD }) })).status).toBe(200);
  }, 120_000);

  it('the real shop shows the practice shop and lets only the owner start it over, with the password again', async () => {
    let resets = 0;
    const status: PracticeStatus = { state: 'ready', port: 8443, preparedAt: '2026-10-15T10:00:00.000+08:00', days: 30, message: null };
    const control: PracticeControl = { status: () => status, reset: () => { resets++; status.state = 'preparing'; } };
    const env = await createTestEnv('2026-10-15T02:00:00Z', { practiceShop: control });
    const encoder = await env.as('encoder');
    const owner = await env.as('owner');
    expect((await encoder.get('/api/system/practice')).json()).toMatchObject({ state: 'ready', port: 8443 });
    expect((await encoder.post('/api/system/practice/reset')).statusCode).toBe(403);
    const noStepUp = await owner.post('/api/system/practice/reset');
    expect([noStepUp.statusCode, noStepUp.json().code]).toEqual([403, 'STEP_UP_REQUIRED']);
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    const reset = await owner.post('/api/system/practice/reset');
    expect([reset.statusCode, reset.json().state, resets]).toEqual([200, 'preparing', 1]);
    const busy = await owner.post('/api/system/practice/reset');
    expect([busy.statusCode, busy.json().code, resets]).toEqual([409, 'PRACTICE_BUSY', 1]);
    expect(env.db.prepare("SELECT user_id FROM audit_log WHERE action = 'practice.reset'").pluck().all()).toEqual([owner.userId]);
  });

  it('says when practice mode is off, and the practice shop sends the owner to the real one to start over', async () => {
    const real = await createTestEnv();
    const owner = await real.as('owner');
    expect((await owner.get('/api/system/practice')).json()).toMatchObject({ state: 'off' });
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.post('/api/system/practice/reset')).json().code).toBe('PRACTICE_OFF');

    const practice = await createTestEnv(undefined, { practice: true });
    const there = await practice.as('owner');
    expect((await there.get('/api/system/practice')).json()).toMatchObject({ state: 'here' });
    await there.post('/api/auth/step-up', { password: PASSWORD });
    expect((await there.post('/api/system/practice/reset')).json().code).toBe('PRACTICE');
    expect((await practice.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ practice: true });
    expect((await real.app.inject({ method: 'GET', url: '/api/health' })).json()).not.toHaveProperty('practice');
  });
});
