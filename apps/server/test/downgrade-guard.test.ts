/**
 * The downgrade guard (audit B3-3): a database that a newer version used (it ran a migration this version does not
 * have) is refused before anything runs, at start-up in plain words, and nothing is written to it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDatabase } from '../src/app.ts';
import { loadModules } from '../src/modules/load.ts';
import { fixedClock } from '../src/platform/clock.ts';
import { openDb, type Db } from '../src/platform/db/driver.ts';
import { NewerDatabaseError } from '../src/platform/db/migrate.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const clock = fixedClock('2026-09-28T02:00:00Z');
const future = (db: Db, id: string) => db.prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)').run(id, 'f'.repeat(64), '2027-01-01T08:00:00.000+08:00');
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'moonproject-downgrade-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a database a newer version used', () => {
  it('is refused before any migration runs, naming what this version does not know', async () => {
    const modules = await loadModules();
    const db = openDb(':memory:');
    prepareDatabase(db, clock, modules);
    prepareDatabase(db, clock, modules); // the same version starts again: fine
    future(db, 'engine/9001_from_a_newer_version.sql');
    future(db, 'PRD/9002_from_a_newer_version.sql');
    const before = db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get();
    let err: unknown;
    try { prepareDatabase(db, clock, modules); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(NewerDatabaseError);
    expect((err as NewerDatabaseError).unknown).toEqual(['PRD/9002_from_a_newer_version.sql', 'engine/9001_from_a_newer_version.sql']);
    expect((err as Error).message).toMatch(/^This database was used by a newer version of Virtus, so this older version will not start on it\. Install the newer version/);
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(before);
  });

  it('stops the server at start-up with the plain message', async () => {
    mkdirSync(join(dir, 'shop'), { recursive: true });
    const file = join(dir, 'shop', 'moonproject.db');
    const db = openDb(file);
    prepareDatabase(db, clock, await loadModules());
    future(db, 'engine/9001_from_a_newer_version.sql');
    db.close();
    const { NODE_OPTIONS: _, ...parent } = process.env;
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN], {
      env: { ...parent, MOONPROJECT_DB: file, MOONPROJECT_BACKUP_DIR: join(dir, 'shop', 'backups'), PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code, output).toBe(1);
    expect(output).toContain('This database was used by a newer version of Virtus');
    expect(output).not.toMatch(/\n\s+at /); // a plain message, not a stack trace
  }, 60_000);
});
