import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, newId, type Issue } from '@moonproject/shared';
import { prepareDatabase, type AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { engineModule } from '../../engine/security/module.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { TIERS, bakSettings, keptIn, lastOkRun, runBackup } from './backup.ts';
import { saveSettings, settingsIssues } from './settings.ts';
import { BACKUP_FILE, cleanStaged, openBackup, pendingRestore, requestRestore, restoreDir, stage, stagedPath } from './restore.ts';
import { copyToUsb } from './usb.ts';

const HOUR = 3600_000;
/** No successful backup for this long turns the status red (PLAN E13 "backup stale"). */
const STALE_MS = 26 * HOUR;
/** The restore drill is quarterly; USB drives are swapped weekly (PLAN C8). */
const DRILL_EVERY_MS = 92 * 24 * HOUR;
const USB_EVERY_MS = 8 * 24 * HOUR;

const checkInput = z.object({
  source: z.enum(['local', 'offsite']),
  file: z.string().regex(BACKUP_FILE, 'Pick a backup from the list.'),
  key: z.string().max(200),
  purpose: z.enum(['drill', 'restore']),
}).strict();
const usbInput = z.object({ drive: z.enum(['A', 'B']), dir: z.string().trim().min(1).max(260) }).strict();

export function bakRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;
  const now = () => stamp(clock);
  const ago = (at: string | null | undefined) => (at ? Date.parse(now()) - Date.parse(at) : Infinity);
  const dir = () => restoreDir(db.name);
  const migrations = () => db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as { id: string; checksum: string }[];
  const lastOk = (sql: string) => (db.prepare(sql).pluck().get() as string | undefined) ?? null;

  /** Backup status: settings, what is kept in each tier, the last runs, drills and USB copies, and what needs doing. */
  app.get('/api/bak/status', { config: { permission: 'bak.view' } }, async () => {
    const settings = bakSettings(db);
    const kept = keptIn(settings.backupDir);
    const offsite = settings.offsiteDir ? keptIn(settings.offsiteDir) : [];
    const last = lastOkRun(db);
    const newest = (xs: { at: string }[]) => xs.map((x) => x.at).sort().at(-1) ?? null;
    const lastDrillAt = lastOk(`SELECT at FROM bak_restore_checks WHERE purpose = 'drill' AND result = 'ok' ORDER BY at DESC LIMIT 1`);
    const usb = Object.fromEntries((['A', 'B'] as const).map((d) => [d, lastOk(`SELECT at FROM bak_usb_copies WHERE drive = '${d}' AND status = 'ok' ORDER BY at DESC LIMIT 1`)]));
    const issues: Issue[] = settingsIssues(settings);
    if (last && ago(lastDrillAt) > DRILL_EVERY_MS) {
      issues.push({ field: 'drill', code: 'DRILL_DUE', level: 'warning', message: 'A restore drill is due: open a backup with a recovery key to prove it can be restored.' });
    }
    if (last && Math.min(ago(usb.A), ago(usb.B)) > USB_EVERY_MS) {
      issues.push({ field: 'usb', code: 'USB_OVERDUE', level: 'warning', message: 'No USB copy this week: copy the backups to the USB drive, then swap the drives.' });
    }
    return {
      settings, issues,
      lastOk: last ?? null,
      stale: ago(last?.at) > STALE_MS,
      kept: Object.fromEntries(TIERS.map((t) => [t, kept.filter((k) => k.tier === t).length])),
      lastOffsiteAt: newest(offsite),
      lastDrillAt, usb,
      pendingRestore: pendingRestore(dir()),
      runs: db.prepare('SELECT * FROM bak_runs ORDER BY finished_at DESC LIMIT 20').all(),
    };
  });

  /** "Back up now". */
  app.post('/api/bak/run', { config: { permission: 'bak.run' } }, async (req: FastifyRequest) => {
    const r = await runBackup(db, { reason: 'manual', userId: currentUser(req).userId, stamp: now });
    if (!r.ok) throw new AppError(r.code, r.error, r.code === 'NO_RECOVERY_KEYS' ? 409 : 500);
    return r.result;
  });

  /** Folders and recovery keys: the owner, with a fresh password. */
  app.put('/api/bak/settings', { config: { permission: 'bak.manage' } }, async (req: FastifyRequest) => {
    requireStepUp(currentUser(req), clock);
    const ifMatch = req.headers['if-match'];
    return tx(db, () => saveSettings(db, req.body, Array.isArray(ifMatch) ? ifMatch[0] : ifMatch, { userId: currentUser(req).userId, at: now() }));
  });

  /** The backups the restore wizard can pick from: the backup folder and the off-site folder, newest first. */
  app.get('/api/bak/backups', { config: { permission: 'bak.restore' } }, async () => {
    const s = bakSettings(db);
    const list = (source: 'local' | 'offsite', folder: string | null) =>
      (folder ? keptIn(folder) : []).map((k) => ({ source, file: k.file, at: k.at, tier: k.tier, bytes: k.bytes }));
    return [...list('local', s.backupDir), ...list('offsite', s.offsiteDir)].sort((a, b) => b.at.localeCompare(a.at) || a.source.localeCompare(b.source));
  });

  /**
   * Opens a backup with a recovery key and checks it: the quarterly drill, or the first step of a restore (the checked
   * copy is then kept for 30 minutes). Every check is logged, passed or failed; the key never is.
   */
  app.post('/api/bak/restore/check', { config: { permission: 'bak.restore' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const input = checkInput.parse(req.body);
    const s = bakSettings(db);
    const folder = input.source === 'local' ? s.backupDir : s.offsiteDir;
    if (!folder) throw new AppError('NO_OFFSITE', 'No off-site folder is set.', 409);
    const at = now();
    cleanStaged(dir(), at);
    const id = newId();
    const staged = stagedPath(dir(), id);
    const log = (result: 'ok' | 'failed', error: string | null, facts: unknown) =>
      tx(db, () => {
        db.prepare('INSERT INTO bak_restore_checks (id, at, user_id, purpose, file, result, error, facts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, at, user.userId, input.purpose, input.file, result, error, facts === null ? null : JSON.stringify(facts));
        appendAudit(db, { at, userId: user.userId, action: `bak.${input.purpose}`, entityType: 'bak.backup', entityId: input.file, data: { source: input.source, result, error } });
      });
    try {
      const facts = await openBackup(join(folder, input.file), input.key, staged, migrations(), (copy) =>
        prepareDatabase(copy, clock, registry.modules.filter((m) => m !== engineModule)));
      log('ok', null, facts);
      const live = db.prepare('SELECT seq, at FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { seq: number; at: string };
      if (input.purpose === 'drill') {
        rmSync(staged, { force: true });
        return { ...facts, drill: 'passed' };
      }
      stage(dir(), { id, file: input.file, at, userId: user.userId, facts });
      return { ...facts, stagedId: id, live: { auditSeq: live.seq, lastAuditAt: live.at } };
    } catch (e) {
      log('failed', (e as Error).message, null);
      throw e;
    }
  });

  /** Restores the checked copy: it is swapped in when Moonproject next starts. The owner, with a fresh password. */
  app.post('/api/bak/restore/apply', { config: { permission: 'bak.restore' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const { stagedId } = z.object({ stagedId: z.string().min(1).max(64) }).strict().parse(req.body);
    const at = now();
    const s = requestRestore(dir(), stagedId, at);
    tx(db, () => appendAudit(db, { at, userId: user.userId, action: 'bak.restore', entityType: 'bak.backup', entityId: s.file, data: { stagedId, madeAt: s.facts.madeAt } }));
    return { file: s.file, restartNeeded: true, message: 'Restart Moonproject to finish. Everyone should save their work and sign out first; the current data is kept next to the restored one.' };
  });

  /** Copies the backups to USB drive A or B. */
  app.post('/api/bak/usb', { config: { permission: 'bak.run' } }, async (req: FastifyRequest) => {
    const user = currentUser(req);
    const { drive, dir: usbDir } = usbInput.parse(req.body);
    const at = now();
    const log = (status: 'ok' | 'failed', copied: number, error: string | null) =>
      db.prepare('INSERT INTO bak_usb_copies (id, at, user_id, drive, dir, status, copied, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), at, user.userId, drive, usbDir, status, copied, error);
    try {
      const r = copyToUsb(bakSettings(db).backupDir, usbDir, drive, at);
      log('ok', r.copied, null);
      return { drive, ...r };
    } catch (e) {
      log('failed', 0, (e as Error).message);
      if (e instanceof AppError) throw e;
      throw new AppError('USB_FAILED', `The USB copy failed: ${(e as Error).message}`, 500);
    }
  });

}
