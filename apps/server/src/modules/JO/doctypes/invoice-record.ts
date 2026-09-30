/**
 * Invoice record (PLAN D3, D5 INV-REC + DEP-APPLY): the manual BIR invoice written for a release, recorded as the sale.
 *   Dr 1201 AR (G); Dr 4190 the discount shown (its NET) / Cr 4101/4102/4103 sales (NET at list, by line class); Cr 2301 VAT(G)
 *   Dr 2201 the JO's deposits (up to G) / Cr 1201 AR                                                          (DEP-APPLY)
 * Downpayment VAT modes (D3, COL doctypes/deposit-vat.ts; the job order's mode, which its first downpayment fixed):
 *   B  plus Dr 2301 / Cr 2209: the output VAT recognised on the deposits it applies (DEP-VAT-REV)
 *   C  the downpayments invoiced ahead (INV-DP) are taken into sales first: the booklet shows G − DP, so AR is G − DP
 *      and 2301 gets VAT(G) − VAT_dp; Dr 2201 NET_dp / Cr sales NET_dp (on their own lines). Money held is then applied.
 * The record keeps the whole sale: gross_cents G, vat_cents VAT(G), and deposit_applied_cents = money + DP applied, so
 * G − deposit applied is what it leaves to collect. VAT at document level (D4.1) at the rate in force on the invoice date
 * (settings). AR and deposit lines name the customer and the JO (journal ref): the JO's deposits are one pool, applied
 * oldest first up to G, and its balance due reads straight from the ledger.
 * Cancel (plain or for an edit): the mirror, then settleJobOrder: what was paid on this invoice becomes deposits of the JO
 * again, Dr 1201 / Cr 2201 (D6), and 2209 follows the deposits; an edit's replacement applies them as deposits.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { settingAt } from '../../../engine/settings.ts';
import { saleByInvoiceNumber, saleInvoiceNumbersBetween } from '../../QS/public.ts';
import { assetSaleByInvoiceNumber, assetSaleInvoiceNumbersBetween } from '../../FA/public.ts';
import { creditsOn, depositModeOn, depositVatLines, depositVatRowsOf, invoiceDeposits, modeKeptIssue, recordDepositVat, settleJobOrder, vatRow } from '../../COL/public.ts';
import { bookletIssue } from '../../TAX/public.ts';
import { dpInvoiceUsedBy, dpInvoiceNumbersBetween } from './dp-invoice.ts';
import { invoicedCents, joLedger } from '../public.ts';
import { MAX_CENTS } from './job-order.ts';
import { releaseDoc, type LineKind, type ReleaseLine } from './release.ts';

export const SALES_CLASSES: LineKind[] = ['made_to_order', 'ready_made', 'service'];
export const SALES_ROLE: Record<LineKind, string> = { made_to_order: 'SALES_MTO', ready_made: 'SALES_RTW', service: 'SALES_SERVICE' };
/** One IR- series for every invoice record: a release's (here) and a quick sale's (QS). */
export const INVOICE_SERIES = { key: 'IR', prefix: 'IR-' };

export const invoiceRecordInput = z
  .object({
    releaseId: z.uuid(),
    // Typed from the booklet, never prefilled; checked against the ATP booklet register (TAX, D7).
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type InvoiceRecordInput = z.infer<typeof invoiceRecordInput>;

/**
 * What the booklet shows and the journal posts for some invoiced lines (D4.1, D4.3): VAT on the whole document, sales
 * split by line class weighted by list price, and a discount shown on the invoice as gross + 4190. Quick sales use it too.
 */
export function invoiceAmounts(lines: readonly { kind: LineKind; listCents: number; discountCents: number }[], vatRateBp: number) {
  const listCents = lines.reduce((s, l) => s + l.listCents, 0);
  const discountCents = lines.reduce((s, l) => s + l.discountCents, 0);
  const grossCents = listCents - discountCents;
  const { netCents, vatCents } = vatFromGross(grossCents, vatRateBp);
  const discountNetCents = vatFromGross(discountCents, vatRateBp).netCents;
  const weights = SALES_CLASSES.map((k) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.listCents, 0));
  const shares = weights.some((w) => w > 0) ? allocate(netCents + discountNetCents, weights) : [0, 0, 0];
  const salesCents = Object.fromEntries(SALES_CLASSES.map((k, i) => [k, shares[i]!])) as Record<LineKind, number>;
  return { vatRateBp, listCents, discountCents, grossCents, vatableSalesCents: netCents, vatCents, discountNetCents, salesCents };
}

const NO_DEPOSITS = {
  depositVatMode: 'A' as 'A' | 'B' | 'C',
  depositAppliedCents: 0, depositVatCents: 0, depositVatBaseCents: 0, dpAppliedCents: 0, dpVatAppliedCents: 0,
};

/**
 * A release's invoice figures, with what it does with the JO's deposits (COL invoiceDeposits): money applied, the 2209 on
 * it (mode B), the downpayments invoiced ahead it takes into sales (mode C, their NET split by line class like the sale's).
 * `booklet`: "write these on the booklet" (D4.4); in mode C the balance invoice shows G − DP.
 */
export function invoiceFigures(db: Db, jobOrderId: string, lines: readonly ReleaseLine[], date: string) {
  const figures = invoiceAmounts(lines, settingAt(db, 'tax.vat_rate_bp', date));
  const deposits = jobOrderId ? invoiceDeposits(db, jobOrderId, figures.grossCents, date) : { ...NO_DEPOSITS, depositVatMode: settingAt(db, 'sales.deposit_vat_mode', date) };
  const dpNetCents = deposits.dpAppliedCents - deposits.dpVatAppliedCents;
  const weights = SALES_CLASSES.map((k) => figures.salesCents[k]);
  const shares = weights.some((w) => w > 0) ? allocate(dpNetCents, weights) : [dpNetCents, 0, 0];
  const dpSalesCents = Object.fromEntries(SALES_CLASSES.map((k, i) => [k, shares[i]!])) as Record<LineKind, number>;
  const bookletGross = figures.grossCents - deposits.dpAppliedCents;
  const bookletVat = figures.vatCents - deposits.dpVatAppliedCents;
  return {
    ...figures,
    ...deposits,
    dpSalesCents,
    booklet: { grossCents: bookletGross, vatableSalesCents: bookletGross - bookletVat, vatCents: bookletVat },
  };
}

export interface InvoiceRecord extends InvoiceRecordInput, ReturnType<typeof invoiceFigures> {
  releaseNumber: string;
  jobOrderId: string;
  jobOrderNumber: string;
  customerId: string;
  customerName: string;
  lines: ReleaseLine[];
  totalCents: number;
}

const releaseHeader = (db: Db, id: string) =>
  db.prepare(`SELECT d.number, d.status FROM jo_releases r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?`).get(id) as { number: string; status: string } | undefined;

/** The document that used a booklet invoice number, cancelled ones included. Releases, quick sales and asset sales (FA) share one booklet. */
export function invoiceNumberUsedBy(db: Db, invoiceNumber: string): { number: string; status: string } | undefined {
  const own = db
    .prepare(`SELECT d.number, d.status FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id WHERE CAST(i.invoice_number AS INTEGER) = CAST(? AS INTEGER)`)
    .get(invoiceNumber) as { number: string; status: string } | undefined;
  return own ?? dpInvoiceUsedBy(db, invoiceNumber) ?? saleByInvoiceNumber(db, invoiceNumber) ?? assetSaleByInvoiceNumber(db, invoiceNumber);
}

/** Booklet invoice numbers used between two numbers by invoice records, quick sales and asset sales, cancelled ones included (TAX). */
export function invoiceNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  const own = db
    .prepare(`SELECT CAST(i.invoice_number AS INTEGER) AS n, d.number, d.status FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id
              WHERE CAST(i.invoice_number AS INTEGER) BETWEEN ? AND ?`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
  return [...own, ...dpInvoiceNumbersBetween(db, from, to), ...saleInvoiceNumbersBetween(db, from, to), ...assetSaleInvoiceNumbersBetween(db, from, to)].sort((a, b) => a.n - b.n);
}

export const invoiceRecordDoc: DocTypeDef<InvoiceRecordInput, InvoiceRecord> = {
  key: 'jo.invoice_record',
  module: 'JO',
  title: 'Invoice Record',
  numbering: { series: INVOICE_SERIES },
  permissions: { view: 'jo.view', create: 'jo.invoice', post: 'jo.invoice', cancel: 'jo.invoice_cancel' },
  dating: 'system',
  inputSchema: invoiceRecordInput,
  externalNumber: (doc) => doc.invoiceNumber,

  compute(input, ctx) {
    const header = releaseHeader(ctx.db, input.releaseId);
    const rel = header ? releaseDoc.load(ctx.db, input.releaseId) : undefined;
    const figures = invoiceFigures(ctx.db, rel?.jobOrderId ?? '', rel?.lines ?? [], ctx.businessDate);
    return {
      ...input,
      ...figures,
      releaseNumber: header?.number ?? '?',
      jobOrderId: rel?.jobOrderId ?? '',
      jobOrderNumber: rel?.jobOrderNumber ?? '?',
      customerId: rel?.customerId ?? '',
      customerName: rel?.customerName ?? '?',
      lines: rel?.lines ?? [],
      totalCents: figures.grossCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const kept = doc.jobOrderId ? modeKeptIssue(depositModeOn(ctx.db, doc.jobOrderId, ctx.businessDate), doc.jobOrderNumber, 'releaseId') : null;
    if (kept) issues.push(kept);
    const rel = releaseHeader(ctx.db, doc.releaseId);
    if (!rel) error('releaseId', 'RELEASE', 'Pick the release this invoice is for.');
    else if (rel.status !== 'posted') error('releaseId', 'RELEASE_CANCELLED', `${rel.number} is cancelled. Record the invoice for the release that replaced it.`);
    const other = ctx.db
      .prepare(`SELECT d.number, i.invoice_number FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id WHERE i.release_id = ? AND d.status = 'posted'`)
      .get(doc.releaseId) as { number: string; invoice_number: string } | undefined;
    if (other) error('releaseId', 'ALREADY_INVOICED', `${doc.releaseNumber} already has invoice no. ${other.invoice_number} (${other.number}). Cancel that one first to record another.`);
    const used = invoiceNumberUsedBy(ctx.db, doc.invoiceNumber);
    if (used) {
      const how = used.status === 'cancelled' ? ' (cancelled)' : '';
      error('invoiceNumber', 'INVOICE_USED', `Invoice no. ${doc.invoiceNumber} is already used on ${used.number}${how}. Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.`);
    }
    const booklet = bookletIssue(ctx.db, 'SALES_INVOICE', doc.invoiceNumber, 'invoiceNumber');
    if (booklet) issues.push(booklet);
    if (rel && doc.grossCents <= 0) error('releaseId', 'NOTHING_TO_INVOICE', `${doc.releaseNumber} released nothing with a price, so there is nothing to invoice.`);
    if (doc.grossCents > MAX_CENTS) error('releaseId', 'TOO_BIG', 'The amount is over ₱100 million. Please check the job order.');
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO jo_invoice_records (document_id, release_id, job_order_id, customer_id, customer_name, invoice_number, vat_rate_bp, deposit_vat_mode,
         list_cents, discount_cents, gross_cents, vat_cents, discount_net_cents, sales_mto_cents, sales_rtw_cents, sales_service_cents, deposit_applied_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.releaseId, doc.jobOrderId, doc.customerId, doc.customerName, doc.invoiceNumber, doc.vatRateBp, doc.depositVatMode,
      doc.listCents, doc.discountCents, doc.grossCents, doc.vatCents, doc.discountNetCents,
      doc.salesCents.made_to_order, doc.salesCents.ready_made, doc.salesCents.service, doc.depositAppliedCents + doc.dpAppliedCents, doc.note ?? null,
    );
    if (doc.depositVatCents !== 0 || doc.depositVatBaseCents !== 0 || doc.dpAppliedCents !== 0) {
      const dpNetCents = doc.dpAppliedCents - doc.dpVatAppliedCents;
      recordDepositVat(db, h.documentId, 'original', [
        vatRow({
          jobOrderId: doc.jobOrderId, customerId: doc.customerId, mode: doc.depositVatMode, depositCents: -doc.depositAppliedCents,
          depositVatCents: -doc.depositVatCents, depositBaseCents: -doc.depositVatBaseCents, dpInvoicedCents: -doc.dpAppliedCents, dpVatCents: -doc.dpVatAppliedCents,
          // The register's VATable sales of this invoice: its sales, less what was booked with the VAT on the deposits or downpayment invoices.
          registerBaseCents: -doc.depositVatBaseCents - dpNetCents,
        }),
      ]);
    }
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    const ref = { documentId: doc.jobOrderId };
    const dp = `Downpayment invoiced before on ${doc.jobOrderNumber}`;
    // A class's own sale can come out a centavo below zero when the downpayment invoices' VAT rounded down: it is then a debit.
    const credit = (cents: number) => (cents >= 0 ? { creditCents: cents } : { debitCents: -cents });
    return {
      memo: `Sale to ${doc.customerName}, invoice no. ${doc.invoiceNumber} (${doc.jobOrderNumber}, ${doc.releaseNumber})`,
      lines: [
        { account: { role: 'AR_TRADE' }, party, ref, debitCents: doc.grossCents - doc.dpAppliedCents, memo: `Invoice no. ${doc.invoiceNumber}` },
        { account: { role: 'SALES_DISCOUNTS' }, party, debitCents: doc.discountNetCents, memo: 'Discount shown on the invoice' },
        ...SALES_CLASSES.map((k) => ({ account: { role: SALES_ROLE[k] }, party, ...credit(doc.salesCents[k] - doc.dpSalesCents[k]) })),
        { account: { role: 'OUTPUT_VAT' }, party, ...credit(doc.vatCents - doc.dpVatAppliedCents) },
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, debitCents: doc.dpAppliedCents - doc.dpVatAppliedCents, memo: `${dp}, net of VAT, into sales` },
        ...SALES_CLASSES.map((k) => ({ account: { role: SALES_ROLE[k] }, party, creditCents: doc.dpSalesCents[k], memo: dp })),
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, debitCents: doc.depositAppliedCents, memo: `Deposits of ${doc.jobOrderNumber} applied` },
        { account: { role: 'AR_TRADE' }, party, ref, creditCents: doc.depositAppliedCents, memo: `Deposits of ${doc.jobOrderNumber} applied` },
        ...depositVatLines(doc.customerId, doc.jobOrderId, doc.jobOrderNumber, -doc.depositVatCents),
      ],
    };
  },

  /** What COL recorded on this invoice (credit memos, write-offs, 2307s received with no cash): cancel those first. */
  dependents: (db, documentId) => creditsOn(db, documentId),

  afterCancel(db, documentId) {
    const d = invoiceRecordDoc.load(db, documentId);
    const lines = settleJobOrder(db, documentId, d.customerId, d.jobOrderId, d.jobOrderNumber);
    return lines.length > 0 ? { memo: `${d.jobOrderNumber} receivable and deposits put back in line`, lines } : null;
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT release_id AS releaseId, invoice_number AS invoiceNumber, note, vat_rate_bp AS vatRateBp, list_cents AS listCents, discount_cents AS discountCents,
           gross_cents AS grossCents, vat_cents AS vatCents, discount_net_cents AS discountNetCents, sales_mto_cents AS mto, sales_rtw_cents AS rtw,
           sales_service_cents AS service, deposit_applied_cents AS depositAppliedCents, job_order_id AS jobOrderId, customer_id AS customerId,
           customer_name AS customerName, deposit_vat_mode AS depositVatMode
         FROM jo_invoice_records WHERE document_id = ?`,
      )
      .get(documentId) as (Omit<InvoiceRecord, 'note'> & { note: string | null; mto: number; rtw: number; service: number }) | undefined;
    if (!r) throw new Error(`Invoice record ${documentId} not found`);
    const { note, mto, rtw, service, ...rest } = r;
    const rel = releaseDoc.load(db, r.releaseId);
    const row = depositVatRowsOf(db, documentId)[0];
    const dpAppliedCents = 0 - (row?.dpInvoicedCents ?? 0);
    const dpVatAppliedCents = 0 - (row?.dpVatCents ?? 0);
    const salesCents = { made_to_order: mto, ready_made: rtw, service };
    const shares = allocate(dpAppliedCents - dpVatAppliedCents, SALES_CLASSES.some((k) => salesCents[k] > 0) ? SALES_CLASSES.map((k) => salesCents[k]) : [1, 0, 0]);
    const bookletGross = r.grossCents - dpAppliedCents;
    return {
      ...rest,
      ...(note ? { note } : {}),
      depositAppliedCents: r.depositAppliedCents - dpAppliedCents,
      depositVatCents: 0 - (row?.depositVatCents ?? 0),
      depositVatBaseCents: 0 - (row?.depositBaseCents ?? 0),
      dpAppliedCents,
      dpVatAppliedCents,
      dpSalesCents: Object.fromEntries(SALES_CLASSES.map((k, i) => [k, shares[i]!])) as Record<LineKind, number>,
      booklet: { grossCents: bookletGross, vatableSalesCents: bookletGross - (r.vatCents - dpVatAppliedCents), vatCents: r.vatCents - dpVatAppliedCents },
      vatableSalesCents: r.grossCents - r.vatCents,
      salesCents,
      releaseNumber: releaseHeader(db, r.releaseId)!.number,
      jobOrderNumber: rel.jobOrderNumber,
      lines: rel.lines,
      totalCents: r.grossCents,
    };
  },

  toInput: ({ releaseId, invoiceNumber, note }) => ({ releaseId, invoiceNumber, ...(note ? { note } : {}) }),

  summary(doc) {
    const discount = doc.discountCents > 0 ? `, discount ${formatPeso(doc.discountCents)} shown` : '';
    const applied = doc.depositAppliedCents > 0 ? ` ${formatPeso(doc.depositAppliedCents)} of deposits is applied;` : '';
    const left = doc.depositAppliedCents > 0 || doc.dpAppliedCents > 0 ? `${applied} ${formatPeso(doc.grossCents - doc.depositAppliedCents - doc.dpAppliedCents)} is left to collect.` : '';
    const vatOnDeposits = doc.depositVatCents > 0 ? ` ${formatPeso(doc.depositVatCents)} of it was already booked as output VAT on the deposits (mode B).` : '';
    const sale = `${formatPeso(doc.grossCents)} (VATable sales ${formatPeso(doc.vatableSalesCents)}, VAT ${formatPeso(doc.vatCents)}${discount})`;
    if (doc.dpAppliedCents > 0) {
      const b = doc.booklet;
      return `This will record invoice no. ${doc.invoiceNumber} to ${doc.customerName} for ${doc.releaseNumber} of ${doc.jobOrderNumber}: a sale of ${sale}, less ${formatPeso(doc.dpAppliedCents)} of downpayments already invoiced (mode C), so the invoice shows ${formatPeso(b.grossCents)} (VATable sales ${formatPeso(b.vatableSalesCents)}, VAT ${formatPeso(b.vatCents)}).${left}`;
    }
    return `This will record invoice no. ${doc.invoiceNumber} to ${doc.customerName} for ${doc.releaseNumber} of ${doc.jobOrderNumber}: ${sale}.${vatOnDeposits}${left}`;
  },

  arbitrary(db) {
    const waiting = awaitingInvoice(db).filter((r) => r.totalCents > 0);
    if (waiting.length === 0) throw new Error('jo.invoice_record.arbitrary needs a release with a price and no invoice record');
    return fc
      .record({ release: fc.constantFrom(...waiting), n: fc.integer({ min: 1, max: 99_999_999 }), note: fc.constantFrom(undefined, 'Booklet 12') })
      .map(({ release, n, note }) => ({ releaseId: release.id, invoiceNumber: String(n).padStart(4, '0'), ...(note ? { note } : {}) }));
  },
};

/**
 * After a cancel's mirror, puts one JO's receivable and deposits back in line (D6), in one Dr/Cr pair:
 * - the receivable never goes below zero: money paid on a cancelled invoice becomes a deposit of the JO again;
 * - deposits never go below zero: a deposit that an invoice already applied reopens the receivable instead;
 * - the receivable never exceeds what is invoiced: a deposit that had come from a receivable payment leaves with it.
 * Used by the invoice record's and the collection's cancel (COL reads it through JO public.ts).
 */
export function settleLines(db: Db, customerId: string, jobOrderId: string, jobOrderNumber: string): DraftLine[] {
  const { receivableCents: ar, depositsHeldCents: held } = joLedger(db, jobOrderId);
  const up = Math.max(0, -ar, -held);
  const down = up > 0 ? 0 : Math.max(0, Math.min(ar - invoicedCents(db, jobOrderId), held));
  const party = { type: 'customer', id: customerId };
  const ref = { documentId: jobOrderId };
  const receivable = { account: { role: 'AR_TRADE' }, party, ref, memo: jobOrderNumber };
  const deposits = { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref, memo: `Deposit for ${jobOrderNumber}` };
  if (up > 0) return [{ ...receivable, debitCents: up }, { ...deposits, creditCents: up }];
  if (down > 0) return [{ ...deposits, debitCents: down }, { ...receivable, creditCents: down }];
  return [];
}

/** Recorded releases with no recorded invoice record, oldest first: the "invoice to follow" exceptions list (D3). */
export function awaitingInvoice(db: Db, jobOrderId?: string) {
  return db
    .prepare(
      `SELECT d.id, d.number, d.business_date AS businessDate, r.job_order_id AS jobOrderId, d.total_cents AS totalCents FROM jo_releases r JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND (@jo IS NULL OR r.job_order_id = @jo)
         AND NOT EXISTS (SELECT 1 FROM jo_invoice_records i JOIN documents x ON x.id = i.document_id WHERE i.release_id = r.document_id AND x.status = 'posted')
       ORDER BY d.number`,
    )
    .all({ jo: jobOrderId ?? null }) as { id: string; number: string; businessDate: string; jobOrderId: string; totalCents: number }[];
}
