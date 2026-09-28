/** What other parts of the app may read about backups: the facts System Health shows as lights (PLAN C8). */
import type { Db } from '../../platform/db/driver.ts';
import { bakSettings, keptIn, lastOkRun } from './backup.ts';

const HOUR = 3600_000;
/** No successful backup for this long turns the status red (PLAN E13 "backup stale"). */
export const STALE_MS = 26 * HOUR;
/** The restore drill is quarterly; USB drives are swapped weekly (PLAN C8). */
export const DRILL_EVERY_MS = 92 * 24 * HOUR;
export const USB_EVERY_MS = 8 * 24 * HOUR;

export interface BackupFacts {
  /** Both recovery keys are set, so the scheduler backs up. */
  on: boolean;
  offsiteSet: boolean;
  lastOkAt: string | null;
  /** The newest run, when it failed: its error code or message. */
  lastFailed: { at: string; error: string } | null;
  lastOffsiteAt: string | null;
  lastDrillAt: string | null;
  usb: { A: string | null; B: string | null };
}

export function backupFacts(db: Db): BackupFacts {
  const settings = bakSettings(db);
  const newest = settings.offsiteDir ? keptIn(settings.offsiteDir).map((k) => k.at).sort().at(-1) ?? null : null;
  const at = (sql: string, ...args: string[]) => (db.prepare(sql).pluck().get(...args) as string | undefined) ?? null;
  const usb = (drive: 'A' | 'B') => at(`SELECT at FROM bak_usb_copies WHERE drive = ? AND status = 'ok' ORDER BY at DESC LIMIT 1`, drive);
  const last = db.prepare('SELECT finished_at AS at, status, error FROM bak_runs ORDER BY finished_at DESC LIMIT 1').get() as
    | { at: string; status: string; error: string | null }
    | undefined;
  return {
    on: settings.recipients.length === 2,
    offsiteSet: !!settings.offsiteDir,
    lastOkAt: lastOkRun(db)?.at ?? null,
    lastFailed: last && last.status !== 'ok' ? { at: last.at, error: last.error ?? '' } : null,
    lastOffsiteAt: newest,
    lastDrillAt: at(`SELECT at FROM bak_restore_checks WHERE purpose = 'drill' AND result = 'ok' ORDER BY at DESC LIMIT 1`),
    usb: { A: usb('A'), B: usb('B') },
  };
}
