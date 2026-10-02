/**
 * Nightly checks (PLAN E13), on a fake clock: one run a night at 02:00 Manila, catching up after the PC was off, each
 * check finding a planted problem and passing on a clean shop, the Home line, and the permissions.
 * The shop starts on 2026-09-27 at 10:00 Manila; "night" is the day that just ended.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { PASSWORD, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { stamp } from '../../../platform/clock.ts';
import { runBackup } from '../../BAK/backup.ts';
import { nightlyRuns, nightlyTick, type NightlyContext } from '../nightly.ts';
import { nightlyLine } from '../../../../../web/src/modules/AUD/nightly.ts';

let env: TestEnv;
let owner: Client, accountant: Client, encoder: Client;
let dir: string;

const ctx = (): NightlyContext => ({ db: env.db, clock: env.clock, practice: false, titleOf: (t) => env.deps.registry.docType(t)?.title ?? t });
const tick = () => nightlyTick(ctx());
/** Moves the clock; a session idle for an hour ends, so everyone signs in again, as they would the next morning. */
const manila = async (date: string, time = '10:00') => {
  env.clock.set(`${date}T${time}:00+08:00`);
  [owner, accountant, encoder] = await Promise.all([env.as('owner'), env.as('accountant'), env.as('encoder')]);
};
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const runs = () => env.db.prepare('SELECT night, covers_from AS coversFrom FROM aud_nightly_runs ORDER BY night').all() as { night: string; coversFrom: string }[];
const found = (r: NonNullable<ReturnType<typeof tick>>, key: string) => r.checks.find((c) => c.key === key)!;

/** Recovery keys and a first backup, so the "last backup" check has one to look at. */
async function setUpBackups() {
  const keys = await Promise.all([0, 1].map(async () => identityToRecipient(await generateX25519Identity())));
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const saved = await owner.put('/api/bak/settings', { backupDir: join(dir, 'local'), offsiteDir: join(dir, 'drive'), recipients: keys });
  expect(saved.statusCode, saved.body).toBe(200);
  await backupNow();
}
const backupNow = async () => {
  const r = await runBackup(env.db, { reason: 'manual', userId: null, stamp: () => stamp(env.clock) });
  expect(r.ok, JSON.stringify(r)).toBe(true);
};
const receive = (cents: number) => encoder.post('/api/docs/cash.other_receipt/post', {
  input: { cashPlaceId: cashPlaceId(env.db, '1101'), category: 'other_income', receivedFrom: 'Made-up Scrap Buyer', description: 'Scrap cloth', amountCents: cents }, expectedTotalCents: cents }, idem());
const count = (denominationCents: number, qty: number) => encoder.post('/api/docs/cash.count/post', {
  input: { cashPlaceId: cashPlaceId(env.db, '1101'), lines: [{ denominationCents, qty }] }, expectedTotalCents: denominationCents * qty }, idem());
const backdatedJv = () => accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Made-up correction', lateReason: 'Recorded late on purpose for the test',
  lines: [{ accountId: account('1101'), debitCents: 5000 }, { accountId: account('3900'), creditCents: 5000 }] }, businessDate: '2026-09-01', expectedTotalCents: 5000 }, idem());

beforeEach(async () => {
  env = await createTestEnv('2026-09-27T02:00:00Z'); // 10:00 Manila
  owner = await env.as('owner');
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  dir = mkdtempSync(join(tmpdir(), 'moonproject-nightly-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('when the checks run', () => {
  it('runs once a night, from 02:00 Manila', async () => {
    await setUpBackups();
    await manila('2026-09-28', '01:59');
    const first = tick(); // the PC is on at 01:59: last night (09-26) is the newest complete one
    expect(first?.night).toBe('2026-09-26');
    expect(tick()).toBeNull(); // not twice
    await manila('2026-09-28', '02:00');
    expect(tick()?.night).toBe('2026-09-27');
    await manila('2026-09-28', '23:59');
    expect(tick()).toBeNull();
    await manila('2026-09-29', '01:59');
    expect(tick()).toBeNull();
    await manila('2026-09-29', '02:00');
    expect(tick()?.night).toBe('2026-09-28');
    expect(runs().map((r) => r.night)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
  });

  it('catches up at the next start after the PC was off, covering every day it missed', async () => {
    await setUpBackups();
    await manila('2026-09-28', '10:00');
    expect(tick()?.night).toBe('2026-09-27');
    // Off from the evening of 09-28 to the morning of 10-02. A late entry made on 09-29 and one on 09-30, before it went off? No: made while on.
    await manila('2026-09-29');
    expect((await backdatedJv()).statusCode).toBe(200);
    await manila('2026-10-02', '09:00'); // the PC starts
    const ran = tick()!;
    expect([ran.night, ran.coversFrom]).toEqual(['2026-10-01', '2026-09-28']);
    expect(found(ran, 'late').findings).toEqual([expect.objectContaining({ detail: expect.stringContaining('dated 2026-09-01, recorded 2026-09-29') })]);
    expect(tick()).toBeNull(); // once: a start does not run it twice
    expect(runs()).toEqual([{ night: '2026-09-27', coversFrom: '2026-09-27' }, { night: '2026-10-01', coversFrom: '2026-09-28' }]);
  });

  it('reaches back at most 31 days after a long time off', async () => {
    expect(tick()?.night).toBe('2026-09-26');
    await manila('2026-12-01', '09:00');
    const ran = tick()!;
    expect([ran.night, ran.coversFrom]).toEqual(['2026-11-30', '2026-10-31']);
  });
});

describe('the checks', () => {
  beforeEach(async () => {
    await setUpBackups();
  });
  const night = async () => { await manila('2026-09-28'); return tick()!; }; // the checks for 09-27, the day the planting happened

  it('all pass on a clean shop', async () => {
    const r = await night();
    expect(r.checks.map((c) => [c.key, c.passed])).toEqual([
      ['integrity', true], ['backup', true], ['gaps', true], ['drafts', true], ['cash', true], ['late', true], ['cancelled', true],
      ['books', true], ['negative-cash', true]]);
    expect(env.db.prepare('SELECT found_count FROM aud_nightly_runs').pluck().get()).toBe(0);
  });

  it('integrity: finds a changed audit record', async () => {
    env.db.exec('DROP TRIGGER audit_log_no_update');
    env.db.prepare("UPDATE audit_log SET action = 'tampered' WHERE seq = 1").run();
    const c = found(await night(), 'integrity');
    expect(c.passed).toBe(false);
    expect(c.findings[0]!.detail).toContain('Audit chain: Audit chain breaks at entry 1');
  });

  it('backup: finds a file that does not open, a missing file, and backups off', async () => {
    const files = () => readdirSync(join(dir, 'local')).filter((f) => f.endsWith('.age'));
    writeFileSync(join(dir, 'local', files()[0]!), Buffer.alloc(200)); // the same name, not an encrypted backup
    expect(found(await night(), 'backup').findings[0]!.detail).toMatch(/not the size|does not open/);
    await manila('2026-09-29', '02:00');
    await backupNow();
    for (const f of files()) rmSync(join(dir, 'local', f));
    expect(found(tick()!, 'backup').findings[0]!.detail).toContain('is not in the backup folder');
    const off = await createTestEnv('2026-09-28T02:00:00Z');
    const r = nightlyTick({ db: off.db, clock: off.clock, practice: false, titleOf: (t) => t })!;
    expect(found(r, 'backup').findings[0]).toEqual({ detail: expect.stringContaining('Backups are off'), path: '/bak' });
  });

  it('backup: an old last backup is found', async () => {
    await manila('2026-09-30'); // no backup since 09-27 10:00
    expect(found(tick()!, 'backup').findings[0]!.detail).toContain('more than a day ago');
  });

  it('gaps: finds a missing number in a series', async () => {
    expect((await receive(10_000)).json().number).toBe('ORC-000001');
    env.db.prepare("UPDATE number_series SET next_value = next_value + 1 WHERE series_key = 'ORC'").run(); // ORC-000002 issued, never used
    const c = found(await night(), 'gaps');
    expect(c.findings).toEqual([{ detail: 'ORC-000002 is missing from ORC- numbers (ORC-000002 is the newest issued).', path: '/aud/integrity' }]);
  });

  it('drafts: finds a draft left more than 7 days, not one left 7 days', async () => {
    const draft = (id: string, updated: string) => env.db.prepare("INSERT INTO drafts (id, doc_type, payload, status, created_by, created_at, updated_at) VALUES (?, 'cash.transfer', '{}', 'open', ?, ?, ?)")
      .run(id, encoder.userId, updated, updated);
    draft('old-draft', '2026-09-20T09:00:00.000+08:00');
    draft('week-draft', '2026-09-21T09:00:00.000+08:00');
    const c = found(await night(), 'drafts'); // checked on 09-28
    expect(c.findings).toEqual([{ detail: expect.stringContaining('last changed 2026-09-20'), path: '/docs/cash.transfer/new?draft=old-draft' }]);
  });

  it('cash: finds a box whose last count differed from the books, and clears when the next count matches', async () => {
    await receive(100_000); // ₱1,000.00 in the box
    const short = (await count(10_000, 9)).json(); // counted ₱900.00
    const c = found(await night(), 'cash');
    expect(c.findings).toEqual([{ detail: expect.stringMatching(/the last count \(CNT-000001, 2026-09-27\) was ₱100\.00 short of the books/), path: `/docs/cash.count/${short.id}` }]);
    expect((await count(10_000, 9)).statusCode).toBe(200); // the shortage posted, so ₱900.00 is now right
    await manila('2026-09-29');
    await backupNow();
    expect(found(tick()!, 'cash').passed).toBe(true);
  });

  it("late: finds the day's back-dated documents", async () => {
    expect((await backdatedJv()).statusCode).toBe(200);
    const c = found(await night(), 'late');
    expect(c.findings).toEqual([{ detail: expect.stringMatching(/^Journal Voucher JV-000001 dated 2026-09-01, recorded 2026-09-27 10:00\.$/), path: expect.stringMatching(/^\/docs\/acc\.jv\//) }]);
  });

  it("cancelled: finds the day's cancellations, with the reason", async () => {
    const r = (await receive(10_000)).json();
    expect((await accountant.post(`/api/docs/cash.other_receipt/${r.id}/cancel`, { reason: 'Recorded in the wrong box' }, idem())).statusCode).toBe(200);
    const c = found(await night(), 'cancelled');
    expect(c.findings).toEqual([{ detail: expect.stringContaining('ORC-000001 was cancelled: Recorded in the wrong box'), path: `/docs/cash.other_receipt/${r.id}` }]);
  });

  it('a check that cannot run counts as found', async () => {
    env.db.exec('ALTER TABLE cash_counts RENAME TO cash_counts_gone');
    const c = found(await night(), 'cash');
    expect([c.passed, c.findings[0]!.detail]).toEqual([false, expect.stringContaining('could not run')]);
  });
});

describe('the Home line and the nights kept', () => {
  it('appears when last night found something and clears when a later night finds nothing', async () => {
    await setUpBackups();
    expect((await backdatedJv()).statusCode).toBe(200);
    await manila('2026-09-28');
    tick();
    const red = (await owner.get('/api/aud/nightly/status')).json();
    expect(red).toMatchObject({ night: '2026-09-27', foundCount: 1, found: [{ key: 'late', label: 'Late entries and back-dated documents', foundCount: 1 }] });
    expect(nightlyLine(red)).toBe("Last night's checks (2026-09-27) found something to look at: late entries and back-dated documents.");
    expect((await accountant.get('/api/aud/nightly/status')).json().foundCount).toBe(1);

    await manila('2026-09-29');
    await backupNow();
    tick(); // 09-28 was quiet
    const clear = (await owner.get('/api/aud/nightly/status')).json();
    expect(clear).toMatchObject({ night: '2026-09-28', foundCount: 0, found: [] });
    expect(nightlyLine(clear)).toBeNull();
  });

  it('shows nothing before any night has run', async () => {
    const s = (await owner.get('/api/aud/nightly/status')).json();
    expect(s).toEqual({ night: null, ranAt: null, foundCount: 0, found: [], integrity: null });
    expect(nightlyLine(s)).toBeNull();
    expect((await owner.get('/api/aud/nightly')).json()).toEqual({ rows: [], nextBefore: null });
  });

  it('lists each night newest first, with findings and links, and pages back', async () => {
    await setUpBackups();
    expect((await backdatedJv()).statusCode).toBe(200);
    for (const d of ['2026-09-28', '2026-09-29', '2026-09-30']) { await manila(d); await backupNow(); tick(); }
    const page = (await accountant.get('/api/aud/nightly?limit=2')).json();
    expect(page.rows.map((r: { night: string }) => r.night)).toEqual(['2026-09-29', '2026-09-28']);
    expect(page.nextBefore).toBe('2026-09-28');
    const older = (await accountant.get(`/api/aud/nightly?limit=2&before=${page.nextBefore}`)).json();
    expect(older.rows.map((r: { night: string }) => r.night)).toEqual(['2026-09-27']);
    expect(older.rows[0].checks.find((c: { key: string }) => c.key === 'late')).toMatchObject({
      label: 'Late entries and back-dated documents', passed: false, foundCount: 1, reportPath: '/rpt/late-entries',
      findings: [{ detail: expect.stringContaining('JV-000001'), path: expect.stringMatching(/^\/docs\/acc\.jv\//) }] });
    expect((await accountant.get('/api/aud/nightly?before=tomorrow')).statusCode).toBe(400);
  });

  it('lists the last 400 nights and never deletes older ones', async () => {
    const put = (night: string) => env.db.prepare('INSERT INTO aud_nightly_runs (id, night, covers_from, ran_at, found_count) VALUES (?, ?, ?, ?, 0)').run(`run-${night}`, night, night, `${night}T02:00:00.000+08:00`);
    put('2025-08-24'); // 399 days before 2026-09-27
    put('2025-08-23'); // 400 days: still listed
    put('2025-08-22'); // 401 days: not listed
    expect(nightlyRuns(env.db, '2026-09-27', { limit: 10 }).rows.map((r) => r.night)).toEqual(['2025-08-24', '2025-08-23']);
    expect(() => env.db.prepare('DELETE FROM aud_nightly_runs').run()).toThrow(/NO_DELETE/);
    expect(() => env.db.prepare("UPDATE aud_nightly_runs SET found_count = 9 WHERE night = '2025-08-22'").run()).toThrow(/IMMUTABLE/);
    expect(env.db.prepare('SELECT COUNT(*) FROM aud_nightly_runs').pluck().get()).toBe(3);
  });
});

describe('Run the checks now, and who may see the nights', () => {
  it('only reads: the same checks, and nothing stored or posted', async () => {
    await setUpBackups();
    expect((await backdatedJv()).statusCode).toBe(200);
    const count = (t: string) => env.db.prepare(`SELECT COUNT(*) FROM ${t}`).pluck().get() as number;
    const before = ['documents', 'journals', 'journal_lines', 'audit_log', 'aud_nightly_runs', 'aud_nightly_checks'].map(count);
    const res = await owner.post('/api/aud/nightly/run', {});
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect([body.from, body.to, body.foundCount]).toEqual(['2026-09-27', '2026-09-27', 1]);
    expect(body.checks.map((c: { key: string }) => c.key)).toEqual(['integrity', 'backup', 'gaps', 'drafts', 'cash', 'late', 'cancelled', 'books', 'negative-cash']);
    expect(body.checks.find((c: { key: string }) => c.key === 'late').findings).toHaveLength(1);
    expect(['documents', 'journals', 'journal_lines', 'audit_log', 'aud_nightly_runs', 'aud_nightly_checks'].map(count)).toEqual(before);
  });

  it('starts the day checks after the last night run', async () => {
    await setUpBackups();
    await manila('2026-09-28');
    tick(); // covers 09-27
    await manila('2026-09-29');
    const body = (await owner.post('/api/aud/nightly/run', {})).json();
    expect([body.from, body.to]).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('answers 403 to a role without the audit permission, and to the accountant for the button', async () => {
    for (const path of ['/api/aud/nightly', '/api/aud/nightly/status']) {
      expect([(await encoder.get(path)).statusCode, (await (await env.as('production')).get(path)).statusCode]).toEqual([403, 403]);
      expect((await accountant.get(path)).statusCode).toBe(200);
    }
    expect((await encoder.post('/api/aud/nightly/run', {})).statusCode).toBe(403);
    expect((await accountant.post('/api/aud/nightly/run', {})).statusCode).toBe(403); // the button is the owner's
  });
});
