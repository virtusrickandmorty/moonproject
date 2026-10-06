/** Read-only QS contract for other modules (COL, JO, DASH, RPT). Callers check their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

export interface SaleRef { id: string; number: string; status: 'posted' | 'cancelled'; customerId: string; customerName: string; invoiceNumber: string; businessDate: string; totalCents: number }

const SALE = `SELECT d.id, d.number, d.status, s.customer_id AS customerId, s.customer_name AS customerName, s.invoice_number AS invoiceNumber,
  d.business_date AS businessDate, d.total_cents AS totalCents FROM qs_sales s JOIN documents d ON d.id = s.document_id`;

/** One quick sale's header, for documents that point at it (COL: a collection paying it). */
export function saleRef(db: Db, id: string): SaleRef | undefined {
  return db.prepare(`${SALE} WHERE s.document_id = ?`).get(id) as SaleRef | undefined;
}

/** The quick sale that used a booklet invoice number, cancelled ones included ("0501" and "501" are the same paper). */
export function saleByInvoiceNumber(db: Db, invoiceNumber: string): { number: string; status: string } | undefined {
  return db.prepare(`${SALE} WHERE CAST(s.invoice_number AS INTEGER) = CAST(? AS INTEGER)`).get(invoiceNumber) as SaleRef | undefined;
}

/** Booklet invoice numbers quick sales used between two numbers, cancelled ones included (TAX's booklet usage report). */
export function saleInvoiceNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  return db
    .prepare(`SELECT CAST(s.invoice_number AS INTEGER) AS n, d.number, d.status FROM qs_sales s JOIN documents d ON d.id = s.document_id
              WHERE CAST(s.invoice_number AS INTEGER) BETWEEN ? AND ?`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
}

/** What is still owed on a quick sale: its receivable, from the journal lines that name the sale (NR-2). */
export function saleOpenCents(db: Db, id: string): number {
  return accountBalance(db, resolveAccount(db, { role: 'AR_TRADE' }).id, { refDocId: id });
}

/** A customer's recorded quick sales with money still owed, oldest first (the collection form's open items). */
export function openSalesOf(db: Db, customerId: string): (SaleRef & { openCents: number })[] {
  return (db.prepare(`${SALE} WHERE s.customer_id = ? AND d.status = 'posted' ORDER BY d.number`).all(customerId) as SaleRef[])
    .map((s) => ({ ...s, openCents: saleOpenCents(db, s.id) }))
    .filter((s) => s.openCents > 0);
}

/** A quick sale as an invoice other documents credit (COL credit memos, write-offs, 2307s received): its VAT and rate. */
export interface SaleInvoice extends SaleRef { vatCents: number; vatRateBp: number }
const SALE_INVOICE = `SELECT d.id, d.number, d.status, s.customer_id AS customerId, s.customer_name AS customerName, s.invoice_number AS invoiceNumber,
  d.business_date AS businessDate, d.total_cents AS totalCents, s.vat_cents AS vatCents, s.vat_rate_bp AS vatRateBp FROM qs_sales s JOIN documents d ON d.id = s.document_id`;

export function saleInvoice(db: Db, id: string): SaleInvoice | undefined {
  return db.prepare(`${SALE_INVOICE} WHERE s.document_id = ?`).get(id) as SaleInvoice | undefined;
}

/** A customer's recorded (not cancelled) quick sales, or everyone's, oldest first. */
export function saleInvoicesOf(db: Db, customerId?: string): SaleInvoice[] {
  return db.prepare(`${SALE_INVOICE} WHERE (@c IS NULL OR s.customer_id = @c) AND d.status = 'posted' ORDER BY d.business_date, d.number`).all({ c: customerId ?? null }) as SaleInvoice[];
}

/** Sold quick-sale lines for read-only sales analysis. */
export function quickSaleLines(db: Db) {
  return db.prepare(`SELECT s.document_id AS id, s.customer_id AS customerId, s.customer_name AS customerName,
    l.line_no AS lineNo, l.description, l.kind, l.qty, l.amount_cents AS grossCents
    FROM qs_sales s JOIN qs_sale_lines l ON l.document_id = s.document_id
    ORDER BY s.document_id, l.line_no`).all() as { id: string; customerId: string; customerName: string;
      lineNo: number; description: string; kind: string; qty: number; grossCents: number }[];
}

/** Pieces of website shop items on recorded (not cancelled) quick sales, per product, size and colour: they are off the shelf. */
export function soldShopPieces(db: Db, productIds?: readonly string[]): { productId: string; size: string; colour: string; qty: number }[] {
  return db.prepare(`SELECT l.product_id AS productId, l.size, l.colour, SUM(l.qty) AS qty FROM qs_sale_lines l JOIN documents d ON d.id = l.document_id
    WHERE l.product_id IS NOT NULL AND d.status = 'posted' AND (@all OR l.product_id IN (SELECT value FROM json_each(@ids)))
    GROUP BY l.product_id, l.size, l.colour`).all({ all: productIds ? 0 : 1, ids: JSON.stringify(productIds ?? []) }) as { productId: string; size: string; colour: string; qty: number }[];
}

/**
 * Records a quick sale and its payment together, in the caller's transaction (the website shop's confirmed online orders).
 * Handed over by QS's index.ts when the modules load, so this contract does not import the doc type (COL and SHP read it).
 */
type RecordQuickSale = typeof import('./record.ts').recordQuickSale;
let recordImpl: RecordQuickSale | undefined;
export const provideRecordQuickSale = (fn: RecordQuickSale) => { recordImpl = fn; };
export const recordQuickSale: RecordQuickSale = (...args) => {
  if (!recordImpl) throw new Error('The QS module is not loaded');
  return recordImpl(...args);
};

/** Cancels a recorded quick sale and its payment in the caller's transaction (SHP: a confirmed online order cancelled or returned). Provided like recordQuickSale. */
type CancelQuickSale = typeof import('./record.ts').cancelQuickSale;
let cancelImpl: CancelQuickSale | undefined;
export const provideCancelQuickSale = (fn: CancelQuickSale) => { cancelImpl = fn; };
export const cancelQuickSale: CancelQuickSale = (...args) => {
  if (!cancelImpl) throw new Error('The QS module is not loaded');
  return cancelImpl(...args);
};
