/** An expense voucher's tenders: the cash places it was paid from (one to four), read and written like COL's (COL ledger.ts). */
import { z } from 'zod';
import type { Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { getCashPlace } from '../../engine/ledger/accounts.ts';

export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
export const MAX_TENDERS = 4;

/** One cash place and the amount that left it. */
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

/** Each tender's cash place must be an active one (the rule the single cash place had, now per tender). */
export function cashPlaceIssues(db: Db, tenders: readonly Tender[]): Issue[] {
  return tenders
    .filter((t) => !getCashPlace(db, t.cashPlaceId)?.isActive)
    .map((t) => ({ field: `tenders.${t.lineNo - 1}.cashPlaceId`, code: 'CASH_PLACE', level: 'error' as const, message: 'Pick where the money came from.' }));
}

export function insertTenders(db: Db, documentId: string, tenders: readonly Tender[]): void {
  const ins = db.prepare('INSERT INTO exp_voucher_tenders (document_id, line_no, account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)');
  for (const t of tenders) ins.run(documentId, t.lineNo, t.cashPlaceId, t.amountCents, t.reference ?? null);
}

export function loadTenders(db: Db, documentId: string): Tender[] {
  const rows = db
    .prepare('SELECT line_no, account_id, amount_cents, reference FROM exp_voucher_tenders WHERE document_id = ? ORDER BY line_no')
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
