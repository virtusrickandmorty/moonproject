/** Payables read from the ledger (NR-2): what is owed on a bill, what is open on a supplier advance, and AP by supplier (PLAN E9). */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { supplier } from '../PUR/public.ts';

const apAccount = (db: Db) => resolveAccount(db, { role: 'AP' }).id;
const advanceAccount = (db: Db) => resolveAccount(db, { role: 'SUPPLIER_ADVANCES' }).id;

/** What is still owed on a bill: its 2101 credit less the payments applied to it (zero once cancelled). */
export const owedOnBill = (db: Db, billId: string): number => -accountBalance(db, apAccount(db), { refDocId: billId });

/** What is still open on a supplier advance: its 1230 debit less what bills applied and returns took back (zero once cancelled). */
export const openOnAdvance = (db: Db, advanceId: string): number => accountBalance(db, advanceAccount(db), { refDocId: advanceId });

/** A supplier advance (SADV-, ap.advance) as recorded: the whole advance, the EWT withheld on it and the cash paid. */
export interface AdvanceRow {
  id: string; number: string; status: string; date: string; supplierId: string; purchaseOrderId: string | null;
  amountCents: number; ewtBaseCents: number; ewtCents: number; cashCents: number;
}
const ADVANCES = `SELECT d.id, d.number, d.status, d.business_date AS date, a.supplier_id AS supplierId, a.purchase_order_id AS purchaseOrderId,
  a.amount_cents AS amountCents, a.ewt_base_cents AS ewtBaseCents, a.ewt_cents AS ewtCents, a.cash_cents AS cashCents
  FROM ap_advances a JOIN documents d ON d.id = a.document_id`;

export const advance = (db: Db, id: string): AdvanceRow | undefined => db.prepare(`${ADVANCES} WHERE d.id = ?`).get(id) as AdvanceRow | undefined;

/** A supplier's recorded advances with something still open, oldest first: the order a bill takes them in. */
export function openAdvances(db: Db, supplierId: string): (AdvanceRow & { openCents: number })[] {
  return (db.prepare(`${ADVANCES} WHERE a.supplier_id = ? AND d.status = 'posted' ORDER BY d.number`).all(supplierId) as AdvanceRow[])
    .map((a) => ({ ...a, openCents: openOnAdvance(db, a.id) }))
    .filter((a) => a.openCents > 0);
}

/** Posted bills that apply an advance and posted returns of it (the advance cancels only after them, PLAN D6). */
export const usesOfAdvance = (db: Db, advanceId: string) =>
  db
    .prepare(
      `SELECT DISTINCT d.id, d.number FROM (SELECT document_id FROM ap_bill_advances WHERE advance_id = ? UNION SELECT document_id FROM ap_advance_returns WHERE advance_id = ?) u
       JOIN documents d ON d.id = u.document_id WHERE d.status = 'posted' ORDER BY d.number`,
    )
    .all(advanceId, advanceId) as { id: string; number: string }[];

/** A recorded bill: a BILL- (ap.bill), or an OBAP- (ap.opening) open on the cut-over date, whose figures are what was still owed then. */
export interface BillRow {
  id: string; docType: 'ap.bill' | 'ap.opening'; number: string; status: string; date: string; supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string; dueDate: string;
  grossCents: number; ewtCents: number; payableCents: number;
}
const BILLS = `SELECT d.id, d.doc_type AS docType, d.number, d.status, d.business_date AS date, b.supplier_id AS supplierId, b.supplier_invoice_no AS supplierInvoiceNo,
  b.supplier_invoice_date AS supplierInvoiceDate, b.due_date AS dueDate, b.gross_cents AS grossCents, b.ewt_cents AS ewtCents, b.payable_cents AS payableCents
  FROM ap_bills b JOIN documents d ON d.id = b.document_id`;

export const bill = (db: Db, id: string): BillRow | undefined => db.prepare(`${BILLS} WHERE d.id = ?`).get(id) as BillRow | undefined;

/** Posted payments that apply to a bill (it cancels only after them). */
export const paymentsOnBill = (db: Db, billId: string) =>
  db
    .prepare(`SELECT DISTINCT d.id, d.number FROM ap_payment_bills p JOIN documents d ON d.id = p.document_id WHERE p.bill_id = ? AND d.status = 'posted' ORDER BY d.number`)
    .all(billId) as { id: string; number: string }[];

/** Net per supplier on an account with a supplier party (credit-positive on 2101, debit-positive on 1230). */
function bySupplier(db: Db, accountId: number, sign: 1 | -1): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT l.party_id AS supplierId, SUM(l.debit_cents - l.credit_cents) AS cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND j.sealed = 1 GROUP BY l.party_id HAVING cents <> 0`,
    )
    .all(accountId) as { supplierId: string; cents: number }[];
  return new Map(rows.map((r) => [r.supplierId, sign * r.cents]));
}

/**
 * Every supplier with something owed in 2101 or an advance still open in 1230: what is owed, the advances not yet
 * applied or returned, and the two netted (what would be left to pay if the advances went on the bills).
 */
export function supplierBalances(db: Db) {
  const owed = bySupplier(db, apAccount(db), -1);
  const advances = bySupplier(db, advanceAccount(db), 1);
  return [...new Set([...owed.keys(), ...advances.keys()])].sort().map((supplierId) => {
    const balanceCents = owed.get(supplierId) ?? 0;
    const advancesCents = advances.get(supplierId) ?? 0;
    return { supplierId, supplierName: supplier(db, supplierId)?.name ?? '?', balanceCents, advancesCents, netCents: balanceCents - advancesCents };
  });
}

/**
 * AP of one supplier: its bills (with the advances applied on each and what is still owed), its payments, its advances
 * (with what is still open on each), the balance of 2101 and the advances open in 1230. The 2101 balance also counts
 * what is owed on account from other documents (an FA- purchase), so it may exceed the bills' total.
 */
export function supplierLedger(db: Db, supplierId: string) {
  const sup = supplier(db, supplierId);
  if (!sup) return undefined;
  const advancesOnBill = db.prepare(
    `SELECT x.advance_id AS advanceId, d.number AS advanceNumber, x.amount_cents AS amountCents FROM ap_bill_advances x JOIN documents d ON d.id = x.advance_id WHERE x.document_id = ? ORDER BY x.line_no`,
  );
  const bills = (db.prepare(`${BILLS} WHERE b.supplier_id = ? ORDER BY d.number`).all(supplierId) as BillRow[]).map((b) => {
    const posted = b.status === 'posted';
    const advances = advancesOnBill.all(b.id) as { advanceId: string; advanceNumber: string; amountCents: number }[];
    const advanceCents = posted ? advances.reduce((s, a) => s + a.amountCents, 0) : 0;
    const owedCents = posted ? owedOnBill(db, b.id) : 0;
    return { ...b, advances, advanceCents, owedCents, paidCents: posted ? b.payableCents - advanceCents - owedCents : 0 };
  });
  const applied = db.prepare(`SELECT p.bill_id AS billId, d.number AS billNumber, p.amount_cents AS amountCents FROM ap_payment_bills p JOIN documents d ON d.id = p.bill_id WHERE p.document_id = ? ORDER BY p.line_no`);
  const payments = (
    db
      .prepare(`SELECT d.id, d.number, d.status, d.business_date AS date, d.total_cents AS totalCents, p.fee_cents AS feeCents FROM ap_payments p JOIN documents d ON d.id = p.document_id WHERE p.supplier_id = ? ORDER BY d.number`)
      .all(supplierId) as { id: string }[]
  ).map((p) => ({ ...p, bills: applied.all(p.id) }));
  const onBills = db.prepare(
    `SELECT x.document_id AS billId, d.number AS billNumber, x.amount_cents AS amountCents FROM ap_bill_advances x JOIN documents d ON d.id = x.document_id WHERE x.advance_id = ? AND d.status = 'posted' ORDER BY d.number`,
  );
  const returns = db.prepare(
    `SELECT d.id, d.number, d.total_cents AS amountCents FROM ap_advance_returns r JOIN documents d ON d.id = r.document_id WHERE r.advance_id = ? AND d.status = 'posted' ORDER BY d.number`,
  );
  const poNumber = db.prepare('SELECT number FROM documents WHERE id = ?').pluck();
  const advances = (db.prepare(`${ADVANCES} WHERE a.supplier_id = ? ORDER BY d.number`).all(supplierId) as AdvanceRow[]).map((a) => {
    const bills = onBills.all(a.id) as { billId: string; billNumber: string; amountCents: number }[];
    const returned = returns.all(a.id) as { id: string; number: string; amountCents: number }[];
    return {
      ...a, purchaseOrderNumber: a.purchaseOrderId ? ((poNumber.get(a.purchaseOrderId) as string | undefined) ?? '?') : null,
      bills, returns: returned,
      appliedCents: bills.reduce((s, x) => s + x.amountCents, 0), returnedCents: returned.reduce((s, x) => s + x.amountCents, 0),
      openCents: a.status === 'posted' ? openOnAdvance(db, a.id) : 0,
    };
  });
  const party = { type: 'supplier', id: supplierId };
  const balanceCents = -accountBalance(db, apAccount(db), { party });
  const advancesCents = accountBalance(db, advanceAccount(db), { party });
  return { supplierId, supplierName: sup.name, bills, payments, advances, balanceCents, advancesCents };
}
