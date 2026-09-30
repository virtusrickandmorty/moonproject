/**
 * Does the newest good backup still exist and hold together? Read-only, for AUD's nightly checks.
 * The server holds no recovery key (PLAN C8), so it cannot decrypt the file: "opens" here means the file is there, is
 * the size its record says, starts like an age-encrypted file and its record says every check passed when it was made.
 * Opening it with a recovery key is the restore drill.
 */
import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../platform/db/driver.ts';
import { bakSettings, lastOkRun, type Sidecar } from './backup.ts';

const AGE_HEADER = 'age-encryption.org/v1';

/** What is wrong with the last backup, in plain English; empty when it is fine. `now` is a Manila timestamp. */
export function backupProblems(db: Db, now: string, staleMs: number): string[] {
  const settings = bakSettings(db);
  if (settings.recipients.length !== 2) return ['Backups are off: the two recovery keys are not set on the Backups page.'];
  const last = lastOkRun(db);
  if (!last) return ['No backup has been made yet.'];
  const at = last.at.slice(0, 16).replace('T', ' ');
  if (Date.parse(now) - Date.parse(last.at) > staleMs) return [`The last good backup was on ${at}, more than a day ago.`];
  const file = join(settings.backupDir, last.file);
  if (!existsSync(file)) return [`The last backup (${last.file}) is not in the backup folder any more.`];
  const sidecarFile = join(settings.backupDir, last.file.replace(/\.db\.gz\.age$/, '.json'));
  let sidecar: Sidecar;
  try {
    sidecar = JSON.parse(readFileSync(sidecarFile, 'utf8')) as Sidecar;
  } catch {
    return [`The record that goes with the last backup (${last.file}) is missing or damaged.`];
  }
  if (sidecar.file !== last.file || Object.values(sidecar.checks ?? {}).some((c) => c !== 'ok')) return [`The record of the last backup (${last.file}) does not match it.`];
  if (statSync(file).size !== sidecar.bytes) return [`The last backup (${last.file}) is not the size it was when it was made: it is damaged or was changed.`];
  const head = Buffer.alloc(AGE_HEADER.length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  if (head.toString('latin1') !== AGE_HEADER) return [`The last backup (${last.file}) does not open: it is not a valid encrypted backup file.`];
  return [];
}
