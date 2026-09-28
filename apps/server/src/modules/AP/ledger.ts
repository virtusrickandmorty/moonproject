/** Payables read from the ledger (NR-2): what is owed on a bill, and AP by supplier (PLAN E9). */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { supplier } from '../PUR/public.ts';

const apAccount = (db: Db) => resolveAccount(db, { role: 'AP' }).id;

/** What is still owed on a bill: its 2101 credit less the payments applied to it (zero once cancelled). */
export const owedOnBill = (db: Db, billId: string): number => -accountBalance(db, apAccount(db), { refDocId: billId });

export interface BillRow {
  id: string; number: string; status: string; date: string; supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string; dueDate: string;
  grossCents: number; ewtCents: number; payableCents: number;
}
const BILLS = `SELECT d.id, d.number, d.status, d.business_date AS date, b.supplier_id AS supplierId, b.supplier_invoice_no AS supplierInvoiceNo,
  b.supplier_invoice_date AS supplierInvoiceDate, b.due_date AS dueDate, b.gross_cents AS grossCents, b.ewt_cents AS ewtCents, b.payable_cents AS payableCents
  FROM ap_bills b JOIN documents d ON d.id = b.document_id`;

export const bill = (db: Db, id: string): BillRow | undefined => db.prepare(`${BILLS} WHERE d.id = ?`).get(id) as BillRow | undefined;

/** Posted payments that apply to a bill (it cancels only after them). */
export const paymentsOnBill = (db: Db, billId: string) =>
  db
    .prepare(`SELECT DISTINCT d.id, d.number FROM ap_payment_bills p JOIN documents d ON d.id = p.document_id WHERE p.bill_id = ? AND d.status = 'posted' ORDER BY d.number`)
    .all(billId) as { id: string; number: string }[];

/** Every supplier with something owed in 2101, and the amount. */
export function supplierBalances(db: Db) {
  const rows = db
    .prepare(
      `SELECT l.party_id AS supplierId, SUM(l.credit_cents - l.debit_cents) AS balanceCents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND j.sealed = 1 GROUP BY l.party_id HAVING balanceCents <> 0 ORDER BY l.party_id`,
    )
    .all(apAccount(db)) as { supplierId: string; balanceCents: number }[];
  return rows.map((r) => ({ ...r, supplierName: supplier(db, r.supplierId)?.name ?? '?' }));
}

/**
 * AP of one supplier: its bills (with what is still owed on each), its payments, and the balance of 2101. The balance
 * also counts what is owed on account from other documents (an FA- purchase), so it may exceed the bills' total.
 */
export function supplierLedger(db: Db, supplierId: string) {
  const sup = supplier(db, supplierId);
  if (!sup) return undefined;
  const bills = (db.prepare(`${BILLS} WHERE b.supplier_id = ? ORDER BY d.number`).all(supplierId) as BillRow[]).map((b) => {
    const owedCents = b.status === 'posted' ? owedOnBill(db, b.id) : 0;
    return { ...b, owedCents, paidCents: b.status === 'posted' ? b.payableCents - owedCents : 0 };
  });
  const applied = db.prepare(`SELECT p.bill_id AS billId, d.number AS billNumber, p.amount_cents AS amountCents FROM ap_payment_bills p JOIN documents d ON d.id = p.bill_id WHERE p.document_id = ? ORDER BY p.line_no`);
  const payments = (
    db
      .prepare(`SELECT d.id, d.number, d.status, d.business_date AS date, d.total_cents AS totalCents, p.fee_cents AS feeCents FROM ap_payments p JOIN documents d ON d.id = p.document_id WHERE p.supplier_id = ? ORDER BY d.number`)
      .all(supplierId) as { id: string }[]
  ).map((p) => ({ ...p, bills: applied.all(p.id) }));
  const balanceCents = -accountBalance(db, apAccount(db), { party: { type: 'supplier', id: supplierId } });
  return { supplierId, supplierName: sup.name, bills, payments, balanceCents };
}
