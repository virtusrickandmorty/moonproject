/**
 * The employee's bank or GCash QR code (the owner's request, Oct 2026): the picture of the QR their pay is sent to, kept
 * beside the record's "Paid by" and account. Seen with emp.view, changed with emp.manage (as the account is). Each save
 * is a new version in emp_payout_qr; the audit log says it changed, never what it shows (C6).
 */
import { z } from 'zod';
import { AppError, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { pictureFile, sha256Hex } from '../../engine/attachments.ts';
import type { Who } from './employees.ts';

/** A phone's photo of a QR is small; 4 MB, as the online shop's pictures. */
export const MAX_QR_BYTES = 4 * 1024 * 1024;

export const payoutQrInput = z.object({ name: z.string().max(200), data: z.string().min(1).max(Math.ceil((MAX_QR_BYTES * 4) / 3) + 8) }).strict();

export interface PayoutQr { version: number; contentType: string; savedAt: string }

/** The QR in force (without its bytes), or null when there is none or it was taken off. */
export function payoutQrOf(db: Db, employeeId: string): PayoutQr | null {
  const r = db.prepare(`SELECT version, content_type AS contentType, saved_at AS savedAt FROM emp_payout_qr WHERE employee_id = ? ORDER BY version DESC LIMIT 1`).get(employeeId) as
    | { version: number; contentType: string | null; savedAt: string }
    | undefined;
  return r?.contentType ? { version: r.version, contentType: r.contentType, savedAt: r.savedAt } : null;
}

/** The picture of the QR in force, for the image route. */
export function payoutQrPicture(db: Db, employeeId: string): { type: string; data: Buffer } | null {
  const r = db.prepare(`SELECT content_type AS type, data FROM emp_payout_qr WHERE employee_id = ? ORDER BY version DESC LIMIT 1`).get(employeeId) as
    | { type: string | null; data: Buffer | null }
    | undefined;
  return r?.type && r.data ? { type: r.type, data: r.data } : null;
}

/** The employees who have a QR in force, for the list's mark. */
export function employeesWithPayoutQr(db: Db): Set<string> {
  const ids = db.prepare(`SELECT q.employee_id FROM emp_payout_qr q
    WHERE q.data IS NOT NULL AND q.version = (SELECT MAX(version) FROM emp_payout_qr WHERE employee_id = q.employee_id)`).pluck().all() as string[];
  return new Set(ids);
}

function save(db: Db, employeeId: string, picture: { type: string; data: Buffer } | null, who: Who): PayoutQr | null {
  if (!db.prepare('SELECT 1 FROM emp_employees WHERE id = ?').get(employeeId)) throw notFound('The employee');
  const version = ((db.prepare('SELECT MAX(version) FROM emp_payout_qr WHERE employee_id = ?').pluck().get(employeeId) as number | null) ?? 0) + 1;
  db.prepare(`INSERT INTO emp_payout_qr (employee_id, version, content_type, data, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(employeeId, version, picture?.type ?? null, picture?.data ?? null, who.userId, who.at);
  appendAudit(db, {
    at: who.at, userId: who.userId, action: picture ? 'emp.payout_qr.save' : 'emp.payout_qr.remove', entityType: 'emp.employee', entityId: employeeId,
    data: { fields: ['payoutQr'], version, ...(picture ? { sha256: sha256Hex(picture.data) } : {}) },
  });
  return payoutQrOf(db, employeeId);
}

/** A new QR picture: JPEG, PNG or WebP by its first bytes, at most 4 MB. */
export function savePayoutQr(db: Db, employeeId: string, raw: unknown, who: Who): PayoutQr | null {
  const f = payoutQrInput.parse(raw);
  const sent = Buffer.from(f.data, 'base64');
  const picture = sent.length ? pictureFile(sent, 'The QR code picture') : null;
  if (!picture || 'problem' in picture) throw new AppError('FILE_TYPE', picture && 'problem' in picture && /pixels/.test(picture.problem) ? picture.problem : 'The QR code must be a JPEG, PNG or WebP picture.', 415);
  const { type, data } = picture; // a phone photo's extra picture or video after its end is not kept
  if (data.length > MAX_QR_BYTES) throw new AppError('FILE_TOO_BIG', 'The QR code picture is bigger than 4 MB. Send a smaller picture.', 413);
  return save(db, employeeId, { type, data }, who);
}

/** Takes the QR off (a new version without a picture; the earlier ones stay for the record). */
export function removePayoutQr(db: Db, employeeId: string, who: Who): null {
  if (!payoutQrOf(db, employeeId)) throw new AppError('NO_QR', 'There is no QR code to take off.', 409);
  save(db, employeeId, null, who);
  return null;
}
