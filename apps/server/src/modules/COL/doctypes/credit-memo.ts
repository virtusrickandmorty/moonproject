/**
 * Credit memo (CM-, PLAN D5 CM-ALLOW, D4.3): a return or allowance on a recorded invoice, by the accountant, with a reason
 * and the manual credit memo form's number when one is used (ACC-08). VAT at the invoice's own rate (D4.1); a memo that
 * credits all that is left of the invoice takes all that is left of its VAT, so the invoice's VAT is reversed exactly.
 *   Dr 4191 sales returns and allowances (NET) ; Dr 2301 output VAT (VAT)            (customer)
 *     / Cr 1201 AR (what the invoice still owes, up to the amount; the invoice's receivable: job order or quick sale)
 *     / Cr 2201 customer deposits (the part already paid: customer credit, on the job order or unapplied for a quick
 *       sale, to refund or move as today)
 * Never more than the invoice less its earlier credit memos, and not on a cancelled or written-off invoice. The output
 * VAT goes down in the memo's own quarter: the sales register, the VAT summary, the 2550Q worksheet and the VAT close read
 * 2301 and revenue from the ledger (TAX), so they take it there. Cancel mirrors.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settleJobOrder } from './deposit-vat.ts';
import { MAX_CENTS, takenOutBy } from '../ledger.ts';
import { allInvoices, invoiceOf, invoiceWords, memosOn, owedCents, writeOffsOn, type Invoice } from '../credits.ts';

export const creditMemoInput = z
  .object({
    invoiceId: z.uuid(),
    kind: z.enum(['return', 'allowance']),
    amountCents: z.number().int().positive().max(MAX_CENTS), // VAT-inclusive, like the invoice
    formNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the credit memo form (digits only).').optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type CreditMemoInput = z.infer<typeof creditMemoInput>;

export interface CreditMemo extends CreditMemoInput {
  invoice: Pick<Invoice, 'number' | 'invoiceNumber' | 'kind' | 'jobOrderNumber' | 'grossCents' | 'vatCents'>;
  customerId: string;
  customerName: string;
  arRefId: string;
  jobOrderId: string | null;
  vatRateBp: number;
  netCents: number;
  vatCents: number;
  /** Taken off what the invoice owes (Cr 1201). */
  arCents: number;
  /** Already paid, so held for the customer (Cr 2201). */
  creditCents: number;
  /** What earlier credit memos left of the invoice. */
  creditableCents: number;
  totalCents: number;
}

const KIND_WORDS = { return: 'a return', allowance: 'an allowance' } as const;

export const creditMemoDoc: DocTypeDef<CreditMemoInput, CreditMemo> = {
  key: 'col.credit_memo',
  module: 'COL',
  title: 'Credit Memo',
  numbering: { series: { key: 'CM', prefix: 'CM-' } },
  permissions: { view: 'col.view', create: 'col.credit_memo', post: 'col.credit_memo', cancel: 'col.credit_memo' },
  dating: 'system',
  inputSchema: creditMemoInput,
  externalNumber: (doc) => doc.formNumber ?? null,

  compute(input, ctx) {
    const inv = invoiceOf(ctx.db, input.invoiceId);
    const earlier = memosOn(ctx.db, input.invoiceId);
    const creditableCents = (inv?.grossCents ?? 0) - earlier.amountCents;
    const vatRateBp = inv?.vatRateBp ?? 0;
    const vatCents = inv && input.amountCents === creditableCents ? inv.vatCents - earlier.vatCents : vatFromGross(input.amountCents, vatRateBp).vatCents;
    const arCents = Math.min(input.amountCents, inv ? owedCents(ctx.db, inv) : 0);
    return {
      ...input,
      invoice: { number: inv?.number ?? '?', invoiceNumber: inv?.invoiceNumber ?? '?', kind: inv?.kind ?? 'jo.invoice_record', jobOrderNumber: inv?.jobOrderNumber ?? null, grossCents: inv?.grossCents ?? 0, vatCents: inv?.vatCents ?? 0 },
      customerId: inv?.customerId ?? '',
      customerName: inv?.customerName ?? '?',
      arRefId: inv?.arRefId ?? '',
      jobOrderId: inv?.jobOrderId ?? null,
      vatRateBp,
      netCents: input.amountCents - vatCents,
      vatCents,
      arCents,
      creditCents: input.amountCents - arCents,
      creditableCents,
      totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const inv = invoiceOf(ctx.db, doc.invoiceId);
    if (!inv) return [{ field: 'invoiceId', code: 'INVOICE', level: 'error', message: 'Pick the invoice this credit memo is for.' }];
    const words = invoiceWords(inv);
    if (inv.status !== 'posted') return [{ field: 'invoiceId', code: 'INVOICE_CANCELLED', level: 'error', message: `${words} is cancelled, so there is nothing to credit. Its sale was already taken back.` }];
    const off = writeOffsOn(ctx.db, inv.arRefId).find((w) => w.invoiceId === inv.id);
    if (off) add('error', 'invoiceId', 'WRITTEN_OFF', `${words} was written off (${off.number}). Cancel the write-off first.`);
    if (doc.amountCents > doc.creditableCents) {
      const earlier = doc.creditableCents < inv.grossCents ? ` less its earlier credit memos` : '';
      add('error', 'amountCents', 'OVER_INVOICE', doc.creditableCents > 0 ? `${words} is ${formatPeso(inv.grossCents)}${earlier}: at most ${formatPeso(doc.creditableCents)} can be credited.` : `${words} is already fully credited.`);
    }
    if (doc.vatCents < 0 || doc.netCents < 0) add('error', 'amountCents', 'VAT', 'The VAT of this credit is more than what is left of the invoice VAT. Credit all that is left instead.');
    if (doc.formNumber) {
      const used = ctx.db
        .prepare(`SELECT d.number, d.status FROM col_credit_memos m JOIN documents d ON d.id = m.document_id WHERE CAST(m.form_number AS INTEGER) = CAST(? AS INTEGER)`)
        .get(doc.formNumber) as { number: string; status: string } | undefined;
      if (used) add('error', 'formNumber', 'FORM_USED', `Credit memo form no. ${doc.formNumber} is already used on ${used.number}${used.status === 'cancelled' ? ' (cancelled)' : ''}. Each form number is used once.`);
    }
    if (doc.creditCents > 0 && doc.amountCents <= doc.creditableCents) {
      const held = inv.jobOrderNumber ? `held on ${inv.jobOrderNumber}` : 'kept as unapplied payments';
      add('warning', 'amountCents', 'ALREADY_PAID', `${formatPeso(doc.creditCents)} of this was already paid. It becomes ${doc.customerName}'s credit, ${held}: refund it or move it to another job order.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO col_credit_memos (document_id, customer_id, customer_name, invoice_id, ar_ref_id, job_order_id, kind, form_number, vat_rate_bp, net_cents, vat_cents, ar_cents, credit_cents, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.invoiceId, doc.arRefId, doc.jobOrderId, doc.kind, doc.formNumber ?? null, doc.vatRateBp, doc.netCents, doc.vatCents, doc.arCents, doc.creditCents, doc.reason);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    const on = `invoice no. ${doc.invoice.invoiceNumber}`;
    return {
      memo: `Credit memo to ${doc.customerName} on ${on}: ${doc.kind}${doc.formNumber ? `, form no. ${doc.formNumber}` : ''}`,
      lines: [
        { account: { role: 'SALES_RETURNS' }, party, debitCents: doc.netCents, memo: `${doc.kind === 'return' ? 'Return' : 'Allowance'} on ${on}` },
        { account: { role: 'OUTPUT_VAT' }, party, debitCents: doc.vatCents, memo: `VAT on ${on} reversed` },
        { account: { role: 'AR_TRADE' }, party, ref: { documentId: doc.arRefId }, creditCents: doc.arCents, memo: `Invoice no. ${doc.invoice.invoiceNumber}` },
        {
          account: { role: 'CUSTOMER_DEPOSITS' }, party, ...(doc.jobOrderId ? { ref: { documentId: doc.jobOrderId } } : {}), creditCents: doc.creditCents,
          memo: `Credit on ${on}, already paid`,
        },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(`SELECT m.*, d.total_cents FROM col_credit_memos m JOIN documents d ON d.id = m.document_id WHERE m.document_id = ?`)
      .get(documentId) as
      | { invoice_id: string; kind: 'return' | 'allowance'; form_number: string | null; reason: string; customer_id: string; customer_name: string; ar_ref_id: string;
          job_order_id: string | null; vat_rate_bp: number; net_cents: number; vat_cents: number; ar_cents: number; credit_cents: number; total_cents: number }
      | undefined;
    if (!r) throw new Error(`Credit memo ${documentId} not found`);
    const inv = invoiceOf(db, r.invoice_id)!;
    return {
      invoiceId: r.invoice_id,
      kind: r.kind,
      amountCents: r.total_cents,
      ...(r.form_number ? { formNumber: r.form_number } : {}),
      reason: r.reason,
      invoice: { number: inv.number, invoiceNumber: inv.invoiceNumber, kind: inv.kind, jobOrderNumber: inv.jobOrderNumber, grossCents: inv.grossCents, vatCents: inv.vatCents },
      customerId: r.customer_id,
      customerName: r.customer_name,
      arRefId: r.ar_ref_id,
      jobOrderId: r.job_order_id,
      vatRateBp: r.vat_rate_bp,
      netCents: r.net_cents,
      vatCents: r.vat_cents,
      arCents: r.ar_cents,
      creditCents: r.credit_cents,
      creditableCents: 0, // as it was when recorded is not kept
      totalCents: r.total_cents,
    };
  },

  /**
   * Refunds and deposit transfers that took out the customer credit this memo made: cancelling it first would leave the
   * deposits account below zero (D6). On a job order, the part a later invoice applied reopens the receivable instead
   * (afterCancel), as a collection's cancel does.
   */
  dependents(db, documentId) {
    const d = creditMemoDoc.load(db, documentId);
    return d.creditCents > 0 ? takenOutBy(db, d.customerId, d.jobOrderId, d.creditCents, d.arCents) : [];
  },

  afterCancel(db, documentId) {
    const d = creditMemoDoc.load(db, documentId);
    const lines = d.jobOrderId ? settleJobOrder(db, documentId, d.customerId, d.jobOrderId, d.invoice.jobOrderNumber ?? '?') : [];
    return lines.length > 0 ? { memo: `${d.invoice.jobOrderNumber} receivable and deposits put back in line`, lines } : null;
  },

  toInput: ({ invoiceId, kind, amountCents, formNumber, reason }) => ({ invoiceId, kind, amountCents, ...(formNumber ? { formNumber } : {}), reason }),

  summary(doc) {
    const split = [
      ...(doc.arCents > 0 ? [`${formatPeso(doc.arCents)} off what it still owes`] : []),
      ...(doc.creditCents > 0 ? [`${formatPeso(doc.creditCents)} already paid, kept as ${doc.customerName}'s credit`] : []),
    ];
    const form = doc.formNumber ? `, form no. ${doc.formNumber}` : '';
    return `This will record ${KIND_WORDS[doc.kind]} of ${formatPeso(doc.amountCents)} to ${doc.customerName} on ${invoiceWords(doc.invoice)}${form}: sales ${formatPeso(doc.netCents)} and output VAT ${formatPeso(doc.vatCents)} go down this quarter; ${split.join(' and ')}.`;
  },

  arbitrary(db) {
    const open = allInvoices(db)
      .filter((i) => writeOffsOn(db, i.arRefId).every((w) => w.invoiceId !== i.id))
      .map((i) => ({ id: i.id, left: i.grossCents - memosOn(db, i.id).amountCents }))
      .filter((i) => i.left > 0);
    if (open.length === 0) throw new Error('col.credit_memo.arbitrary needs a recorded invoice that is not fully credited or written off');
    return fc
      .record({ inv: fc.constantFrom(...open), kind: fc.constantFrom('return' as const, 'allowance' as const), pct: fc.integer({ min: 1, max: 100 }) })
      .map(({ inv, kind, pct }) => ({ invoiceId: inv.id, kind, amountCents: Math.max(1, Math.floor((inv.left * pct) / 100)), reason: 'Customer returned some of the pieces' }));
  },
};
