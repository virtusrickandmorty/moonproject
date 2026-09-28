import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { TIERS, bakSettings, keptIn, lastOkRun, runBackup } from './backup.ts';
import { saveSettings, settingsIssues } from './settings.ts';

/** No successful backup for this long turns the status red (PLAN E13 "backup stale"). */
const STALE_MS = 26 * 3600_000;

export function bakRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** Backup status: settings, what is kept in each tier, the last runs, and whether backups are stale. */
  app.get('/api/bak/status', { config: { permission: 'bak.view' } }, async () => {
    const settings = bakSettings(db);
    const kept = keptIn(settings.backupDir);
    const offsite = settings.offsiteDir ? keptIn(settings.offsiteDir) : [];
    const last = lastOkRun(db);
    const newest = (xs: { at: string }[]) => xs.map((x) => x.at).sort().at(-1) ?? null;
    return {
      settings, issues: settingsIssues(settings),
      lastOk: last ?? null,
      stale: !last || Date.parse(stamp(clock)) - Date.parse(last.at) > STALE_MS,
      kept: Object.fromEntries(TIERS.map((t) => [t, kept.filter((k) => k.tier === t).length])),
      lastOffsiteAt: newest(offsite),
      runs: db.prepare('SELECT * FROM bak_runs ORDER BY finished_at DESC LIMIT 20').all(),
    };
  });

  /** "Back up now". */
  app.post('/api/bak/run', { config: { permission: 'bak.run' } }, async (req: FastifyRequest) => {
    const r = await runBackup(db, { reason: 'manual', userId: currentUser(req).userId, stamp: () => stamp(clock) });
    if (!r.ok) throw new AppError(r.code, r.error, r.code === 'NO_RECOVERY_KEYS' ? 409 : 500);
    return r.result;
  });

  /** Folders and recovery keys: the owner, with a fresh password. */
  app.put('/api/bak/settings', { config: { permission: 'bak.manage' } }, async (req: FastifyRequest) => {
    requireStepUp(currentUser(req), clock);
    const ifMatch = req.headers['if-match'];
    return tx(db, () => saveSettings(db, req.body, Array.isArray(ifMatch) ? ifMatch[0] : ifMatch, { userId: currentUser(req).userId, at: stamp(clock) }));
  });
}
