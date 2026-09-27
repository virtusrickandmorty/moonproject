/**
 * Deposit Transfer (PLAN D5 DEP-XFER, D6, G-28): moves money held for a customer to another of their job orders, with no
 * cash line. It comes from a job order's deposits (usually one that was cancelled or edited, D6 "transfer to a
 * new/reissued JO") or from the customer's unapplied payments. On the receiving JO, its open receivable is settled first
 * and the rest is a deposit, as a collection does (D3):
 *   Dr 2201 (customer, + the old JO) / Cr 1201 AR (customer, new JO) ; Cr 2201 (customer, new JO)
 * Cancel: the mirror, then settleLines on the receiving JO, so a deposit that an invoice record has since applied reopens
 * its receivable instead of 2201 going below zero (D6). A refund or transfer that took the money further blocks it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { customerRef } from '../../CUS/public.ts';
import { jobOrderRef, jobOrdersOf, joLedger, joMoney, settleLines } from '../../JO/public.ts';
import { MAX_CENTS, depositsHeld, takenOutBy } from '../ledger.ts';

export const depositTransferInput = z
  .object({
    customerId: z.uuid(),
    fromJobOrderId: z.uuid().optional(), // the JO whose deposits move; left out = the customer's unapplied payments
    toJobOrderId: z.uuid(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type DepositTransferInput = z.infer<typeof depositTransferInput>;

export interface DepositTransfer extends DepositTransferInput {
  customerName: string;
  fromJobOrderNumber: string | null;
  toJobOrderNumber: string;
  toReceivableCents: number;
  toDepositCents: number;
  totalCents: number;
}

export const depositTransferDoc: DocTypeDef<DepositTransferInput, DepositTransfer> = {
  key: 'col.deposit_transfer',
  module: 'COL',
  title: 'Deposit Transfer',
  numbering: { series: { key: 'DXF', prefix: 'DXF-' } },
  permissions: { view: 'col.view', create: 'col.transfer', post: 'col.transfer', cancel: 'col.transfer' },
  dating: 'system',
  inputSchema: depositTransferInput,

  compute(input, ctx) {
    const to = jobOrderRef(ctx.db, input.toJobOrderId);
    const toReceivableCents = Math.min(input.amountCents, to ? Math.max(0, joLedger(ctx.db, to.id).receivableCents) : 0);
    return {
      ...input,
      customerName: customerRef(ctx.db, input.customerId)?.display_name ?? '?',
      fromJobOrderNumber: input.fromJobOrderId ? (jobOrderRef(ctx.db, input.fromJobOrderId)?.number ?? '?') : null,
      toJobOrderNumber: to?.number ?? '?',
      toReceivableCents,
      toDepositCents: input.amountCents - toReceivableCents,
      totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!customerRef(ctx.db, doc.customerId)) add('error', 'customerId', 'CUSTOMER', 'Pick a customer.');
    const from = doc.fromJobOrderId ? jobOrderRef(ctx.db, doc.fromJobOrderId) : undefined;
    if (doc.fromJobOrderId && from?.customerId !== doc.customerId) add('error', 'fromJobOrderId', 'JOB_ORDER', `Pick one of ${doc.customerName}'s job orders to move money from.`);
    const to = jobOrderRef(ctx.db, doc.toJobOrderId);
    if (to?.customerId !== doc.customerId) {
      add('error', 'toJobOrderId', 'JOB_ORDER', `Pick one of ${doc.customerName}'s job orders to move the money to.`);
    } else if (to.id === doc.fromJobOrderId) {
      add('error', 'toJobOrderId', 'SAME_JO', `The money is already on ${to.number}. Pick another job order.`);
    } else if (to.status !== 'posted') {
      add('error', 'toJobOrderId', 'JO_CANCELLED', `${to.number} is cancelled, so money cannot be moved to it.`);
    } else {
      const due = joMoney(ctx.db, to.id).balanceDueCents;
      if (doc.amountCents > due) add('error', 'amountCents', 'OVER_BALANCE', due > 0 ? `${to.number} has ${formatPeso(due)} left to pay. Move at most that.` : `${to.number} is fully paid.`);
    }
    const held = depositsHeld(ctx.db, doc.customerId, doc.fromJobOrderId ?? null);
    const what = from ? `for ${from.number}` : `as ${doc.customerName}'s unapplied payments`;
    if (doc.amountCents > held) add('error', 'amountCents', 'OVER_HELD', held > 0 ? `Only ${formatPeso(held)} is held ${what}.` : `No money is held ${what}.`);
    if (from?.customerId === doc.customerId && from.status === 'posted') add('warning', 'fromJobOrderId', 'JO_OPEN', `${from.number} is still open. Moving its deposit raises its balance due.`);
    const mode = doc.toDepositCents > 0 ? settingAt(ctx.db, 'sales.deposit_vat_mode', ctx.businessDate) : 'A';
    if (mode !== 'A') {
      add('error', 'toJobOrderId', 'DEPOSIT_VAT_MODE', `Downpayment VAT mode ${mode} is in force, and this version can move deposits only in mode A (deposit only). Mode ${mode} is not built yet: ask the accountant.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO col_deposit_transfers (document_id, customer_id, customer_name, from_job_order_id, to_job_order_id, to_receivable_cents, to_deposit_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.fromJobOrderId ?? null, doc.toJobOrderId, doc.toReceivableCents, doc.toDepositCents, doc.note ?? null);
  },

  journal(doc) {
    const party = { type: 'customer', id: doc.customerId };
    const to = { documentId: doc.toJobOrderId };
    const from = doc.fromJobOrderNumber ? `Deposit for ${doc.fromJobOrderNumber}` : 'Unapplied payments';
    return {
      memo: `${from} of ${doc.customerName} moved to ${doc.toJobOrderNumber}`,
      lines: [
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ...(doc.fromJobOrderId ? { ref: { documentId: doc.fromJobOrderId } } : {}), debitCents: doc.totalCents, memo: from },
        { account: { role: 'AR_TRADE' }, party, ref: to, creditCents: doc.toReceivableCents, memo: doc.toJobOrderNumber },
        { account: { role: 'CUSTOMER_DEPOSITS' }, party, ref: to, creditCents: doc.toDepositCents, memo: `Deposit for ${doc.toJobOrderNumber}` },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT t.customer_id, t.customer_name, t.from_job_order_id, t.to_job_order_id, t.to_receivable_cents, t.to_deposit_cents, t.note, d.total_cents
         FROM col_deposit_transfers t JOIN documents d ON d.id = t.document_id WHERE t.document_id = ?`,
      )
      .get(documentId) as
      | { customer_id: string; customer_name: string; from_job_order_id: string | null; to_job_order_id: string; to_receivable_cents: number; to_deposit_cents: number; note: string | null; total_cents: number }
      | undefined;
    if (!r) throw new Error(`Deposit transfer ${documentId} not found`);
    return {
      customerId: r.customer_id,
      ...(r.from_job_order_id ? { fromJobOrderId: r.from_job_order_id } : {}),
      toJobOrderId: r.to_job_order_id,
      amountCents: r.total_cents,
      ...(r.note ? { note: r.note } : {}),
      customerName: r.customer_name,
      fromJobOrderNumber: r.from_job_order_id ? (jobOrderRef(db, r.from_job_order_id)?.number ?? '?') : null,
      toJobOrderNumber: jobOrderRef(db, r.to_job_order_id)?.number ?? '?',
      toReceivableCents: r.to_receivable_cents,
      toDepositCents: r.to_deposit_cents,
      totalCents: r.total_cents,
    };
  },

  toInput: ({ customerId, fromJobOrderId, toJobOrderId, amountCents, note }) => ({
    customerId,
    ...(fromJobOrderId ? { fromJobOrderId } : {}),
    toJobOrderId,
    amountCents,
    ...(note ? { note } : {}),
  }),

  /** Refunds and transfers that took this money further from the receiving JO (D6): cancel those first. */
  dependents(db, documentId) {
    const d = depositTransferDoc.load(db, documentId);
    return takenOutBy(db, d.customerId, d.toJobOrderId, d.toDepositCents, d.toReceivableCents);
  },

  afterCancel(db, documentId) {
    const d = depositTransferDoc.load(db, documentId);
    const lines = settleLines(db, d.customerId, d.toJobOrderId, d.toJobOrderNumber);
    return lines.length > 0 ? { memo: `${d.toJobOrderNumber} receivable and deposits put back in line`, lines } : null;
  },

  summary(doc) {
    const from = doc.fromJobOrderNumber ?? 'their unapplied payments';
    const split = doc.toReceivableCents > 0 ? `: ${formatPeso(doc.toReceivableCents)} pays what is invoiced${doc.toDepositCents > 0 ? ` and ${formatPeso(doc.toDepositCents)} is its deposit` : ''}` : '';
    return `This will move ${formatPeso(doc.totalCents)} held for ${doc.customerName} from ${from} to ${doc.toJobOrderNumber}${split}. No cash comes in or goes out.`;
  },

  arbitrary(db) {
    const pairs: { customerId: string; fromJobOrderId: string | null; toJobOrderId: string; maxCents: number }[] = [];
    const all = jobOrdersOf(db, undefined, true);
    for (const customerId of new Set(all.map((jo) => jo.customerId))) {
      const theirs = all.filter((jo) => jo.customerId === customerId);
      const pools = [...theirs.map((jo) => jo.id), null].map((id) => ({ id, held: depositsHeld(db, customerId, id) })).filter((p) => p.held > 0);
      const targets = theirs.filter((jo) => jo.status === 'posted').map((jo) => ({ id: jo.id, due: joMoney(db, jo.id).balanceDueCents })).filter((t) => t.due > 0);
      for (const p of pools) for (const t of targets) if (p.id !== t.id) pairs.push({ customerId, fromJobOrderId: p.id, toJobOrderId: t.id, maxCents: Math.min(p.held, t.due) });
    }
    if (pairs.length === 0) throw new Error('col.deposit_transfer.arbitrary needs a customer with money held and another job order with a balance due');
    return fc
      .constantFrom(...pairs)
      .chain((p) => fc.tuple(fc.constant(p), fc.integer({ min: 1, max: p.maxCents }), fc.constantFrom(undefined, 'Order changed, deposit moved')))
      .map(([p, amountCents, note]) => ({
        customerId: p.customerId,
        ...(p.fromJobOrderId ? { fromJobOrderId: p.fromJobOrderId } : {}),
        toJobOrderId: p.toJobOrderId,
        amountCents,
        ...(note ? { note } : {}),
      }));
  },
};
