/**
 * The backup screens' rules (PLAN C8, E13): how long ago, the stale notice, the runs and results in words, the recovery
 * keys typed back, what a checked backup holds and what a restore would lose. Pure, so they are tested without a
 * browser; every figure comes from the server.
 */
import { formatPeso } from '@moonproject/shared';
import type { BackupCheck, BackupMade, BackupRun, BackupSource, BackupStatus, BackupTier } from '../../api.ts';
import { manilaTime } from '../../components/ui.tsx';

export const TIERS: BackupTier[] = ['snapshot', 'daily', 'monthly', 'yearly'];
const TIER_WORDS: Record<BackupTier, [one: string, many: string]> = {
  snapshot: ['Snapshot', 'Snapshots'], daily: ['Daily', 'Dailies'], monthly: ['Monthly', 'Monthlies'], yearly: ['Yearly', 'Yearlies'],
};
export const tierWords = (t: BackupTier) => TIER_WORDS[t][0];
export const tierCount = (t: BackupTier, n: number) => `${TIER_WORDS[t][1]}: ${n}`;
export const sourceWords = (s: BackupSource) => (s === 'local' ? 'This PC' : 'Off-site');
export const sizeWords = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago"; `now` is the server's time. */
export function agoWords(at: string, now: string): string {
  const minutes = Math.floor((Date.parse(now) - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${count(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${count(hours, 'hour')} ago`;
  return `${count(Math.floor(hours / 24), 'day')} ago`;
}

/** "2026-09-28 10:00 (3 hours ago)", or `never` when it has not happened. */
export const whenWords = (at: string | null, now: string, never = 'Never') => (at ? `${manilaTime(at)} (${agoWords(at, now)})` : never);

/** The red notice when no backup has worked for too long (the server decides `stale`). */
export function staleWords(s: Pick<BackupStatus, 'lastOk' | 'stale'>, now: string): string | null {
  if (!s.stale) return null;
  return s.lastOk ? `Backups are stale: the last good backup was ${agoWords(s.lastOk.at, now)}.` : 'Backups are stale: no backup has worked yet.';
}

export const pendingRestoreWords = (p: { file: string }) => `Restart Moonproject to finish the restore of ${p.file}.`;

const REASONS: Record<BackupRun['reason'], string> = { schedule: 'Scheduled', manual: 'Back up now', pre_update: 'Before an update' };

/** One run of the log. A failed run has no tier of its own, and an OK run may still name an off-site copy that failed. */
export function runWords(r: BackupRun): { when: string; reason: string; tier: string; ok: boolean; result: string } {
  const ok = r.status === 'ok';
  return {
    when: manilaTime(r.finished_at), reason: REASONS[r.reason], tier: ok ? tierWords(r.tier) : '—', ok,
    result: ok ? (r.error ? `OK. ${r.error}` : 'OK') : `Failed: ${r.error ?? 'no reason was recorded.'}`,
  };
}

/** "Back up now" worked: the new file, its tier and where the off-site copy stands. */
export function madeWords(r: BackupMade): string {
  const offsite = r.offsite ? 'Copied off-site too.' : r.offsiteError ?? (r.tier === 'snapshot' ? 'Snapshots stay on this PC.' : 'No off-site folder is set.');
  return `Backed up: ${r.file} (${tierWords(r.tier).toLowerCase()}). ${offsite}`;
}

export const usbWords = (r: { copied: number; onDrive: number }) => `Copied ${r.copied}; ${r.onDrive} on the drive.`;

/** The recovery keys are typed back to prove they were printed or written down: the last 8 characters of each. */
export const TYPED_BACK = 8;
export const keyEnd = (key: string) => key.slice(-TYPED_BACK);
/** Spaces and letter case do not matter: the key is shown in capitals and read from paper. */
export const typedBackOk = (key: string, typed: string) => key.length > TYPED_BACK && typed.replace(/\s+/g, '').toUpperCase() === keyEnd(key);
export const bothTypedBack = (keys: { a: string; b: string }, typed: { a: string; b: string }) => typedBackOk(keys.a, typed.a) && typedBackOk(keys.b, typed.b);

/** A recovery key typed from its sheet: line-break spaces and small letters are fine. */
export const cleanKey = (typed: string) => typed.replace(/\s+/g, '').toUpperCase();

/** A restore goes ahead only when the word is typed exactly. */
export const restoreConfirmed = (typed: string) => typed.trim() === 'RESTORE';

/** What a checked backup holds, as label and value. */
export function factRows(c: BackupCheck): [label: string, value: string][] {
  return [
    ['Made at', c.madeAt ? manilaTime(c.madeAt) : 'Unknown: the backup has no record file'],
    ['Posted documents', String(c.postedDocuments)],
    ['Books up to', c.lastBusinessDate ?? 'Nothing posted yet'],
    ['Trial balance', `Debits ${formatPeso(c.trialBalance.totalDebitCents)}, credits ${formatPeso(c.trialBalance.totalCreditCents)}`],
    ['Updates to apply', c.toApply.length ? `${c.toApply.length}: ${c.toApply.join(', ')}` : 'None: made by this version'],
  ];
}

/** How many audit entries the live data has after the backup: what a restore would take away. */
export const lostEntries = (c: Pick<BackupCheck, 'audit' | 'live'>) => Math.max(0, (c.live?.auditSeq ?? 0) - (c.audit?.seq ?? 0));

export function lostWords(c: Pick<BackupCheck, 'audit' | 'live' | 'madeAt' | 'lastAuditAt'>): string {
  const after = c.madeAt ?? c.lastAuditAt;
  const n = lostEntries(c);
  return `Everything recorded after ${after ? manilaTime(after) : 'this backup was made'} will be lost: ${count(n, 'audit entry', 'audit entries')} in the live data ${n === 1 ? 'is' : 'are'} newer than this backup.`;
}
