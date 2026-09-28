/**
 * Deposit forfeit (PLAN D5 DEP-FORFEIT, D6, ACC-15): the customer abandons a job order and its deposit is kept, as the
 * terms say. Owner or accountant (col.forfeit).
 *   Dr 2201 customer deposits (customer, the JO) / Cr 7103 other income (the amount, or its NET when VATable)
 *                                                / Cr 2301 output VAT (customer), 12/112 of it, only when VATable
 * VATable or not is the accountant's dated setting col.forfeit_vatable (ACC-15; default no, and the preview flags it).
 * A recorded job order is marked abandoned (a stage event: Closed, abandoned): nothing more is released on it, and no
 * new deposit is taken; with no release waiting for its invoice (refused otherwise), nothing more is invoiced either. A
 * cancelled job order's deposit can be forfeited too (D6). One recorded forfeit per job order. Cancel mirrors and puts
 * the job order back on the stage it was abandoned from.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { abandon, awaitingInvoice, currentStage, isAbandoned, jobOrderRef, jobOrdersOf, unabandon } from '../../JO/public.ts';
import { MAX_CENTS, depositsHeld } from '../ledger.ts';

export const forfeitInput = z
  .object({
    jobOrderId: z.uuid(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // all of the deposit, or the part the terms keep
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type ForfeitInput = z.infer<typeof forfeitInput>;

export interface Forfeit extends ForfeitInput {
  jobOrderNumber: string;
  customerId: string;
  customerName: string;
  heldCents: number;
  vatable: boolean;
  vatRateBp: number;
  vatCents: number;
  incomeCents: number;
  totalCents: number;
}

const forfeitOn = (db: Parameters<typeof depositsHeld>[0], jobOrderId: string) =>
  db.prepare(`SELECT d.number FROM col_forfeits f JOIN documents d ON d.id = f.document_id WHERE f.job_order_id = ? AND d.status = 'posted'`).pluck().get(jobOrderId) as string | undefined;

export const forfeitDoc: DocTypeDef<ForfeitInput, Forfeit> = {
  key: 'col.forfeit',
  module: 'COL',
  title: 'Deposit Forfeit',
  numbering: { series: { key: 'DFF', prefix: 'DFF-' } },
  permissions: { view: 'col.view', create: 'col.forfeit', post: 'col.forfeit', cancel: 'col.forfeit' },
  dating: 'system',
  inputSchema: forfeitInput,

  compute(input, ctx) {
    const jo = jobOrderRef(ctx.db, input.jobOrderId);
    const vatable = settingAt(ctx.db, 'col.forfeit_vatable', ctx.businessDate);
    const vatRateBp = vatable ? settingAt(ctx.db, 'tax.vat_rate_bp', ctx.businessDate) : 0;
    const vatCents = vatable ? vatFromGross(input.amountCents, vatRateBp).vatCents : 0;
    return {
      ...input,
      jobOrderNumber: jo?.number ?? '?',
      customerId: jo?.customerId ?? '',
      customerName: jo?.customerName ?? '?',
      heldCents: jo ? depositsHeld(ctx.db, jo.customerId, jo.id) : 0,
      vatable,
      vatRateBp,
      vatCents,
      incomeCents: input.amountCents - vatCents,
      totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const jo = jobOrderRef(ctx.db, doc.jobOrderId);
    if (!jo) return [{ field: 'jobOrderId', code: 'JOB_ORDER', level: 'error', message: 'Pick the job order the customer abandoned.' }];
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const earlier = forfeitOn(ctx.db, jo.id);
    if (earlier) add('error', 'jobOrderId', 'FORFEITED', `${jo.number}'s deposit was already forfeited on ${earlier}. Cancel that one first to forfeit a different amount.`);
    if (jo.status === 'posted') {
      const stage = currentStage(ctx.db, jo.id);
      if ((stage === 'released' || stage === 'closed') && !isAbandoned(ctx.db, jo.id)) {
        add('error', 'jobOrderId', 'JO_RELEASED', `${jo.number} was released to the customer, so it was not abandoned. Money held on it is an overpayment: refund it or move it.`);
      }
      const waiting = awaitingInvoice(ctx.db, jo.id);
      if (waiting.length > 0) add('error', 'jobOrderId', 'INVOICE_TO_FOLLOW', `${waiting.map((r) => r.number).join(', ')} of ${jo.number} still waits for its invoice. Record the invoice first.`);
    }
    if (doc.amountCents > doc.heldCents) {
      add('error', 'amountCents', 'OVER_HELD', doc.heldCents > 0 ? `Only ${formatPeso(doc.heldCents)} is held for ${jo.number}.` : `No deposit is held for ${jo.number}.`);
    } else if (doc.amountCents < doc.heldCents) {
      add('warning', 'amountCents', 'PART_KEPT', `${formatPeso(doc.heldCents - doc.amountCents)} stays held for ${doc.customerName}: refund it or move it to another job order.`);
    }
    add('warning', 'amountCents', 'ACC_15', doc.vatable
      ? `The accountant set forfeited deposits as VATable (ACC-15): ${formatPeso(doc.vatCents)} goes to output VAT. A sales invoice may be needed for it.`
      : 'Kept as other income with no VAT, the default until the accountant decides (ACC-15). The accountant should confirm this one.');
    return issues;
  },

  persist(db, doc, h) {
    const who = db.prepare('SELECT posted_by AS userId, posted_at AS at FROM documents WHERE id = ?').get(h.documentId) as { userId: string; at: string };
    const marked = abandon(db, doc.jobOrderId, `Abandoned: deposit forfeited on ${h.number}`, who);
    db.prepare(
      'INSERT INTO col_forfeits (document_id, customer_id, customer_name, job_order_id, vatable, vat_rate_bp, vat_cents, marked_abandoned, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(h.documentId, doc.customerId, doc.customerName, doc.jobOrderId, doc.vatable ? 1 : 0, doc.vatRateBp, doc.vatCents, marked ? 1 : 0, doc.reason);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    return {
      memo: `Deposit of ${doc.jobOrderNumber} forfeited: ${doc.customerName} abandoned the order`,
      lines: [
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref: { documentId: doc.jobOrderId }, debitCents: doc.amountCents, memo: `Deposit for ${doc.jobOrderNumber}` },
        { account: { role: 'OTHER_INCOME' }, creditCents: doc.incomeCents, memo: `Forfeited deposit, ${doc.jobOrderNumber}` },
        { account: { role: 'OUTPUT_VAT' }, party, creditCents: doc.vatCents, memo: `VAT on the forfeited deposit (ACC-15)` },
      ],
    };
  },

  afterCancel(db, documentId, h) {
    const r = db.prepare('SELECT job_order_id, marked_abandoned FROM col_forfeits WHERE document_id = ?').get(documentId) as { job_order_id: string; marked_abandoned: number };
    if (r.marked_abandoned) unabandon(db, r.job_order_id, `${h.number} cancelled`, h);
    return null;
  },

  load(db, documentId) {
    const r = db
      .prepare('SELECT f.*, d.total_cents FROM col_forfeits f JOIN documents d ON d.id = f.document_id WHERE f.document_id = ?')
      .get(documentId) as { job_order_id: string; customer_id: string; customer_name: string; vatable: number; vat_rate_bp: number; vat_cents: number; reason: string; total_cents: number } | undefined;
    if (!r) throw new Error(`Forfeit ${documentId} not found`);
    return {
      jobOrderId: r.job_order_id,
      amountCents: r.total_cents,
      reason: r.reason,
      jobOrderNumber: jobOrderRef(db, r.job_order_id)?.number ?? '?',
      customerId: r.customer_id,
      customerName: r.customer_name,
      heldCents: 0, // as it was when recorded is not kept
      vatable: r.vatable === 1,
      vatRateBp: r.vat_rate_bp,
      vatCents: r.vat_cents,
      incomeCents: r.total_cents - r.vat_cents,
      totalCents: r.total_cents,
    };
  },

  toInput: ({ jobOrderId, amountCents, reason }) => ({ jobOrderId, amountCents, reason }),

  summary(doc) {
    const vat = doc.vatable ? ` (other income ${formatPeso(doc.incomeCents)}, output VAT ${formatPeso(doc.vatCents)})` : ' as other income, no VAT';
    return `This will keep ${formatPeso(doc.amountCents)} of ${doc.customerName}'s deposit for ${doc.jobOrderNumber}${vat}, and mark ${doc.jobOrderNumber} abandoned: nothing more is released or invoiced on it.`;
  },

  arbitrary(db) {
    const open = jobOrdersOf(db, undefined, true)
      .filter((jo) => !forfeitOn(db, jo.id) && awaitingInvoice(db, jo.id).length === 0)
      .filter((jo) => jo.status === 'cancelled' || !['released', 'closed'].includes(currentStage(db, jo.id)))
      .map((jo) => ({ id: jo.id, held: depositsHeld(db, jo.customerId, jo.id) }))
      .filter((jo) => jo.held > 0);
    if (open.length === 0) throw new Error('col.forfeit.arbitrary needs a job order with a deposit held, not released');
    return fc
      .record({ jo: fc.constantFrom(...open), pct: fc.integer({ min: 1, max: 100 }) })
      .map(({ jo, pct }) => ({ jobOrderId: jo.id, amountCents: Math.max(1, Math.floor((jo.held * pct) / 100)), reason: 'Customer stopped answering; terms keep the deposit' }));
  },
};
