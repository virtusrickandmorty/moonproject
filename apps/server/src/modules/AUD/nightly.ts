/**
 * Nightly checks (PLAN E13 "Integrity centre: runs D9 checks on demand and nightly"). Read-only: nothing here posts or
 * changes the books; the only writes are the night's results in aud_nightly_*.
 *   Each night at 02:00 Manila by this PC's clock (or at the next start, when the PC was off) the checks run once:
 *   the integrity check, the last backup, gaps in the number series, drafts left over 7 days, cash boxes whose last
 *   count differed from the books, the day's late entries and back-dated documents, and the day's cancellations.
 *   A run after a night or more off covers every day since the last run (at most 31), so no day's entries are missed.
 *   The "Run the checks now" button runs the same checks and stores nothing.
 */
import { formatPeso, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, type Clock } from '../../platform/clock.ts';
import { INVARIANT_NAMES, runInvariants } from '../../engine/ledger/invariants.ts';
import { lastBackupProblems } from '../BAK/public.ts';

export interface Finding { detail: string; path: string | null }
export interface CheckResult { key: string; label: string; reportPath: string; passed: boolean; foundCount: number; findings: Finding[] }

/** What a run needs from the app: the database, the PC's clock, and the names of document types. */
export interface NightlyContext {
  db: Db;
  clock: Clock;
  /** The practice shop is not backed up. */
  practice: boolean;
  titleOf(docType: string): string;
}

/** Findings kept per check per night; the rest are counted and the report has them all. */
const SHOWN = 100;
/** Days a catch-up run reaches back, at most. */
const CATCH_UP_DAYS = 31;
/** A night's results are listed for this many days. */
export const KEEP_DAYS = 400;
/** The hour, Manila time, from which last night's checks are due. */
const RUN_HOUR = 2;

const DAY = 86_400_000;
/** A calendar date moved by whole days (dates are plain YYYY-MM-DD, so UTC arithmetic is exact). */
export function addDays(date: string, n: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

type Check = { key: string; label: string; reportPath: string; run(ctx: NightlyContext, from: string, to: string, asOf: string): Finding[] };

const doc = (type: string, id: string) => `/docs/${type}/${id}`;
const when = (at: string) => at.slice(0, 16).replace('T', ' ');

const CHECKS: Check[] = [
  {
    key: 'integrity', label: 'Integrity check', reportPath: '/aud/integrity',
    run({ db }) {
      const out: Finding[] = [];
      const add = (detail: string) => out.push({ detail, path: '/aud/integrity' });
      for (const m of (db.pragma('quick_check') as { quick_check: string }[]).map((r) => r.quick_check).filter((m) => m !== 'ok')) add(`The database file has a problem: ${m}`);
      const orphans = (db.pragma('foreign_key_check') as unknown[]).length;
      if (orphans) add(`${orphans} rows point at records that do not exist.`);
      // Gaps in the number series have their own check.
      for (const r of runInvariants(db).filter((x) => x.id !== 'L7' && !x.ok)) for (const p of r.problems) add(`${INVARIANT_NAMES[r.id] ?? r.id}: ${p}`);
      return out;
    },
  },
  {
    key: 'backup', label: 'Last backup', reportPath: '/bak',
    run({ db, clock, practice }) {
      if (practice) return [];
      return lastBackupProblems(db, stamp(clock)).map((detail) => ({ detail, path: '/bak' }));
    },
  },
  {
    key: 'gaps', label: 'Gaps in number series', reportPath: '/aud/integrity',
    run({ db }) {
      const out: Finding[] = [];
      const series = db.prepare('SELECT series_key AS key, prefix, next_value AS next, pad FROM number_series ORDER BY series_key').all() as
        { key: string; prefix: string; next: number; pad: number }[];
      for (const s of series) {
        // Journals are numbered by their own series (JE-...); every other series numbers documents.
        const numbers = (s.key.startsWith('JE-')
          ? db.prepare('SELECT number FROM journals WHERE number LIKE ?').pluck().all(`${s.prefix}%`)
          : db.prepare('SELECT number FROM documents WHERE series_key = ?').pluck().all(s.key)) as string[];
        const seen = new Set<number>();
        const odd: string[] = [];
        for (const n of numbers) {
          const v = /^\d+$/.test(n.slice(s.prefix.length)) ? Number(n.slice(s.prefix.length)) : NaN;
          if (Number.isInteger(v) && v >= 1 && v < s.next) seen.add(v);
          else odd.push(n);
        }
        const name = (n: number) => `${s.prefix}${String(n).padStart(s.pad, '0')}`;
        const missing: number[] = [];
        for (let n = 1; n < s.next; n++) if (!seen.has(n)) missing.push(n);
        if (missing.length) {
          const first = missing.slice(0, 5).map(name).join(', ');
          out.push({ detail: `${missing.length === 1 ? `${first} is` : `${first}${missing.length > 5 ? ` and ${missing.length - 5} more are` : ' are'}`} missing from ${s.prefix} numbers (${name(s.next - 1)} is the newest issued).`, path: '/aud/integrity' });
        }
        if (odd.length) out.push({ detail: `${s.prefix} numbers with a number that does not belong: ${odd.slice(0, 5).join(', ')}${odd.length > 5 ? ` and ${odd.length - 5} more` : ''}.`, path: '/aud/integrity' });
      }
      return out;
    },
  },
  {
    key: 'drafts', label: 'Drafts left over 7 days', reportPath: '/rpt/exceptions',
    run({ db, titleOf }, _from, _to, asOf) {
      const rows = db.prepare(
        `SELECT d.id, d.doc_type AS docType, d.updated_at AS updatedAt, COALESCE(u.display_name, '?') AS who
         FROM drafts d LEFT JOIN users u ON u.id = d.created_by
         WHERE d.status = 'open' AND substr(d.updated_at, 1, 10) < date(?, '-7 days') ORDER BY d.updated_at`,
      ).all(asOf) as { id: string; docType: string; updatedAt: string; who: string }[];
      return rows.map((r) => ({ detail: `${titleOf(r.docType)} draft by ${r.who}, last changed ${r.updatedAt.slice(0, 10)}.`, path: `/docs/${r.docType}/new?draft=${r.id}` }));
    },
  },
  {
    key: 'cash', label: 'Cash counts against the books', reportPath: '/rpt/cash-counts',
    run({ db }) {
      // Each cash box's newest count that still stands; its recorded difference is what the box held against the books.
      const rows = db.prepare(
        `SELECT d.id, d.number, d.business_date AS date, a.name AS place, c.difference_cents AS difference
         FROM cash_counts c JOIN documents d ON d.id = c.document_id JOIN accounts a ON a.id = c.cash_account_id
         WHERE d.status = 'posted' AND c.difference_cents <> 0 AND d.id = (
           SELECT d2.id FROM cash_counts c2 JOIN documents d2 ON d2.id = c2.document_id
           WHERE c2.cash_account_id = c.cash_account_id AND d2.status = 'posted'
           ORDER BY d2.business_date DESC, d2.posted_at DESC, d2.number DESC LIMIT 1)
         ORDER BY a.code`,
      ).all() as { id: string; number: string; date: string; place: string; difference: number }[];
      return rows.map((r) => ({
        detail: `${r.place}: the last count (${r.number}, ${r.date}) was ${formatPeso(Math.abs(r.difference))} ${r.difference < 0 ? 'short of' : 'over'} the books.`,
        path: doc('cash.count', r.id),
      }));
    },
  },
  {
    key: 'late', label: 'Late entries and back-dated documents', reportPath: '/rpt/late-entries',
    run({ db, titleOf }, from, to) {
      const rows = db.prepare(
        `SELECT id, number, doc_type AS docType, business_date AS date, posted_at AS postedAt FROM documents
         WHERE substr(posted_at, 1, 10) BETWEEN ? AND ? AND business_date < substr(posted_at, 1, 10) ORDER BY posted_at, number`,
      ).all(from, to) as { id: string; number: string; docType: string; date: string; postedAt: string }[];
      return rows.map((r) => ({ detail: `${titleOf(r.docType)} ${r.number} dated ${r.date}, recorded ${when(r.postedAt)}.`, path: doc(r.docType, r.id) }));
    },
  },
  {
    key: 'cancelled', label: 'Documents cancelled', reportPath: '/rpt/cancellations',
    run({ db, titleOf }, from, to) {
      const rows = db.prepare(
        `SELECT id, number, doc_type AS docType, cancel_reason AS reason, replaced_by_id AS replacedBy FROM documents
         WHERE status = 'cancelled' AND substr(cancelled_at, 1, 10) BETWEEN ? AND ? ORDER BY cancelled_at, number`,
      ).all(from, to) as { id: string; number: string; docType: string; reason: string; replacedBy: string | null }[];
      return rows.map((r) => ({ detail: `${titleOf(r.docType)} ${r.number} was cancelled${r.replacedBy ? ' and reissued' : ''}: ${r.reason}`, path: doc(r.docType, r.id) }));
    },
  },
];

export const CHECK_INFO = CHECKS.map(({ key, label, reportPath }) => ({ key, label, reportPath }));

/** Runs every check for the days `from` to `to` (Manila dates). A check that cannot run counts as found. Read-only. */
export function runChecks(ctx: NightlyContext, from: string, to: string): CheckResult[] {
  const asOf = stamp(ctx.clock).slice(0, 10);
  return CHECKS.map((c): CheckResult => {
    let findings: Finding[];
    try {
      findings = c.run(ctx, from, to, asOf);
    } catch (e) {
      findings = [{ detail: `This check could not run: ${(e as Error).message}`, path: null }];
    }
    const total = findings.length;
    const shown = total > SHOWN ? [...findings.slice(0, SHOWN), { detail: `and ${total - SHOWN} more. Open the report for all of them.`, path: c.reportPath }] : findings;
    return { key: c.key, label: c.label, reportPath: c.reportPath, passed: total === 0, foundCount: total, findings: shown };
  });
}

/** The last night whose checks are due at `now` (a Manila timestamp): yesterday from 02:00, the day before until then. */
export function dueNight(now: string): string {
  return addDays(now.slice(0, 10), Number(now.slice(11, 13)) >= RUN_HOUR ? -1 : -2);
}

export const lastNight = (db: Db) => db.prepare('SELECT night FROM aud_nightly_runs ORDER BY night DESC LIMIT 1').pluck().get() as string | undefined;

/**
 * Runs the checks if last night's are due and stores the results; returns them, or null when there is nothing to do.
 * Called every minute and at start: once a night, and once at the next start after the PC was off.
 */
export function nightlyTick(ctx: NightlyContext): { night: string; coversFrom: string; checks: CheckResult[] } | null {
  const now = stamp(ctx.clock);
  const night = dueNight(now);
  const prev = lastNight(ctx.db);
  if (prev !== undefined && prev >= night) return null;
  const coversFrom = prev === undefined ? night : [addDays(prev, 1), addDays(night, -(CATCH_UP_DAYS - 1))].sort().at(-1)!;
  const checks = runChecks(ctx, coversFrom, night);
  const found = checks.reduce((n, c) => n + c.foundCount, 0);
  const id = newId();
  tx(ctx.db, () => {
    ctx.db.prepare('INSERT INTO aud_nightly_runs (id, night, covers_from, ran_at, found_count) VALUES (?, ?, ?, ?, ?)').run(id, night, coversFrom, now, found);
    const check = ctx.db.prepare('INSERT INTO aud_nightly_checks (run_id, check_key, passed, found_count) VALUES (?, ?, ?, ?)');
    const finding = ctx.db.prepare('INSERT INTO aud_nightly_findings (run_id, check_key, seq, detail, path) VALUES (?, ?, ?, ?, ?)');
    for (const c of checks) {
      check.run(id, c.key, c.passed ? 1 : 0, c.foundCount);
      c.findings.forEach((f, i) => finding.run(id, c.key, i + 1, f.detail, f.path));
    }
  });
  return { night, coversFrom, checks };
}

export interface NightRow {
  night: string;
  coversFrom: string;
  ranAt: string;
  foundCount: number;
  checks: CheckResult[];
}

const labelOf = new Map(CHECK_INFO.map((c) => [c.key, c] as const));

/** The nights within the last 400 days, newest first, `limit` at a time (`before` is the oldest night already shown). */
export function nightlyRuns(db: Db, today: string, o: { before?: string; limit: number }): { rows: NightRow[]; nextBefore: string | null } {
  const runs = db.prepare(
    `SELECT id, night, covers_from AS coversFrom, ran_at AS ranAt, found_count AS foundCount FROM aud_nightly_runs
     WHERE night >= ? AND night < ? ORDER BY night DESC LIMIT ?`,
  ).all(addDays(today, -KEEP_DAYS), o.before ?? '9999-12-31', o.limit + 1) as (Omit<NightRow, 'checks'> & { id: string })[];
  const page = runs.slice(0, o.limit);
  const checks = db.prepare('SELECT check_key AS key, passed, found_count AS foundCount FROM aud_nightly_checks WHERE run_id = ?');
  const findings = db.prepare('SELECT detail, path FROM aud_nightly_findings WHERE run_id = ? AND check_key = ? ORDER BY seq');
  const rows = page.map(({ id, ...run }): NightRow => ({
    ...run,
    checks: (checks.all(id) as { key: string; passed: number; foundCount: number }[])
      .map((c) => ({ key: c.key, label: labelOf.get(c.key)?.label ?? c.key, reportPath: labelOf.get(c.key)?.reportPath ?? '/aud/integrity',
        passed: c.passed === 1, foundCount: c.foundCount, findings: findings.all(id, c.key) as Finding[] }))
      .sort((a, b) => CHECK_INFO.findIndex((x) => x.key === a.key) - CHECK_INFO.findIndex((x) => x.key === b.key)),
  }));
  return { rows, nextBefore: runs.length > o.limit ? page.at(-1)!.night : null };
}

/** What the owner's and accountant's Home shows: the newest night, and which checks found something. */
export function nightlyStatus(db: Db) {
  const run = db.prepare('SELECT id, night, found_count AS foundCount FROM aud_nightly_runs ORDER BY night DESC LIMIT 1').get() as { id: string; night: string; foundCount: number } | undefined;
  if (!run) return { night: null, foundCount: 0, found: [] as { key: string; label: string; foundCount: number }[] };
  const found = (db.prepare('SELECT check_key AS key, found_count AS foundCount FROM aud_nightly_checks WHERE run_id = ? AND passed = 0').all(run.id) as { key: string; foundCount: number }[])
    .map((c) => ({ ...c, label: labelOf.get(c.key)?.label ?? c.key }));
  return { night: run.night, foundCount: run.foundCount, found };
}
