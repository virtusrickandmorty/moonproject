/**
 * Post-dated checks (ACC-23): a memo list that posts nothing. A check dated after today is listed here with the job orders
 * it is for; from its date it shows as due, and it is recorded as a collection filled in from it (the collection names
 * it, postDatedCheckId, which marks it used while that collection stands). A listed check is never edited: it is voided
 * with a reason and listed again. Every change is audited.
 */
import { z } from 'zod';
import { AppError, conflict, formatPeso, isBusinessDate, newId, notFound, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { customerRef } from '../CUS/public.ts';
import { jobOrderRef } from '../JO/public.ts';
import { MAX_CENTS } from './ledger.ts';
import { checkDetails, checkPlaceIds, type CollectionTender } from './checks.ts';

export const pdcInput = z
  .object({
    customerId: z.uuid(),
    bank: checkDetails.shape.bank,
    checkNumber: checkDetails.shape.number,
    checkDate: checkDetails.shape.date,
    amountCents: z.number().int().positive().max(MAX_CENTS),
    jobOrderIds: z.array(z.uuid()).max(10),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export const voidInput = z.object({ reason: z.string().trim().min(10).max(300) }).strict();

export type PdcStatus = 'waiting' | 'due' | 'used' | 'voided';
export interface Pdc {
  id: string; customerId: string; customerName: string; bank: string; checkNumber: string; checkDate: string; amountCents: number; note: string | null;
  createdAt: string; createdBy: string;
  jobOrders: { id: string; number: string }[];
  status: PdcStatus;
  usedBy: { id: string; number: string } | null;
  voided: { reason: string; at: string } | null;
}
interface Who { userId: string; at: string }

const PDCS = `SELECT p.id, p.customer_id AS customerId, p.customer_name AS customerName, p.bank, p.check_number AS checkNumber, p.check_date AS checkDate,
    p.amount_cents AS amountCents, p.note, p.created_at AS createdAt, u.display_name AS createdBy,
    (SELECT json_object('id', d.id, 'number', d.number) FROM col_pdc_uses x JOIN documents d ON d.id = x.document_id WHERE x.pdc_id = p.id AND d.status = 'posted') AS usedBy,
    (SELECT json_object('reason', v.reason, 'at', v.voided_at) FROM col_pdc_voids v WHERE v.pdc_id = p.id) AS voided
  FROM col_pdcs p JOIN users u ON u.id = p.created_by`;
type Raw = Omit<Pdc, 'jobOrders' | 'status' | 'usedBy' | 'voided'> & { usedBy: string | null; voided: string | null };

function asPdc(db: Db, r: Raw, today: string): Pdc {
  const usedBy = r.usedBy ? JSON.parse(r.usedBy) : null;
  const voided = r.voided ? JSON.parse(r.voided) : null;
  const jobOrders = (db.prepare('SELECT job_order_id FROM col_pdc_job_orders WHERE pdc_id = ? ORDER BY line_no').pluck().all(r.id) as string[])
    .map((id) => ({ id, number: jobOrderRef(db, id)?.number ?? '?' }));
  const status: PdcStatus = voided ? 'voided' : usedBy ? 'used' : r.checkDate <= today ? 'due' : 'waiting';
  return { ...r, jobOrders, status, usedBy, voided };
}

/** The list: due first (oldest date first), then waiting, then used and voided (newest first). */
export function listPdcs(db: Db, today: string): Pdc[] {
  const order: Record<PdcStatus, number> = { due: 0, waiting: 1, used: 2, voided: 3 };
  return (db.prepare(`${PDCS} ORDER BY p.check_date, p.created_at`).all() as Raw[])
    .map((r) => asPdc(db, r, today))
    .sort((a, b) => order[a.status] - order[b.status] || (a.status === 'used' || a.status === 'voided' ? b.checkDate.localeCompare(a.checkDate) : 0));
}

export function getPdc(db: Db, id: string, today: string): Pdc | undefined {
  const r = db.prepare(`${PDCS} WHERE p.id = ?`).get(id) as Raw | undefined;
  return r && asPdc(db, r, today);
}

const sameCheck = (a: { bank: string; number: string }, b: { bank: string; number: string }) =>
  a.number === b.number && a.bank.trim().toLowerCase() === b.bank.trim().toLowerCase();

/** Lists a post-dated check. Call inside a transaction. */
export function addPdc(db: Db, raw: unknown, who: Who, today: string): Pdc {
  const v = pdcInput.parse(raw);
  const customer = customerRef(db, v.customerId);
  if (customer?.is_active !== 1) throw new AppError('CUSTOMER', customer ? `${customer.display_name} is inactive. Pick an active customer.` : 'Pick a customer.', 400);
  if (v.checkDate <= today) throw new AppError('NOT_POST_DATED', `Check no. ${v.checkNumber} is dated ${v.checkDate}, not after today: record it as a collection now.`, 400);
  if (new Set(v.jobOrderIds).size !== v.jobOrderIds.length) throw new AppError('JO_TWICE', 'A job order is listed twice.', 400);
  for (const id of v.jobOrderIds) {
    const jo = jobOrderRef(db, id);
    if (!jo || jo.customerId !== v.customerId) throw new AppError('JOB_ORDER', `Pick ${customer.display_name}'s own job orders.`, 400);
    if (jo.status !== 'posted') throw new AppError('JO_CANCELLED', `${jo.number} is cancelled.`, 400);
  }
  const listed = listPdcs(db, today).find((p) => (p.status === 'waiting' || p.status === 'due') && sameCheck({ bank: p.bank, number: p.checkNumber }, { bank: v.bank, number: v.checkNumber }));
  if (listed) throw conflict('PDC_LISTED', `Check no. ${v.checkNumber} of ${v.bank} is already on the list (${listed.customerName}, ${listed.checkDate}).`);
  const id = newId();
  db.prepare(`INSERT INTO col_pdcs (id, customer_id, customer_name, bank, check_number, check_date, amount_cents, note, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.customerId, customer.display_name, v.bank, v.checkNumber, v.checkDate, v.amountCents, v.note ?? null, who.at, who.userId);
  const jo = db.prepare('INSERT INTO col_pdc_job_orders (pdc_id, line_no, job_order_id) VALUES (?, ?, ?)');
  v.jobOrderIds.forEach((j, i) => jo.run(id, i + 1, j));
  appendAudit(db, { at: who.at, userId: who.userId, action: 'col.pdc.add', entityType: 'col.pdc', entityId: id, data: { ...v, customerName: customer.display_name } });
  return getPdc(db, id, today)!;
}

/** Takes a post-dated check off the list, with a reason. Call inside a transaction. */
export function voidPdc(db: Db, id: string, raw: unknown, who: Who, today: string): Pdc {
  const { reason } = voidInput.parse(raw);
  const p = getPdc(db, id, today);
  if (!p) throw notFound('The post-dated check');
  if (p.status === 'voided') throw conflict('ALREADY_VOIDED', `Check no. ${p.checkNumber} is already voided.`);
  if (p.usedBy) throw conflict('PDC_USED', `Check no. ${p.checkNumber} is recorded on ${p.usedBy.number}. Cancel that collection first.`);
  db.prepare('INSERT INTO col_pdc_voids (pdc_id, reason, voided_at, voided_by) VALUES (?, ?, ?, ?)').run(id, reason, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'col.pdc.void', entityType: 'col.pdc', entityId: id, data: { checkNumber: p.checkNumber, bank: p.bank, amountCents: p.amountCents, reason } });
  return getPdc(db, id, today)!;
}

/** A collection that records a post-dated check: the check is due, still listed, the customer's, and paid in as listed. */
export function pdcUseIssues(db: Db, doc: { postDatedCheckId?: string; customerId: string; tenders: readonly CollectionTender[] }, businessDate: string): Issue[] {
  if (!doc.postDatedCheckId) return [];
  const error = (code: string, message: string): Issue[] => [{ field: 'postDatedCheckId', code, level: 'error', message }];
  const p = getPdc(db, doc.postDatedCheckId, businessDate);
  if (!p) return error('PDC', 'The post-dated check is not on the list.');
  if (p.customerId !== doc.customerId) return error('PDC_CUSTOMER', `Check no. ${p.checkNumber} is ${p.customerName}'s. Pick that customer.`);
  if (p.status === 'voided') return error('PDC_VOIDED', `Check no. ${p.checkNumber} was taken off the list: ${p.voided!.reason}`);
  if (p.status === 'used') return error('PDC_USED', `Check no. ${p.checkNumber} is already recorded on ${p.usedBy!.number}.`);
  if (p.status === 'waiting') return error('PDC_NOT_DUE', `Check no. ${p.checkNumber} is dated ${p.checkDate}: record it on or after that date.`);
  const places = checkPlaceIds(db);
  const paid = doc.tenders.some((t) => places.has(t.cashPlaceId) && t.amountCents === p.amountCents && t.check && t.check.date === p.checkDate
    && sameCheck(t.check, { bank: p.bank, number: p.checkNumber }));
  return paid ? [] : error('PDC_TENDER', `Put check no. ${p.checkNumber} of ${p.bank}, ${formatPeso(p.amountCents)} dated ${p.checkDate}, in Checks on hand, as listed.`);
}
