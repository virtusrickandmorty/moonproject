/**
 * A migration that rebuilds a table other tables point to (first line "-- migrate: rebuild-with-foreign-keys-off"):
 * foreign keys are off while it runs, every key is checked before it is kept, and they are on again after.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDb } from './driver.ts';
import { migrate } from './migrate.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function source(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return [{ owner: 'T', dir }];
}
const base = {
  '0001_base.sql': `CREATE TABLE runs (id TEXT PRIMARY KEY, grp TEXT NOT NULL CHECK (grp IN ('A','B'))) STRICT;
CREATE TABLE lines (run_id TEXT NOT NULL REFERENCES runs(id), amount INTEGER NOT NULL) STRICT;
INSERT INTO runs VALUES ('r1', 'A'); INSERT INTO lines VALUES ('r1', 100);`,
};
const widen = `-- migrate: rebuild-with-foreign-keys-off
CREATE TABLE runs_next (id TEXT PRIMARY KEY, grp TEXT NOT NULL CHECK (grp IN ('A','B','C'))) STRICT;
INSERT INTO runs_next SELECT id, grp FROM runs;
DROP TABLE runs;
ALTER TABLE runs_next RENAME TO runs;`;

it('rebuilds a table others point to: rows kept, the new value allowed, links still enforced afterwards', () => {
  const db = openDb(':memory:');
  expect(migrate(db, source({ ...base, '0002_widen.sql': widen }), '2026-10-09T00:00:00+08:00')).toEqual(['T/0001_base.sql', 'T/0002_widen.sql']);
  expect(db.prepare('SELECT * FROM runs').all()).toEqual([{ id: 'r1', grp: 'A' }]);
  db.prepare("INSERT INTO runs VALUES ('r2', 'C')").run();
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(() => db.prepare("INSERT INTO lines VALUES ('nope', 1)").run()).toThrow(/FOREIGN KEY/);
});

it('refuses a rebuild that would break a link, and changes nothing', () => {
  const db = openDb(':memory:');
  const broken = `-- migrate: rebuild-with-foreign-keys-off
CREATE TABLE runs_next (id TEXT PRIMARY KEY, grp TEXT NOT NULL) STRICT;
DROP TABLE runs;
ALTER TABLE runs_next RENAME TO runs;`; // the row r1 is not copied: lines would point to nothing
  expect(() => migrate(db, source({ ...base, '0002_broken.sql': broken }), '2026-10-09T00:00:00+08:00')).toThrow(/would break 1 link/);
  expect(db.prepare('SELECT id FROM runs').pluck().all()).toEqual(['r1']);
  expect(db.prepare('SELECT id FROM schema_migrations').pluck().all()).toEqual(['T/0001_base.sql']);
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
});
