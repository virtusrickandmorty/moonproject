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
