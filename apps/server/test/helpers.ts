/** Test harness: in-memory database, pinned clock, fast password hashing, signed-in clients. */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { openDb, type Db } from '../src/platform/db/driver.ts';
import { fixedClock } from '../src/platform/clock.ts';
import { buildApp, type AppDeps, type BuildOptions } from '../src/app.ts';
import { loadModules } from '../src/modules/load.ts';
import { hashPassword } from '../src/engine/security/passwords.ts';
import { PRACTICE_SESSION_COOKIE, SESSION_COOKIE } from '../src/engine/security/sessions.ts';
import { newId, type RoleKey } from '@moonproject/shared';

export const TEST_SCRYPT_N = 2 ** 10;
export const PASSWORD = 'correct horse battery staple';

export interface TestEnv {
  app: FastifyInstance;
  deps: AppDeps;
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  as(role: RoleKey | RoleKey[]): Promise<Client>;
}

/** `practice` builds the practice shop's app; `practiceShop` gives the real shop a handle on one (PLAN C8). */
export async function createTestEnv(at = '2026-09-28T02:00:00Z', extra: Pick<BuildOptions, 'practice' | 'practiceShop' | 'host'> = {}): Promise<TestEnv> {
  const db = openDb(':memory:');
  const clock = fixedClock(at);
  const { app, deps } = buildApp({ db, clock, modules: await loadModules(), config: { scryptN: TEST_SCRYPT_N }, ...extra });
  await app.ready();
  const env: TestEnv = {
    app,
    deps,
    db,
    clock,
    async as(role) {
      const roles = Array.isArray(role) ? role : [role];
      const username = `${roles.join('-')}-${newId().slice(0, 6)}`;
      createUser(db, username, roles);
      return login(app, username, PASSWORD);
    },
  };
  return env;
}

export function createUser(db: Db, username: string, roles: RoleKey[], mustChange = false): string {
  const id = newId();
  const at = '2026-09-28T10:00:00.000+08:00';
  db.prepare('INSERT INTO users (id, username, display_name, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    username,
    username,
    hashPassword(PASSWORD, TEST_SCRYPT_N),
    mustChange ? 1 : 0,
    at,
    at,
  );
  for (const r of roles) db.prepare('INSERT INTO user_roles (user_id, role_key, active, updated_at) VALUES (?, ?, 1, ?)').run(id, r, at);
  return id;
}

export interface Client {
  userId: string;
  csrf: string;
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  put(url: string, body?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE || c.name === PRACTICE_SESSION_COOKIE)!;
  return clientFor(app, cookie.value, res.json().csrfToken, cookie.name);
}

export async function clientFor(app: FastifyInstance, token: string, csrf: string, cookieName = SESSION_COOKIE): Promise<Client> {
  const cookies = { [cookieName]: token };
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
  const send = (method: 'POST' | 'PUT') => (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, cookies, payload: body as object, headers: { 'x-csrf-token': csrf, ...headers } });
  return {
    userId: me.json().userId,
    csrf,
    get: (url) => app.inject({ method: 'GET', url, cookies }),
    post: send('POST'),
    put: send('PUT'),
  };
}

let keyCounter = 0;
export const idem = () => ({ 'idempotency-key': `test-key-${++keyCounter}-${newId()}` });

export function cashPlaceId(db: Db, code: string): number {
  return (db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as { id: number }).id;
}

/** Net debit-positive balance per account code, from the ledger. */
export function balances(db: Db): Record<string, number> {
  const rows = db
    .prepare(`SELECT a.code, SUM(l.debit_cents - l.credit_cents) AS bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id GROUP BY a.code`)
    .all() as { code: string; bal: number }[];
  return Object.fromEntries(rows.filter((r) => r.bal !== 0).map((r) => [r.code, r.bal]));
}
