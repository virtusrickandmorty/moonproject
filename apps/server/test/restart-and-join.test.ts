/**
 * W27 (PLAN C6, C8): a red System Health light makes a notification on the owner's and accountant's Home; after a
 * restore is applied the server restarts itself once no request is running, and the owner is told at the next sign-in;
 * GET /api/system/tls gives the address staff type to join.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { idleRestarter } from '../src/platform/restart.ts';
import { recordRestored } from '../src/modules/BAK/restore.ts';
import { ensureTls } from '../src/engine/security/tls/store.ts';
import { printLinkBase } from '../src/engine/security/tls/routes.ts';
import type { Host } from '../src/platform/health/health.ts';
import { PASSWORD, createTestEnv, login, encoderOwnDefaults } from './helpers.ts';

const host: Host = { platform: 'win32', release: '10.0.26100', arch: 'x64', freeBytes: () => 50e9, utcOffsetMinutes: 480 };
type Notice = { kind: string; id: string; label: string; href?: string; detail?: string; read: boolean };

describe('System Health on the Home', () => {
  it('makes a notification for each red light, for the owner and the accountant only, back the next day once read', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z', { host }); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    const accountant = await env.as('accountant');
    const encoder = await env.as('encoder');
    const red = async (c: typeof owner) => ((await c.get('/api/dash/notifications')).json() as Notice[]).filter((n) => n.kind === 'health-red');

    // A new shop: backups are off until the recovery keys are set, and there is no off-site folder.
    const lights = (await owner.get('/api/system/health')).json();
    expect(lights.overall).toBe('red');
    const notices = await red(owner);
    expect(notices.map((n) => n.id)).toEqual(['health-red:backups:2026-09-28', 'health-red:offsite:2026-09-28']);
    expect(notices[0]).toMatchObject({ label: 'System Health: Backups is red', href: '/admin/health', detail: expect.stringContaining('recovery keys'), read: false });
    expect((await red(accountant)).length).toBe(2);
    expect(await red(encoder)).toEqual([]);
    // The accountant's exceptions inbox carries them too.
    const home = (await accountant.get('/api/dash/home')).json();
    expect(home.widgets.find((w: { key: string }) => w.key === 'exceptions').items.map((i: { id: string }) => i.id)).toContain('health-red:backups:2026-09-28');

    expect((await owner.post('/api/dash/notifications/read', { id: notices[0]!.id })).statusCode).toBe(200);
    expect((await red(owner)).find((n) => n.id === notices[0]!.id)?.read).toBe(true);
    env.clock.set('2026-09-29T02:00:00Z');
    const owner2 = await login(env.app, (env.db.prepare('SELECT username FROM users WHERE id = ?').pluck().get(owner.userId) as string), PASSWORD);
    expect((await red(owner2)).map((n) => [n.id, n.read])).toContainEqual(['health-red:backups:2026-09-29', false]);
  });

  it('makes none in the practice shop, which has no backups', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z', { host, practice: true }); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    expect(((await owner.get('/api/dash/notifications')).json() as Notice[]).filter((n) => n.kind === 'health-red')).toEqual([]);
  });
});

describe('restart after a restore', () => {
  const slowApp = async () => {
    const app = Fastify() as unknown as FastifyInstance;
    const exit = vi.fn();
    const restarter = idleRestarter(app, exit, 5_000);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    app.get('/slow', async () => (await held, 'done'));
    app.get('/fast', async () => 'ok');
    await app.ready();
    return { app, exit, restarter, release };
  };
  const tick = () => new Promise((r) => setImmediate(r));

  it('waits until no request is running, then exits once', async () => {
    const { app, exit, restarter, release } = await slowApp();
    const slow = app.inject({ url: '/slow' });
    await tick();
    restarter.request('restore of a backup');
    await app.inject({ url: '/fast' });
    await tick();
    expect(exit).not.toHaveBeenCalled(); // the slow request is still running
    release();
    expect((await slow).body).toBe('done');
    await tick();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith('restore of a backup');
    restarter.request('again');
    await tick();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does not wait longer than its limit for a request that never ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { app, exit, restarter } = await slowApp();
      void app.inject({ url: '/slow' });
      await tick();
      restarter.request('restore');
      vi.advanceTimersByTime(4_999);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is asked for by applying a restore, after which nothing more is recorded', async () => {
    const exit = vi.fn();
    const env = await createTestEnv('2026-09-28T02:00:00Z', { onRestart: exit }); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    const accountant = await env.as('accountant');
    // The restore route itself is covered in BAK's restore tests; here the restart it asks for.
    env.deps.restart.request('restore of moonproject-2026-09-28T09-00-00-daily.db.gz.age');
    await tick();
    expect(exit).toHaveBeenCalledWith('restore of moonproject-2026-09-28T09-00-00-daily.db.gz.age');
    const blocked = await accountant.post('/api/drafts', { docType: 'acc.jv', input: {} });
    expect([blocked.statusCode, blocked.json().code]).toEqual([503, 'RESTARTING']);
    expect((await owner.get('/api/system/health')).statusCode).toBe(200); // reading still works
  });

  it('tells the owner "Restored from <backup> at <time>" at the first sign-in after, not the one after that', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z'); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    expect((await owner.get('/api/bak/restored')).json()).toEqual({ restored: null });

    // The service started again and swapped the copy in (main.ts), at 10:05 Manila.
    env.clock.set('2026-09-28T02:05:00Z');
    const file = 'moonproject-2026-09-28T09-00-00-daily.db.gz.age';
    recordRestored(env.db, { file, previous: 'before-restore-2026-09-28T10-05-00.db' }, '2026-09-28T10:05:00.000+08:00', 'start');
    const old = await owner.get('/api/bak/restored'); // signed in before the restore: the restore signed everyone out
    expect([old.statusCode, old.json().code]).toEqual([401, 'AUTH_REQUIRED']);

    env.clock.set('2026-09-28T02:06:00Z');
    const username = env.db.prepare('SELECT username FROM users WHERE id = ?').pluck().get(owner.userId) as string;
    const next = await login(env.app, username, PASSWORD);
    expect((await next.get('/api/bak/restored')).json()).toEqual({ restored: { file, at: '2026-09-28T10:05:00.000+08:00' } });
    expect((await next.get('/api/bak/restored')).json().restored).not.toBeNull(); // all through that session

    const other = await env.as('owner'); // another owner's first sign-in after it
    expect((await other.get('/api/bak/restored')).json().restored).toMatchObject({ file });
    env.clock.set('2026-09-28T03:00:00Z');
    const later = await login(env.app, username, PASSWORD);
    expect((await later.get('/api/bak/restored')).json()).toEqual({ restored: null });
    expect((await (await env.as('accountant')).get('/api/bak/restored')).statusCode).toBe(403);
  });
});

describe('the join address', () => {
  const network = { pcName: () => 'VIRTUS-PC', names: () => ({ ips: ['100.80.1.2', '127.0.0.1', '192.168.1.20'], dnsNames: ['localhost', 'virtus-pc.local'] }) };

  it('gives the PC\'s name and its private addresses with the CA code, once the server runs on the network', async () => {
    let port: number | null = 80;
    const env = await createTestEnv('2026-09-28T02:00:00Z', { network: { ...network, joinPort: () => port } }); encoderOwnDefaults(env);
    const encoder = await env.as('encoder');
    expect((await encoder.get('/api/system/tls')).json()).toEqual({ ca: null });

    const tls = ensureTls(env.db, env.clock, network.names());
    const body = (await encoder.get('/api/system/tls')).json();
    expect(body.ca.fingerprint256).toBe(tls.ca.fingerprint256);
    expect(body.join).toEqual({
      pcName: 'VIRTUS-PC',
      addresses: [{ ip: '100.80.1.2', kind: 'vpn' }, { ip: '192.168.1.20', kind: 'lan' }],
      port: 80,
      urls: ['http://100.80.1.2/', 'http://192.168.1.20/'],
    });
    port = 8080; // another program has port 80
    expect((await encoder.get('/api/system/tls')).json().join.urls).toEqual(['http://100.80.1.2:8080/', 'http://192.168.1.20:8080/']);
    port = null;
    expect((await encoder.get('/api/system/tls')).json().join).toMatchObject({ port: null, urls: [] });
  });

  it('points printed QR codes at the LAN join address, and nowhere before the CA or while the join page is off', async () => {
    let port: number | null = 8080;
    const env = await createTestEnv('2026-09-28T02:00:00Z', { network: { ...network, joinPort: () => port } }); encoderOwnDefaults(env);
    expect(printLinkBase(env.db, env.deps.network)).toBeUndefined();
    ensureTls(env.db, env.clock, network.names());
    expect(printLinkBase(env.db, env.deps.network)).toBe('http://192.168.1.20:8080/');
    expect(printLinkBase(env.db, { ...env.deps.network, names: () => ({ ips: ['100.80.1.2'], dnsNames: [] }) })).toBe('http://100.80.1.2:8080/');
    port = null;
    expect(printLinkBase(env.db, env.deps.network)).toBeUndefined();
  });
});
