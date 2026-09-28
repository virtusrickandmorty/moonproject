/**
 * What COL's credits without cash share (PLAN D5 CWT-ONLY, CM-ALLOW, BAD-DEBT): the recorded invoice they are on, and
 * what it still owes. An invoice is a release's invoice record (JO) or a quick sale (QS); both are in the IR- series.
 * A quick sale's receivable names the sale itself. A release invoice's receivable names its job order (NR-2): collections
 * pay the job order, not an invoice, so what each invoice owes is the job order's receivable shared out the way the AR
 * aging does it (RPT receivables.ts): newest invoice first, each up to its gross less the deposits it applied and what
 * was credited on it, so the oldest invoice counts as paid first. Whatever cannot be shared out stays on the job order.
 */
import type { Db } from '../../platform/db/driver.ts';
import { invoiceRecordRef, invoiceRecordsOf, joLedger, type InvoiceRecordRef } from '../JO/public.ts';
import { saleInvoice, saleInvoicesOf, saleOpenCents, type SaleInvoice } from '../QS/public.ts';

export type InvoiceKind = 'jo.invoice_record' | 'qs.sale';
export interface Invoice {
  id: string; kind: InvoiceKind; number: string; status: 'posted' | 'cancelled'; businessDate: string; invoiceNumber: string;
  customerId: string; customerName: string; grossCents: number; vatCents: number; vatRateBp: number;
  /** The document the receivable lines name: the job order, or the quick sale itself. */
  arRefId: string;
  jobOrderId: string | null; jobOrderNumber: string | null;
}

const fromRecord = (r: InvoiceRecordRef): Invoice => ({
  id: r.id, kind: 'jo.invoice_record', number: r.number, status: r.status, businessDate: r.businessDate, invoiceNumber: r.invoiceNumber,
  customerId: r.customerId, customerName: r.customerName, grossCents: r.grossCents, vatCents: r.vatCents, vatRateBp: r.vatRateBp,
  arRefId: r.jobOrderId, jobOrderId: r.jobOrderId, jobOrderNumber: r.jobOrderNumber,
});
const fromSale = (s: SaleInvoice): Invoice => ({
  id: s.id, kind: 'qs.sale', number: s.number, status: s.status, businessDate: s.businessDate, invoiceNumber: s.invoiceNumber,
  customerId: s.customerId, customerName: s.customerName, grossCents: s.totalCents, vatCents: s.vatCents, vatRateBp: s.vatRateBp,
  arRefId: s.id, jobOrderId: null, jobOrderNumber: null,
});

export function invoiceOf(db: Db, id: string): Invoice | undefined {
  const r = invoiceRecordRef(db, id);
  if (r) return fromRecord(r);
  const s = saleInvoice(db, id);
  return s && fromSale(s);
}

/** A customer's recorded (not cancelled) invoices, or everyone's: release invoices, then quick sales, each oldest first. */
export function invoicesOf(db: Db, customerId?: string): Invoice[] {
  return [...invoiceRecordsOf(db, customerId ? { customerId } : 'all').map(fromRecord), ...saleInvoicesOf(db, customerId).map(fromSale)];
}

/**
 * Each credit on an invoice, with the part that reduced its receivable: the receivable part of a credit memo, a write-off,
 * a 2307 received with no cash. `live` is the SQL for "counts": recorded now, or recorded by a date and not cancelled then.
 */
const CREDITS = `SELECT m.invoice_id, m.ar_ref_id, m.document_id, 'col.credit_memo' AS kind, m.ar_cents AS cents FROM col_credit_memos m
  UNION ALL SELECT w.invoice_id, w.ar_ref_id, w.document_id, 'col.write_off', d.total_cents FROM col_write_offs w JOIN documents d ON d.id = w.document_id
  UNION ALL SELECT c.invoice_id, c.ar_ref_id, c.document_id, 'col.cwt_only', c.cwt_cents FROM col_cwt_only c`;
const POSTED = `d.status = 'posted'`;
const liveAt = `d.business_date <= @asOf AND (d.cancelled_at IS NULL OR date(d.cancelled_at, '+8 hours') > @asOf)`;

/** Recorded credits on an invoice (they block cancelling it: D6, cancel them first). */
export function creditsOn(db: Db, invoiceId: string): { id: string; number: string }[] {
  return db
    .prepare(`SELECT d.id, d.number FROM (${CREDITS}) x JOIN documents d ON d.id = x.document_id WHERE x.invoice_id = ? AND ${POSTED} ORDER BY d.number`)
    .all(invoiceId) as { id: string; number: string }[];
}

/** What credits took off each invoice's receivable, counting documents recorded by asOf and not cancelled then (the aging's date). */
export function invoiceCreditsAt(db: Db, asOf: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT x.invoice_id AS id, SUM(x.cents) AS cents FROM (${CREDITS}) x JOIN documents d ON d.id = x.document_id WHERE ${liveAt} GROUP BY x.invoice_id`)
    .all({ asOf }) as { id: string; cents: number }[];
  return new Map(rows.map((r) => [r.id, r.cents]));
}

function creditedNow(db: Db, invoiceId: string): number {
  return db.prepare(`SELECT COALESCE(SUM(x.cents), 0) FROM (${CREDITS}) x JOIN documents d ON d.id = x.document_id WHERE x.invoice_id = ? AND ${POSTED}`).pluck().get(invoiceId) as number;
}

/** Recorded credit memos on an invoice: their amounts and output VAT so far. */
export function memosOn(db: Db, invoiceId: string): { amountCents: number; vatCents: number } {
  return db
    .prepare(`SELECT COALESCE(SUM(d.total_cents), 0) AS amountCents, COALESCE(SUM(m.vat_cents), 0) AS vatCents FROM col_credit_memos m JOIN documents d ON d.id = m.document_id
              WHERE m.invoice_id = ? AND ${POSTED}`)
    .get(invoiceId) as { amountCents: number; vatCents: number };
}

/** The recorded write-offs of invoices whose receivable names this document (a job order or a quick sale). */
export function writeOffsOn(db: Db, arRefId: string): { id: string; number: string; invoiceId: string }[] {
  return db
    .prepare(`SELECT d.id, d.number, w.invoice_id AS invoiceId FROM col_write_offs w JOIN documents d ON d.id = w.document_id WHERE w.ar_ref_id = ? AND ${POSTED} ORDER BY d.number`)
    .all(arRefId) as { id: string; number: string; invoiceId: string }[];
}

/** What an invoice still owes now: never below zero, never above its gross. */
export function owedCents(db: Db, invoice: Invoice): number {
  if (invoice.status !== 'posted') return 0;
  if (invoice.kind === 'qs.sale') return Math.max(0, saleOpenCents(db, invoice.id));
  let remaining = joLedger(db, invoice.arRefId).receivableCents;
  for (const r of invoiceRecordsOf(db, { jobOrderId: invoice.arRefId }).reverse()) {
    const cap = Math.max(0, r.grossCents - r.depositAppliedCents - creditedNow(db, r.id));
    const share = Math.max(0, Math.min(remaining, cap));
    if (r.id === invoice.id) return share;
    remaining -= share;
  }
  return 0;
}

/** The invoice's words in summaries and messages: "invoice no. 0501 (IR-000001, JO-000001)". */
export const invoiceWords = (i: Pick<Invoice, 'invoiceNumber' | 'number' | 'jobOrderNumber'>) =>
  `invoice no. ${i.invoiceNumber} (${i.number}${i.jobOrderNumber ? `, ${i.jobOrderNumber}` : ''})`;

/** Every recorded invoice with what it owes now (the arbitraries of COL's credit documents). */
export function allInvoices(db: Db): (Invoice & { owedCents: number })[] {
  return invoicesOf(db).map((i) => ({ ...i, owedCents: owedCents(db, i) }));
}
