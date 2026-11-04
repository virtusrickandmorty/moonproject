/**
 * A migration that ran is the same migration on a checkout with other line endings (git's autocrlf), so the server still
 * starts; a real change to its text is refused as before.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/platform/db/driver.ts';
import { migrate } from '../src/platform/db/migrate.ts';

let dir: string, db: Db;
const AT = '2026-11-04T10:00:00+08:00';
const file = () => join(dir, '0001_sample.sql');
const run = () => migrate(db, [{ owner: 'sample', dir }], AT);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moonproject-migrate-'));
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

it('takes the same migration with other line endings, either way round', () => {
  writeFileSync(file(), 'CREATE TABLE sample (id TEXT);\r\nCREATE INDEX sample_id ON sample(id);\r\n');
  expect(run()).toEqual(['sample/0001_sample.sql']);
  writeFileSync(file(), 'CREATE TABLE sample (id TEXT);\nCREATE INDEX sample_id ON sample(id);\n');
  expect(run()).toEqual([]);
  writeFileSync(file(), 'CREATE TABLE sample (id TEXT);\r\nCREATE INDEX sample_id ON sample(id);\r\n');
  expect(run()).toEqual([]);
});

it('still refuses a migration whose text changed after it ran', () => {
  writeFileSync(file(), 'CREATE TABLE sample (id TEXT);\n');
  run();
  writeFileSync(file(), 'CREATE TABLE sample (id TEXT, name TEXT);\n');
  expect(run).toThrow('was changed after it ran');
});
