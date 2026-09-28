/**
 * Practice mode (PLAN C8): a made-up shop beside the real one, for training. The service runs it in the same process on
 * its own port (MOONPROJECT_PRACTICE_PORT; the installer sets 8443) with its own database in its own folder
 * (data\practice), so nothing it does can reach the real database, its restore folder or its backups (app.ts refuses
 * backups in it). Everyone signs in with their real username and password: each sign-in first copies the users, roles
 * and role grants of the real shop. Its history is the last 30 days of a made-up shop (data.ts), built in a child
 * process so the real shop keeps answering; the owner starts it over from the real shop's Practice shop page.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { manilaDate } from '@moonproject/shared';
import { buildApp } from '../../app.ts';
import type { ModuleDef } from '../../engine/documents/registry.ts';
import { openDb, tx, type Db } from '../db/driver.ts';
import { stamp, type Clock } from '../clock.ts';
import type { PracticeControl, PracticeStatus } from './routes.ts';

export const PRACTICE_DAYS = 30;
const DATA_SCRIPT = fileURLToPath(new URL('./data.ts', import.meta.url));
const DAY_MS = 86_400_000;

export interface PracticeOptions {
  realDb: Db;
  /** The practice shop's own folder (data\practice next to the real database). */
  folder: string;
  host: string;
  port: number;
  clock: Clock;
  modules: ModuleDef[];
  /** The real shop's server certificate (LAN mode); plain HTTP otherwise. */
  https?: { key: string; cert: string };
  log: { info(msg: string): void; error(msg: string): void };
  days?: number;
}

export interface PracticeShop extends PracticeControl {
  /** Opens the practice shop, first making its made-up history if there is none yet. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** A renewed server certificate (main.ts), for the practice port too. */
  setSecureContext(tls: { key: string; cert: string }): void;
}

interface Made { preparedAt: string; days: number; start: string }

/**
 * Copies every user, role and role grant of the real shop into the practice shop, so everyone signs in to it as
 * themselves, and switches off the made-up users who recorded its history. A real user whose username is taken by
 * someone else in the practice shop is left out. Returns how many users were copied.
 */
export function copySignIns(real: Db, practice: Db): number {
  const users = real.prepare('SELECT id, username, display_name, password_hash, must_change_password, is_active, created_at, updated_at FROM users').all();
  const roles = real.prepare('SELECT user_id, role_key, active, updated_at FROM user_roles').all();
  const grants = real.prepare('SELECT role_key, permission_key, granted, updated_at FROM role_permissions').all() as { permission_key: string }[];
  const known = new Set(practice.prepare('SELECT key FROM permissions').pluck().all() as string[]);
  const user = practice.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, must_change_password, is_active, created_at, updated_at)
     VALUES (@id, @username, @display_name, @password_hash, @must_change_password, @is_active, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, password_hash = excluded.password_hash,
       must_change_password = excluded.must_change_password, is_active = excluded.is_active, updated_at = excluded.updated_at`,
  );
  const role = practice.prepare(
    `INSERT INTO user_roles (user_id, role_key, active, updated_at) VALUES (@user_id, @role_key, @active, @updated_at)
     ON CONFLICT(user_id, role_key) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
  );
  const grant = practice.prepare(
    `INSERT INTO role_permissions (role_key, permission_key, granted, updated_at) VALUES (@role_key, @permission_key, @granted, @updated_at)
     ON CONFLICT(role_key, permission_key) DO UPDATE SET granted = excluded.granted, updated_at = excluded.updated_at`,
  );
  const tryRun = (run: () => unknown) => {
    try {
      run();
      return true;
    } catch {
      return false; // a username taken in the practice shop; the user's roles then have no user to belong to
    }
  };
  return tx(practice, () => {
    practice.prepare(`UPDATE users SET is_active = 0 WHERE username LIKE 'practice-%'`).run();
    const copied = users.filter((u) => tryRun(() => user.run(u))).length;
    for (const r of roles) tryRun(() => role.run(r));
    for (const g of grants) if (known.has(g.permission_key)) grant.run(g);
    return copied;
  });
}

/** The first made-up day, so that the last one is yesterday (Manila) and today is the practice shop's own. */
export function practiceStart(today: string, days: number): string {
  return manilaDate(new Date(Date.parse(`${today}T04:00:00Z`) - days * DAY_MS));
}

export function practiceShop(o: PracticeOptions): PracticeShop {
  const days = o.days ?? PRACTICE_DAYS;
  const file = join(o.folder, 'practice.db');
  const next = join(o.folder, 'practice-new.db');
  const madeFile = join(o.folder, 'practice.json');
  let https = o.https;
  let app: FastifyInstance | null = null;
  let db: Db | null = null;
  let state: PracticeStatus['state'] = 'preparing';
  let message: string | null = null;
  let port = o.port; // the port asked for; the one it got when that was 0 (tests)

  const made = (): Made | null => {
    try {
      return JSON.parse(readFileSync(madeFile, 'utf8')) as Made;
    } catch {
      return null;
    }
  };
  const remove = (f: string) => { for (const s of ['', '-wal', '-shm']) rmSync(f + s, { force: true }); };

  /** Runs data.ts in a child process into practice-new.db. */
  const make = () => {
    remove(next);
    const start = practiceStart(manilaDate(o.clock.now()), days);
    o.log.info(`Making the practice shop: ${days} made-up days from ${start}`);
    return new Promise<Made>((resolve, reject) => {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', DATA_SCRIPT, '--db', next, '--days', String(days), '--start', start, '--quiet'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let out = '';
      const keep = (chunk: Buffer) => { out = (out + chunk.toString()).slice(-2000); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve({ preparedAt: stamp(o.clock), days, start });
        else reject(new Error(`The made-up data could not be made: ${out.trim().split('\n').slice(-3).join(' ')}`));
      });
    });
  };

  /** Puts practice-new.db in place of practice.db; the practice shop must be closed. */
  const swapIn = (m: Made) => {
    remove(file);
    renameSync(next, file);
    for (const s of ['-wal', '-shm']) if (existsSync(next + s)) renameSync(next + s, file + s);
    writeFileSync(madeFile, JSON.stringify(m));
  };

  const open = async () => {
    const practiceDb = openDb(file);
    try {
      const built = buildApp({ db: practiceDb, clock: o.clock, modules: o.modules, practice: true, ...(https ? { https } : {}) });
      copySignIns(o.realDb, practiceDb);
      built.app.addHook('onRequest', async (req) => {
        if (req.method === 'POST' && req.url === '/api/auth/login') copySignIns(o.realDb, practiceDb); // a new user, a new password
      });
      await built.app.listen({ host: o.host, port: o.port });
      port = (built.app.server.address() as AddressInfo).port;
      app = built.app;
      db = practiceDb;
    } catch (e) {
      practiceDb.close();
      throw e;
    }
    state = 'ready';
    o.log.info(`The practice shop is open on port ${port}`);
  };

  const close = async () => {
    const [a, d] = [app, db];
    app = null;
    db = null;
    await a?.close();
    d?.close();
  };

  const failed = (e: unknown, kept: boolean) => {
    const why = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${o.port} is used by another program on this PC.` : (e as Error).message;
    message = kept ? `Starting over did not work, so the practice shop kept its data. ${why}` : why;
    state = kept ? 'ready' : 'failed';
    o.log.error(`Practice shop: ${why}`);
  };

  return {
    status: () => {
      const m = made();
      return { state, port, preparedAt: m?.preparedAt ?? null, days: m?.days ?? null, message };
    },

    async start() {
      mkdirSync(o.folder, { recursive: true });
      try {
        if (!existsSync(file)) swapIn(await make());
        await open();
      } catch (e) {
        failed(e, false);
      }
    },

    reset() {
      if (state === 'preparing') return;
      state = 'preparing';
      message = null;
      void (async () => {
        let m: Made;
        try {
          m = await make(); // the old practice shop keeps answering meanwhile
        } catch (e) {
          remove(next);
          if (app) return failed(e, true);
          return failed(e, false);
        }
        try {
          await close();
          swapIn(m);
          await open();
        } catch (e) {
          failed(e, false);
        }
      })();
    },

    stop: close,

    setSecureContext(tls) {
      https = tls;
      if (app) (app.server as unknown as HttpsServer).setSecureContext(tls);
    },
  };
}
