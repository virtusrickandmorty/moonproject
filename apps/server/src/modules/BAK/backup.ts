/**
 * Backups (PLAN C8, NR-13). Each run:
 *   1. copies the live database with SQLite's online backup API;
 *   2. checks the copy: integrity_check, the ledger invariants (the trial balance balances) and the audit chain;
 *   3. gzips it and encrypts it with age to the two recovery public keys (the server holds no secret key), next to a
 *      sidecar JSON with the checks, the SHA-256 of the plain copy, the migrations and the audit chain's head;
 *   4. copies daily, monthly and yearly backups to the off-site folder (Google Drive for desktop);
 *   5. rotates: snapshots kept 48 hours, dailies 30, monthlies 24, yearlies forever.
 * Attachments (engine/attachments.ts) are backed up beside the copies, in the backup folder's attachments folder: each
 * file once, encrypted to the recovery keys and named by its SHA-256 and the keys (<sha256>.<keys>.age), so a run adds
 * only the files attached since the last one. They are never rotated away: attachment rows are never deleted, and every
 * backup's database names every file it had. New recovery keys encrypt them all again, once.
 * A copy that fails a check is never kept. The tier is the widest period with no backup yet: the first backup of the
 * year is yearly, the first of a month monthly, the first of a day daily, the rest snapshots.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Encrypter } from 'age-encryption';
import { AppError, newId } from '@moonproject/shared';
import { openReadonly, snapshotTo, type Db } from '../../platform/db/driver.ts';
import { runInvariants } from '../../engine/ledger/invariants.ts';
import { verifyAuditChain } from '../../engine/audit.ts';
import { attachedFiles, attachmentsDir, readStored, sha256Hex, writeWhole } from '../../engine/attachments.ts';

export const TIERS = ['snapshot', 'daily', 'monthly', 'yearly'] as const;
export type Tier = (typeof TIERS)[number];
export type Reason = 'schedule' | 'manual' | 'pre_update';
const RANK: Record<Tier, number> = { snapshot: 0, daily: 1, monthly: 2, yearly: 3 };
export const PREFIX = 'moonproject-';

/** Recovery public keys are age X25519 recipients: "age1" and 58 bech32 characters. */
export const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

export interface BakSettings { backupDir: string; offsiteDir: string | null; recipients: string[]; version: number }

export function bakSettings(db: Db): BakSettings {
  const r = db.prepare('SELECT backup_dir, offsite_dir, recipients, version FROM bak_settings WHERE id = 1').get() as
    | { backup_dir: string; offsite_dir: string | null; recipients: string; version: number }
    | undefined;
  if (!r) return { backupDir: process.env.MOONPROJECT_BACKUP_DIR ?? 'data/backups', offsiteDir: null, recipients: [], version: 0 };
  return { backupDir: r.backup_dir, offsiteDir: r.offsite_dir, recipients: JSON.parse(r.recipients) as string[], version: r.version };
}

export interface Sidecar {
  app: 'moonproject';
  file: string;
  tier: Tier;
  at: string;
  bytes: number;
  sha256: string;
  gzipBytes: number;
  recipients: string[];
  migrations: string[];
  audit: { seq: number; hash: string } | null;
  trialBalance: { totalDebitCents: number; totalCreditCents: number };
  checks: { integrity: 'ok'; invariants: 'ok'; auditChain: 'ok' };
  /** The attachment files this copy names (absent on backups made before attachments). */
  attachments?: AttachmentsBackedUp;
}

export interface AttachmentsBackedUp {
  files: number;
  bytes: number;
  /** Encrypted by this run: the files attached since the last backup. */
  newFiles: number;
  newBytes: number;
  /** Files a row names that are not in the attachments folder (or no longer match their SHA-256): not backed up. */
  missing: string[];
}

/** The backup folder's attachments folder. */
export const ATTACHMENTS = 'attachments';
/** The recovery keys a file was encrypted to, in its name: new keys make new copies, never unreadable ones. */
export const encryptedName = (sha256: string, recipients: string[]) => `${sha256}.${sha256Hex(Buffer.from([...recipients].sort().join('\n'))).slice(0, 12)}.age`;

/** Encrypts into `dir`/attachments each file the copy names that is not there yet for these keys. */
async function backUpAttachments(copyFile: string, liveDir: string, dir: string, recipients: string[]): Promise<AttachmentsBackedUp> {
  const copy = openReadonly(copyFile);
  let files: { sha256: string; bytes: number }[];
  try {
    files = attachedFiles(copy);
  } finally {
    copy.close();
  }
  const r: AttachmentsBackedUp = { files: files.length, bytes: 0, newFiles: 0, newBytes: 0, missing: [] };
  for (const f of files) {
    r.bytes += f.bytes;
    const target = join(dir, ATTACHMENTS, encryptedName(f.sha256, recipients));
    if (existsSync(target)) continue;
    const plain = readStored(liveDir, f.sha256);
    if (!plain) {
      r.missing.push(f.sha256);
      continue;
    }
    writeWhole(target, await encrypt(plain, recipients));
    r.newFiles++;
    r.newBytes += statSync(target).size;
  }
  return r;
}

/** Copies the encrypted attachments `to` lacks (off-site, USB). Each lands whole, before any backup that names it. */
export function copyAttachments(from: string, to: string): number {
  const src = join(from, ATTACHMENTS);
  if (!existsSync(src)) return 0;
  const dst = join(to, ATTACHMENTS);
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(src).filter((x) => x.endsWith('.age'))) {
    if (existsSync(join(dst, f))) continue;
    copyFileSync(join(src, f), join(dst, `${f}.tmp`));
    renameSync(join(dst, `${f}.tmp`), join(dst, f));
    copied++;
  }
  return copied;
}

/** The tier of a backup made at `at` (Manila timestamp), given the backups kept so far. */
export function tierFor(at: string, kept: { tier: Tier; at: string }[]): Tier {
  const has = (len: number, min: Tier) => kept.some((k) => k.at.slice(0, len) === at.slice(0, len) && RANK[k.tier] >= RANK[min]);
  if (!has(4, 'yearly')) return 'yearly';
  if (!has(7, 'monthly')) return 'monthly';
  if (!has(10, 'daily')) return 'daily';
  return 'snapshot';
}

/** Which kept backups to delete at `at`: snapshots older than 48 hours, all but the newest 30 dailies and 24 monthlies. */
export function toRotate(kept: { file: string; tier: Tier; at: string }[], at: string): string[] {
  const now = Date.parse(at);
  const newestFirst = [...kept].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const keep = { daily: 30, monthly: 24 } as const;
  const out: string[] = [];
  for (const tier of ['daily', 'monthly'] as const) out.push(...newestFirst.filter((k) => k.tier === tier).slice(keep[tier]).map((k) => k.file));
  out.push(...kept.filter((k) => k.tier === 'snapshot' && now - Date.parse(k.at) > 48 * 3600_000).map((k) => k.file));
  return out;
}

/** The backups in a folder, from their sidecars. */
export function keptIn(dir: string): Sidecar[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.json'))
    .flatMap((f) => {
      try {
        const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Sidecar;
        return s.app === 'moonproject' && existsSync(join(dir, s.file)) ? [s] : [];
      } catch {
        return [];
      }
    });
}

export function rotate(dir: string, at: string): void {
  for (const file of toRotate(keptIn(dir), at)) {
    rmSync(join(dir, file), { force: true });
    rmSync(join(dir, file.replace(/\.db\.gz\.age$/, '.json')), { force: true });
  }
}

/** Checks a database copy; throws BACKUP_CHECK with what failed. */
export function checkCopy(file: string): Pick<Sidecar, 'migrations' | 'audit' | 'trialBalance'> {
  const copy = openReadonly(file);
  try {
    const integrity = copy.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new AppError('BACKUP_CHECK', `The copy failed SQLite's integrity check: ${String(integrity)}.`, 500);
    const bad = runInvariants(copy).filter((r) => !r.ok);
    if (bad.length) throw new AppError('BACKUP_CHECK', `The copy failed the ledger checks: ${bad.map((r) => r.id).join(', ')}.`, 500);
    const broken = verifyAuditChain(copy);
    if (broken !== null) throw new AppError('BACKUP_CHECK', `The audit chain of the copy breaks at entry ${broken}.`, 500);
    const tb = copy
      .prepare('SELECT COALESCE(SUM(l.debit_cents), 0) AS totalDebitCents, COALESCE(SUM(l.credit_cents), 0) AS totalCreditCents FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE j.sealed = 1')
      .get() as { totalDebitCents: number; totalCreditCents: number };
    const head = copy.prepare('SELECT seq, row_hash AS hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
    const migrations = copy.prepare('SELECT id FROM schema_migrations ORDER BY id').pluck().all() as string[];
    return { migrations, audit: head ?? null, trialBalance: tb };
  } finally {
    copy.close();
  }
}

async function encrypt(data: Uint8Array, recipients: string[]): Promise<Uint8Array> {
  const e = new Encrypter();
  for (const r of recipients) e.addRecipient(r);
  return e.encrypt(data);
}

export interface BackupResult {
  file: string; tier: Tier; bytes: number; sha256: string; offsite: boolean; offsiteError: string | null;
  attachments: AttachmentsBackedUp; attachmentsError: string | null;
}

/**
 * Makes one backup into settings.backupDir. `at` is the Manila timestamp of the run; it names the file
 * (moonproject-2026-09-28T10-00-00-daily.db.gz.age, safe on Windows).
 */
export async function makeBackup(db: Db, settings: BakSettings, at: string): Promise<BackupResult> {
  if (settings.recipients.length !== 2) throw new AppError('NO_RECOVERY_KEYS', 'Backups are off: set the two recovery keys first.', 409);
  const dir = settings.backupDir;
  mkdirSync(dir, { recursive: true });
  const tier = tierFor(at, keptIn(dir));
  const base = `${PREFIX}${at.slice(0, 19).replaceAll(':', '-')}-${tier}`;
  const tmp = join(dir, `.${base}-${newId()}.db`);
  try {
    await snapshotTo(db, tmp);
    const facts = checkCopy(tmp);
    const plain = readFileSync(tmp);
    const gz = gzipSync(plain);
    const attachments = await backUpAttachments(tmp, attachmentsDir(db), dir, settings.recipients);
    const attachmentsError = attachments.missing.length
      ? `${attachments.missing.length} attached file(s) are missing or damaged in the attachments folder and were not backed up: ${attachments.missing.join(', ')}.`
      : null;
    const file = `${base}.db.gz.age`;
    writeFileSync(join(dir, file), await encrypt(gz, settings.recipients));
    const sidecar: Sidecar = {
      app: 'moonproject', file, tier, at, bytes: statSync(join(dir, file)).size, sha256: createHash('sha256').update(plain).digest('hex'),
      gzipBytes: gz.length, recipients: settings.recipients, ...facts, checks: { integrity: 'ok', invariants: 'ok', auditChain: 'ok' }, attachments,
    };
    writeFileSync(join(dir, `${base}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
    rotate(dir, at);

    // Off-site: the dailies and longer go to the Google Drive folder. A failure there never loses the local backup.
    let offsite = false;
    let offsiteError: string | null = null;
    if (settings.offsiteDir && tier !== 'snapshot') {
      try {
        mkdirSync(settings.offsiteDir, { recursive: true });
        copyAttachments(dir, settings.offsiteDir);
        copyFileSync(join(dir, file), join(settings.offsiteDir, file));
        copyFileSync(join(dir, `${base}.json`), join(settings.offsiteDir, `${base}.json`));
        rotate(settings.offsiteDir, at);
        offsite = true;
      } catch (e) {
        offsiteError = `The off-site copy failed: ${(e as Error).message}`;
      }
    }
    return { file, tier, bytes: sidecar.bytes, sha256: sidecar.sha256, offsite, offsiteError, attachments, attachmentsError };
  } finally {
    rmSync(tmp, { force: true });
    rmSync(`${tmp}-journal`, { force: true });
  }
}

/**
 * Runs a backup and logs it in bak_runs, ok or failed. Never throws for a failed backup: the failure is logged and
 * returned, so the scheduler keeps going and the status page shows it.
 */
export async function runBackup(db: Db, opts: { reason: Reason; userId: string | null; stamp: () => string }): Promise<{ ok: true; result: BackupResult } | { ok: false; code: string; error: string }> {
  const startedAt = opts.stamp();
  const settings = bakSettings(db);
  const log = (r: { tier: Tier; status: 'ok' | 'failed'; file?: string; bytes?: number; sha256?: string; offsite: boolean; error?: string | null }) =>
    db.prepare(
      `INSERT INTO bak_runs (id, started_at, finished_at, reason, tier, status, file, bytes, sha256, offsite, error, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), startedAt, opts.stamp(), opts.reason, r.tier, r.status, r.file ?? null, r.bytes ?? null, r.sha256 ?? null, +r.offsite, r.error ?? null, opts.userId);
  try {
    const result = await makeBackup(db, settings, startedAt);
    log({ ...result, status: 'ok', error: [result.attachmentsError, result.offsiteError].filter(Boolean).join(' ') || null });
    return { ok: true, result };
  } catch (e) {
    const code = e instanceof AppError ? e.code : 'BACKUP_FAILED';
    const error = (e as Error).message;
    log({ tier: 'snapshot', status: 'failed', offsite: false, error });
    return { ok: false, code, error };
  }
}

/** The scheduler's rule: a backup every 2 hours from 07:00 to 21:00 Manila, and one at start if none today. */
export function isDue(at: string, lastOkAt: string | null): boolean {
  if (!lastOkAt) return true;
  if (lastOkAt.slice(0, 10) !== at.slice(0, 10)) return true;
  const hour = Number(at.slice(11, 13));
  return hour >= 7 && hour < 21 && Date.parse(at) - Date.parse(lastOkAt) >= 2 * 3600_000;
}

export const lastOkRun = (db: Db) =>
  db.prepare(`SELECT finished_at AS at, file, tier FROM bak_runs WHERE status = 'ok' ORDER BY finished_at DESC LIMIT 1`).get() as
    | { at: string; file: string; tier: Tier }
    | undefined;
