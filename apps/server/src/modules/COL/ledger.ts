/** What collections and refunds share: tender lines, and customer deposits read from the ledger (NR-2). */
import { z } from 'zod';
import type { Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { getCashPlace, resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

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

export function withNames(db: Db, tenders: readonly TenderInput[]): Tender[] {
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
 * the customer's unapplied payments (lines with no document reference).
 */
export function depositsHeld(db: Db, customerId: string, jobOrderId: string | null): number {
  const account = resolveAccount(db, { role: 'CUSTOMER_DEPOSITS' }).id;
  if (jobOrderId) return 0 - accountBalance(db, account, { party: { type: 'customer', id: customerId }, refDocId: jobOrderId });
  // accountBalance has no "no reference" filter, so unapplied payments are read here (engine tables may be read directly).
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS held FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND l.party_type = 'customer' AND l.party_id = ? AND l.ref_doc_id IS NULL AND j.sealed = 1`,
    )
    .get(account, customerId) as { held: number };
  return r.held;
}
