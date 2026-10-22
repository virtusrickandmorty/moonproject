/** No more fresh starts (the owner's decision, 22 Oct 2026): with the lock, a missing, empty or user-less database is refused. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from './driver.ts';
import { FRESH_START_LOCK, freshStartRefusedAfterOpen, freshStartRefusedBeforeOpen } from './fresh-start.ts';

let dir: string;
let dbFile: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'virtus-fresh-')); dbFile = join(dir, 'moonproject.db'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const lock = () => writeFileSync(join(dir, FRESH_START_LOCK), 'The owner decided on 22 Oct 2026: no more fresh starts.');
const withUsers = (n: number) => {
  const db = openDb(dbFile);
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  for (let i = 0; i < n; i++) db.prepare('INSERT INTO users (id) VALUES (?)').run(`u${i}`);
  return db;
};

it('without the lock, a new shop starts as before: no database yet, or none with users', () => {
  expect(freshStartRefusedBeforeOpen(dbFile)).toBeNull();
  const db = withUsers(0);
  expect(freshStartRefusedAfterOpen(db, dbFile)).toBeNull();
  db.close();
});

it('with the lock, a missing or empty database is refused before it is opened', () => {
  lock();
  expect(freshStartRefusedBeforeOpen(dbFile)).toMatch(/^Virtus will not start: the database file is missing .*restore it from a backup/);
  writeFileSync(dbFile, '');
  expect(freshStartRefusedBeforeOpen(dbFile)).toMatch(/the database file is empty/);
});

it('with the lock, a database with no users is refused; the shop\'s own database starts', () => {
  lock();
  const empty = withUsers(0);
  expect(freshStartRefusedAfterOpen(empty, dbFile)).toMatch(/has no users, so it would start over/);
  empty.close();
  rmSync(dbFile); rmSync(`${dbFile}-wal`, { force: true }); rmSync(`${dbFile}-shm`, { force: true });
  const shop = withUsers(2);
  expect(freshStartRefusedBeforeOpen(dbFile)).toBeNull();
  expect(freshStartRefusedAfterOpen(shop, dbFile)).toBeNull();
  shop.close();
});
