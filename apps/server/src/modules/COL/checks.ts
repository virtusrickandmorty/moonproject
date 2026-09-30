/**
 * Customer checks (PLAN E5 "check date and bank for checks -> 1103", E10 check deposits): the check a collection puts in
 * a checks place (Checks on hand), where each check is now, and taking checks to the bank or back from it.
 * Nothing here builds a journal: money moves through collections and fund transfers (TRF, bank -> Checks on hand for a
 * check the bank returned) and bank adjustments (the bank's charge), posted with the engine in one transaction.
 * Where a check is comes from its documents' status: on hand while its collection stands and its deposits that stand
 * are no more than its returns that stand; so cancelling a deposit's transfer puts its checks back on hand.
 */
import { z } from 'zod';
import { AppError, conflict, formatPeso, isBusinessDate, notFound, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import { cancelDocument, postDocument, type Actor, type EngineEnv } from '../../engine/documents/lifecycle.ts';
import { appendAudit } from '../../engine/audit.ts';
import { placesFor } from '../CASH/public.ts';
import { tenderInput, type Tender } from './ledger.ts';

/** Banks refuse a check dated more than six months back (a stale check). */
export const STALE_AFTER_DAYS = 180;
/** A deposit's note lists its checks; 30 fit the transfer's note. */
export const MAX_CHECKS_PER_DEPOSIT = 30;

export const checkDetails = z
  .object({
    number: z.string().trim().regex(/^[0-9A-Za-z-]{1,20}$/, 'Type the check number as printed on the check.'),
    bank: z.string().trim().min(2).max(60),
    date: z.string().refine(isBusinessDate, 'Type the date on the check, like 2026-09-30.'),
  })
  .strict();
export type CheckDetails = z.infer<typeof checkDetails>;

/** A collection's tender: into a checks place it carries the check (number, bank, date on the check). */
export const collectionTenderInput = tenderInput.extend({ check: checkDetails.optional() }).strict();
export type CollectionTenderInput = z.infer<typeof collectionTenderInput>;
export type CollectionTender = Tender & { check?: CheckDetails };

export const tenderWithCheckToInput = ({ cashPlaceId, amountCents, reference, check }: CollectionTender): CollectionTenderInput => ({
  cashPlaceId, amountCents, ...(reference ? { reference } : {}), ...(check ? { check } : {}),
});

/** Cash places of kind "checks" (Checks on hand, 1103, and any other the shop adds), inactive ones too. */
export function checkPlaceIds(db: Db): Set<number> {
  return new Set(placesFor(db, () => false, true).filter((p) => p.kind === 'checks').map((p) => p.id));
}

const dayNo = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round(dayNo(to) - dayNo(from));
const sameBank = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Check details are required on a tender into a checks place, and only there. A check dated after the collection is a
 * post-dated check: it goes on the post-dated checks list until its date instead (ACC-23).
 */
export function checkIssues(db: Db, tenders: readonly CollectionTender[], businessDate: string): Issue[] {
  const places = checkPlaceIds(db);
  const issues: Issue[] = [];
  for (const t of tenders) {
    const field = `tenders.${t.lineNo - 1}.check`;
    const add = (level: Issue['level'], code: string, message: string, sub = '') => issues.push({ field: field + sub, code, level, message });
    if (!places.has(t.cashPlaceId)) {
      if (t.check) add('error', 'NOT_A_CHECK_PLACE', `Payment ${t.lineNo}: only a check put in Checks on hand has a check number, bank and date. Pick Checks on hand, or clear the check details.`);
      continue;
    }
    const c = t.check;
    if (!c) {
      add('error', 'CHECK_DETAILS', `Payment ${t.lineNo} goes to ${t.cashPlaceName}: type the check number, the bank and the date on the check.`);
    } else if (c.date > businessDate) {
      add('error', 'POST_DATED', `Check no. ${c.number} is dated ${c.date}, after today. Do not record a post-dated check as a collection: put it on the post-dated checks list, and record it from there on its date.`, '.date');
    } else {
      if (daysBetween(c.date, businessDate) > STALE_AFTER_DAYS) {
        add('warning', 'STALE_CHECK', `Check no. ${c.number} is dated ${c.date}, more than six months ago. Banks refuse stale checks: ask the customer for a new one.`, '.date');
      }
      const twice = db
        .prepare(`SELECT d.number, k.bank FROM col_tender_checks k JOIN documents d ON d.id = k.document_id
                  WHERE d.status = 'posted' AND k.check_number = ?`)
        .all(c.number) as { number: string; bank: string }[];
      const used = twice.find((r) => sameBank(r.bank, c.bank));
      if (used) add('warning', 'CHECK_TWICE', `Check no. ${c.number} of ${c.bank} is already recorded on ${used.number}. Please check it is not the same check.`, '.number');
    }
  }
  return issues;
}

export function insertTenderChecks(db: Db, documentId: string, tenders: readonly CollectionTender[]): void {
  const ins = db.prepare('INSERT INTO col_tender_checks (document_id, line_no, check_number, bank, check_date) VALUES (?, ?, ?, ?, ?)');
  for (const t of tenders) if (t.check) ins.run(documentId, t.lineNo, t.check.number, t.check.bank, t.check.date);
}

export function withChecks(db: Db, documentId: string, tenders: Tender[]): CollectionTender[] {
  const rows = db.prepare('SELECT line_no, check_number, bank, check_date FROM col_tender_checks WHERE document_id = ?').all(documentId) as
    { line_no: number; check_number: string; bank: string; check_date: string }[];
  const by = new Map(rows.map((r) => [r.line_no, { number: r.check_number, bank: r.bank, date: r.check_date }]));
  return tenders.map((t) => (by.has(t.lineNo) ? { ...t, check: by.get(t.lineNo)! } : t));
}

export interface CheckRow {
  collectionId: string; collectionNumber: string; collectionStatus: 'posted' | 'cancelled'; lineNo: number; receivedOn: string;
  customerId: string; customerName: string; cashPlaceId: number; cashPlaceName: string;
  checkNumber: string; bank: string; checkDate: string; amountCents: number;
  /** Deposits and returns that stand (their fund transfers not cancelled). */
  deposits: number; returns: number;
  /** The latest deposit and return that stand, if any. */
  lastDeposit: { id: string; number: string; date: string } | null;
  lastReturn: { id: string; number: string; date: string } | null;
}
export type CheckWhere = 'on hand' | 'at the bank' | 'gone';
export const whereIs = (r: Pick<CheckRow, 'collectionStatus' | 'deposits' | 'returns'>): CheckWhere =>
  r.collectionStatus !== 'posted' ? 'gone' : r.deposits > r.returns ? 'at the bank' : 'on hand';

const standing = (table: 'col_check_deposits' | 'col_check_returns', what: string) => `(SELECT ${what} FROM ${table} x JOIN documents xd ON xd.id = x.transfer_id
  WHERE x.document_id = k.document_id AND x.line_no = k.line_no AND xd.status = 'posted' ${what.startsWith('COUNT') ? '' : 'ORDER BY xd.number DESC LIMIT 1'})`;
const CHECKS = `SELECT k.document_id AS collectionId, d.number AS collectionNumber, d.status AS collectionStatus, k.line_no AS lineNo, d.business_date AS receivedOn,
    c.customer_id AS customerId, c.customer_name AS customerName, t.account_id AS cashPlaceId, a.name AS cashPlaceName,
    k.check_number AS checkNumber, k.bank, k.check_date AS checkDate, t.amount_cents AS amountCents,
    ${standing('col_check_deposits', 'COUNT(*)')} AS deposits, ${standing('col_check_returns', 'COUNT(*)')} AS returns,
    ${standing('col_check_deposits', `json_object('id', xd.id, 'number', xd.number, 'date', xd.business_date)`)} AS lastDeposit,
    ${standing('col_check_returns', `json_object('id', xd.id, 'number', xd.number, 'date', xd.business_date)`)} AS lastReturn
  FROM col_tender_checks k JOIN col_tenders t ON t.document_id = k.document_id AND t.line_no = k.line_no
  JOIN col_collections c ON c.document_id = k.document_id JOIN documents d ON d.id = k.document_id JOIN accounts a ON a.id = t.account_id`;
type RawCheck = Omit<CheckRow, 'lastDeposit' | 'lastReturn'> & { lastDeposit: string | null; lastReturn: string | null };
const asCheck = (r: RawCheck): CheckRow => ({ ...r, lastDeposit: r.lastDeposit ? JSON.parse(r.lastDeposit) : null, lastReturn: r.lastReturn ? JSON.parse(r.lastReturn) : null });

/** Every check received and not yet deposited (or back from the bank), oldest first. */
export function checksOnHand(db: Db): CheckRow[] {
  return (db.prepare(`${CHECKS} WHERE d.status = 'posted' ORDER BY d.business_date, d.number, k.line_no`).all() as RawCheck[])
    .map(asCheck)
    .filter((r) => whereIs(r) === 'on hand');
}

/** Every check now at the bank, newest deposit first. */
export function checksAtBank(db: Db): CheckRow[] {
  return (db.prepare(`${CHECKS} WHERE d.status = 'posted' AND EXISTS (SELECT 1 FROM col_check_deposits x WHERE x.document_id = k.document_id AND x.line_no = k.line_no)`).all() as RawCheck[])
    .map(asCheck)
    .filter((r) => whereIs(r) === 'at the bank')
    .sort((a, b) => b.lastDeposit!.number.localeCompare(a.lastDeposit!.number));
}

export function checkAt(db: Db, collectionId: string, lineNo: number): CheckRow | undefined {
  const r = db.prepare(`${CHECKS} WHERE k.document_id = ? AND k.line_no = ?`).get(collectionId, lineNo) as RawCheck | undefined;
  return r && asCheck(r);
}

/** A collection's checks now at the bank: cancelling or editing the collection waits until each is back (returned) or its deposit is cancelled. */
export function depositedChecksOf(db: Db, collectionId: string): CheckRow[] {
  return (db.prepare(`${CHECKS} WHERE k.document_id = ? ORDER BY k.line_no`).all(collectionId) as RawCheck[]).map(asCheck).filter((r) => r.deposits > r.returns);
}

const label = (r: Pick<CheckRow, 'checkNumber' | 'bank'>) => `${r.checkNumber} ${r.bank}`;

export const depositBody = z
  .object({
    checks: z.array(z.object({ collectionId: z.uuid(), lineNo: z.number().int().positive() }).strict()).min(1).max(MAX_CHECKS_PER_DEPOSIT),
    toCashPlaceId: z.number().int().positive(),
  })
  .strict();
export type DepositBody = z.infer<typeof depositBody>;

const docType = (registry: Registry, key: string) => {
  const d = registry.docType(key);
  if (!d) throw new AppError('NOT_AVAILABLE', `This needs ${key}, which is not installed.`, 500);
  return d;
};

/** The fund transfer that takes the ticked checks to the bank: from their checks place, for their total, their numbers in the note. */
export function depositTransferInput(db: Db, body: DepositBody) {
  const seen = new Set<string>();
  const checks = body.checks.map(({ collectionId, lineNo }) => {
    const key = `${collectionId}:${lineNo}`;
    if (seen.has(key)) throw new AppError('CHECK_TWICE', 'A check is ticked twice.', 400);
    seen.add(key);
    const r = checkAt(db, collectionId, lineNo);
    if (!r) throw notFound('The check');
    if (whereIs(r) !== 'on hand') {
      const why = r.collectionStatus !== 'posted' ? `its collection ${r.collectionNumber} was cancelled` : `it was deposited with ${r.lastDeposit?.number}`;
      throw conflict('CHECK_NOT_ON_HAND', `Check no. ${label(r)} is not on hand any more: ${why}. Reload the list.`);
    }
    return r;
  });
  const from = checks[0]!.cashPlaceId;
  if (checks.some((r) => r.cashPlaceId !== from)) throw new AppError('ONE_PLACE', 'Deposit checks from one checks place at a time.', 400);
  const bank = placesFor(db, () => false).find((p) => p.id === body.toCashPlaceId);
  if (bank?.kind !== 'bank') throw new AppError('NOT_A_BANK', 'Pick the bank the checks go to.', 400);
  const totalCents = checks.reduce((s, r) => s + r.amountCents, 0);
  const note = `Checks deposited: ${checks.map(label).join(', ')}`;
  return { checks, input: { fromCashPlaceId: from, toCashPlaceId: bank.id, amountSentCents: totalCents, amountReceivedCents: totalCents, note: note.length > 500 ? `${note.slice(0, 497)}...` : note } };
}

/** Records the deposit: the fund transfer and which checks it carried, in the caller's transaction. */
export function depositChecks(env: EngineEnv, registry: Registry, actor: Actor, body: DepositBody, expectedTotalCents: number, at: string) {
  const { checks, input } = depositTransferInput(env.db, body);
  const transfer = postDocument(env, docType(registry, 'cash.transfer'), actor, { input, expectedTotalCents });
  const ins = env.db.prepare('INSERT INTO col_check_deposits (transfer_id, document_id, line_no) VALUES (?, ?, ?)');
  for (const r of checks) ins.run(transfer.id, r.collectionId, r.lineNo);
  appendAudit(env.db, {
    at, userId: actor.userId, action: 'col.checks.deposit', entityType: 'cash.transfer', entityId: transfer.id,
    data: { number: transfer.number, checks: checks.map((r) => ({ collection: r.collectionNumber, lineNo: r.lineNo, checkNumber: r.checkNumber, amountCents: r.amountCents })) },
  });
  return { transfer, count: checks.length };
}

/**
 * COL's dependents of fund transfers (engine DependentsFn): a check's transfers are undone in the order the check moved,
 * so Checks on hand always holds exactly the checks on its list.
 *   A deposit is not cancelled while a return from it stands (cancel the return first).
 *   A return is not cancelled while its check is at the bank again (cancel that deposit first), nor once its collection
 *   was cancelled (the check already left Checks on hand with the collection's mirror).
 *   Neither is edited: the checks it carried stay with the cancelled one, so cancel it and use the Checks screen again.
 */
export function checkTransferDependents(db: Db, docType: string, documentId: string, reissuing: boolean): { id: string; number: string }[] {
  if (docType !== 'cash.transfer') return [];
  const deposited = db.prepare('SELECT 1 FROM col_check_deposits WHERE transfer_id = ? LIMIT 1').get(documentId) !== undefined;
  const back = db.prepare('SELECT document_id AS collectionId, line_no AS lineNo FROM col_check_returns WHERE transfer_id = ?').get(documentId) as
    { collectionId: string; lineNo: number } | undefined;
  if (!deposited && !back) return [];
  if (reissuing) {
    throw conflict('CHECK_TRANSFER', 'This transfer carried customer checks, so it is not edited. Cancel it, then deposit the checks or record the returned check again on the Checks on hand screen.');
  }
  if (deposited) {
    return db
      .prepare(`SELECT d.id, d.number FROM col_check_returns r JOIN documents d ON d.id = r.transfer_id WHERE r.deposit_id = ? AND d.status = 'posted' ORDER BY d.number`)
      .all(documentId) as { id: string; number: string }[];
  }
  const r = checkAt(db, back!.collectionId, back!.lineNo);
  if (!r) return [];
  if (r.collectionStatus !== 'posted') {
    throw conflict('CHECK_GONE', `Check no. ${label(r)} came back with this transfer, and its collection ${r.collectionNumber} was cancelled since, which already took the check out of ${r.cashPlaceName}. This transfer stays.`);
  }
  return whereIs(r) === 'at the bank' ? [{ id: r.lastDeposit!.id, number: r.lastDeposit!.number }] : [];
}

export const returnBody = z
  .object({
    collectionId: z.uuid(),
    lineNo: z.number().int().positive(),
    chargeCents: z.number().int().positive().max(10_000_00).optional(), // the bank's charge for the returned check
    reason: z.string().trim().min(10).max(300), // what the bank wrote: "Drawn against insufficient funds"
    cancelCollection: z.boolean(),
  })
  .strict();
export type ReturnBody = z.infer<typeof returnBody>;

/**
 * A check the bank returned (PLAN E10, no new posting rule), in the caller's transaction:
 *   1. fund transfer bank -> the check's checks place, for the check: the check is on hand again, as it is in the hand;
 *   2. bank adjustment (charge) on the bank for the bank's fee, if any: Dr 6230 / Cr bank;
 *   3. with cancelCollection, the collection is cancelled (its mirror takes the check out of Checks on hand and puts the
 *      receivable or the deposit back, D6), when the check is all the money it took; otherwise the collection is edited
 *      without the check afterwards, or the check is deposited again.
 */
export function returnCheck(env: EngineEnv, registry: Registry, actor: Actor, body: ReturnBody, at: string) {
  const { db } = env;
  const r = checkAt(db, body.collectionId, body.lineNo);
  if (!r) throw notFound('The check');
  if (whereIs(r) !== 'at the bank') throw conflict('CHECK_NOT_DEPOSITED', `Check no. ${label(r)} is not at the bank: only a deposited check can come back from it.`);
  const trf = docType(registry, 'cash.transfer');
  const bankId = (trf.load(db, r.lastDeposit!.id) as { toCashPlaceId: number }).toCashPlaceId;
  const tenders = db.prepare('SELECT COUNT(*) FROM col_tenders WHERE document_id = ?').pluck().get(r.collectionId) as number;
  const other = db.prepare('SELECT cwt_cents + vat_withheld_cents FROM col_collections WHERE document_id = ?').pluck().get(r.collectionId) as number;
  if (body.cancelCollection && (tenders > 1 || other > 0)) {
    throw conflict('OTHER_MONEY', `${r.collectionNumber} also took other money or a 2307. Record the return without cancelling it, then edit ${r.collectionNumber} without this check.`);
  }
  const what = `Check no. ${label(r)} of ${r.customerName} returned by the bank`;
  const back = postDocument(env, trf, actor, {
    input: { fromCashPlaceId: bankId, toCashPlaceId: r.cashPlaceId, amountSentCents: r.amountCents, amountReceivedCents: r.amountCents, note: `${what}: ${body.reason}`.slice(0, 500) },
    expectedTotalCents: r.amountCents,
  });
  const charge = body.chargeCents
    ? postDocument(env, docType(registry, 'cash.bank_adj'), actor, {
      input: { cashPlaceId: bankId, kind: 'charge', amountCents: body.chargeCents, description: `Returned check no. ${label(r)}`.slice(0, 200), note: body.reason },
      expectedTotalCents: body.chargeCents,
    })
    : null;
  db.prepare('INSERT INTO col_check_returns (transfer_id, document_id, line_no, deposit_id, charge_id, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .run(back.id, r.collectionId, r.lineNo, r.lastDeposit!.id, charge?.id ?? null, body.reason);
  if (body.cancelCollection) cancelDocument(env, docType(registry, 'col.collection'), actor, r.collectionId, `${what}: ${body.reason}`);
  appendAudit(db, {
    at, userId: actor.userId, action: 'col.checks.return', entityType: 'col.collection', entityId: r.collectionId,
    data: { checkNumber: r.checkNumber, lineNo: r.lineNo, amountCents: r.amountCents, transfer: back.number, charge: charge?.number ?? null, cancelled: body.cancelCollection, reason: body.reason },
  });
  return { transfer: back, charge, cancelled: body.cancelCollection, summary: `${what}: ${formatPeso(r.amountCents)} back in ${r.cashPlaceName}.` };
}
