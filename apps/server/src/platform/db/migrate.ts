/**
 * Forward-only, checksummed migrations (PLAN C5). Engine migrations run first, then each
 * module's migrations in module-code order. After migrating, every table gets a
 * BEFORE DELETE trigger that aborts (NR-3), so no table can ever lose rows.
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

export function migrate(db: Db, sources: MigrationSource[], appliedAt: string): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT`);
  const applied = new Map(
    (db.prepare('SELECT id, checksum FROM schema_migrations').all() as { id: string; checksum: string }[]).map((r) => [
      r.id,
      r.checksum,
    ]),
  );
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
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)').run(id, checksum, appliedAt);
      }).immediate();
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
