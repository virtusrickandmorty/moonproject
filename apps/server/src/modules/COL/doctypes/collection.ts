/**
 * Collection (PLAN E5, D5 DEP-RCV / COL-RCV / COL-OVER): money in from a customer, split across cash places and
 * applied to job orders and quick sales, in one journal.
 *   Dr cash place (per tender); Dr 1410 CWT (2307); Dr 1404 VAT withheld (government buyers, 2307); Dr 6280 (short ≤ ₱1)
 *     / Cr 1201 AR (the JO's invoiced part); Cr 2201 (the JO's un-invoiced part, a deposit);
 *       Cr 1201 AR (a quick sale, QS-SALE); Cr 2201 (unapplied remainder, no JO); Cr 6280 (over ≤ ₱1)
 * AR and deposit lines name the customer and the JO (journal_lines.ref_doc_id), so each JO's balance due is read
 * from the ledger (JO public.ts). Balance rule (E5): Σ tenders + CWT + VAT withheld = Σ applied + unapplied, give or take ₱1.
 * Downpayment VAT modes (D3, deposit-vat.ts; the job order's mode, which its first downpayment fixes): in mode B each
 * deposit also posts Dr 2209 / Cr 2301 VAT(deposit) (DEP-VAT), on the customer and the JO; in mode C the downpayment is
 * invoiced (JO downpayment invoice) and the collection pays that receivable; money taken first waits for its invoice.
 * Cancel: the mirror, then any part of a deposit that an invoice record already applied reopens the receivable,
 * Dr 1201 / Cr 2201 (D6), so the JO's deposits never go below zero, and 2209 follows (settleJobOrder).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, manilaDate, vatFromGross, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { settingAt } from '../../../engine/settings.ts';
import { customerRef } from '../../CUS/public.ts';
import { isAbandoned, jobOrderRef, jobOrdersOf, joLedger, joMoney } from '../../JO/public.ts';
import { saleOpenCents, saleRef } from '../../QS/public.ts';
import { bookletIssue } from '../../TAX/public.ts';
import { writeOffsOn } from '../credits.ts';
import { depositModeOn, depositVatLines, depositVatRowsOf, modeKeptIssue, recordDepositVat, settleJobOrder, vatOnDeposit, vatRow, type DepositMode } from './deposit-vat.ts';
import { MAX_CENTS, cashPlaceIssues, insertTenders, loadTenders, sumCents, takenOutBy, tenderInput, tenderToInput, withNames, type Tender } from '../ledger.ts';

/** Largest difference that may go to cash short and over instead of a deposit or an unpaid balance (D4.9). */
export const SHORT_OVER_LIMIT_CENTS = 100;
/** Expected customer CWT by ATC (D4.6): WC158 goods 1%, WC160 services 2%. "other" has no expectation. */
const CWT_BP = { WC158: 100, WC160: 200 } as const;
/** Expected VAT withheld by a government buyer (D4.6): 5% of the net. */
const VAT_WITHHELD_BP = 500;

const application = z.object({ jobOrderId: z.uuid(), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();
/** A quick sale paid (QS invoice record): what is still owed on it is its receivable, named by the sale (journal ref). */
const saleApplication = z.object({ saleId: z.uuid(), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();

export const collectionInput = z
  .object({
    customerId: z.uuid(),
    // Typed from the ATP CR booklet, never prefilled (ACC-03 booklet mode).
    crNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the CR (digits only).'),
    applications: z.array(application).max(50),
    sales: z.array(saleApplication).min(1).max(20).optional(),
    tenders: z.array(tenderInput).min(1).max(10),
    withholding: z
      .object({
        cwtCents: z.number().int().positive().max(MAX_CENTS),
        atc: z.enum(['WC158', 'WC160', 'other']),
        certificate: z.enum(['pending', 'received']),
        vatWithheldCents: z.number().int().positive().max(MAX_CENTS).optional(), // government buyers, on the same 2307 (D4.6)
      })
      .strict()
      .optional(),
    settleSmallDifference: z.boolean().optional(), // a difference up to ₱1.00 goes to cash short and over (D4.9)
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CollectionInput = z.infer<typeof collectionInput>;

export interface Application extends z.infer<typeof application> {
  lineNo: number; jobOrderNumber: string; toReceivableCents: number; toDepositCents: number;
  /** The JO's downpayment VAT mode, and in mode B the VAT on the deposit (DEP-VAT) with its VATable amount. */
  depositVatMode: DepositMode; depositVatCents: number; depositBaseCents: number;
}
export interface SaleApplication extends z.infer<typeof saleApplication> { lineNo: number; saleNumber: string; invoiceNumber: string }
export interface Collection extends Omit<CollectionInput, 'applications' | 'sales' | 'tenders'> {
  applications: Application[];
  sales: SaleApplication[];
  tenders: Tender[];
  customerName: string;
  cwtCents: number;
  vatWithheldCents: number;
  appliedCents: number;
  unappliedCents: number;
  /** + over (kept), − short (absorbed). */
  shortOverCents: number;
  totalCents: number;
}

function crUsedBy(db: Db, crNumber: string) {
  return db
    .prepare(`SELECT d.number, d.status FROM col_collections c JOIN documents d ON d.id = c.document_id WHERE CAST(c.cr_number AS INTEGER) = CAST(? AS INTEGER)`)
    .get(crNumber) as { number: string; status: string } | undefined;
}

export const collectionDoc: DocTypeDef<CollectionInput, Collection> = {
  key: 'col.collection',
  module: 'COL',
  title: 'Collection Receipt',
  numbering: { series: { key: 'COL', prefix: 'COL-' } },
  permissions: { view: 'col.view', create: 'col.create', post: 'col.post', cancel: 'col.cancel' },
  dating: 'system',
  inputSchema: collectionInput,
  externalNumber: (doc) => doc.crNumber,

  compute(input, ctx) {
    const { settleSmallDifference, sales: _, ...rest } = input;
    const cwtCents = input.withholding?.cwtCents ?? 0;
    const vatWithheldCents = input.withholding?.vatWithheldCents ?? 0;
    const totalCents = sumCents(input.tenders) + cwtCents + vatWithheldCents;
    // The JO's open receivable is settled first; what is left is a deposit on the JO's un-invoiced part (D3).
    const applications = input.applications.map((a, i) => {
      const jo = jobOrderRef(ctx.db, a.jobOrderId);
      const toReceivableCents = Math.min(a.amountCents, jo ? Math.max(0, joLedger(ctx.db, jo.id).receivableCents) : 0);
      const toDepositCents = a.amountCents - toReceivableCents;
      // No deposit, no mode to keep (load reads it back from the deposit's row).
      const depositVatMode: DepositMode = jo && toDepositCents > 0 ? depositModeOn(ctx.db, jo.id, ctx.businessDate).mode : 'A';
      const vat = depositVatMode === 'B' && toDepositCents > 0 ? vatOnDeposit(ctx.db, toDepositCents, ctx.businessDate) : { vatCents: 0, baseCents: 0 };
      return {
        ...a, lineNo: i + 1, jobOrderNumber: jo?.number ?? '?', toReceivableCents, toDepositCents,
        depositVatMode, depositVatCents: vat.vatCents, depositBaseCents: vat.baseCents,
      };
    });
    const sales = (input.sales ?? []).map((a, i) => {
      const sale = saleRef(ctx.db, a.saleId);
      return { ...a, lineNo: i + 1, saleNumber: sale?.number ?? '?', invoiceNumber: sale?.invoiceNumber ?? '?' };
    });
    const appliedCents = sumCents(applications) + sumCents(sales);
    const difference = totalCents - appliedCents;
    return {
      ...rest,
      ...(settleSmallDifference ? { settleSmallDifference } : {}),
      applications,
      sales,
      tenders: withNames(ctx.db, input.tenders),
      customerName: customerRef(ctx.db, input.customerId)?.display_name ?? '?',
      cwtCents,
      vatWithheldCents,
      appliedCents,
      unappliedCents: settleSmallDifference ? 0 : Math.max(0, difference),
      shortOverCents: settleSmallDifference ? difference : 0,
      totalCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const c = customerRef(ctx.db, doc.customerId);
    if (c?.is_active !== 1) add('error', 'customerId', 'CUSTOMER', c ? `${c.display_name} is inactive. Pick an active customer.` : 'Pick a customer.');
    const used = crUsedBy(ctx.db, doc.crNumber);
    if (used) {
      const how = used.status === 'cancelled' ? ' (cancelled)' : '';
      add('error', 'crNumber', 'CR_USED', `CR ${doc.crNumber} is already used on ${used.number}${how}. Each CR number is used once: write this payment on a new CR and keep all copies of a spoiled one.`);
    }
    const booklet = bookletIssue(ctx.db, 'CR', doc.crNumber, 'crNumber');
    if (booklet) issues.push(booklet);
    issues.push(...cashPlaceIssues(ctx.db, doc.tenders, 'Pick where the money went.'));
    if (doc.totalCents > MAX_CENTS) add('error', 'tenders', 'TOO_BIG', 'The amount is over ₱100 million. Please check the amounts.');

    const seen = new Set<string>();
    for (const a of doc.applications) {
      const f = `applications.${a.lineNo - 1}`;
      const jo = jobOrderRef(ctx.db, a.jobOrderId);
      if (!jo || jo.customerId !== doc.customerId) {
        add('error', `${f}.jobOrderId`, 'JOB_ORDER', `Line ${a.lineNo}: pick one of ${doc.customerName}'s job orders.`);
      } else if (seen.has(jo.id)) {
        add('error', `${f}.jobOrderId`, 'JO_TWICE', `${jo.number} is listed twice. Put its whole amount on one line.`);
      } else if (jo.status !== 'posted') {
        add('error', `${f}.jobOrderId`, 'JO_CANCELLED', `${jo.number} is cancelled, so money cannot be applied to it.`);
      } else {
        const due = joMoney(ctx.db, jo.id).balanceDueCents;
        const off = writeOffsOn(ctx.db, jo.id)[0];
        if (a.amountCents > due && off) {
          add('error', `${f}.amountCents`, 'WRITTEN_OFF', `An invoice of ${jo.number} was written off as a bad debt (${off.number}). To take payment on it, the accountant cancels the write-off first.`);
        } else if (a.amountCents > due) {
          add('error', `${f}.amountCents`, 'OVER_BALANCE', due > 0 ? `${jo.number} has ${formatPeso(due)} left to pay. Apply at most that; the rest is kept as a deposit.` : `${jo.number} is fully paid.`);
        }
        if (a.toDepositCents > 0 && isAbandoned(ctx.db, jo.id)) {
          add('error', `${f}.jobOrderId`, 'JO_ABANDONED', `${jo.number} was abandoned and its deposit forfeited, so no new deposit is taken on it.`);
        }
        if (a.toDepositCents > 0) {
          const kept = modeKeptIssue(depositModeOn(ctx.db, jo.id, ctx.businessDate), jo.number, `${f}.jobOrderId`);
          if (kept) issues.push(kept);
          if (a.depositVatMode === 'C') {
            add('warning', `${f}.amountCents`, 'DP_INVOICE_NEEDED', `${formatPeso(a.toDepositCents)} of this is a downpayment on ${jo.number} not yet invoiced. In mode C (invoice on downpayment) write it on a sales invoice and record it as ${jo.number}'s downpayment invoice.`);
          }
        }
      }
      seen.add(a.jobOrderId);
    }
    for (const a of doc.sales) {
      const f = `sales.${a.lineNo - 1}`;
      const sale = saleRef(ctx.db, a.saleId);
      if (!sale || sale.customerId !== doc.customerId) {
        add('error', `${f}.saleId`, 'SALE', `Line ${a.lineNo}: pick one of ${doc.customerName}'s quick sales.`);
      } else if (seen.has(sale.id)) {
        add('error', `${f}.saleId`, 'SALE_TWICE', `Invoice no. ${sale.invoiceNumber} is listed twice. Put its whole amount on one line.`);
      } else if (sale.status !== 'posted') {
        add('error', `${f}.saleId`, 'SALE_CANCELLED', `Invoice no. ${sale.invoiceNumber} (${sale.number}) is cancelled, so money cannot be applied to it.`);
      } else if (writeOffsOn(ctx.db, sale.id).length > 0) {
        const off = writeOffsOn(ctx.db, sale.id)[0]!;
        add('error', `${f}.saleId`, 'WRITTEN_OFF', `Invoice no. ${sale.invoiceNumber} was written off as a bad debt (${off.number}). To take payment on it, the accountant cancels the write-off first.`);
      } else {
        const open = saleOpenCents(ctx.db, sale.id);
        if (a.amountCents > open) {
          add('error', `${f}.amountCents`, 'OVER_BALANCE', open > 0 ? `Invoice no. ${sale.invoiceNumber} has ${formatPeso(open)} left to pay. Apply at most that.` : `Invoice no. ${sale.invoiceNumber} is fully paid.`);
        }
      }
      seen.add(a.saleId);
    }

    const difference = doc.totalCents - doc.appliedCents;
    if (doc.settleSmallDifference) {
      if (Math.abs(difference) > SHORT_OVER_LIMIT_CENTS) {
        add('error', 'settleSmallDifference', 'DIFFERENCE_TOO_BIG', `Only a difference of up to ₱1.00 can go to cash short and over. This one is ${formatPeso(Math.abs(difference))}.`);
      }
    } else if (difference < 0) {
      add('error', 'applications', 'APPLIED_MORE', `You applied ${formatPeso(doc.appliedCents)} but received ${formatPeso(doc.totalCents)} (money plus tax withheld).`);
    }
    if (doc.unappliedCents > 0) {
      add('warning', 'applications', 'UNAPPLIED', `${formatPeso(doc.unappliedCents)} is not applied to a job order. It is kept as ${doc.customerName}'s deposit, to apply or refund later.`);
    }
    const w = doc.withholding;
    const netCents = () => vatFromGross(doc.totalCents, settingAt(ctx.db, 'tax.vat_rate_bp', ctx.businessDate)).netCents;
    if (w && w.atc !== 'other') {
      const expected = applyRate(netCents(), CWT_BP[w.atc]);
      if (Math.abs(w.cwtCents - expected) > 100) {
        add('warning', 'withholding.cwtCents', 'CWT_EXPECTED', `Tax withheld under ${w.atc} is usually ${formatPeso(expected)} on this payment. Please check the 2307.`);
      }
    }
    if (doc.vatWithheldCents > 0) {
      const expected = applyRate(netCents(), VAT_WITHHELD_BP);
      if (Math.abs(doc.vatWithheldCents - expected) > 100) {
        add('warning', 'withholding.vatWithheldCents', 'VAT_WITHHELD_EXPECTED', `VAT withheld by a government buyer is usually 5% of the amount before VAT, ${formatPeso(expected)} on this payment. Please check the 2307.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    const w = doc.withholding;
    db.prepare(
      `INSERT INTO col_collections (document_id, customer_id, customer_name, cr_number, cwt_cents, cwt_atc, cert_2307, vat_withheld_cents, unapplied_cents, short_over_cents, settle_small_difference, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.crNumber, doc.cwtCents, w?.atc ?? null, w?.certificate ?? null, doc.vatWithheldCents, doc.unappliedCents, doc.shortOverCents, doc.settleSmallDifference ? 1 : 0, doc.note ?? null);
    insertTenders(db, 'col_tenders', h.documentId, doc.tenders);
    const app = db.prepare(
      'INSERT INTO col_applications (document_id, line_no, job_order_id, amount_cents, to_receivable_cents, to_deposit_cents) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const a of doc.applications) app.run(h.documentId, a.lineNo, a.jobOrderId, a.amountCents, a.toReceivableCents, a.toDepositCents);
    const sale = db.prepare('INSERT INTO col_sale_applications (document_id, line_no, sale_id, amount_cents) VALUES (?, ?, ?, ?)');
    for (const a of doc.sales) sale.run(h.documentId, a.lineNo, a.saleId, a.amountCents);
    // Every deposit on a JO, whatever its mode: the JO's first one fixes its mode (deposit-vat.ts).
    recordDepositVat(db, h.documentId, 'original', doc.applications.filter((a) => a.toDepositCents > 0).map((a) => vatRow({
      jobOrderId: a.jobOrderId, customerId: doc.customerId, mode: a.depositVatMode, depositCents: a.toDepositCents,
      depositVatCents: a.depositVatCents, depositBaseCents: a.depositBaseCents, registerBaseCents: a.depositBaseCents,
    })));
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    return {
      memo: `Collection from ${doc.customerName}, CR ${doc.crNumber}`,
      lines: [
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, debitCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
        { account: { role: 'CWT' }, party, debitCents: doc.cwtCents, memo: `2307 ${doc.withholding?.atc ?? ''}`.trim() },
        { account: { role: 'VAT_WITHHELD' }, party, debitCents: doc.vatWithheldCents, memo: '2307 VAT withheld' },
        { account: { role: 'CASH_SHORT_OVER' }, debitCents: Math.max(0, -doc.shortOverCents), memo: 'Short' },
        ...doc.applications.flatMap((a) => [
          { account: { role: 'AR_TRADE' }, party, ref: { documentId: a.jobOrderId }, creditCents: a.toReceivableCents, memo: a.jobOrderNumber },
          { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref: { documentId: a.jobOrderId }, creditCents: a.toDepositCents, memo: `Deposit for ${a.jobOrderNumber}` },
        ]),
        ...doc.sales.map((a) => ({ account: { role: 'AR_TRADE' }, party, ref: { documentId: a.saleId }, creditCents: a.amountCents, memo: `Invoice no. ${a.invoiceNumber}` })),
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, creditCents: doc.unappliedCents, memo: 'Unapplied payment' },
        { account: { role: 'CASH_SHORT_OVER' }, creditCents: Math.max(0, doc.shortOverCents), memo: 'Over' },
        ...doc.applications.flatMap((a) => depositVatLines(doc.customerId, a.jobOrderId, a.jobOrderNumber, a.depositVatCents)), // DEP-VAT (mode B)
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(`SELECT c.*, d.total_cents FROM col_collections c JOIN documents d ON d.id = c.document_id WHERE c.document_id = ?`)
      .get(documentId) as
      | { customer_id: string; customer_name: string; cr_number: string; cwt_cents: number; cwt_atc: 'WC158' | 'WC160' | 'other' | null; cert_2307: 'pending' | 'received' | null;
          vat_withheld_cents: number; unapplied_cents: number; short_over_cents: number; settle_small_difference: number; note: string | null; total_cents: number }
      | undefined;
    if (!r) throw new Error(`Collection ${documentId} not found`);
    const vat = new Map(depositVatRowsOf(db, documentId).map((v) => [v.jobOrderId, v]));
    const applications = (
      db
        .prepare('SELECT line_no, job_order_id, amount_cents, to_receivable_cents, to_deposit_cents FROM col_applications WHERE document_id = ? ORDER BY line_no')
        .all(documentId) as { line_no: number; job_order_id: string; amount_cents: number; to_receivable_cents: number; to_deposit_cents: number }[]
    ).map((a) => ({
      jobOrderId: a.job_order_id,
      amountCents: a.amount_cents,
      lineNo: a.line_no,
      jobOrderNumber: jobOrderRef(db, a.job_order_id)?.number ?? '?',
      toReceivableCents: a.to_receivable_cents,
      toDepositCents: a.to_deposit_cents,
      // Recorded before these rows existed, or with no deposit: mode A.
      depositVatMode: vat.get(a.job_order_id)?.mode ?? 'A',
      depositVatCents: vat.get(a.job_order_id)?.depositVatCents ?? 0,
      depositBaseCents: vat.get(a.job_order_id)?.depositBaseCents ?? 0,
    }));
    const sales = (
      db.prepare('SELECT line_no, sale_id, amount_cents FROM col_sale_applications WHERE document_id = ? ORDER BY line_no').all(documentId) as { line_no: number; sale_id: string; amount_cents: number }[]
    ).map((a) => {
      const sale = saleRef(db, a.sale_id);
      return { saleId: a.sale_id, amountCents: a.amount_cents, lineNo: a.line_no, saleNumber: sale?.number ?? '?', invoiceNumber: sale?.invoiceNumber ?? '?' };
    });
    return {
      customerId: r.customer_id,
      crNumber: r.cr_number,
      ...(r.cwt_atc && r.cert_2307
        ? { withholding: { cwtCents: r.cwt_cents, atc: r.cwt_atc, certificate: r.cert_2307, ...(r.vat_withheld_cents > 0 ? { vatWithheldCents: r.vat_withheld_cents } : {}) } }
        : {}),
      ...(r.settle_small_difference ? { settleSmallDifference: true } : {}),
      ...(r.note ? { note: r.note } : {}),
      applications,
      sales,
      tenders: loadTenders(db, 'col_tenders', documentId),
      customerName: r.customer_name,
      cwtCents: r.cwt_cents,
      vatWithheldCents: r.vat_withheld_cents,
      appliedCents: sumCents(applications) + sumCents(sales),
      unappliedCents: r.unapplied_cents,
      shortOverCents: r.short_over_cents,
      totalCents: r.total_cents,
    };
  },

  toInput(doc) {
    const { customerId, crNumber, withholding, settleSmallDifference, note } = doc;
    return {
      customerId,
      crNumber,
      applications: doc.applications.map(({ jobOrderId, amountCents }) => ({ jobOrderId, amountCents })),
      ...(doc.sales.length > 0 ? { sales: doc.sales.map(({ saleId, amountCents }) => ({ saleId, amountCents })) } : {}),
      tenders: doc.tenders.map(tenderToInput),
      ...(withholding ? { withholding } : {}),
      ...(settleSmallDifference ? { settleSmallDifference } : {}),
      ...(note ? { note } : {}),
    };
  },

  /**
   * Refunds and deposit transfers that took out money this collection put in: cancelling the collection first would
   * leave the deposits account owing the customer less than nothing (D6). The part an invoice record applied reopens
   * the receivable instead (afterCancel), as long as the JO's receivable stays within what was invoiced.
   */
  dependents(db, documentId) {
    const d = collectionDoc.load(db, documentId);
    return [
      ...d.applications.flatMap((a) => takenOutBy(db, d.customerId, a.jobOrderId, a.toDepositCents, a.toReceivableCents)),
      ...(d.unappliedCents > 0 ? takenOutBy(db, d.customerId, null, d.unappliedCents, 0) : []),
    ];
  },

  afterCancel(db, documentId) {
    const d = collectionDoc.load(db, documentId);
    const settled = d.applications.map((a) => [a.jobOrderNumber, settleJobOrder(db, documentId, d.customerId, a.jobOrderId, a.jobOrderNumber)] as const).filter(([, l]) => l.length > 0);
    return settled.length > 0 ? { memo: `${settled.map(([n]) => n).join(', ')} receivable and deposits put back in line`, lines: settled.flatMap(([, l]) => l) } : null;
  },

  summary(doc) {
    const cash = sumCents(doc.tenders);
    const where = doc.tenders.length === 1 ? ` in ${doc.tenders[0]!.cashPlaceName}` : ` (${doc.tenders.map((t) => `${formatPeso(t.amountCents)} in ${t.cashPlaceName}`).join(', ')})`;
    const vat = doc.vatWithheldCents > 0 ? ` and ${formatPeso(doc.vatWithheldCents)} VAT withheld` : '';
    const cwt = doc.cwtCents > 0 ? ` plus ${formatPeso(doc.cwtCents)} tax withheld${vat} (2307)` : '';
    const uses = [
      ...doc.applications.map((a) => `${formatPeso(a.amountCents)} for ${a.jobOrderNumber}`),
      ...doc.sales.map((a) => `${formatPeso(a.amountCents)} for invoice no. ${a.invoiceNumber}`),
      ...(doc.unappliedCents > 0 ? [`${formatPeso(doc.unappliedCents)} kept as deposit`] : []),
    ];
    const diff = doc.shortOverCents === 0 ? '' : ` ${formatPeso(Math.abs(doc.shortOverCents))} ${doc.shortOverCents > 0 ? 'over' : 'short'} goes to cash short and over.`;
    return `This will record ${formatPeso(cash)} received from ${doc.customerName}${where}${cwt}, CR ${doc.crNumber}${uses.length ? `: ${uses.join(', ')}` : ''}.${diff}`;
  },

  arbitrary(db) {
    const vatBp = settingAt(db, 'tax.vat_rate_bp', manilaDate(new Date()));
    const places = listCashPlaces(db).map((c) => c.id);
    const byCustomer = new Map<string, { id: string; dueCents: number }[]>();
    for (const jo of jobOrdersOf(db)) {
      const dueCents = joMoney(db, jo.id).balanceDueCents;
      if (dueCents > 0 && customerRef(db, jo.customerId)?.is_active === 1) byCustomer.set(jo.customerId, [...(byCustomer.get(jo.customerId) ?? []), { id: jo.id, dueCents }]);
    }
    if (byCustomer.size === 0) throw new Error('col.collection.arbitrary needs an active customer with a job order that has a balance due');
    return fc.constantFrom(...byCustomer.keys()).chain((customerId) => {
      const app = fc.constantFrom(...byCustomer.get(customerId)!).chain((jo) => fc.integer({ min: 1, max: Math.min(jo.dueCents, 2_000_000) }).map((amountCents) => ({ jobOrderId: jo.id, amountCents })));
      return fc
        .record({
          applications: fc.uniqueArray(app, { maxLength: 2, selector: (a) => a.jobOrderId }),
          weights: fc.array(fc.tuple(fc.constantFrom(...places), fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 3 }),
          extraCents: fc.integer({ min: 0, max: 300_000 }), // received beyond the applied amount: kept as deposit
          cwtBp: fc.constantFrom(0, 100, 200),
          government: fc.boolean(), // also withholds 5% VAT (D4.6), only ever next to CWT
          cr: fc.integer({ min: 1, max: 99_999_999 }),
        })
        .map(({ applications, weights, extraCents, cwtBp, government, cr }) => {
          const applied = sumCents(applications);
          const total = Math.max(applied + extraCents, 1_000); // every tender gets at least a centavo
          const netCents = vatFromGross(total, vatBp).netCents;
          const cwtCents = cwtBp ? applyRate(netCents, cwtBp) : 0;
          const vatWithheldCents = cwtCents > 0 && government ? applyRate(netCents, VAT_WITHHELD_BP) : 0;
          const amounts = allocate(total - cwtCents - vatWithheldCents, weights.map(([, w]) => w));
          return {
            customerId,
            crNumber: String(cr).padStart(6, '0'),
            applications,
            tenders: weights.map(([cashPlaceId], i) => ({ cashPlaceId, amountCents: amounts[i]! })),
            ...(cwtCents > 0
              ? { withholding: { cwtCents, atc: cwtBp === 100 ? ('WC158' as const) : ('WC160' as const), certificate: 'pending' as const, ...(vatWithheldCents > 0 ? { vatWithheldCents } : {}) } }
              : {}),
          };
        });
    });
  },
};
