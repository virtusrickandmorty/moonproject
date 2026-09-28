/**
 * 2307 received with no cash (PLAN D5 CWT-ONLY): a customer's certificate for tax it withheld on an invoice it paid net,
 * when the collection that paid the rest did not record the withholding (a collection needs money in: at least one
 * tender). The invoice's receivable becomes creditable tax:
 *   Dr 1410 CWT (customer, the invoice as ref) / Cr 1201 AR (customer, the invoice's receivable: its job order or quick sale)
 * With the certificate's ATC and the quarter it covers; the 2307 is in hand (it is what this records). Never more than
 * the invoice still owes. Cancel mirrors.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { applyRate, formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { MAX_CENTS } from '../ledger.ts';
import { allInvoices, invoiceOf, invoiceWords, owedCents, type Invoice } from '../credits.ts';

/** Expected customer CWT by ATC (D4.6), on the invoice's amount before VAT. */
const CWT_BP = { WC158: 100, WC160: 200 } as const;

export const cwtOnlyInput = z
  .object({
    invoiceId: z.uuid(),
    cwtCents: z.number().int().positive().max(MAX_CENTS),
    atc: z.enum(['WC158', 'WC160', 'other']),
    periodYear: z.number().int().min(2000).max(2999), // the quarter the 2307 covers
    periodQuarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CwtOnlyInput = z.infer<typeof cwtOnlyInput>;

export interface CwtOnly extends CwtOnlyInput {
  invoice: Pick<Invoice, 'number' | 'invoiceNumber' | 'kind' | 'jobOrderNumber' | 'grossCents' | 'vatRateBp'>;
  customerId: string;
  customerName: string;
  arRefId: string;
  owedCents: number;
  totalCents: number;
}

const quarterOf = (date: string) => ({ year: Number(date.slice(0, 4)), quarter: Math.ceil(Number(date.slice(5, 7)) / 3) });

export const cwtOnlyDoc: DocTypeDef<CwtOnlyInput, CwtOnly> = {
  key: 'col.cwt_only',
  module: 'COL',
  title: '2307 Received',
  numbering: { series: { key: 'CWT', prefix: 'CWT-' } },
  permissions: { view: 'col.view', create: 'col.cwt_only', post: 'col.cwt_only', cancel: 'col.cwt_only' },
  dating: 'system',
  inputSchema: cwtOnlyInput,

  compute(input, ctx) {
    const inv = invoiceOf(ctx.db, input.invoiceId);
    return {
      ...input,
      invoice: { number: inv?.number ?? '?', invoiceNumber: inv?.invoiceNumber ?? '?', kind: inv?.kind ?? 'jo.invoice_record', jobOrderNumber: inv?.jobOrderNumber ?? null, grossCents: inv?.grossCents ?? 0, vatRateBp: inv?.vatRateBp ?? 0 },
      customerId: inv?.customerId ?? '',
      customerName: inv?.customerName ?? '?',
      arRefId: inv?.arRefId ?? '',
      owedCents: inv ? owedCents(ctx.db, inv) : 0,
      totalCents: input.cwtCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const inv = invoiceOf(ctx.db, doc.invoiceId);
    if (!inv) return [{ field: 'invoiceId', code: 'INVOICE', level: 'error', message: 'Pick the invoice the customer withheld tax on.' }];
    const words = invoiceWords(inv);
    if (inv.status !== 'posted') add('error', 'invoiceId', 'INVOICE_CANCELLED', `${words} is cancelled, so no tax withheld can be recorded on it.`);
    else if (doc.cwtCents > doc.owedCents) {
      add('error', 'cwtCents', 'OVER_OWED', doc.owedCents > 0 ? `${words} still owes ${formatPeso(doc.owedCents)}. The tax withheld cannot be more than that.` : `${words} owes nothing. If the customer's payment already counted the tax, cancel that collection and record it again with the 2307.`);
    }
    const now = quarterOf(ctx.businessDate);
    if (doc.periodYear * 4 + doc.periodQuarter > now.year * 4 + now.quarter) add('error', 'periodQuarter', 'FUTURE_PERIOD', `Q${doc.periodQuarter} ${doc.periodYear} has not started. Pick the quarter printed on the 2307.`);
    if (doc.atc !== 'other') {
      const expected = applyRate(vatFromGross(inv.grossCents, inv.vatRateBp).netCents, CWT_BP[doc.atc]);
      if (Math.abs(doc.cwtCents - expected) > 100) add('warning', 'cwtCents', 'CWT_EXPECTED', `Tax withheld under ${doc.atc} on ${words} is usually ${formatPeso(expected)}. Please check the 2307.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO col_cwt_only (document_id, customer_id, customer_name, invoice_id, ar_ref_id, cwt_cents, atc, period_year, period_quarter, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.invoiceId, doc.arRefId, doc.cwtCents, doc.atc, doc.periodYear, doc.periodQuarter, doc.note ?? null);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    const words = `Invoice no. ${doc.invoice.invoiceNumber}`;
    return {
      memo: `2307 from ${doc.customerName} on invoice no. ${doc.invoice.invoiceNumber}, Q${doc.periodQuarter} ${doc.periodYear}, no cash`,
      lines: [
        { account: { role: 'CWT' }, party, ref: { documentId: doc.invoiceId }, debitCents: doc.cwtCents, memo: `2307 ${doc.atc}` },
        { account: { role: 'AR_TRADE' }, party, ref: { documentId: doc.arRefId }, creditCents: doc.cwtCents, memo: words },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare('SELECT invoice_id, cwt_cents, atc, period_year, period_quarter, note, customer_id, customer_name, ar_ref_id FROM col_cwt_only WHERE document_id = ?')
      .get(documentId) as { invoice_id: string; cwt_cents: number; atc: CwtOnlyInput['atc']; period_year: number; period_quarter: 1 | 2 | 3 | 4; note: string | null; customer_id: string; customer_name: string; ar_ref_id: string } | undefined;
    if (!r) throw new Error(`2307 received ${documentId} not found`);
    const inv = invoiceOf(db, r.invoice_id)!;
    return {
      invoiceId: r.invoice_id,
      cwtCents: r.cwt_cents,
      atc: r.atc,
      periodYear: r.period_year,
      periodQuarter: r.period_quarter,
      ...(r.note ? { note: r.note } : {}),
      invoice: { number: inv.number, invoiceNumber: inv.invoiceNumber, kind: inv.kind, jobOrderNumber: inv.jobOrderNumber, grossCents: inv.grossCents, vatRateBp: inv.vatRateBp },
      customerId: r.customer_id,
      customerName: r.customer_name,
      arRefId: r.ar_ref_id,
      owedCents: 0, // what it owed when recorded is not kept; the receivable reads from the ledger
      totalCents: r.cwt_cents,
    };
  },

  toInput: ({ invoiceId, cwtCents, atc, periodYear, periodQuarter, note }) => ({ invoiceId, cwtCents, atc, periodYear, periodQuarter, ...(note ? { note } : {}) }),

  summary(doc) {
    return `This will record ${doc.customerName}'s 2307 for ${formatPeso(doc.cwtCents)} tax withheld (${doc.atc}, Q${doc.periodQuarter} ${doc.periodYear}) on ${invoiceWords(doc.invoice)}. No cash comes in: the tax is taken off what the invoice owes and kept as a credit against income tax.`;
  },

  arbitrary(db) {
    const open = allInvoices(db).filter((x) => x.owedCents > 0);
    if (open.length === 0) throw new Error('col.cwt_only.arbitrary needs a recorded invoice that still owes something');
    return fc
      .record({ inv: fc.constantFrom(...open), atc: fc.constantFrom('WC158' as const, 'WC160' as const, 'other' as const), pct: fc.integer({ min: 1, max: 100 }) })
      .map(({ inv, atc, pct }) => {
        const { year, quarter } = quarterOf(inv.businessDate); // the invoice's quarter: never in the future
        return { invoiceId: inv.id, cwtCents: Math.max(1, Math.floor((inv.owedCents * pct) / 100)), atc, periodYear: year, periodQuarter: quarter as 1 | 2 | 3 | 4 };
      });
  },
};
