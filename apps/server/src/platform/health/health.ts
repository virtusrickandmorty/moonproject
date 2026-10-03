/**
 * System Health (PLAN C8): traffic lights for what keeps the shop's books safe, the full system check (nightly and on
 * the "Run system check" button) and the support file.
 *   Lights: backups, off-site copy, USB copies, restore drill, disk space, clock, system check, database, books (the D9
 *   checks), audit trail, Windows, the practice shop, the version.
 * The full check (SQLite quick_check and foreign keys, runInvariants, the audit chain) is stored in sys_checks, and the
 * database, books and audit lights read the newest one, so opening the page stays quick as the books grow.
 */
import { statfsSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Db } from '../db/driver.ts';
import { CLOCK_TOLERANCE_MS, stamp, type Clock } from '../clock.ts';
import { APP_VERSION } from '../version.ts';
import type { PracticeStatus } from '../practice/routes.ts';
import { lastAuditAt, verifyAuditChain } from '../../engine/audit.ts';
import { INVARIANT_NAMES, runInvariants } from '../../engine/ledger/invariants.ts';
import { backupFacts, DRILL_EVERY_MS, STALE_MS, USB_EVERY_MS, type BackupFacts } from '../../modules/BAK/public.ts';

export type Light = 'green' | 'amber' | 'red' | 'grey';
export interface HealthLight { key: string; label: string; light: Light; message: string }

export interface SystemCheck {
  database: { ok: boolean; problems: string[] };
  audit: { ok: boolean; brokenAt: number | null; entries: number };
  ledger: { id: string; name: string; ok: boolean; problems: string[] }[];
}
export interface StoredCheck { at: string; reason: 'schedule' | 'button'; ok: boolean; results: SystemCheck }

/** The PC the server runs on; tests give their own. */
export interface Host {
  platform: string;
  release: string;
  arch: string;
  /** Free bytes on the drive holding `path`, or null when it cannot be read. */
  freeBytes(path: string): number | null;
  /** The PC's own time zone, in minutes east of UTC (Manila is 480). */
  utcOffsetMinutes: number;
}

export const realHost: Host = {
  platform: platform(),
  release: release(),
  arch: arch(),
  freeBytes(path) {
    try {
      const s = statfsSync(path);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  },
  utcOffsetMinutes: -new Date().getTimezoneOffset(),
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const GB = 1e9;
/** Problems listed per check; the Integrity check page has them all. */
const SHOWN = 5;

const firstOf = (problems: string[]) =>
  problems.length > SHOWN ? [...problems.slice(0, SHOWN), `and ${problems.length - SHOWN} more`] : problems;

/** The full system check: the database file, the D9 ledger checks and the audit chain. Stored in sys_checks. */
export function runSystemCheck(db: Db, at: string, who: { reason: 'schedule' | 'button'; userId: string | null }): StoredCheck {
  const quick = (db.pragma('quick_check') as { quick_check: string }[]).map((r) => r.quick_check).filter((m) => m !== 'ok');
  const orphans = (db.pragma('foreign_key_check') as unknown[]).length;
  const database = { ok: quick.length === 0 && orphans === 0, problems: firstOf([...quick, ...(orphans ? [`${orphans} rows point at records that do not exist`] : [])]) };
  const ledger = runInvariants(db)
    .filter((r) => r.id !== 'L12') // the audit chain has its own light
    .map((r) => ({ id: r.id, name: INVARIANT_NAMES[r.id] ?? r.id, ok: r.ok, problems: firstOf(r.problems) }));
  const brokenAt = verifyAuditChain(db);
  const entries = db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get() as number;
  const results: SystemCheck = { database, audit: { ok: brokenAt === null, brokenAt, entries }, ledger };
  const ok = database.ok && brokenAt === null && ledger.every((r) => r.ok);
  db.prepare('INSERT INTO sys_checks (at, reason, user_id, ok, results) VALUES (?, ?, ?, ?, ?)').run(at, who.reason, who.userId, ok ? 1 : 0, JSON.stringify(results));
  return { at, reason: who.reason, ok, results };
}

export function lastSystemCheck(db: Db): StoredCheck | null {
  const r = db.prepare('SELECT at, reason, ok, results FROM sys_checks ORDER BY id DESC LIMIT 1').get() as
    | { at: string; reason: 'schedule' | 'button'; ok: number; results: string }
    | undefined;
  return r ? { at: r.at, reason: r.reason, ok: r.ok === 1, results: JSON.parse(r.results) as SystemCheck } : null;
}

/** The nightly check: due between 01:00 and 05:00 Manila once the last one is 20 hours old, and any time after 36 hours. */
export function isCheckDue(lastAt: string | null, now: string): boolean {
  if (!lastAt) return true;
  const age = Date.parse(now) - Date.parse(lastAt);
  const hour = Number(now.slice(11, 13)); // `now` is a Manila timestamp (stamp)
  return age > 36 * HOUR || (age > 20 * HOUR && hour >= 1 && hour < 5);
}

export interface HealthFacts {
  now: string;
  practice: boolean;
  /** null in the practice shop, which is not backed up. */
  backups: BackupFacts | null;
  freeBytes: number | null;
  lastAuditAt: string | null;
  lastCheck: StoredCheck | null;
  host: Pick<Host, 'platform' | 'release' | 'utcOffsetMinutes'>;
  version: string;
  /** The practice shop beside the real one; null when practice mode is off or this is the practice shop. */
  practiceShop: PracticeStatus | null;
}

/** The folder holding the database: its drive is the one that must not fill up. */
const dataFolder = (db: Db) => (db.name && db.name !== ':memory:' ? dirname(resolve(db.name)) : process.cwd());

export function gatherFacts(db: Db, clock: Clock, o: { practice: boolean; host: Host; practiceShop?: { status(): PracticeStatus } }): HealthFacts {
  return {
    now: stamp(clock),
    practice: o.practice,
    backups: o.practice ? null : backupFacts(db),
    freeBytes: o.host.freeBytes(dataFolder(db)),
    lastAuditAt: lastAuditAt(db),
    lastCheck: lastSystemCheck(db),
    host: o.host,
    version: APP_VERSION,
    practiceShop: o.practiceShop?.status() ?? null,
  };
}

/** "2026-09-28 10:05" from a Manila timestamp. */
const when = (at: string) => at.slice(0, 16).replace('T', ' ');

/** The lights, worst first within the order staff read them in. Pure, so every threshold is tested. */
export function healthLights(f: HealthFacts): HealthLight[] {
  const out: HealthLight[] = [];
  const add = (key: string, label: string, light: Light, message: string) => out.push({ key, label, light, message });
  const age = (at: string) => Date.parse(f.now) - Date.parse(at);

  const b = f.backups;
  if (!b) {
    add('backups', 'Backups', 'grey', 'The practice shop is not backed up. The real shop backs itself up.');
  } else {
    if (!b.on) add('backups', 'Backups', 'red', 'Backups are off until both recovery keys are set on the Backups page.');
    else if (!b.lastOkAt) add('backups', 'Backups', 'red', 'No backup has been made yet. Open Backups and back up now.');
    else if (age(b.lastOkAt) > STALE_MS) add('backups', 'Backups', 'red', `The last good backup was on ${when(b.lastOkAt)}, more than a day ago. Open Backups and back up now.`);
    else if (b.lastFailed && b.lastFailed.at > b.lastOkAt) {
      add('backups', 'Backups', 'amber', `The last backup, on ${when(b.lastFailed.at)}, failed: ${b.lastFailed.error}. The one before it, on ${when(b.lastOkAt)}, is good.`);
    } else add('backups', 'Backups', 'green', `Last good backup on ${when(b.lastOkAt)}.`);

    if (!b.offsiteSet) add('offsite', 'Off-site copy', 'red', 'No off-site folder is set, so every backup stays on this PC. Set the Google Drive folder on the Backups page.');
    else if (!b.lastOffsiteAt) add('offsite', 'Off-site copy', 'red', 'No backup has reached the off-site folder yet.');
    else if (age(b.lastOffsiteAt) > 7 * DAY) add('offsite', 'Off-site copy', 'red', `The newest off-site copy is from ${when(b.lastOffsiteAt)}, more than a week ago. Check that Google Drive is signed in and syncing.`);
    else if (age(b.lastOffsiteAt) > STALE_MS) add('offsite', 'Off-site copy', 'amber', `The newest off-site copy is from ${when(b.lastOffsiteAt)}. Check that Google Drive is syncing.`);
    else add('offsite', 'Off-site copy', 'green', `The newest off-site copy is from ${when(b.lastOffsiteAt)}.`);

    const usb = [b.usb.A, b.usb.B].filter((x): x is string => !!x).sort().at(-1);
    const drives = `Drive A was last copied on ${b.usb.A ? when(b.usb.A) : 'no day yet'}, drive B on ${b.usb.B ? when(b.usb.B) : 'no day yet'}.`;
    if (!usb) add('usb', 'USB copies', 'amber', 'No backup has been copied to a USB drive yet. Copy them to drive A on the Backups page.');
    else if (age(usb) > 15 * DAY) add('usb', 'USB copies', 'red', `No USB copy for more than two weeks. ${drives} Copy the backups to the USB drive, then swap the drives.`);
    else if (age(usb) > USB_EVERY_MS) add('usb', 'USB copies', 'amber', `No USB copy this week. ${drives} Copy the backups to the USB drive, then swap the drives.`);
    else add('usb', 'USB copies', 'green', drives);

    if (!b.lastDrillAt) add('drill', 'Restore drill', 'amber', 'No restore drill yet. On the Backups page, open a backup with a recovery key to prove it can be restored.');
    else if (age(b.lastDrillAt) > DRILL_EVERY_MS) add('drill', 'Restore drill', 'amber', `The last restore drill was on ${when(b.lastDrillAt)}. One is due every three months.`);
    else add('drill', 'Restore drill', 'green', `The last restore drill was on ${when(b.lastDrillAt)}.`);
  }

  const free = f.freeBytes;
  const gb = free === null ? '' : (free / GB).toFixed(1);
  if (free === null) add('disk', 'Disk space', 'grey', 'The free space on the drive with the database could not be read.');
  else if (free < 2 * GB) add('disk', 'Disk space', 'red', `Only ${gb} GB free on the drive with the database. Free up space now: the books and their backups need room.`);
  else if (free < 10 * GB) add('disk', 'Disk space', 'amber', `${gb} GB free on the drive with the database. Free up some space soon.`);
  else add('disk', 'Disk space', 'green', `${gb} GB free on the drive with the database.`);

  const offset = f.host.utcOffsetMinutes;
  if (f.lastAuditAt && Date.parse(f.now) < Date.parse(f.lastAuditAt) - CLOCK_TOLERANCE_MS) {
    add('clock', 'Clock', 'red', `The PC's clock (${when(f.now)}) is behind the last recorded entry (${when(f.lastAuditAt)}). Recording is blocked until the Windows date and time are fixed.`);
  } else if (f.host.platform === 'win32' && offset !== 480) {
    const zone = `UTC${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
    add('clock', 'Clock', 'amber', `Windows is set to ${zone}, not UTC+08:00 (Singapore Standard Time). Business dates are still Manila's, but set the time zone in the Windows settings.`);
  } else add('clock', 'Clock', 'green', `The server's time is ${when(f.now)}, Manila.`);

  const c = f.lastCheck;
  if (!c) {
    add('check', 'System check', 'amber', 'No system check has run yet. Press Run system check.');
    for (const [key, label] of [['database', 'Database'], ['books', 'Books'], ['audit', 'Audit trail']] as const) add(key, label, 'grey', 'Not checked yet.');
  } else {
    const how = c.reason === 'schedule' ? 'the nightly check' : 'by hand';
    if (age(c.at) > 36 * HOUR) add('check', 'System check', 'amber', `The last system check was on ${when(c.at)} (${how}). Press Run system check.`);
    else add('check', 'System check', 'green', `The last system check was on ${when(c.at)} (${how}).`);
    const r = c.results;
    if (r.database.ok) add('database', 'Database', 'green', 'The database file is sound.');
    else add('database', 'Database', 'red', `The database file has problems: ${r.database.problems.join('; ')}. Stop recording, keep the latest backups and call for help.`);
    const failed = r.ledger.filter((x) => !x.ok);
    if (!failed.length) add('books', 'Books', 'green', 'Every journal balances, so the trial balance does, and the other ledger checks passed.');
    else add('books', 'Books', 'red', `${failed.map((x) => `${x.name}: ${x.problems[0] ?? 'failed'}`).join('; ')}. Open Integrity check for the details.`);
    if (r.audit.ok) add('audit', 'Audit trail', 'green', `The audit trail is intact (${r.audit.entries} entries).`);
    else add('audit', 'Audit trail', 'red', `The audit trail breaks at entry ${r.audit.brokenAt}: records were changed outside Virtus. Keep the latest backups and call for help.`);
  }

  if (f.host.platform !== 'win32') add('windows', 'Windows', 'grey', `This server is not running on Windows (${f.host.platform}).`);
  else {
    const build = Number(f.host.release.split('.')[2] ?? 0);
    if (build >= 22000) add('windows', 'Windows', 'green', `Windows 11 (build ${build}).`);
    else if (f.now.slice(0, 10) > '2026-10-13') {
      add('windows', 'Windows', 'red', 'This PC runs Windows 10, which no longer gets security updates (free ones ended 14 October 2025, the one-year Extended Security Updates on 13 October 2026). Move the shop server to Windows 11.');
    } else {
      add('windows', 'Windows', 'amber', 'This PC runs Windows 10. Free security updates ended 14 October 2025, and the one-year Extended Security Updates end 13 October 2026. Plan the move to Windows 11.');
    }
  }

  const p = f.practiceShop;
  if (p && p.state === 'failed') add('practice', 'Practice shop', 'amber', `The practice shop is not running. ${p.message ?? ''}`.trim());
  else if (p && p.state === 'preparing') add('practice', 'Practice shop', 'grey', 'The practice shop is being prepared with new made-up data.');
  else if (p && p.state === 'ready') add('practice', 'Practice shop', 'green', 'The practice shop is ready.');

  add('version', 'Version', 'grey', `Virtus ${f.version}. An update comes as a new Setup.exe, run on this PC.`);
  return out;
}

/** The worst light: red, then amber, else green (grey lights are information). */
export function overallLight(lights: HealthLight[]): Exclude<Light, 'grey'> {
  if (lights.some((l) => l.light === 'red')) return 'red';
  if (lights.some((l) => l.light === 'amber')) return 'amber';
  return 'green';
}

/**
 * The red lights now, for the notification each makes (the owner's and accountant's Home). Keyed by light and day, so
 * a light still red tomorrow comes back after it was marked read.
 */
export function redLightNotices(db: Db, clock: Clock, o: { practice: boolean; host: Host }) {
  const f = gatherFacts(db, clock, o);
  return healthLights(f).filter((l) => l.light === 'red').map((l) => ({ id: `${l.key}:${f.now.slice(0, 10)}`, label: `System Health: ${l.label} is red`, detail: l.message }));
}

/** A path in an error message may hold a Windows user's name: the support file carries none. */
const noPaths = (s: string) => s.replace(/[A-Za-z]:\\[^\s'"]*/g, '<path>').replace(/(?:\/[\w.@-]+){2,}\/?/g, '<path>');

/**
 * The support file (PLAN C8 "one-click support file, no personal data"): the version, the PC, the lights, the last
 * system check, the migrations, and counts. No names, amounts, addresses, file paths or keys.
 */
export function supportFile(db: Db, f: HealthFacts, host: Pick<Host, 'arch'>) {
  const lights = healthLights(f);
  const count = (sql: string) => db.prepare(sql).pluck().get() as number;
  return {
    app: 'moonproject',
    version: f.version,
    generatedAt: f.now,
    node: process.version,
    os: { platform: f.host.platform, release: f.host.release, arch: host.arch, utcOffsetMinutes: f.host.utcOffsetMinutes },
    practice: f.practice,
    overall: overallLight(lights),
    lights: lights.map((l) => ({ ...l, message: noPaths(l.message) })),
    lastCheck: f.lastCheck,
    migrations: db.prepare('SELECT id FROM schema_migrations ORDER BY id').pluck().all() as string[],
    counts: {
      documents: db.prepare('SELECT doc_type AS docType, status, COUNT(*) AS n FROM documents GROUP BY doc_type, status ORDER BY doc_type, status').all(),
      journals: count('SELECT COUNT(*) FROM journals'),
      auditEntries: count('SELECT COUNT(*) FROM audit_log'),
      activeUsers: count('SELECT COUNT(*) FROM users WHERE is_active = 1'),
    },
    backupRuns: (db.prepare('SELECT finished_at AS at, reason, tier, status, offsite, error FROM bak_runs ORDER BY finished_at DESC LIMIT 20').all() as { error: string | null }[])
      .map((r) => ({ ...r, error: r.error === null ? null : noPaths(r.error) })),
  };
}
