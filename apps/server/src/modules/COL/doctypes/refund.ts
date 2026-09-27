/**
 * Customer Refund (PLAN D5 DEP-REFUND): pays back money held for a customer, either a job order's deposits or the
 * customer's unapplied payments.
 *   Dr 2201 customer deposits (customer, + the JO when it is a JO's deposit) / Cr cash place (per tender)
 * A deposit that came with tax withheld (2307) is refunded in cash only; the withheld part stays and the accountant
 * is warned (ACC-14 default).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { customerRef } from '../../CUS/public.ts';
import { jobOrderRef } from '../../JO/public.ts';
import { cashPlaceIssues, depositsHeld, insertTenders, loadTenders, sumCents, tenderInput, tenderToInput, withNames, type Tender } from '../ledger.ts';

export const refundInput = z
  .object({
    customerId: z.uuid(),
    jobOrderId: z.uuid().optional(), // the JO whose deposit is paid back; left out = the customer's unapplied payments
    tenders: z.array(tenderInput).min(1).max(5), // where the money came from
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type RefundInput = z.infer<typeof refundInput>;

export interface Refund extends Omit<RefundInput, 'tenders'> {
  tenders: Tender[];
  customerName: string;
  jobOrderNumber: string | null;
  totalCents: number;
}

export const refundDoc: DocTypeDef<RefundInput, Refund> = {
  key: 'col.refund',
  module: 'COL',
  title: 'Customer Refund',
  numbering: { series: { key: 'RFD', prefix: 'RFD-' } },
  permissions: { view: 'col.view', create: 'col.refund', post: 'col.refund', cancel: 'col.refund' },
  dating: 'system',
  inputSchema: refundInput,

  compute(input, ctx) {
    return {
      ...input,
      tenders: withNames(ctx.db, input.tenders),
      customerName: customerRef(ctx.db, input.customerId)?.display_name ?? '?',
      jobOrderNumber: input.jobOrderId ? (jobOrderRef(ctx.db, input.jobOrderId)?.number ?? '?') : null,
      totalCents: sumCents(input.tenders),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!customerRef(ctx.db, doc.customerId)) add('error', 'customerId', 'CUSTOMER', 'Pick a customer.');
    const jo = doc.jobOrderId ? jobOrderRef(ctx.db, doc.jobOrderId) : undefined;
    if (doc.jobOrderId && jo?.customerId !== doc.customerId) add('error', 'jobOrderId', 'JOB_ORDER', `Pick one of ${doc.customerName}'s job orders.`);
    issues.push(...cashPlaceIssues(ctx.db, doc.tenders, 'Pick where the money came from.'));

    const held = depositsHeld(ctx.db, doc.customerId, doc.jobOrderId ?? null);
    const what = jo ? `for ${jo.number}` : `as ${doc.customerName}'s unapplied payments`;
    if (doc.totalCents > held) add('error', 'tenders', 'OVER_HELD', held > 0 ? `Only ${formatPeso(held)} is held ${what}.` : `No money is held ${what}.`);
    if (jo?.status === 'posted') add('warning', 'jobOrderId', 'JO_OPEN', `${jo.number} is still open. Paying back its deposit raises its balance due.`);

    const withheld = ctx.db
      .prepare(
        `SELECT 1 FROM col_collections c JOIN documents d ON d.id = c.document_id
         WHERE c.customer_id = @customer AND c.cwt_cents > 0 AND d.status = 'posted'
           AND (CASE WHEN @jo IS NULL THEN c.unapplied_cents > 0
                ELSE EXISTS (SELECT 1 FROM col_applications a WHERE a.document_id = c.document_id AND a.job_order_id = @jo AND a.to_deposit_cents > 0) END)`,
      )
      .get({ customer: doc.customerId, jo: doc.jobOrderId ?? null });
    if (withheld) add('warning', 'tenders', 'CWT_HELD', 'Some of this money came with tax withheld (2307). Pay back only the cash part; the accountant decides what happens to the withheld tax.');
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO col_refunds (document_id, customer_id, customer_name, job_order_id, reason) VALUES (?, ?, ?, ?, ?)').run(
      h.documentId, doc.customerId, doc.customerName, doc.jobOrderId ?? null, doc.reason,
    );
    insertTenders(db, 'col_refund_tenders', h.documentId, doc.tenders);
  },

  journal(doc) {
    return {
      memo: `Refund to ${doc.customerName}${doc.jobOrderNumber ? ` (${doc.jobOrderNumber})` : ''}`,
      lines: [
        {
          account: { role: 'CUSTOMER_DEPOSITS' },
          party: { type: 'customer', id: doc.customerId },
          ...(doc.jobOrderId ? { ref: { documentId: doc.jobOrderId } } : {}),
          debitCents: doc.totalCents,
          memo: doc.jobOrderNumber ? `Deposit for ${doc.jobOrderNumber}` : 'Unapplied payments',
        },
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, creditCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare('SELECT r.customer_id, r.customer_name, r.job_order_id, r.reason, d.total_cents FROM col_refunds r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?')
      .get(documentId) as { customer_id: string; customer_name: string; job_order_id: string | null; reason: string; total_cents: number } | undefined;
    if (!r) throw new Error(`Refund ${documentId} not found`);
    return {
      customerId: r.customer_id,
      ...(r.job_order_id ? { jobOrderId: r.job_order_id } : {}),
      reason: r.reason,
      tenders: loadTenders(db, 'col_refund_tenders', documentId),
      customerName: r.customer_name,
      jobOrderNumber: r.job_order_id ? (jobOrderRef(db, r.job_order_id)?.number ?? '?') : null,
      totalCents: r.total_cents,
    };
  },

  toInput(doc) {
    return { customerId: doc.customerId, ...(doc.jobOrderId ? { jobOrderId: doc.jobOrderId } : {}), tenders: doc.tenders.map(tenderToInput), reason: doc.reason };
  },

  summary(doc) {
    const from = doc.tenders.length === 1 ? ` from ${doc.tenders[0]!.cashPlaceName}` : ` (${doc.tenders.map((t) => `${formatPeso(t.amountCents)} from ${t.cashPlaceName}`).join(', ')})`;
    const what = doc.jobOrderNumber ? `deposit for ${doc.jobOrderNumber}` : 'unapplied payments';
    return `This will pay back ${formatPeso(doc.totalCents)} to ${doc.customerName}${from}: ${what}.`;
  },

  arbitrary(db) {
    const places = listCashPlaces(db).map((c) => c.id);
    const held = (
      db
        .prepare(
          `SELECT DISTINCT c.customer_id AS customerId, NULL AS jobOrderId FROM col_collections c WHERE c.unapplied_cents > 0
           UNION SELECT DISTINCT c.customer_id, a.job_order_id FROM col_collections c JOIN col_applications a ON a.document_id = c.document_id WHERE a.to_deposit_cents > 0`,
        )
        .all() as { customerId: string; jobOrderId: string | null }[]
    )
      .map((k) => ({ ...k, cents: depositsHeld(db, k.customerId, k.jobOrderId) }))
      .filter((k) => k.cents > 0);
    if (held.length === 0) throw new Error('col.refund.arbitrary needs a customer with money held');
    return fc
      .constantFrom(...held)
      .chain((k) => fc.tuple(fc.constant(k), fc.constantFrom(...places), fc.integer({ min: 1, max: k.cents })))
      .map(([k, cashPlaceId, amountCents]) => ({
        customerId: k.customerId,
        ...(k.jobOrderId ? { jobOrderId: k.jobOrderId } : {}),
        tenders: [{ cashPlaceId, amountCents }],
        reason: 'Customer asked for the money back',
      }));
  },
};
