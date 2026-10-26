/** What collections and refunds share: tender lines, and customer deposits read from the ledger (NR-2). */
import { z } from 'zod';
import type { Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { getCashPlace, resolveAccount } from '../../engine/ledger/accounts.ts';
import { joLedger, joMoney } from '../JO/public.ts';

export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

/** One cash place and the amount that went into it (or came out of it, for a refund). */
export const tenderInput = z
  .object({
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    reference: z.string().trim().min(1).max(80).optional(), // GCash or bank reference, or check number and bank
  })
  .strict();
export type TenderInput = z.infer<typeof tenderInput>;
export interface Tender extends TenderInput { lineNo: number; cashPlaceName: string }

export const sumCents = (rows: readonly { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);

export function withNames<T extends TenderInput>(db: Db, tenders: readonly T[]): (T & Omit<Tender, keyof TenderInput>)[] {
  return tenders.map((t, i) => ({ ...t, lineNo: i + 1, cashPlaceName: getCashPlace(db, t.cashPlaceId)?.name ?? '?' }));
}

export function cashPlaceIssues(db: Db, tenders: readonly Tender[], message: string): Issue[] {
  return tenders
    .filter((t) => !getCashPlace(db, t.cashPlaceId)?.isActive)
    .map((t) => ({ field: `tenders.${t.lineNo - 1}.cashPlaceId`, code: 'CASH_PLACE', level: 'error' as const, message }));
}

export function insertTenders(db: Db, table: 'col_tenders' | 'col_refund_tenders', documentId: string, tenders: readonly Tender[]): void {
  const ins = db.prepare(`INSERT INTO ${table} (document_id, line_no, account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)`);
  for (const t of tenders) ins.run(documentId, t.lineNo, t.cashPlaceId, t.amountCents, t.reference ?? null);
}

export function loadTenders(db: Db, table: 'col_tenders' | 'col_refund_tenders', documentId: string): Tender[] {
  const rows = db
    .prepare(`SELECT line_no, account_id, amount_cents, reference FROM ${table} WHERE document_id = ? ORDER BY line_no`)
    .all(documentId) as { line_no: number; account_id: number; amount_cents: number; reference: string | null }[];
  return rows.map((r) => ({
    cashPlaceId: r.account_id,
    amountCents: r.amount_cents,
    ...(r.reference ? { reference: r.reference } : {}),
    lineNo: r.line_no,
    cashPlaceName: getCashPlace(db, r.account_id)?.name ?? '?',
  }));
}

export const tenderToInput = ({ cashPlaceId, amountCents, reference }: Tender): TenderInput => ({ cashPlaceId, amountCents, ...(reference ? { reference } : {}) });

/**
 * Money held for a customer in 2201 (a credit balance): the deposits of one job order, or, with jobOrderId null,
 * the customer's unapplied payments (lines with no document reference). A job order's is money only: in downpayment VAT
 * mode C, the NET of downpayments invoiced ahead also sits in 2201 until the release invoice (JO joLedger).
 */
export function depositsHeld(db: Db, customerId: string, jobOrderId: string | null): number {
  if (jobOrderId) return joLedger(db, jobOrderId).depositsHeldCents;
  const account = resolveAccount(db, { role: 'CUSTOMER_DEPOSITS' }).id;
  // accountBalance has no "no reference" filter, so unapplied payments are read here (engine tables may be read directly).
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS held FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND l.party_type = 'customer' AND l.party_id = ? AND l.ref_doc_id IS NULL AND j.sealed = 1`,
    )
    .get(account, customerId) as { held: number };
  return r.held;
}

/**
 * What blocks cancelling a document that put money into one pool of 2201 (a JO's deposits, or with jobOrderId null the
 * customer's unapplied payments): `depositCents` into the pool, plus `receivableCents` paid on the same JO's receivable.
 * Its mirror takes both back. On a JO, the cancel's settleLines then keeps deposits and the receivable at zero or more
 * by reopening the receivable, which works while the receivable stays within what is invoiced (D6); the unapplied pool
 * has no receivable, so it must still hold the money. When that fails, the refunds, deposit transfers and deposit
 * forfeits that took money out of the pool are listed: cancel those first, so 2201 never goes below zero.
 */
export function takenOutBy(db: Db, customerId: string, jobOrderId: string | null, depositCents: number, receivableCents: number): { id: string; number: string }[] {
  if (jobOrderId) {
    const m = joMoney(db, jobOrderId);
    if (m.receivableCents - m.depositsHeldCents + receivableCents + depositCents <= m.invoicedCents) return [];
  } else if (depositCents <= depositsHeld(db, customerId, null)) return [];
  return db
    .prepare(
      `SELECT d.id, d.number FROM documents d WHERE d.status = 'posted' AND d.id IN (
         SELECT document_id FROM col_refunds WHERE customer_id = @c AND job_order_id IS @jo
         UNION SELECT document_id FROM col_deposit_transfers WHERE customer_id = @c AND from_job_order_id IS @jo
         UNION SELECT document_id FROM col_forfeits WHERE customer_id = @c AND job_order_id IS @jo)
       ORDER BY d.number`,
    )
    .all({ c: customerId, jo: jobOrderId }) as { id: string; number: string }[];
}

/**
 * Deposits not on a job order (the owner's rule, 26 Oct 2026): money a customer paid before any job order (a layout fee
 * deposit, and other deposits) is their credit, for a job order if they order; once it is this many days old and they
 * did not, it may be forfeited as other income (col.forfeit without a job order).
 */
export const DEPOSIT_MATURES_DAYS = 30;

/** A date `days` after `date` (YYYY-MM-DD, no clock: NR-7). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export interface UnappliedDeposits {
  heldCents: number;
  /** Paid at least DEPOSIT_MATURES_DAYS ago and still held, oldest money used first. */
  maturedCents: number;
  /** When the oldest money still held was paid, and when the next part that is not matured yet matures. */
  firstPaid: string | null;
  nextMatures: string | null;
}

/**
 * A customer's deposits not on a job order as of `today`: what is held, and how much of it is matured. Oldest money goes
 * first: what was moved, refunded or forfeited out of it is taken from the oldest payments. A cancelled document counts
 * neither way (its journal and its mirror are both left out).
 */
export function unappliedDeposits(db: Db, customerId: string, today: string): UnappliedDeposits {
  const account = resolveAccount(db, { role: 'CUSTOMER_DEPOSITS' }).id;
  const lines = db.prepare(`SELECT j.business_date AS date, l.credit_cents AS inCents, l.debit_cents AS outCents FROM journal_lines l
      JOIN journals j ON j.id = l.journal_id LEFT JOIN documents d ON d.id = j.source_id
      WHERE l.account_id = ? AND l.party_type = 'customer' AND l.party_id = ? AND l.ref_doc_id IS NULL AND j.sealed = 1
        AND (d.id IS NULL OR d.status = 'posted') ORDER BY j.business_date, j.id`).all(account, customerId) as { date: string; inCents: number; outCents: number }[];
  let out = lines.reduce((n, l) => n + l.outCents, 0);
  const lots: { date: string; cents: number }[] = [];
  for (const l of lines) {
    if (l.inCents <= 0) continue;
    const used = Math.min(out, l.inCents);
    out -= used;
    if (l.inCents - used > 0) lots.push({ date: l.date, cents: l.inCents - used });
  }
  const cutoff = addDays(today, -DEPOSIT_MATURES_DAYS);
  const young = lots.find((l) => l.date > cutoff);
  return {
    heldCents: lots.reduce((n, l) => n + l.cents, 0),
    maturedCents: lots.filter((l) => l.date <= cutoff).reduce((n, l) => n + l.cents, 0),
    firstPaid: lots[0]?.date ?? null,
    nextMatures: young ? addDays(young.date, DEPOSIT_MATURES_DAYS) : null,
  };
}

/** Every customer with deposits not on a job order, as of `today`, oldest payment first. */
export function customersWithUnappliedDeposits(db: Db, today: string): (UnappliedDeposits & { customerId: string })[] {
  const account = resolveAccount(db, { role: 'CUSTOMER_DEPOSITS' }).id;
  const ids = db.prepare(`SELECT l.party_id FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      WHERE l.account_id = ? AND l.party_type = 'customer' AND l.ref_doc_id IS NULL AND j.sealed = 1
      GROUP BY l.party_id HAVING SUM(l.credit_cents - l.debit_cents) <> 0`).pluck().all(account) as string[];
  return ids.map((customerId) => ({ customerId, ...unappliedDeposits(db, customerId, today) }))
    .filter((c) => c.heldCents > 0).sort((a, b) => (a.firstPaid ?? '').localeCompare(b.firstPaid ?? ''));
}
