/** The backup screens' rules (stale notice, runs, keys typed back, what a restore loses), the menu, and the web client against the real server. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, type BackupCheck, type BackupRun } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import {
  agoWords, bothTypedBack, cleanKey, factRows, keyEnd, lostEntries, lostWords, madeWords, pendingRestoreWords, restoreConfirmed, runWords, sizeWords,
  staleWords, typedBackOk, usbWords, whenWords,
} from './backups.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const now = '2026-09-28T10:00:00.000+08:00';

describe('backup screen rules', () => {
  it('says how long ago on the server clock, and turns red with "Backups are stale" only when the server says so', () => {
    expect(['2026-09-28T09:59:30.000+08:00', '2026-09-28T09:59:00.000+08:00', '2026-09-28T09:15:00.000+08:00', '2026-09-28T09:00:00.000+08:00', '2026-09-27T08:00:00.000+08:00', '2026-09-25T09:00:00.000+08:00']
      .map((at) => agoWords(at, now))).toEqual(['just now', '1 minute ago', '45 minutes ago', '1 hour ago', '26 hours ago', '3 days ago']);
    expect(whenWords('2026-09-28T08:00:00.000+08:00', now)).toBe('2026-09-28 08:00 (2 hours ago)');
    expect(whenWords(null, now)).toBe('Never');
    const lastOk = { at: '2026-09-27T07:30:00.000+08:00', file: 'moonproject-2026-09-27T07-30-00-daily.db.gz.age', tier: 'daily' as const };
    expect(staleWords({ lastOk, stale: true }, now)).toBe('Backups are stale: the last good backup was 26 hours ago.');
    expect(staleWords({ lastOk: null, stale: true }, now)).toBe('Backups are stale: no backup has worked yet.');
    expect(staleWords({ lastOk, stale: false }, now)).toBeNull();
    expect(pendingRestoreWords({ file: lastOk.file })).toBe('Moonproject restarts by itself to finish the restore of moonproject-2026-09-27T07-30-00-daily.db.gz.age. If it has not within a few minutes, restart this PC.');
  });

  it('shows each run, a new backup and a USB copy in words', () => {
    const run = (r: Partial<BackupRun>): BackupRun => ({ id: 'r', started_at: now, finished_at: now, reason: 'schedule', tier: 'daily', status: 'ok', file: 'f', bytes: 1, offsite: 1, error: null, ...r });
    expect(runWords(run({}))).toEqual({ when: '2026-09-28 10:00', reason: 'Scheduled', tier: 'Daily', ok: true, result: 'OK' });
    expect(runWords(run({ reason: 'manual', offsite: 0, error: 'The off-site copy failed: EACCES' })).result).toBe('OK. The off-site copy failed: EACCES');
    expect(runWords(run({ reason: 'pre_update', status: 'failed', tier: 'snapshot', error: 'Backups are off: set the two recovery keys first.' })))
      .toMatchObject({ reason: 'Before an update', tier: '—', ok: false, result: 'Failed: Backups are off: set the two recovery keys first.' });
    const made = { file: 'moonproject-2026-09-28T10-00-00-daily.db.gz.age', tier: 'daily' as const, bytes: 4096 };
    expect(madeWords({ ...made, offsite: true, offsiteError: null })).toBe('Backed up: moonproject-2026-09-28T10-00-00-daily.db.gz.age (daily). Copied off-site too.');
    expect(madeWords({ ...made, offsite: false, offsiteError: null })).toMatch(/\(daily\)\. No off-site folder is set\.$/);
    expect(madeWords({ ...made, tier: 'snapshot', offsite: false, offsiteError: null })).toMatch(/\(snapshot\)\. Snapshots stay on this PC\.$/);
    expect(madeWords({ ...made, offsite: false, offsiteError: 'The off-site copy failed: no such folder' })).toMatch(/The off-site copy failed: no such folder$/);
    expect(usbWords({ copied: 3, onDrive: 12 })).toBe('Copied 3; 12 on the drive.');
    expect([200, 48_000, 2_345_678].map(sizeWords)).toEqual(['1 KB', '48 KB', '2.3 MB']);
  });

  it('saves new recovery keys only when the last 8 characters of both are typed back', async () => {
    const a = await generateX25519Identity();
    const b = await generateX25519Identity();
    expect(a).toMatch(/^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/);
    expect(await identityToRecipient(a)).toMatch(/^age1[02-9ac-hj-np-z]{58}$/);
    expect(typedBackOk(a, keyEnd(a))).toBe(true);
    expect(typedBackOk(a, ` ${keyEnd(a).slice(0, 4).toLowerCase()} ${keyEnd(a).slice(4)} `)).toBe(true); // read from paper
    expect(typedBackOk(a, keyEnd(a).slice(1))).toBe(false);
    expect(typedBackOk(a, a.slice(-9))).toBe(false);
    expect(typedBackOk(a, keyEnd(b))).toBe(keyEnd(a) === keyEnd(b));
    expect(typedBackOk('', '')).toBe(false);
    expect(bothTypedBack({ a, b }, { a: keyEnd(a), b: keyEnd(b) })).toBe(true);
    expect(bothTypedBack({ a, b }, { a: keyEnd(a), b: '' })).toBe(false);
    expect(bothTypedBack({ a, b }, { a: keyEnd(b), b: keyEnd(a) })).toBe(keyEnd(a) === keyEnd(b));
    expect(cleanKey(` ${a.slice(0, 30).toLowerCase()}\n${a.slice(30)} `)).toBe(a);
  });

  it('says what a checked backup holds and what a restore would lose; RESTORE must be typed exactly', () => {
    const check: BackupCheck = {
      file: 'f', madeAt: '2026-09-27T19:00:00.000+08:00', tier: 'daily', sidecar: 'matches', toApply: [], audit: { seq: 40 }, lastAuditAt: '2026-09-27T18:59:00.000+08:00',
      trialBalance: { totalDebitCents: 1_234_500, totalCreditCents: 1_234_500 }, lastBusinessDate: '2026-09-27', postedDocuments: 17,
      stagedId: 's', live: { auditSeq: 52, lastAuditAt: now },
    };
    expect(factRows(check)).toEqual([
      ['Made at', '2026-09-27 19:00'], ['Posted documents', '17'], ['Books up to', '2026-09-27'], ['Trial balance', 'Debits ₱12,345.00, credits ₱12,345.00'],
      ['Updates to apply', 'None: made by this version'],
    ]);
    expect(factRows({ ...check, madeAt: null, lastBusinessDate: null, toApply: ['TAX/0003_x.sql'] }).map(([, v]) => v))
      .toEqual(['Unknown: the backup has no record file', '17', 'Nothing posted yet', 'Debits ₱12,345.00, credits ₱12,345.00', '1: TAX/0003_x.sql']);
    expect(lostEntries(check)).toBe(12);
    expect(lostWords(check)).toBe('Everything recorded after 2026-09-27 19:00 will be lost: 12 audit entries in the live data are newer than this backup.');
    expect(lostWords({ ...check, live: { auditSeq: 41, lastAuditAt: now } })).toMatch(/lost: 1 audit entry in the live data is newer than this backup\.$/);
    expect(lostWords({ ...check, madeAt: null, audit: null })).toMatch(/^Everything recorded after 2026-09-27 18:59 will be lost: 52 audit entries/);
    expect(['RESTORE', ' RESTORE ', 'restore', 'RESTOR', ''].map(restoreConfirmed)).toEqual([true, true, false, false, false]);
  });

  it('the menu shows Backups under Admin with the permission of the status route', () => {
    const admin = (permissions: string[]) => buildMenu([], new Set(permissions)).find((g) => g.group === 'Admin')?.items.map((i) => `${i.label} ${i.path}`);
    expect(admin(['bak.view'])).toEqual(['Shop certificate /admin/shop-certificate', 'Practice shop /admin/practice', 'Backups /bak']);
    expect(admin(['bak.run', 'bak.manage'])).toEqual(['Shop certificate /admin/shop-certificate', 'Practice shop /admin/practice']);
  });
});

describe('web client for the backup screens', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'moonproject-bak-web-'));
    process.env.MOONPROJECT_RESTORE_DIR = join(dir, 'restore');
  });
  afterEach(() => {
    delete process.env.MOONPROJECT_RESTORE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('keys made in the browser, back up now, a USB copy, the drill and a restore, as the screens ask for them', async () => {
    const env = await createTestEnv(); // 2026-09-28 10:00 Manila
    createUser(env.db, 'own1', ['owner']);
    createUser(env.db, 'acct1', ['accountant']);
    const owner = createApi(injectFetch(env.app));
    const acct = createApi(injectFetch(env.app));
    await owner.login('own1', PASSWORD);
    await acct.login('acct1', PASSWORD);

    const before = await owner.bakStatus();
    expect(before).toMatchObject({ stale: true, lastOk: null, settings: { version: 0, recipients: [] }, pendingRestore: null });
    expect(staleWords(before, now)).toBe('Backups are stale: no backup has worked yet.');
    await expect(owner.bakRun()).rejects.toMatchObject({ code: 'NO_RECOVERY_KEYS', message: 'Backups are off: set the two recovery keys first.' });

    // The recovery keys screen: two keys made here; only the public keys are sent, after the password.
    const keys = await Promise.all([0, 1].map(async () => { const secret = await generateX25519Identity(); return { secret, recipient: await identityToRecipient(secret) }; }));
    const body = { backupDir: join(dir, 'local'), offsiteDir: null, recipients: keys.map((k) => k.recipient) };
    await expect(owner.bakSaveSettings(0, body)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await expect(owner.stepUp('not my password')).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    await owner.stepUp(PASSWORD);
    const saved = await owner.bakSaveSettings(0, body);
    expect(saved).toMatchObject({ recipients: body.recipients, version: 1 });
    await expect(acct.bakSaveSettings(1, body)).rejects.toMatchObject({ status: 403 });
    await expect(owner.bakSaveSettings(0, { ...body, offsiteDir: join(dir, 'drive') })).rejects.toMatchObject({ code: 'STALE' });

    const made = await acct.bakRun(); // bak.run: the accountant too
    expect(madeWords(made)).toBe('Backed up: moonproject-2026-09-28T10-00-00-yearly.db.gz.age (yearly). No off-site folder is set.');
    const status = await acct.bakStatus();
    expect(status).toMatchObject({ stale: false, lastOk: { file: made.file, tier: 'yearly' }, kept: { snapshot: 0, daily: 0, monthly: 0, yearly: 1 }, usb: { A: null, B: null } });
    expect(status.issues.map((i) => i.code)).toEqual(['NO_OFFSITE', 'DRILL_DUE', 'USB_OVERDUE']);
    expect(runWords(status.runs[0]!)).toMatchObject({ reason: 'Back up now', tier: 'Yearly', result: 'OK' });

    const usb = join(dir, 'usb');
    expect(usbWords(await acct.bakUsb('A', usb))).toBe('Copied 1; 1 on the drive.');
    await expect(acct.bakUsb('B', usb)).rejects.toMatchObject({ code: 'WRONG_DRIVE', message: 'This is USB drive A, not B. Pick drive A, or plug in drive B.' });

    // Restore and drill: the owner's, with the password before each POST.
    await expect(acct.bakBackups()).rejects.toMatchObject({ status: 403 });
    const [backup] = await owner.bakBackups();
    expect(backup).toMatchObject({ source: 'local', file: made.file, tier: 'yearly' });
    const ask = (key: string, purpose: 'drill' | 'restore') => ({ source: backup!.source, file: backup!.file, key: cleanKey(key), purpose });
    await owner.stepUp(PASSWORD);
    const drill = await owner.bakCheck(ask(` ${keys[1]!.secret.toLowerCase()} `, 'drill'));
    expect(drill).toMatchObject({ drill: 'passed', madeAt: expect.stringMatching(/^2026-09-28T10:00/), postedDocuments: 0, toApply: [] });
    expect(drill.stagedId).toBeUndefined();
    expect((await owner.bakStatus()).lastDrillAt).toMatch(/^2026-09-28T10:00/);
    await expect(owner.bakCheck(ask((await generateX25519Identity()), 'drill'))).rejects.toMatchObject({ code: 'WRONG_KEY', message: 'This recovery key does not open this backup. Try the other key.' });

    const check = await owner.bakCheck(ask(keys[0]!.secret, 'restore'));
    expect(check.stagedId).toEqual(expect.any(String));
    expect(lostEntries(check)).toBe(check.live!.auditSeq - check.audit!.seq);
    expect(lostEntries(check)).toBeGreaterThan(0); // at least the password and the checks since
    expect(lostWords(check)).toMatch(/^Everything recorded after 2026-09-28 10:00 will be lost: \d+ audit entries in the live data are newer than this backup\.$/);
    await owner.stepUp(PASSWORD);
    const applied = await owner.bakApply(check.stagedId!);
    expect(applied).toMatchObject({ file: made.file, restartNeeded: true, restarting: true, message: expect.stringMatching(/^Moonproject restarts by itself within a minute/) });
    const pending = (await owner.bakStatus()).pendingRestore;
    expect(pending).toMatchObject({ id: check.stagedId, file: made.file });
    expect(pendingRestoreWords(pending!)).toBe(`Moonproject restarts by itself to finish the restore of ${made.file}. If it has not within a few minutes, restart this PC.`);
    await env.app.close();
  });
});
