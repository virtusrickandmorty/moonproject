/**
 * Forward-only, checksummed migrations (PLAN C5). Engine migrations run first, then each
 * module's migrations in module-code order. After migrating, every table gets a
 * BEFORE DELETE trigger that aborts (NR-3), so no table can ever lose rows.
 * A database that already ran a migration this version does not have (a newer version used it) is refused before
 * anything runs: an older version must never write to it (audit B3-3).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './driver.ts';

export interface MigrationSource {
  /** "engine" or a module code such as "CASH". */
  owner: string;
  dir: string;
}

/** The database was used by a newer version: `unknown` are its migrations that this version does not have. */
export class NewerDatabaseError extends Error {
  readonly unknown: string[];
  constructor(unknown: string[]) {
    super(
      'This database was used by a newer version of Virtus, so this older version will not start on it. ' +
        'Install the newer version again (or a later one), or restore a backup made with this version. ' +
        `Changes this version does not know: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? `, and ${unknown.length - 5} more` : ''}.`,
    );
    this.name = 'NewerDatabaseError';
    this.unknown = unknown;
  }
}

/** The first line of a migration that rebuilds a table other tables point to (run with foreign keys off, then checked). */
const REBUILD = /^--\s*migrate:\s*rebuild-with-foreign-keys-off\b/;

export function migrate(db: Db, sources: MigrationSource[], appliedAt: string): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT`);
  const applied = new Map(
    (db.prepare('SELECT id, checksum FROM schema_migrations').all() as { id: string; checksum: string }[]).map((r) => [
      r.id,
      r.checksum,
    ]),
  );
  const known = new Set(
    sources.flatMap((src) => (existsSync(src.dir) ? readdirSync(src.dir).filter((f) => f.endsWith('.sql')).map((f) => `${src.owner}/${f}`) : [])),
  );
  const unknown = [...applied.keys()].filter((id) => !known.has(id)).sort();
  if (unknown.length > 0) throw new NewerDatabaseError(unknown);
  const ran: string[] = [];
  for (const src of sources) {
    if (!existsSync(src.dir)) continue;
    const files = readdirSync(src.dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const id = `${src.owner}/${f}`;
      const sql = readFileSync(join(src.dir, f), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(id);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${id} was changed after it ran. Add a new migration instead.`);
        continue;
      }
      // A migration that rebuilds a table other tables point to (SQLite's documented way to change a CHECK: copy, drop,
      // rename) says so on its first line; foreign keys are off while it runs (the pragma has no effect inside a
      // transaction), every key is checked before it is kept, and they are on again after.
      const rebuild = REBUILD.test(sql.split(/\r?\n/, 1)[0] ?? '');
      if (rebuild) db.pragma('foreign_keys = OFF');
      try {
        db.transaction(() => {
          db.exec(sql);
          if (rebuild) {
            const broken = db.prepare('PRAGMA foreign_key_check').all() as { table: string; parent: string }[];
            if (broken.length > 0) throw new Error(`Migration ${id} would break ${broken.length} link(s), e.g. ${broken[0]!.table} → ${broken[0]!.parent}. Nothing was changed.`);
          }
          db.prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)').run(id, checksum, appliedAt);
        }).immediate();
      } finally {
        if (rebuild) db.pragma('foreign_keys = ON');
      }
      ran.push(id);
    }
  }
  addNoDeleteTriggers(db);
  return ran;
}

export function addNoDeleteTriggers(db: Db): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  for (const { name } of tables) {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Bad table name ${name}`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${name}_no_delete BEFORE DELETE ON ${name}
      BEGIN SELECT RAISE(ABORT, 'NO_DELETE: rows are never deleted; cancel or deactivate instead'); END`);
  }
}
