/**
 * Downpayment invoice (PLAN D5 INV-DP, D3 "Downpayment VAT modes" mode C, ACC-02): in mode C the downpayment is invoiced
 * when it is received, on a manual BIR invoice from the same booklet as the release invoices (IR- series, D7).
 *   Dr 1201 AR (the downpayment, G_dp) / Cr 2201 customer deposits (NET_dp) ; Cr 2301 output VAT (VAT_dp)
 *   Dr 2201 / Cr 1201: money already held for the job order (a collection taken before the invoice), up to G_dp
 * The collection then pays the receivable (COL-RCV), and the release invoice takes NET_dp out of 2201 into sales and
 * books only the VAT not yet booked (invoice-record.ts). VAT at the rate in force on the invoice date (D4.1).
 * Only on a job order in mode C: the setting on the invoice date, or the mode its first downpayment fixed (COL
 * doctypes/deposit-vat.ts); a job order that started in mode A or B takes no downpayment invoice. At most what is not yet
 * invoiced of the job order. Its amounts are kept in col_deposit_vat (the downpayment held, NET_dp in 2201).
 * Cancel: the mirror, then settleJobOrder (D6): a downpayment already paid becomes money held for the job order again,
 * Dr 1201 / Cr 2201. Refused while a release invoice or a forfeit took it out of 2201: cancel that first.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { MODE_WORDS, depositModeOn, dpHeld, dpTakenBy, lockedMode, modeKeptIssue, recordDepositVat, settleJobOrder, vatRow } from '../../COL/public.ts';
import { bookletIssue } from '../../TAX/public.ts';
import { invoiceNumberUsedBy, invoicedCents, isAbandoned, jobOrderRef, jobOrdersOf, joLedger } from '../public.ts';
import { MAX_CENTS } from './job-order.ts';

export const dpInvoiceInput = z
  .object({
    jobOrderId: z.uuid(),
    // Typed from the booklet, never prefilled; checked against the ATP booklet register (TAX, D7).
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
    amountCents: z.number().int().positive().max(MAX_CENTS), // the downpayment, VAT-inclusive
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type DpInvoiceInput = z.infer<typeof dpInvoiceInput>;

export interface DpInvoice extends DpInvoiceInput {
  jobOrderNumber: string;
  customerId: string;
  customerName: string;
  vatRateBp: number;
  vatCents: number;
  vatableSalesCents: number;
  /** Money already held for the job order, applied to this invoice. */
  depositAppliedCents: number;
  /** The job order's downpayment VAT mode on the invoice date: only C takes a downpayment invoice. */
  mode: 'A' | 'B' | 'C';
  totalCents: number;
}

/** The downpayment invoice that used a booklet number, cancelled ones included (invoice numbers are shared, D7). */
export function dpInvoiceUsedBy(db: Db, invoiceNumber: string): { number: string; status: string } | undefined {
  return db
    .prepare(`SELECT d.number, d.status FROM jo_dp_invoices i JOIN documents d ON d.id = i.document_id WHERE CAST(i.invoice_number AS INTEGER) = CAST(? AS INTEGER)`)
    .get(invoiceNumber) as { number: string; status: string } | undefined;
}

export function dpInvoiceNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  return db
    .prepare(`SELECT CAST(i.invoice_number AS INTEGER) AS n, d.number, d.status FROM jo_dp_invoices i JOIN documents d ON d.id = i.document_id
              WHERE CAST(i.invoice_number AS INTEGER) BETWEEN ? AND ?`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
}

export const dpInvoiceDoc: DocTypeDef<DpInvoiceInput, DpInvoice> = {
  key: 'jo.dp_invoice',
  module: 'JO',
  title: 'Invoice Record',
  // The IR- series of every invoice record (invoice-record.ts INVOICE_SERIES), written out here so the two doc types
  // do not import each other.
  numbering: { series: { key: 'IR', prefix: 'IR-' } },
  permissions: { view: 'jo.view', create: 'jo.invoice', post: 'jo.invoice', cancel: 'jo.invoice_cancel' },
  dating: 'system',
  inputSchema: dpInvoiceInput,
  externalNumber: (doc) => doc.invoiceNumber,

  compute(input, ctx) {
    const jo = jobOrderRef(ctx.db, input.jobOrderId);
    const vatRateBp = settingAt(ctx.db, 'tax.vat_rate_bp', ctx.businessDate);
    const { vatCents, netCents } = vatFromGross(input.amountCents, vatRateBp);
    return {
      ...input,
      jobOrderNumber: jo?.number ?? '?',
      customerId: jo?.customerId ?? '',
      customerName: jo?.customerName ?? '?',
      vatRateBp,
      vatCents,
      vatableSalesCents: netCents,
      depositAppliedCents: jo ? Math.max(0, Math.min(joLedger(ctx.db, jo.id).depositsHeldCents, input.amountCents)) : 0,
      mode: jo ? depositModeOn(ctx.db, jo.id, ctx.businessDate).mode : settingAt(ctx.db, 'sales.deposit_vat_mode', ctx.businessDate),
      totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const jo = jobOrderRef(ctx.db, doc.jobOrderId);
    if (!jo) return [{ field: 'jobOrderId', code: 'JOB_ORDER', level: 'error', message: 'Pick the job order the downpayment is for.' }];
    if (jo.status !== 'posted') return [{ field: 'jobOrderId', code: 'JO_CANCELLED', level: 'error', message: `${jo.number} is cancelled, so nothing is invoiced on it.` }];
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (isAbandoned(ctx.db, jo.id)) error('jobOrderId', 'JO_ABANDONED', `${jo.number} was abandoned and its deposit forfeited, so nothing more is invoiced on it.`);
    const m = depositModeOn(ctx.db, jo.id, ctx.businessDate);
    if (m.mode !== 'C') {
      error('jobOrderId', 'DEPOSIT_VAT_MODE', m.lockedBy
        ? `${jo.number} took its first downpayment on ${m.lockedBy} in mode ${m.mode} (${MODE_WORDS[m.mode]}), and a job order never mixes modes: its downpayments are not invoiced. Record the collection only.`
        : `Downpayments are invoiced only in downpayment VAT mode C (invoice on downpayment). Mode ${m.mode} (${MODE_WORDS[m.mode]}) is in force: record the collection only.`);
    } else {
      const kept = modeKeptIssue(m, jo.number, 'jobOrderId');
      if (kept) issues.push(kept);
    }
    // What the job order has not had invoiced yet, by release invoices and downpayment invoices.
    const notInvoicedCents = jo.totalCents - invoicedCents(ctx.db, jo.id);
    if (doc.amountCents > notInvoicedCents) {
      error('amountCents', 'OVER_ORDER', notInvoicedCents > 0 ? `${jo.number} has ${formatPeso(notInvoicedCents)} not yet invoiced. Invoice at most that.` : `${jo.number} is fully invoiced.`);
    }
    const used = invoiceNumberUsedBy(ctx.db, doc.invoiceNumber);
    if (used) {
      const how = used.status === 'cancelled' ? ' (cancelled)' : '';
      error('invoiceNumber', 'INVOICE_USED', `Invoice no. ${doc.invoiceNumber} is already used on ${used.number}${how}. Each invoice number is used once: write this downpayment on a new invoice and keep all copies of a spoiled one.`);
    }
    const booklet = bookletIssue(ctx.db, 'SALES_INVOICE', doc.invoiceNumber, 'invoiceNumber');
    if (booklet) issues.push(booklet);
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO jo_dp_invoices (document_id, job_order_id, customer_id, customer_name, invoice_number, vat_rate_bp, gross_cents, vat_cents, deposit_applied_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.jobOrderId, doc.customerId, doc.customerName, doc.invoiceNumber, doc.vatRateBp, doc.amountCents, doc.vatCents, doc.depositAppliedCents, doc.note ?? null);
    recordDepositVat(db, h.documentId, 'original', [
      vatRow({
        jobOrderId: doc.jobOrderId, customerId: doc.customerId, mode: 'C', depositCents: -doc.depositAppliedCents,
        dpInvoicedCents: doc.amountCents, dpVatCents: doc.vatCents, registerBaseCents: doc.vatableSalesCents,
      }),
    ]);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    const ref = { documentId: doc.jobOrderId };
    const on = `Downpayment invoice no. ${doc.invoiceNumber}`;
    return {
      memo: `Downpayment invoiced to ${doc.customerName}, invoice no. ${doc.invoiceNumber} (${doc.jobOrderNumber})`,
      lines: [
        { account: { role: 'AR_TRADE' }, party, ref, debitCents: doc.amountCents, memo: on },
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, creditCents: doc.vatableSalesCents, memo: `${on}, net of VAT, until the release invoice` },
        { account: { role: 'OUTPUT_VAT' }, party, creditCents: doc.vatCents },
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, debitCents: doc.depositAppliedCents, memo: `Deposits of ${doc.jobOrderNumber} applied` },
        { account: { role: 'AR_TRADE' }, party, ref, creditCents: doc.depositAppliedCents, memo: `Deposits of ${doc.jobOrderNumber} applied` },
      ],
    };
  },

  /** A release invoice that took this downpayment into sales, or a forfeit that took it: cancel it first, or 2201 would owe less than nothing. */
  dependents(db, documentId) {
    const d = dpInvoiceDoc.load(db, documentId);
    return dpHeld(db, d.jobOrderId).grossCents < d.amountCents ? dpTakenBy(db, d.jobOrderId) : [];
  },

  afterCancel(db, documentId) {
    const d = dpInvoiceDoc.load(db, documentId);
    const lines = settleJobOrder(db, documentId, d.customerId, d.jobOrderId, d.jobOrderNumber);
    return lines.length > 0 ? { memo: `${d.jobOrderNumber} receivable and deposits put back in line`, lines } : null;
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT job_order_id AS jobOrderId, customer_id AS customerId, customer_name AS customerName, invoice_number AS invoiceNumber, vat_rate_bp AS vatRateBp,
           gross_cents AS amountCents, vat_cents AS vatCents, deposit_applied_cents AS depositAppliedCents, note
         FROM jo_dp_invoices WHERE document_id = ?`,
      )
      .get(documentId) as (Omit<DpInvoice, 'note'> & { note: string | null }) | undefined;
    if (!r) throw new Error(`Downpayment invoice ${documentId} not found`);
    const { note, ...rest } = r;
    return {
      ...rest,
      ...(note ? { note } : {}),
      jobOrderNumber: jobOrderRef(db, r.jobOrderId)?.number ?? '?',
      vatableSalesCents: r.amountCents - r.vatCents,
      mode: 'C',
      totalCents: r.amountCents,
    };
  },

  toInput: ({ jobOrderId, invoiceNumber, amountCents, note }) => ({ jobOrderId, invoiceNumber, amountCents, ...(note ? { note } : {}) }),

  summary(doc) {
    const applied = doc.depositAppliedCents > 0 ? ` ${formatPeso(doc.depositAppliedCents)} already paid is applied; ${formatPeso(doc.amountCents - doc.depositAppliedCents)} is left to collect.` : '';
    return `This will record downpayment invoice no. ${doc.invoiceNumber} to ${doc.customerName} for ${doc.jobOrderNumber}: ${formatPeso(doc.amountCents)} (VATable sales ${formatPeso(doc.vatableSalesCents)}, VAT ${formatPeso(doc.vatCents)}). The release invoice takes it into sales.${applied}`;
  },

  arbitrary(db) {
    // Job orders in mode C or with no downpayment yet (the property test sets mode C).
    const open = jobOrdersOf(db)
      .filter((jo) => !isAbandoned(db, jo.id) && (lockedMode(db, jo.id)?.mode ?? 'C') === 'C')
      .map((jo) => ({ id: jo.id, left: jo.totalCents - invoicedCents(db, jo.id) }))
      .filter((jo) => jo.left > 0);
    if (open.length === 0) throw new Error('jo.dp_invoice.arbitrary needs a job order in mode C with something not yet invoiced');
    return fc
      .record({ jo: fc.constantFrom(...open), pct: fc.integer({ min: 1, max: 100 }), n: fc.integer({ min: 1, max: 99_999_999 }) })
      .map(({ jo, pct, n }) => ({ jobOrderId: jo.id, invoiceNumber: String(n).padStart(4, '0'), amountCents: Math.max(1, Math.floor((jo.left * pct) / 100)) }));
  },
};
