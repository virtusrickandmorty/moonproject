import { z } from 'zod';
import { badRequest, conflict, isBusinessDate, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { BIR_FORM, BIR_FORMS, parsePeriod } from './payments.ts';

export const FILED_FORMS = [...BIR_FORMS, '1601-C'] as const;
export interface FiledRegisterRow {
  id: number; form: (typeof FILED_FORMS)[number]; period: string; filedOn: string; reference: string; note: string | null;
  recordedAt: string; recordedBy: string; voidedAt: string | null; voidedBy: string | null; voidReason: string | null;
}
const ROWS = `SELECT r.id, r.form, r.period, r.filed_on AS filedOn, r.reference, r.note,
  r.recorded_at AS recordedAt, r.recorded_by AS recordedBy, v.voided_at AS voidedAt,
  v.voided_by AS voidedBy, v.reason AS voidReason
  FROM tax_filed_returns r LEFT JOIN tax_filed_return_voids v ON v.return_id = r.id`;

export const filedRegister = (db: Db): FiledRegisterRow[] =>
  db.prepare(`${ROWS} ORDER BY r.recorded_at DESC, r.id DESC`).all() as FiledRegisterRow[];
const rowOf = (db: Db, id: number) => db.prepare(`${ROWS} WHERE r.id = ?`).get(id) as FiledRegisterRow | undefined;
const input = z.object({
  form: z.enum(FILED_FORMS), period: z.string().max(10), filedOn: z.string().refine(isBusinessDate, 'Give a valid date filed.'),
  reference: z.string().trim().min(3).max(100), note: z.string().trim().min(1).max(500).optional(),
}).strict();
type Who = { userId: string; at: string };

/** Call inside the route's guarded transaction, so the row and audit are recorded together. */
export function addFiledReturn(db: Db, body: unknown, who: Who, today: string): FiledRegisterRow {
  const v = input.parse(body);
  const p = parsePeriod(v.period);
  const kind = v.form === '1601-C' ? 'month' : BIR_FORM[v.form].period;
  if (!p || p.kind !== kind || (v.form === '0619-E' && p.month! % 3 === 0) || (v.form === '1702Q' && p.quarter === 4)) {
    throw badRequest('BAD_PERIOD', 'Pick the month, quarter or year covered by this form (0619-E: months 1 and 2; 1702Q: Q1 to Q3).');
  }
  if (v.filedOn > today) throw badRequest('FUTURE_DATE', 'The date filed cannot be in the future.');
  const id = Number(db.prepare(`INSERT INTO tax_filed_returns (form, period, filed_on, reference, note, recorded_at, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(v.form, v.period, v.filedOn, v.reference, v.note ?? null, who.at, who.userId).lastInsertRowid);
  appendAudit(db, { ...who, action: 'tax.filed_return.add', entityType: 'tax_filed_return', entityId: String(id), data: v });
  return rowOf(db, id)!;
}

export function voidFiledReturn(db: Db, id: number, body: unknown, who: Who): FiledRegisterRow {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(500) }).strict().parse(body);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('The filed return');
  const row = rowOf(db, id);
  if (!row) throw notFound('The filed return');
  if (row.voidedAt) throw conflict('ALREADY_VOIDED', 'This filed return is already voided.');
  db.prepare('INSERT INTO tax_filed_return_voids (return_id, reason, voided_at, voided_by) VALUES (?, ?, ?, ?)').run(id, reason, who.at, who.userId);
  appendAudit(db, { ...who, action: 'tax.filed_return.void', entityType: 'tax_filed_return', entityId: String(id), data: { form: row.form, period: row.period, reference: row.reference, reason } });
  return rowOf(db, id)!;
}
