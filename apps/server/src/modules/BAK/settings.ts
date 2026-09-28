/** Backup settings: the folders and the two recovery public keys (PLAN E13). Owner only, with a fresh password. */
import { z } from 'zod';
import { conflict, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { AGE_RECIPIENT, bakSettings, type BakSettings } from './backup.ts';

const folder = z.string().trim().min(1).max(260);
export const settingsInput = z
  .object({
    backupDir: folder,
    offsiteDir: folder.nullable(),
    recipients: z.array(z.string().trim().regex(AGE_RECIPIENT, 'A recovery key starts with age1 and has 62 characters.')).length(2),
  })
  .strict()
  .refine((s) => s.recipients[0] !== s.recipients[1], { path: ['recipients'], message: 'Use two different recovery keys, A and B.' })
  .refine((s) => s.offsiteDir === null || s.offsiteDir !== s.backupDir, { path: ['offsiteDir'], message: 'The off-site folder must not be the backup folder.' });

export function saveSettings(db: Db, raw: unknown, ifMatch: string | undefined, who: { userId: string; at: string }): BakSettings {
  const v = settingsInput.parse(raw);
  const was = bakSettings(db);
  if (was.version > 0 && ifMatch !== String(was.version)) throw conflict('STALE', 'Someone changed the backup settings. Reload and try again.');
  db.prepare(
    `INSERT INTO bak_settings (id, backup_dir, offsite_dir, recipients, version, updated_at, updated_by) VALUES (1, @backupDir, @offsiteDir, @recipients, 1, @at, @userId)
     ON CONFLICT (id) DO UPDATE SET backup_dir = @backupDir, offsite_dir = @offsiteDir, recipients = @recipients, version = version + 1, updated_at = @at, updated_by = @userId`,
  ).run({ ...v, recipients: JSON.stringify(v.recipients), at: who.at, userId: who.userId });
  appendAudit(db, { at: who.at, userId: who.userId, action: 'bak.settings', entityType: 'bak.settings', entityId: '1', data: { ...v, was: { ...was } } });
  return bakSettings(db);
}

/** What the status page warns about. */
export function settingsIssues(s: BakSettings): Issue[] {
  const issues: Issue[] = [];
  if (s.recipients.length !== 2) issues.push({ field: 'recipients', code: 'NO_RECOVERY_KEYS', level: 'error', message: 'Backups are off: set the two recovery keys.' });
  if (!s.offsiteDir) issues.push({ field: 'offsiteDir', code: 'NO_OFFSITE', level: 'warning', message: 'No off-site folder: a fire or theft would take the backups with the PC.' });
  return issues;
}
