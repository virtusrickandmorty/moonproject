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

  it('a new shop set up from the first-run screen starts with nothing in its price list; the API alone keeps the starter rates', async () => {
    const inForce = () => (env.db.prepare(`SELECT DISTINCT garment_type FROM rate_piece_rates r WHERE created_by IS NULL
      AND NOT EXISTS (SELECT 1 FROM rate_garment_type_switches w WHERE w.garment_type = r.garment_type AND w.is_on = 0)`).pluck().all() as string[]).length;
    expect(inForce()).toBe(9); // the made-up starters (RATE 0001)
    const ok = await inject('POST', '/api/setup/first-owner', { username: 'virtus', displayName: 'Owner', password: 'three blue sewing machines', freshPriceList: true });
    expect(ok.statusCode).toBe(200);
    expect(inForce()).toBe(0);
    const owner = await login(env.app, 'virtus', 'three blue sewing machines');
    expect((await owner.get('/api/rate/rates')).json()).toMatchObject({ current: [], unmatched: [] });
    expect(env.db.prepare('SELECT COUNT(*) FROM rate_piece_rates').pluck().get()).toBe(22); // switched off, never deleted
    // Set up through the API alone (tests, the practice shop's made-up data): the starters stay.
    const other = await createTestEnv();
    await other.app.inject({ method: 'POST', url: '/api/setup/first-owner', payload: { username: 'virtus', displayName: 'Owner', password: 'three blue sewing machines' } });
    expect(other.db.prepare('SELECT COUNT(*) FROM rate_garment_type_switches').pluck().get()).toBe(0);
  });

  it('creates the first owner only from the shop PC itself (I1-01)', async () => {
    const from = (remoteAddress: string) =>
      env.app.inject({ method: 'POST', url: '/api/setup/first-owner', remoteAddress, payload: { username: 'virtus', displayName: 'Owner', password: 'three blue sewing machines' } });
    for (const ip of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1']) {
      const r = await from(ip);
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe('SHOP_PC_ONLY');
      expect(r.json().message).toMatch(/shop PC/);
    }
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(0);
    expect((await inject('GET', '/api/setup/status')).json()).toEqual({ needsFirstOwner: true });
    expect((await from('::1')).statusCode).toBe(200);
  });

  it("counts each website visitor on their own through the shop PC's Cloudflare connector, and believes no other device", async () => {
    // Cloudflare's connector runs on the shop PC: the socket is the shop PC's, the visitor is in X-Forwarded-For.
    const via = (visitor: string, remoteAddress = '127.0.0.1') => ({ remoteAddress, headers: { 'x-forwarded-for': visitor } });
    const owner = (o: object) => env.app.inject({ method: 'POST', url: '/api/setup/first-owner', ...o, payload: { username: 'virtus', displayName: 'Owner', password: 'three blue sewing machines' } });
    // "Shop PC only" stays the shop PC: not an internet visitor, not one who claims to be the shop PC (Cloudflare adds
    // the real address last), not a device on the shop's network that sends the header itself.
    for (const o of [via('203.0.113.7'), via('127.0.0.1, 203.0.113.7'), via('127.0.0.1', '192.168.1.20')]) {
      expect((await owner(o)).json().code).toBe('SHOP_PC_ONLY');
    }
    expect((await owner({ remoteAddress: '127.0.0.1' })).statusCode).toBe(200);

    // A stranger's 20 wrong passwords lock out that stranger only, never the staff signing in elsewhere or at the shop PC.
    createUser(env.db, 'enc', ['encoder']);
    const signIn = (username: string, password: string, o: object) => env.app.inject({ method: 'POST', url: '/api/auth/login', ...o, payload: { username, password } });
    for (let i = 0; i < 20; i++) expect((await signIn(`guess${i}`, 'wrong wrong wrong', via('203.0.113.7'))).statusCode).toBe(401);
    expect((await signIn('enc', PASSWORD, via('203.0.113.7'))).statusCode).toBe(429);
    expect((await signIn('enc', PASSWORD, via('198.51.100.4'))).statusCode).toBe(200);
    expect((await signIn('enc', PASSWORD, { remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
    expect(env.db.prepare('SELECT DISTINCT ip FROM login_attempts ORDER BY ip').pluck().all()).toEqual(['127.0.0.1', '198.51.100.4', '203.0.113.7']);
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

  it('never leaves the shop without someone who can manage users', async () => {
    const owner = await env.as('owner');
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    const revoke = await owner.post('/api/roles/owner/permissions', { permissionKey: 'sec.users.manage', granted: false });
    expect([revoke.statusCode, revoke.json().code]).toEqual([409, 'LAST_USER_MANAGER']);
    const managers = env.db.prepare(`SELECT user_id FROM user_roles WHERE role_key = 'owner' AND active = 1`).pluck().all() as string[];
    const codes = [];
    for (const id of managers) codes.push((await owner.post(`/api/users/${id}/roles`, { roles: [] })).statusCode);
    expect(codes.at(-1)).toBe(409);
    expect((await owner.get('/api/roles')).statusCode).toBe(200);
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
