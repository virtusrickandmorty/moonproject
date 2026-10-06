/**
 * Restore (PLAN C8 "Restore", N-15). A backup is opened with one recovery key (A or B), checked and staged: the
 * decrypted copy must match its sidecar's SHA-256, come from this version of Virtus or an older one (older copies
 * are brought up to date first), and pass the same checks as a new backup. Restoring swaps the staged copy in at the
 * next start; the database it replaces is kept next to it (before-restore-….db). The quarterly drill is the same
 * check without the swap. The secret key is used in memory only: never stored, logged or audited.
 * Each attachment row's file must be in the backup's attachments folder and open to its SHA-256 (a drill reports any
 * missing or changed one); a restore puts those files back in the attachments folder beside the database.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Decrypter } from 'age-encryption';
import { AppError, badRequest, newId } from '@moonproject/shared';
import { openDb, openReadonly, type Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { attachedFiles, sha256Hex, storeFile } from '../../engine/attachments.ts';
import { revokeAllSessions } from '../../engine/security/sessions.ts';
import { ATTACHMENTS, checkCopy, type Sidecar } from './backup.ts';

/** A recovery secret key: "AGE-SECRET-KEY-1" and 58 bech32 characters, as printed at setup. */
export const AGE_IDENTITY = /^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/;
export const BACKUP_FILE = /^moonproject-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(snapshot|daily|monthly|yearly)\.db\.gz\.age$/;
/** A staged copy must be restored within this long of its check. */
const STAGED_FOR_MS = 30 * 60_000;

/** Where staged copies and the pending-restore note live: a "restore" folder next to the live database. */
export function restoreDir(dbFile: string): string {
  if (process.env.MOONPROJECT_RESTORE_DIR) return process.env.MOONPROJECT_RESTORE_DIR;
  return dbFile === ':memory:' || dbFile === '' ? join(tmpdir(), 'moonproject-restore') : join(dirname(dbFile), 'restore');
}

interface Migration { id: string; checksum: string }
const migrationsOf = (db: Db) => db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as Migration[];

/** Whether this app can open a copy with these migrations: none it does not know, none changed. */
export function compatibility(copy: Migration[], app: Migration[]): { newer: string[]; changed: string[]; toApply: string[] } {
  const known = new Map(app.map((m) => [m.id, m.checksum]));
  const has = new Set(copy.map((m) => m.id));
  return {
    newer: copy.filter((m) => !known.has(m.id)).map((m) => m.id),
    changed: copy.filter((m) => known.has(m.id) && known.get(m.id) !== m.checksum).map((m) => m.id),
    toApply: app.filter((m) => !has.has(m.id)).map((m) => m.id),
  };
}

export interface BackupFacts {
  file: string;
  /** From the sidecar; null when the sidecar is missing (a copy found without it). */
  madeAt: string | null;
  tier: Sidecar['tier'] | null;
  sha256: string;
  sidecar: 'matches' | 'missing';
  /** Updates this version applies to an older copy. */
  toApply: string[];
  audit: Sidecar['audit'];
  lastAuditAt: string | null;
  trialBalance: Sidecar['trialBalance'];
  lastBusinessDate: string | null;
  postedDocuments: number;
  users: number;
  /** The copy's attachment files: how many, and any not in the backup (`missing`) or not matching their SHA-256 (`changed`). */
  attachments: { files: number; bytes: number; missing: string[]; changed: string[] };
}

/**
 * Opens each file the copy's attachment rows name from `folder` (the backup's attachments folder) and checks its SHA-256.
 * With `restoreTo`, the good ones are put in that attachments folder (content-addressed: one already there is kept).
 */
async function checkAttachments(copy: Db, folder: string, d: Decrypter, restoreTo?: string): Promise<BackupFacts['attachments']> {
  const files = attachedFiles(copy);
  const there = existsSync(folder) ? readdirSync(folder) : [];
  const r: BackupFacts['attachments'] = { files: files.length, bytes: 0, missing: [], changed: [] };
  for (const f of files) {
    r.bytes += f.bytes;
    const candidates = there.filter((x) => x.startsWith(`${f.sha256}.`) && x.endsWith('.age'));
    let found = false;
    for (const c of candidates) {
      let plain: Uint8Array;
      try {
        plain = await d.decrypt(readFileSync(join(folder, c)));
      } catch {
        continue; // encrypted to other recovery keys, or damaged
      }
      if (sha256Hex(plain) !== f.sha256) continue;
      found = true;
      if (restoreTo) storeFile(restoreTo, plain, f.sha256);
      break;
    }
    if (!found) (candidates.length ? r.changed : r.missing).push(f.sha256);
  }
  return r;
}

/**
 * Opens `encryptedFile` with `secretKey` into `stagedFile` and checks it. `prepare` brings the copy up to this
 * version's schema (the app's migrations); `appMigrations` are the ones this version has.
 */
export async function openBackup(
  encryptedFile: string, secretKey: string, stagedFile: string, appMigrations: Migration[], prepare: (copy: Db) => void,
  opts: { restoreAttachmentsTo?: string } = {},
): Promise<BackupFacts> {
  const key = secretKey.trim();
  if (!AGE_IDENTITY.test(key)) throw badRequest('BAD_KEY', 'A recovery key starts with AGE-SECRET-KEY-1 and has 74 characters. Check it and type it again.');
  if (!existsSync(encryptedFile)) throw new AppError('NOT_FOUND', 'That backup file is not there any more.', 404);
  const d = new Decrypter();
  d.addIdentity(key);
  let gz: Uint8Array;
  try {
    gz = await d.decrypt(readFileSync(encryptedFile));
  } catch {
    throw badRequest('WRONG_KEY', 'This recovery key does not open this backup. Try the other key.');
  }
  let plain: Buffer;
  try {
    plain = gunzipSync(gz);
  } catch {
    throw new AppError('DAMAGED', 'The backup opened but is damaged. Pick an older one.', 422);
  }
  const sha256 = createHash('sha256').update(plain).digest('hex');
  const sidecarFile = encryptedFile.replace(/\.db\.gz\.age$/, '.json');
  const sidecar = existsSync(sidecarFile) ? (JSON.parse(readFileSync(sidecarFile, 'utf8')) as Sidecar) : null;
  if (sidecar && sidecar.sha256 !== sha256) throw new AppError('DAMAGED', 'The backup does not match its record: it is damaged or was changed. Pick an older one.', 422);

  mkdirSync(dirname(stagedFile), { recursive: true });
  writeFileSync(stagedFile, plain);
  try {
    const copy = openDb(stagedFile);
    let toApply: string[];
    try {
      const c = compatibility(migrationsOf(copy), appMigrations);
      if (c.newer.length) throw new AppError('NEWER_VERSION', 'This backup was made by a newer version of Virtus. Update Virtus on this PC first, then restore it.', 409, { newer: c.newer });
      if (c.changed.length) throw new AppError('CHANGED_VERSION', 'This backup was made by a different build of Virtus and cannot be opened here.', 409, { changed: c.changed });
      toApply = c.toApply;
      if (toApply.length) prepare(copy);
      copy.pragma('journal_mode = DELETE');
    } finally {
      copy.close();
    }
    const checked = checkCopy(stagedFile);
    const ro = openReadonly(stagedFile);
    try {
      const one = <T>(sql: string) => ro.prepare(sql).pluck().get() as T;
      return {
        file: encryptedFile.split(/[\\/]/).pop()!, madeAt: sidecar?.at ?? null, tier: sidecar?.tier ?? null, sha256,
        sidecar: sidecar ? 'matches' : 'missing', toApply, audit: checked.audit, trialBalance: checked.trialBalance,
        lastAuditAt: one<string | null>('SELECT at FROM audit_log ORDER BY seq DESC LIMIT 1') ?? null,
        lastBusinessDate: one<string | null>('SELECT MAX(business_date) FROM journals WHERE sealed = 1') ?? null,
        postedDocuments: one<number>(`SELECT COUNT(*) FROM documents WHERE status = 'posted'`),
        users: one<number>('SELECT COUNT(*) FROM users'),
        attachments: await checkAttachments(ro, join(dirname(encryptedFile), ATTACHMENTS), d, opts.restoreAttachmentsTo),
      };
    } finally {
      ro.close();
    }
  } catch (e) {
    rmSync(stagedFile, { force: true });
    throw e;
  }
}

/** One document series: the last number in the live data and in the backup, and how many numbers a restore would issue again. */
export interface SeriesCompared { series: string; liveLast: string | null; backupLast: string | null; reused: number }

const seriesOf = (db: Db) =>
  new Map((db.prepare('SELECT series_key AS key, prefix, next_value AS next, pad FROM number_series').all() as { key: string; prefix: string; next: number; pad: number }[]).map((r) => [r.key, r]));

/**
 * Per document series, the last number issued in the live data and in the backup (audit B3-5). Numbers move forward
 * by one and are never reset, so after a restore the series go on from the backup's numbers: those issued after the
 * backup are issued again, to new documents. Series that moved since the backup come first.
 */
export function seriesCompared(live: Db, copy: Db): SeriesCompared[] {
  const a = seriesOf(live);
  const b = seriesOf(copy);
  const last = (r?: { prefix: string; next: number; pad: number }) => (r && r.next > 1 ? `${r.prefix}${String(r.next - 1).padStart(r.pad, '0')}` : null);
  return [...new Set([...a.keys(), ...b.keys()])]
    .map((key) => ({ series: key, liveLast: last(a.get(key)), backupLast: last(b.get(key)), reused: Math.max(0, (a.get(key)?.next ?? 1) - (b.get(key)?.next ?? 1)) }))
    .sort((x, y) => (y.reused > 0 ? 1 : 0) - (x.reused > 0 ? 1 : 0) || x.series.localeCompare(y.series));
}

/** What a drill reports when attachment files are missing from the backup or changed; null when all are there. */
export function attachmentProblems(a: BackupFacts['attachments']): string | null {
  const parts = [
    a.missing.length ? `${a.missing.length} missing (${a.missing.join(', ')})` : '',
    a.changed.length ? `${a.changed.length} changed or unreadable (${a.changed.join(', ')})` : '',
  ].filter(Boolean);
  return parts.length ? `The backup's attached files do not all check out: ${parts.join('; ')}.` : null;
}

/** A checked copy waiting to be restored. */
export interface Staged { id: string; file: string; at: string; userId: string | null; facts: BackupFacts }
export const stagedPath = (dir: string, id: string) => join(dir, `staged-${id}.db`);
const PENDING = 'pending.json';

/** Records a checked copy (already at stagedPath) so a restore can ask for it. */
export function stage(dir: string, s: Staged): void {
  writeFileSync(join(dir, `staged-${s.id}.json`), JSON.stringify(s));
}

/** Asks for the staged copy to be swapped in at the next start. */
export function requestRestore(dir: string, id: string, now: string): Staged {
  const f = join(dir, `staged-${id}.json`);
  if (!/^[0-9A-Za-z_-]+$/.test(id) || !existsSync(f) || !existsSync(stagedPath(dir, id))) throw new AppError('NOT_STAGED', 'Check the backup with a recovery key first.', 409);
  const s = JSON.parse(readFileSync(f, 'utf8')) as Staged;
  if (Date.parse(now) - Date.parse(s.at) > STAGED_FOR_MS) throw new AppError('NOT_STAGED', 'That check is more than 30 minutes old. Check the backup again.', 409);
  writeFileSync(join(dir, PENDING), JSON.stringify({ id, file: s.file, requestedAt: now }));
  return s;
}

export function pendingRestore(dir: string): { id: string; file: string; requestedAt: string } | null {
  const f = join(dir, PENDING);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { id: string; file: string; requestedAt: string }) : null;
}

/** Drops staged copies older than 30 minutes that no restore waits for. */
export function cleanStaged(dir: string, now: string): void {
  if (!existsSync(dir)) return;
  const keep = pendingRestore(dir)?.id;
  for (const f of readdirSync(dir)) {
    const m = /^staged-([0-9A-Za-z_-]+)\.(db|json)$/.exec(f);
    if (m && m[1] !== keep && Date.parse(now) - statSync(join(dir, f)).mtimeMs > STAGED_FOR_MS) rmSync(join(dir, f), { force: true });
  }
}

/**
 * Called at start, before the database is opened: swaps in the copy a restore asked for. The database it replaces
 * (with its WAL) is kept as before-restore-<time>.db next to it. Returns what happened, or null if nothing was asked.
 */
export function applyPendingRestore(dbFile: string, at: string): { file: string; previous: string } | null {
  const dir = restoreDir(dbFile);
  const p = pendingRestore(dir);
  if (!p) return null;
  const staged = stagedPath(dir, p.id);
  if (!existsSync(staged)) {
    renameSync(join(dir, PENDING), join(dir, `pending-failed-${newId()}.json`));
    throw new Error(`The restore of ${p.file} could not start: its checked copy is missing. The database was not changed.`);
  }
  const previous = join(dirname(dbFile), `before-restore-${at.slice(0, 19).replaceAll(':', '-')}.db`);
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbFile + suffix)) renameSync(dbFile + suffix, previous + suffix);
  renameSync(staged, dbFile);
  rmSync(join(dir, `staged-${p.id}.json`), { force: true });
  rmSync(join(dir, PENDING), { force: true });
  return { file: p.file, previous };
}

/**
 * After the swap, before anything is served: everyone signs in again, and the audit entry in the restored database says
 * which backup it came from and where the replaced database is kept.
 */
export function recordRestored(db: Db, r: { file: string; previous: string }, at: string, by: 'start' | 'command line'): void {
  revokeAllSessions(db, at);
  appendAudit(db, { at, userId: null, action: 'bak.restored', entityType: 'bak.backup', entityId: r.file, data: { previous: r.previous, by } });
}
