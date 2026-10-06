/**
 * The TV role (audit A11-003): it opens the TV production board by default, and an install made before this
 * version gets the grant once on upgrade.
 */
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestEnv } from '../../../../test/helpers.ts';
import { prepareDatabase } from '../../../app.ts';
import { loadModules } from '../../load.ts';
import { fixedClock } from '../../../platform/clock.ts';
import { openDb, type Db } from '../../../platform/db/driver.ts';

const tvGrant = (db: Db) => db.prepare(`SELECT granted FROM role_permissions WHERE role_key = 'tv' AND permission_key = 'prd.tv'`).pluck().get();

describe('TV role and the TV board (A11-003)', () => {
  it('a TV user opens the TV board and nothing else of production', async () => {
    const env = await createTestEnv();
    const tv = await env.as('tv');
    expect((await tv.get('/api/prd/tv')).statusCode).toBe(200);
    expect((await tv.get('/api/prd/board')).statusCode).toBe(403);
    expect((await tv.get('/api/docs/prd.entry')).statusCode).toBe(403);
    expect((await tv.get('/api/auth/me')).json().permissions).toContain('prd.tv');
  });

  it('an existing install without the grant gets it once on upgrade', async () => {
    // A database migrated only up to PRD 0003, holding the old default (no prd.tv for the TV role).
    const modules = await loadModules();
    const prd = modules.find((m) => m.code === 'PRD')!;
    const before = mkdtempSync(join(tmpdir(), 'prd-migrations-'));
    for (const f of readdirSync(prd.migrationsDir!).filter((f) => f < '0004')) copyFileSync(join(prd.migrationsDir!, f), join(before, f));
    const db = openDb(':memory:');
    const clock = fixedClock('2026-09-28T02:00:00Z');
    prepareDatabase(db, clock, modules.map((m) => (m.code === 'PRD' ? { ...m, migrationsDir: before } : m)));
    db.prepare(`UPDATE role_permissions SET granted = 0 WHERE role_key = 'tv' AND permission_key = 'prd.tv'`).run();
    expect(tvGrant(db)).toBe(0);

    prepareDatabase(db, clock, modules);
    expect(tvGrant(db)).toBe(1);
    // Only once: an owner who later switches it off again keeps it off.
    db.prepare(`UPDATE role_permissions SET granted = 0 WHERE role_key = 'tv' AND permission_key = 'prd.tv'`).run();
    prepareDatabase(db, clock, modules);
    expect(tvGrant(db)).toBe(0);
  });
});
