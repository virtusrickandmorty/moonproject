/**
 * The one file that knows about better-sqlite3 (PLAN C2), so the driver can be swapped later.
 */
import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Runs fn inside BEGIN IMMEDIATE (the write lock is taken up front, PLAN C2).
 * Nested calls join the outer transaction.
 */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.inTransaction) return fn();
  return db.transaction(fn).immediate();
}

/**
 * Copies the live database to `file` with SQLite's online backup API (PLAN C8): a consistent snapshot while the app
 * keeps working. The copy is switched out of WAL so it is one self-contained file.
 */
export async function snapshotTo(db: Db, file: string): Promise<void> {
  await db.backup(file);
  const copy = new Database(file);
  copy.pragma('journal_mode = DELETE');
  copy.close();
}

/** Opens a database copy read-only (a backup being checked or restored), never the live file. */
export function openReadonly(file: string): Db {
  return new Database(file, { readonly: true, fileMustExist: true });
}
