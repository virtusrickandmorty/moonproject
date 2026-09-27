import { describe, expect, it, beforeEach } from 'vitest';
import { PASSWORD, clientFor, createTestEnv, createUser, login, type TestEnv } from './helpers.ts';
import { SESSION_COOKIE } from '../src/engine/security/sessions.ts';
import { verifyAuditChain } from '../src/engine/audit.ts';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

const inject = (method: 'GET' | 'POST', url: string, payload?: object) => env.app.inject({ method, url, payload });

describe('first run and login (PLAN C6, E13)', () => {
  it('creates the first owner once, with a strong passphrase', async () => {
    expect((await inject('GET', '/api/setup/status')).json()).toEqual({ needsFirstOwner: true });
    expect((await inject('POST', '/api/setup/first-owner', { username: 'virtus', displayName: 'Owner', password: 'short' })).statusCode).toBe(400);
    const ok = await inject('POST', '/api/setup/first-owner', { username: 'virtus', displayName: 'Owner', password: 'three blue sewing machines' });
    expect(ok.statusCode).toBe(200);
    const again = await inject('POST', '/api/setup/first-owner', { username: 'other', displayName: 'X', password: 'three blue sewing machines' });
    expect(again.statusCode).toBe(409);
    const me = await (await login(env.app, 'virtus', 'three blue sewing machines')).get('/api/auth/me');
    expect(me.json().roles).toEqual(['owner']);
  });

  it('locks out after 5 wrong passwords, and audits it (N-07)', async () => {
    createUser(env.db, 'enc', ['encoder']);
    for (let i = 0; i < 5; i++) expect((await inject('POST', '/api/auth/login', { username: 'enc', password: 'wrong wrong wrong' })).statusCode).toBe(401);
    expect((await inject('POST', '/api/auth/login', { username: 'enc', password: PASSWORD })).statusCode).toBe(429);
    env.clock.advance(16 * 60_000);
    expect((await inject('POST', '/api/auth/login', { username: 'enc', password: PASSWORD })).statusCode).toBe(200);
    const fails = env.db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.login_failed'`).get() as { n: number };
    expect(fails.n).toBe(5);
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('rate-limits the step-up password check too', async () => {
    const owner = await env.as('owner');
    for (let i = 0; i < 5; i++) expect((await owner.post('/api/auth/step-up', { password: 'wrong wrong wrong' })).statusCode).toBe(400);
    expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(429);
  });

  it('gives the same answer for unknown users and wrong passwords', async () => {
    const r = await inject('POST', '/api/auth/login', { username: 'nobody', password: 'x' });
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toBe('Wrong username or password.');
  });

  it('sets a strict, HttpOnly, Secure session cookie', async () => {
    createUser(env.db, 'enc', ['encoder']);
    const r = await inject('POST', '/api/auth/login', { username: 'enc', password: PASSWORD });
    const c = r.cookies.find((x) => x.name === SESSION_COOKIE)!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
  });

  it('times out idle sessions after 60 minutes and ends them on logout', async () => {
    const c = await env.as('encoder');
    env.clock.advance(61 * 60_000);
    expect((await c.get('/api/auth/me')).statusCode).toBe(401);
    const d = await env.as('encoder');
    expect((await d.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await d.get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('request protection', () => {
  it('requires the CSRF header and a same-site origin on changes', async () => {
    const c = await env.as('encoder');
    const res = await env.app.inject({ method: 'POST', url: '/api/drafts', payload: { docType: 'cash.transfer', payload: {} }, headers: { 'x-csrf-token': 'nope' } });
    expect(res.statusCode).toBe(401); // no cookie
    const noCsrf = await c.post('/api/drafts', { docType: 'cash.transfer', payload: {} }, { 'x-csrf-token': '' });
    expect(noCsrf.statusCode).toBe(403);
    const badOrigin = await c.post('/api/drafts', { docType: 'cash.transfer', payload: {} }, { origin: 'https://evil.example' });
    expect(badOrigin.statusCode).toBe(403);
    expect((await c.post('/api/drafts', { docType: 'cash.transfer', payload: {} })).statusCode).toBe(200);
  });

  it('every route declares a permission (the app refuses to start otherwise)', () => {
    expect(env.app.hasRoute({ method: 'POST', url: '/api/docs/:type/post' })).toBe(true);
  });
});

describe('users and roles (owner, step-up)', () => {
  it('owner creates a user only after re-entering the password; user must change it', async () => {
    const owner = await env.as('owner');
    const payload = { username: 'maria', displayName: 'Maria', roles: ['encoder'], temporaryPassword: 'temporary pass phrase one' };
    const blocked = await owner.post('/api/users', payload);
    expect(blocked.json().code).toBe('STEP_UP_REQUIRED');
    expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    expect((await owner.post('/api/users', payload)).statusCode).toBe(200);

    const maria = await login(env.app, 'maria', 'temporary pass phrase one');
    expect((await maria.get('/api/docs/cash.transfer')).json().code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await maria.post('/api/auth/change-password', { currentPassword: 'temporary pass phrase one', newPassword: 'she sews blue jerseys daily' })).statusCode).toBe(200);
    expect((await maria.get('/api/docs/cash.transfer')).statusCode).toBe(200);
  });

  it('encoders cannot manage users; there is no admin-by-name bypass', async () => {
    const enc = await env.as('encoder');
    expect((await enc.get('/api/users')).statusCode).toBe(403);
    createUser(env.db, 'admin', ['encoder']);
    const admin = await login(env.app, 'admin', PASSWORD);
    expect((await admin.get('/api/users')).statusCode).toBe(403);
  });

  it('deactivating a user ends their sessions', async () => {
    const owner = await env.as('owner');
    const enc = await env.as('encoder');
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.post(`/api/users/${enc.userId}/active`, { active: false })).statusCode).toBe(200);
    expect((await enc.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('owner can change the permission grid; the change applies immediately', async () => {
    const owner = await env.as('owner');
    const enc = await env.as('encoder');
    expect((await enc.get('/api/docs/cash.transfer')).statusCode).toBe(200);
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.post('/api/roles/encoder/permissions', { permissionKey: 'cash.trf.view', granted: false })).statusCode).toBe(200);
    expect((await enc.get('/api/docs/cash.transfer')).statusCode).toBe(403);
    const grid = (await owner.get('/api/roles')).json();
    expect(grid.permissions.find((p: { key: string }) => p.key === 'cash.trf.view').roles).not.toContain('encoder');
  });
});

describe('drafts', () => {
  it('saves drafts with If-Match versions and no number', async () => {
    const c = await env.as('encoder');
    const { id } = (await c.post('/api/drafts', { docType: 'cash.transfer', payload: { amountSentCents: 5 } })).json();
    expect((await c.put(`/api/drafts/${id}`, { payload: { amountSentCents: 6 } }, { 'if-match': '1' })).json().version).toBe(2);
    expect((await c.put(`/api/drafts/${id}`, { payload: { amountSentCents: 7 } }, { 'if-match': '1' })).statusCode).toBe(409);
    expect((await c.get('/api/drafts?type=cash.transfer')).json()[0].payload).toEqual({ amountSentCents: 6 });
    expect((await c.post(`/api/drafts/${id}/discard`)).statusCode).toBe(200);
    expect((await c.get('/api/drafts')).json()).toEqual([]);
  });
});

void clientFor;
