/**
 * Restore (PLAN C8, N-15): either recovery key opens a backup for the quarterly drill or a restore; a wrong key, a
 * damaged copy or a newer version is refused and logged; the restore is finished at the next start and keeps the
 * database it replaces. USB copies go to drive A or B, never mixed up.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { PASSWORD, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { openReadonly } from '../../../platform/db/driver.ts';
import { applyPendingRestore, compatibility } from '../restore.ts';

let env: TestEnv;
let owner: Client, accountant: Client;
let dir: string;
let keys: { identity: string; recipient: string }[];
let backup: string;

const newKey = async () => {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
};
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const jv = (memo: string, cents: number) =>
  accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines: [{ accountId: account('1101'), debitCents: cents }, { accountId: account('3900'), creditCents: cents }] },
    expectedTotalCents: cents,
  }, idem());
const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const check = async (purpose: 'drill' | 'restore', key: string, file = backup) => {
  await stepUp(owner);
  return owner.post('/api/bak/restore/check', { source: 'local', file, key, purpose });
};

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  owner = await env.as('owner');
  accountant = await env.as('accountant');
  dir = mkdtempSync(join(tmpdir(), 'moonproject-restore-'));
  process.env.MOONPROJECT_RESTORE_DIR = join(dir, 'restore');
  keys = [await newKey(), await newKey()];
  await stepUp(owner);
  expect((await owner.put('/api/bak/settings', { backupDir: join(dir, 'local'), offsiteDir: null, recipients: keys.map((k) => k.recipient) })).statusCode).toBe(200);
  expect((await jv('Opening cash', 500_000)).statusCode).toBe(200);
  const run = await owner.post('/api/bak/run', {}, idem());
  expect(run.statusCode, run.body).toBe(200);
  backup = run.json().file;
});
afterEach(() => {
  delete process.env.MOONPROJECT_RESTORE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const logged = () => env.db.prepare('SELECT purpose, result, error FROM bak_restore_checks ORDER BY at, rowid').all();

describe('restore drill', () => {
  it('opens the backup with key B, checks it and records the drill', async () => {
    expect((await owner.get('/api/bak/status')).json().issues.map((i: { code: string }) => i.code)).toContain('DRILL_DUE');
    const res = await check('drill', keys[1]!.identity);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      drill: 'passed', file: backup, tier: 'yearly', sidecar: 'matches', toApply: [], postedDocuments: 1, lastBusinessDate: '2026-09-28',
      trialBalance: { totalDebitCents: 500_000, totalCreditCents: 500_000 },
    });
    expect(res.json().stagedId).toBeUndefined();
    const status = (await owner.get('/api/bak/status')).json();
    expect([status.lastDrillAt, status.issues.map((i: { code: string }) => i.code)]).toEqual([expect.stringMatching(/^2026-09-28T10:/), ['NO_OFFSITE', 'USB_OVERDUE']]);
    expect(logged()).toEqual([{ purpose: 'drill', result: 'ok', error: null }]);
    // The key is never stored or audited.
    const everything = JSON.stringify([env.db.prepare('SELECT * FROM audit_log').all(), env.db.prepare('SELECT * FROM bak_restore_checks').all()]);
    expect(everything).not.toContain(keys[1]!.identity);
  });

  it('refuses a key that is not one of the two, a mistyped key and a damaged copy, and logs each', async () => {
    const stranger = await check('drill', (await newKey()).identity);
    expect([stranger.statusCode, stranger.json().code]).toEqual([400, 'WRONG_KEY']);
    expect((await check('drill', 'AGE-SECRET-KEY-1 not a key')).json().code).toBe('BAD_KEY');

    const sidecar = join(dir, 'local', backup.replace('.db.gz.age', '.json'));
    writeFileSync(sidecar, readFileSync(sidecar, 'utf8').replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${'0'.repeat(64)}"`));
    const damaged = await check('drill', keys[0]!.identity);
    expect([damaged.statusCode, damaged.json().code]).toEqual([422, 'DAMAGED']);
    expect(logged()).toEqual([
      expect.objectContaining({ result: 'failed' }), expect.objectContaining({ result: 'failed' }), expect.objectContaining({ result: 'failed', error: expect.stringContaining('damaged') }),
    ]);
  });

  it('is the owner\'s, with a fresh password', async () => {
    expect((await accountant.post('/api/bak/restore/check', { source: 'local', file: backup, key: keys[0]!.identity, purpose: 'drill' })).statusCode).toBe(403);
    expect((await accountant.get('/api/bak/backups')).statusCode).toBe(403);
    env.clock.advance(10 * 60_000);
    expect((await owner.post('/api/bak/restore/check', { source: 'local', file: backup, key: keys[0]!.identity, purpose: 'drill' })).json().code).toBe('STEP_UP_REQUIRED');
  });
});

describe('restore', () => {
  it('stages the checked copy, then swaps it in at the next start and keeps the database it replaced', async () => {
    expect((await jv('Cash after the backup', 100_000)).statusCode).toBe(200);
    expect((await owner.get('/api/bak/backups')).json()).toEqual([expect.objectContaining({ source: 'local', file: backup, tier: 'yearly' })]);

    const res = await check('restore', keys[0]!.identity);
    expect(res.statusCode, res.body).toBe(200);
    const { stagedId, live, audit } = res.json();
    expect(live.auditSeq).toBeGreaterThan(audit.seq); // what was recorded after the backup is shown before restoring

    await stepUp(owner);
    const applied = await owner.post('/api/bak/restore/apply', { stagedId });
    expect(applied.json()).toMatchObject({ file: backup, restartNeeded: true, restarting: true });
    // Moonproject restarts by itself once no request is running (platform/restart.ts); until then nothing is recorded.
    expect(env.deps.restart.reason).toBe(`restore of ${backup}`);
    expect((await jv('Cash while restarting', 1_000)).json().code).toBe('RESTARTING');
    expect((await owner.get('/api/bak/status')).json().pendingRestore).toMatchObject({ id: stagedId, file: backup });

    // The next start (main.ts) finishes it.
    const liveFile = join(dir, 'moonproject.db');
    writeFileSync(liveFile, 'the database before the restore');
    writeFileSync(`${liveFile}-wal`, 'its WAL');
    const r = applyPendingRestore(liveFile, '2026-09-28T11:00:00.000+08:00');
    expect(r).toEqual({ file: backup, previous: join(dir, 'before-restore-2026-09-28T11-00-00.db') });
    expect([readFileSync(r!.previous, 'utf8'), readFileSync(`${r!.previous}-wal`, 'utf8'), existsSync(`${liveFile}-wal`)]).toEqual(['the database before the restore', 'its WAL', false]);
    const restored = openReadonly(liveFile);
    expect(restored.prepare(`SELECT COUNT(*) FROM documents WHERE status = 'posted'`).pluck().get()).toBe(1);
    restored.close();
    expect(applyPendingRestore(liveFile, '2026-09-28T11:05:00.000+08:00')).toBeNull();
  });

  it('refuses to restore without a fresh check', async () => {
    await stepUp(owner);
    expect((await owner.post('/api/bak/restore/apply', { stagedId: 'nothing-checked' })).json().code).toBe('NOT_STAGED');
    const { stagedId } = (await check('restore', keys[1]!.identity)).json();
    env.clock.advance(31 * 60_000);
    owner = await env.as('owner');
    await stepUp(owner);
    expect((await owner.post('/api/bak/restore/apply', { stagedId })).json().code).toBe('NOT_STAGED');
  });

  it('opens copies from this version or an older one, never a newer or changed one (N-15)', () => {
    const app = [{ id: 'engine/0001.sql', checksum: 'a' }, { id: 'TAX/0001.sql', checksum: 'b' }];
    expect(compatibility(app, app)).toEqual({ newer: [], changed: [], toApply: [] });
    expect(compatibility(app.slice(0, 1), app)).toEqual({ newer: [], changed: [], toApply: ['TAX/0001.sql'] });
    expect(compatibility([...app, { id: 'TAX/0002.sql', checksum: 'c' }], app).newer).toEqual(['TAX/0002.sql']);
    expect(compatibility([{ id: 'engine/0001.sql', checksum: 'x' }], app).changed).toEqual(['engine/0001.sql']);
  });
});

describe('USB copies', () => {
  it('copies what drive A lacks, never mixes up the drives, and clears the weekly reminder', async () => {
    const usb = join(dir, 'usb');
    const first = await owner.post('/api/bak/usb', { drive: 'A', dir: usb });
    expect(first.json()).toEqual({ drive: 'A', copied: 1, onDrive: 1 });
    expect(existsSync(join(usb, backup))).toBe(true);
    expect((await owner.post('/api/bak/usb', { drive: 'A', dir: usb })).json()).toMatchObject({ copied: 0, onDrive: 1 });
    const wrong = await owner.post('/api/bak/usb', { drive: 'B', dir: usb });
    expect([wrong.statusCode, wrong.json().code]).toEqual([409, 'WRONG_DRIVE']);

    const status = (await owner.get('/api/bak/status')).json();
    expect(status.usb).toEqual({ A: expect.stringMatching(/^2026-09-28/), B: null });
    expect(status.issues.map((i: { code: string }) => i.code)).not.toContain('USB_OVERDUE');
    expect((await (await env.as('encoder')).post('/api/bak/usb', { drive: 'A', dir: usb })).statusCode).toBe(403);
  });
});
