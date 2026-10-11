/**
 * Live changes (engine/live.ts): an open screen's stream hears, within moments, that something changed and which kinds
 * of record, never their data; it needs a session; closing the server ends every stream.
 */
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestEnv, createUser, idem, PASSWORD, type Client, type TestEnv } from './helpers.ts';
import { SESSION_COOKIE } from '../src/engine/security/sessions.ts';

let env: TestEnv;
let accountant: Client;
let port: number;
beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  port = (env.app.server.address() as AddressInfo).port;
});
afterEach(async () => { await env.app.close(); env.db.close(); });

/** Opens the stream as a browser does (the session cookie) and collects what arrives. */
function open(cookie?: string) {
  let text = '';
  let status = 0;
  const req = request({ host: '127.0.0.1', port, path: '/api/live', headers: cookie ? { cookie } : {} }, (res) => {
    status = res.statusCode ?? 0;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => { text += chunk; });
  });
  req.on('error', () => undefined);
  req.end();
  return { read: () => text, status: () => status, close: () => req.destroy() };
}
const until = async (ok: () => boolean, ms = 5_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return true;
  return false;
};
async function sessionCookie(): Promise<string> {
  createUser(env.db, 'live-watcher', ['encoder']);
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'live-watcher', password: PASSWORD } });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

it('tells an open screen which kinds of record changed, moments after another user records one', async () => {
  const stream = open(await sessionCookie());
  expect(await until(() => stream.read().includes('event: hello'))).toBe(true);
  expect(stream.status()).toBe(200);

  const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
  const r = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Accrued rent for the month',
    lines: [{ accountId: account('1101'), debitCents: 1000 }, { accountId: account('3900'), creditCents: 1000 }] }, expectedTotalCents: 1000 }, idem());
  expect(r.statusCode, r.body).toBe(200);

  expect(await until(() => stream.read().includes('event: change'))).toBe(true);
  const change = JSON.parse(/event: change\ndata: (.*)\n/.exec(stream.read())![1]!) as { seq: number; types: string[] };
  expect(change.types).toContain('acc.jv');
  expect(stream.read()).not.toContain('Accrued rent'); // no record's data, only the kinds that changed
  stream.close();
});

it('needs a session', async () => {
  const stream = open();
  expect(await until(() => stream.status() !== 0)).toBe(true);
  expect(stream.status()).toBe(401);
  stream.close();
});
