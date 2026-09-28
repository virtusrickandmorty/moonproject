/**
 * Backups (PLAN C8, NR-13): each copy is checked, gzipped and encrypted to the two recovery keys, and either key alone
 * opens it; tiers and rotation; the settings are the owner's, with a fresh password.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { PASSWORD, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { openReadonly } from '../../../platform/db/driver.ts';
import { isDue, keptIn, tierFor, toRotate, type Sidecar } from '../backup.ts';

let env: TestEnv;
let owner: Client;
let dir: string;
let keys: { identity: string; recipient: string }[];

const newKey = async () => {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
};
const settings = (over: Record<string, unknown> = {}) => ({
  backupDir: join(dir, 'local'), offsiteDir: join(dir, 'drive'), recipients: keys.map((k) => k.recipient), ...over,
});
const saveSettings = async (c: Client, body: unknown, version?: number) => {
  await c.post('/api/auth/step-up', { password: PASSWORD });
  return c.put('/api/bak/settings', body, version === undefined ? {} : { 'if-match': String(version) });
};
const sidecar = (folder: string, file: string) => JSON.parse(readFileSync(join(folder, file.replace(/\.db\.gz\.age$/, '.json')), 'utf8')) as Sidecar;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  owner = await env.as('owner');
  dir = mkdtempSync(join(tmpdir(), 'moonproject-bak-'));
  keys = [await newKey(), await newKey()];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('backups', () => {
  it('are off until the owner sets two recovery keys', async () => {
    const run = await owner.post('/api/bak/run', {}, idem());
    expect([run.statusCode, run.json().code]).toEqual([409, 'NO_RECOVERY_KEYS']);
    const status = (await owner.get('/api/bak/status')).json();
    expect(status.issues.map((i: { code: string }) => i.code)).toEqual(['NO_RECOVERY_KEYS', 'NO_OFFSITE']);
    expect(status.stale).toBe(true);
    expect(status.runs).toEqual([expect.objectContaining({ status: 'failed', reason: 'manual' })]);
  });

  it('makes a checked, encrypted copy that either recovery key opens, and copies the dailies and longer off-site', async () => {
    expect((await saveSettings(owner, settings())).statusCode).toBe(200);
    // Some data to back up: the owner's session and audit entries are enough to check the chain.
    const run = await owner.post('/api/bak/run', {}, idem());
    expect(run.statusCode, run.body).toBe(200);
    const { file, tier, sha256, offsite } = run.json();
    expect([file, tier, offsite]).toEqual(['moonproject-2026-09-28T10-00-00-yearly.db.gz.age', 'yearly', true]);

    const local = join(dir, 'local');
    const s = sidecar(local, file);
    expect(s).toMatchObject({ app: 'moonproject', tier: 'yearly', sha256, checks: { integrity: 'ok', invariants: 'ok', auditChain: 'ok' } });
    expect(s.migrations).toContain('BAK/0001_bak.sql');
    expect(s.audit?.seq).toBeGreaterThan(0);

    const encrypted = readFileSync(join(local, file));
    for (const key of keys) {
      const d = new Decrypter();
      d.addIdentity(key.identity);
      const plain = gunzipSync(await d.decrypt(encrypted));
      expect(createHash('sha256').update(plain).digest('hex')).toBe(sha256);
      const copy = join(dir, 'restored.db');
      writeFileSync(copy, plain);
      const db = openReadonly(copy);
      expect(db.prepare('SELECT COUNT(*) FROM users').pluck().get()).toBeGreaterThan(0);
      db.close();
      rmSync(copy);
    }
    // A key that is not one of the two opens nothing.
    const stranger = new Decrypter();
    stranger.addIdentity((await newKey()).identity);
    await expect(stranger.decrypt(encrypted)).rejects.toThrow();

    // The off-site folder has the same file; no temporary copy is left behind.
    expect(readFileSync(join(dir, 'drive', file)).equals(encrypted)).toBe(true);
    expect(readdirSync(local).filter((f) => f.startsWith('.'))).toEqual([]);

    // The next run the same day is a snapshot, kept locally only.
    env.clock.advance(2 * 3600_000);
    owner = await env.as('owner');
    const second = (await owner.post('/api/bak/run', {}, idem())).json();
    expect([second.tier, second.offsite]).toEqual(['snapshot', false]);
    expect(keptIn(join(dir, 'drive')).map((k) => k.tier)).toEqual(['yearly']);

    const status = (await owner.get('/api/bak/status')).json();
    expect(status).toMatchObject({ stale: false, kept: { snapshot: 1, daily: 0, monthly: 0, yearly: 1 }, lastOk: { tier: 'snapshot' }, issues: [] });
    expect(status.lastOffsiteAt).toBe(s.at);
  });

  it('settings: owner only, with a fresh password, two different valid keys, and no lost update', async () => {
    const accountant = await env.as('accountant');
    expect((await saveSettings(accountant, settings())).statusCode).toBe(403);
    expect((await owner.put('/api/bak/settings', settings())).json().code).toBe('STEP_UP_REQUIRED');

    const bad = await saveSettings(owner, settings({ recipients: [keys[0]!.recipient, keys[0]!.recipient] }));
    expect(bad.statusCode).toBe(400);
    expect((await saveSettings(owner, settings({ recipients: [keys[0]!.recipient, 'AGE-SECRET-KEY-1ABC'] }))).statusCode).toBe(400);
    expect((await saveSettings(owner, settings({ offsiteDir: join(dir, 'local') }))).statusCode).toBe(400);

    const saved = await saveSettings(owner, settings());
    expect(saved.json()).toMatchObject({ version: 1, recipients: keys.map((k) => k.recipient) });
    expect((await saveSettings(owner, settings({ offsiteDir: null }))).json().code).toBe('STALE');
    expect((await saveSettings(owner, settings({ offsiteDir: null }), 1)).json()).toMatchObject({ version: 2, offsiteDir: null });
    const audit = env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'bak.settings'`).pluck().get();
    expect(audit).toBe(2);
  });

  it('the status and "back up now" are for the accountant and owner, not the encoder', async () => {
    const encoder = await env.as('encoder');
    expect((await encoder.get('/api/bak/status')).statusCode).toBe(403);
    expect((await encoder.post('/api/bak/run', {}, idem())).statusCode).toBe(403);
    expect((await (await env.as('accountant')).get('/api/bak/status')).statusCode).toBe(200);
  });
});

describe('backup rules', () => {
  const at = (s: string) => `${s}.000+08:00`;
  it('tier: the widest period with no backup yet', () => {
    expect(tierFor(at('2026-09-28T10:00:00'), [])).toBe('yearly');
    const kept = [{ tier: 'yearly' as const, at: at('2026-01-02T09:00:00') }];
    expect(tierFor(at('2026-01-02T11:00:00'), kept)).toBe('snapshot');
    expect(tierFor(at('2026-01-03T09:00:00'), kept)).toBe('daily');
    expect(tierFor(at('2026-02-01T09:00:00'), kept)).toBe('monthly');
    expect(tierFor(at('2027-01-01T09:00:00'), kept)).toBe('yearly');
  });

  it('rotation: snapshots 48 hours, 30 dailies, 24 monthlies, yearlies forever', () => {
    const day = (n: number) => at(`2026-${String(Math.floor(n / 28) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}T09:00:00`);
    const kept = [
      ...Array.from({ length: 35 }, (_, n) => ({ file: `d${n}`, tier: 'daily' as const, at: day(n) })),
      { file: 'y', tier: 'yearly' as const, at: at('2020-01-01T09:00:00') },
      { file: 'old-snap', tier: 'snapshot' as const, at: at('2026-02-10T09:00:00') },
      { file: 'new-snap', tier: 'snapshot' as const, at: at('2026-02-11T09:00:00') },
    ];
    expect(toRotate(kept, at('2026-02-12T10:00:00')).sort()).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'old-snap']);
  });

  it('schedule: at start if none today, then every 2 hours from 07:00 to 21:00', () => {
    expect(isDue(at('2026-09-28T03:00:00'), null)).toBe(true);
    expect(isDue(at('2026-09-28T03:00:00'), at('2026-09-27T20:00:00'))).toBe(true);
    expect(isDue(at('2026-09-28T09:59:00'), at('2026-09-28T08:00:00'))).toBe(false);
    expect(isDue(at('2026-09-28T10:00:00'), at('2026-09-28T08:00:00'))).toBe(true);
    expect(isDue(at('2026-09-28T22:00:00'), at('2026-09-28T19:00:00'))).toBe(false);
  });
});
