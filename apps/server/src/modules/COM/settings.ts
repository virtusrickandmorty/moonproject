/**
 * Email settings (PLAN E14, OWN-11: off until configured). The App Password is write-only: it goes into a file in the
 * data folder that only the service account can read (the installer locks the folder; the file is also mode 0600) and
 * is never in the database, an API answer, a log line or the audit trail (the audit says only that it was changed).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { conflict, newId } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { scanEdges } from '../JO/public.ts';
import { payrollScanEdge } from '../PAY/public.ts';

export interface ComSettings {
  sendingOn: boolean; host: string; port: number; user: string; senderName: string; senderAddress: string; version: number;
}
interface Row { sending_on: number; smtp_host: string; smtp_port: number; smtp_user: string; sender_name: string; sender_address: string; version: number }

export const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

export function comSettings(db: Db): ComSettings {
  const r = db.prepare('SELECT * FROM com_settings WHERE id = 1').get() as Row | undefined;
  return r
    ? { sendingOn: r.sending_on === 1, host: r.smtp_host, port: r.smtp_port, user: r.smtp_user, senderName: r.sender_name, senderAddress: r.sender_address, version: r.version }
    : { sendingOn: false, host: '', port: 587, user: '', senderName: '', senderAddress: '', version: 0 };
}

/** Where the App Password file lives: the folder of the database file (the app's data folder). */
export function secretFile(db: Db): string {
  const folder = process.env.MOONPROJECT_COM_DIR ?? (db.name === ':memory:' || db.name === '' ? join(tmpdir(), 'moonproject-com') : dirname(db.name));
  return join(folder, 'com-app-password.secret');
}
export const appPasswordSet = (db: Db) => existsSync(secretFile(db)) && readAppPassword(db) !== null;
export function readAppPassword(db: Db): string | null {
  try {
    return readFileSync(secretFile(db), 'utf8') || null;
  } catch {
    return null;
  }
}
function writeAppPassword(db: Db, password: string): void {
  const file = secretFile(db);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${newId()}.tmp`;
  writeFileSync(tmp, password, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** Error text is stripped of the password before it is stored or logged, whatever the mail server echoed back. */
export function scrub(text: string, secret: string | null): string {
  let out = text;
  for (const s of new Set([secret, secret?.replace(/\s+/g, '')])) if (s) out = out.split(s).join('***');
  return out.replace(/\s+/g, ' ').slice(0, 300);
}

const text = (max: number) => z.string().trim().max(max);
export const settingsInput = z.object({
  sendingOn: z.boolean(),
  host: text(253).regex(/^[A-Za-z0-9.-]*$/, 'The mail server name has letters, numbers, dots and dashes only.'),
  port: z.number().int().min(1).max(65535),
  user: text(254),
  senderName: text(100).refine((s) => !/[\r\n<>"]/.test(s), 'The sender name cannot have line breaks, quotes or < >.'),
  senderAddress: text(254).refine((s) => s === '' || EMAIL.test(s), 'That is not an email address.'),
  /** Write-only. Leave it out to keep the one already saved. */
  appPassword: z.string().min(1).max(200).optional(),
}).strict();

/** What is missing before sending can be switched on. */
export function missingForSending(s: Omit<ComSettings, 'version'>, passwordSet: boolean): string[] {
  return [
    ...(s.host ? [] : ['the mail server']), ...(s.user ? [] : ['the mail user name']), ...(s.senderAddress ? [] : ['the sender address']),
    ...(passwordSet ? [] : ['the App Password']),
  ];
}

export const CURSORS = ['job_order_created', 'job_order_ready', 'release', 'payroll_release'] as const;
/** Puts every scan at the newest row (turning sending on), or with `onlyMissing` just the ones that have no place yet (a scan added by an update). */
export function setCursors(db: Db, at: string, onlyMissing = false): void {
  const edges = scanEdges(db);
  const put = db.prepare(`INSERT INTO com_cursors (key, last_rowid, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO ${onlyMissing ? 'NOTHING' : 'UPDATE SET last_rowid = excluded.last_rowid, updated_at = excluded.updated_at'}`);
  put.run('job_order_created', edges.jobOrders, at);
  put.run('job_order_ready', edges.stages, at);
  put.run('release', edges.releases, at);
  put.run('payroll_release', payrollScanEdge(db), at);
}

export function saveSettings(db: Db, raw: unknown, ifMatch: string | undefined, who: { userId: string; at: string }): ComSettings {
  const v = settingsInput.parse(raw);
  const was = comSettings(db);
  if (was.version > 0 && ifMatch !== String(was.version)) throw conflict('STALE', 'Someone changed the email settings. Reload and try again.');
  const willHavePassword = v.appPassword !== undefined || appPasswordSet(db);
  const missing = v.sendingOn ? missingForSending(v, willHavePassword) : [];
  if (missing.length > 0) throw conflict('NOT_CONFIGURED', `Sending cannot be turned on yet. Still needed: ${missing.join(', ')}.`);
  if (v.appPassword !== undefined) writeAppPassword(db, v.appPassword);
  db.prepare(
    `INSERT INTO com_settings (id, sending_on, smtp_host, smtp_port, smtp_user, sender_name, sender_address, version, updated_at, updated_by)
     VALUES (1, @sendingOn, @host, @port, @user, @senderName, @senderAddress, 1, @at, @userId)
     ON CONFLICT (id) DO UPDATE SET sending_on = @sendingOn, smtp_host = @host, smtp_port = @port, smtp_user = @user, sender_name = @senderName,
       sender_address = @senderAddress, version = version + 1, updated_at = @at, updated_by = @userId`,
  ).run({ sendingOn: +v.sendingOn, host: v.host, port: v.port, user: v.user, senderName: v.senderName, senderAddress: v.senderAddress, at: who.at, userId: who.userId });
  // Turning sending on starts from now: what was recorded while it was off is not emailed weeks later.
  if (v.sendingOn && !was.sendingOn) setCursors(db, who.at);
  const now = comSettings(db);
  const { appPassword: _never, ...shown } = v;
  appendAudit(db, {
    at: who.at, userId: who.userId, action: 'com.settings', entityType: 'com.settings', entityId: '1',
    data: { was: { ...was, version: undefined }, now: { ...shown }, appPasswordChanged: v.appPassword !== undefined },
  });
  return now;
}
