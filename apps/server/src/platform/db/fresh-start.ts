/**
 * No more fresh starts (the owner's decision, 22 Oct 2026: the database was started fresh for the last time). While
 * the lock file sits beside the database, the server will not start on a missing database, or on one with no users
 * (which would open the first-run setup): the shop's records are never started over again. A restore from a backup
 * still works (it swaps a copy in before the database is opened). The lock is written by hand on the shop's PC; taking
 * it away is a decision for the owner, not a step in any routine.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './driver.ts';

export const FRESH_START_LOCK = 'no-fresh-start.lock';

export const lockFileOf = (dbFile: string) => join(dirname(dbFile), FRESH_START_LOCK);

const refusal = (dbFile: string, what: string) =>
  `Virtus will not start: ${what} (${dbFile}), and this shop is set never to start over with an empty database `
  + `(${lockFileOf(dbFile)}). Put the shop's database back, or restore it from a backup, then start Virtus again.`;

/** Before the database is opened: refused while locked and the database file is missing or empty. */
export function freshStartRefusedBeforeOpen(dbFile: string): string | null {
  if (!existsSync(lockFileOf(dbFile))) return null;
  if (!existsSync(dbFile)) return refusal(dbFile, 'the database file is missing');
  if (statSync(dbFile).size === 0) return refusal(dbFile, 'the database file is empty');
  return null;
}

/** Once it is open and migrated: refused while locked and the database has no users (it would offer the first-run setup). */
export function freshStartRefusedAfterOpen(db: Db, dbFile: string): string | null {
  if (!existsSync(lockFileOf(dbFile))) return null;
  const users = db.prepare('SELECT COUNT(*) FROM users').pluck().get() as number;
  return users === 0 ? refusal(dbFile, 'the database has no users, so it would start over') : null;
}
