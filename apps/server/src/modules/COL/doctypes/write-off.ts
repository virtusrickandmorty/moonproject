/**
 * Bad debt write-off (PLAN D5 BAD-DEBT): the accountant writes off all an invoice still owes, with a reason. The method
 * is the accountant's dated setting acc.bad_debt_method on the write-off's date (ACC-26; default direct):
 *   direct:    Dr 6270 bad debts (customer) / Cr 1201 AR (customer, the invoice's receivable: its job order or quick sale)
 *   allowance: Dr 1209 allowance for credit losses (customer) / Cr 1201, refused when the allowance is short (the
 *              customer's own, or all of it when the latest allowance was made in total: allowance.ts), naming the shortfall.
 * Output VAT is not reversed (the sale stands; only the money will not come). A collection on a written-off invoice is
 * refused until the write-off is cancelled (collection.ts). Cancel mirrors, on the cancel date: that is how a recovery
 * is recorded under both methods (the receivable comes back, crediting 6270 or 1209 as the write-off debited), and then
 * the collection is taken as usual.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { allInvoices, invoiceOf, invoiceWords, owedCents, writeOffsOn, type Invoice } from '../credits.ts';
import { allowanceAvailable, writeOffMethod } from '../allowance.ts';

export const writeOffInput = z.object({ invoiceId: z.uuid(), reason: z.string().trim().min(10).max(500) }).strict();
export type WriteOffInput = z.infer<typeof writeOffInput>;

export interface WriteOff extends WriteOffInput {
  invoice: Pick<Invoice, 'number' | 'invoiceNumber' | 'kind' | 'jobOrderNumber' | 'grossCents'>;
  customerId: string;
  customerName: string;
  arRefId: string;
  /** The bad-debt method on the write-off's date (acc.bad_debt_method). */
  method: 'direct' | 'allowance';
  totalCents: number;
}

export const writeOffDoc: DocTypeDef<WriteOffInput, WriteOff> = {
  key: 'col.write_off',
  module: 'COL',
  title: 'Bad Debt Write-off',
  numbering: { series: { key: 'BDW', prefix: 'BDW-' } },
  permissions: { view: 'col.view', create: 'col.write_off', post: 'col.write_off', cancel: 'col.write_off' },
  dating: 'system',
  inputSchema: writeOffInput,

  compute(input, ctx) {
    const inv = invoiceOf(ctx.db, input.invoiceId);
    return {
      ...input,
      invoice: { number: inv?.number ?? '?', invoiceNumber: inv?.invoiceNumber ?? '?', kind: inv?.kind ?? 'jo.invoice_record', jobOrderNumber: inv?.jobOrderNumber ?? null, grossCents: inv?.grossCents ?? 0 },
      customerId: inv?.customerId ?? '',
      customerName: inv?.customerName ?? '?',
      arRefId: inv?.arRefId ?? '',
      method: settingAt(ctx.db, 'acc.bad_debt_method', ctx.businessDate),
      totalCents: inv ? owedCents(ctx.db, inv) : 0,
    };
  },

  validate(doc, ctx) {
    const inv = invoiceOf(ctx.db, doc.invoiceId);
    if (!inv) return [{ field: 'invoiceId', code: 'INVOICE', level: 'error', message: 'Pick the invoice to write off.' }];
    const words = invoiceWords(inv);
    if (inv.status !== 'posted') return [{ field: 'invoiceId', code: 'INVOICE_CANCELLED', level: 'error', message: `${words} is cancelled, so there is nothing to write off.` }];
    const issues: Issue[] = [];
    const off = writeOffsOn(ctx.db, inv.arRefId).find((w) => w.invoiceId === inv.id);
    if (off) issues.push({ field: 'invoiceId', code: 'WRITTEN_OFF', level: 'error', message: `${words} is already written off (${off.number}).` });
    else if (doc.totalCents <= 0) issues.push({ field: 'invoiceId', code: 'NOTHING_OWED', level: 'error', message: `${words} owes nothing, so there is nothing to write off.` });
    else if (doc.method === 'allowance') {
      const a = allowanceAvailable(ctx.db, doc.customerId, ctx.businessDate);
      if (a.cents < doc.totalCents) {
        const held = a.basis === 'total' ? 'The allowance for credit losses holds' : `The allowance for credit losses holds for ${doc.customerName}`;
        issues.push({
          field: 'invoiceId', code: 'ALLOWANCE_SHORT', level: 'error',
          message: `${held} ${formatPeso(Math.max(a.cents, 0))}, ${formatPeso(doc.totalCents - Math.max(a.cents, 0))} short of the ${formatPeso(doc.totalCents)} to write off. Raise the allowance first (Allowance for Credit Losses).`,
        });
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO col_write_offs (document_id, customer_id, customer_name, invoice_id, ar_ref_id, reason) VALUES (?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.customerId, doc.customerName, doc.invoiceId, doc.arRefId, doc.reason,
    );
    db.prepare('INSERT INTO col_write_off_methods (document_id, method) VALUES (?, ?)').run(h.documentId, doc.method);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    return {
      memo: `Bad debt: ${doc.customerName}, invoice no. ${doc.invoice.invoiceNumber} written off`,
      lines: [
        { account: { role: doc.method === 'allowance' ? 'AR_ALLOWANCE' : 'BAD_DEBTS' }, party, debitCents: doc.totalCents, memo: `Invoice no. ${doc.invoice.invoiceNumber}` },
        { account: { role: 'AR_TRADE' }, party, ref: { documentId: doc.arRefId }, creditCents: doc.totalCents, memo: `Invoice no. ${doc.invoice.invoiceNumber} written off` },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare('SELECT w.invoice_id, w.reason, w.customer_id, w.customer_name, w.ar_ref_id, d.total_cents FROM col_write_offs w JOIN documents d ON d.id = w.document_id WHERE w.document_id = ?')
      .get(documentId) as { invoice_id: string; reason: string; customer_id: string; customer_name: string; ar_ref_id: string; total_cents: number } | undefined;
    if (!r) throw new Error(`Write-off ${documentId} not found`);
    const inv = invoiceOf(db, r.invoice_id)!;
    return {
      invoiceId: r.invoice_id,
      reason: r.reason,
      invoice: { number: inv.number, invoiceNumber: inv.invoiceNumber, kind: inv.kind, jobOrderNumber: inv.jobOrderNumber, grossCents: inv.grossCents },
      customerId: r.customer_id,
      customerName: r.customer_name,
      arRefId: r.ar_ref_id,
      method: writeOffMethod(db, documentId),
      totalCents: r.total_cents,
    };
  },

  toInput: ({ invoiceId, reason }) => ({ invoiceId, reason }),

  summary(doc) {
    return `This will write off ${formatPeso(doc.totalCents)} that ${doc.customerName} still owes on ${invoiceWords(doc.invoice)} as a bad debt${doc.method === 'allowance' ? ', against the allowance for credit losses' : ''}. Its output VAT stays as it is, and no payment on it is taken until the write-off is cancelled.`;
  },

  arbitrary(db) {
    const open = allInvoices(db).filter((i) => i.owedCents > 0 && writeOffsOn(db, i.arRefId).every((w) => w.invoiceId !== i.id));
    if (open.length === 0) throw new Error('col.write_off.arbitrary needs a recorded invoice that still owes something');
    return fc.constantFrom(...open).map((i) => ({ invoiceId: i.id, reason: 'Customer closed shop and cannot be reached' }));
  },
};
