/**
 * Deposit Transfer (PLAN D5 DEP-XFER, D6, G-28): moves money held for a customer to another of their job orders, with no
 * cash line. It comes from a job order's deposits (usually one that was cancelled or edited, D6 "transfer to a
 * new/reissued JO") or from the customer's unapplied payments. On the receiving JO, its open receivable is settled first
 * and the rest is a deposit, as a collection does (D3):
 *   Dr 2201 (customer, + the old JO) / Cr 1201 AR (customer, new JO) ; Cr 2201 (customer, new JO)
 * Downpayment VAT (D3, deposit-vat.ts): output VAT recognised on the moved deposits (2209, mode B) goes with them to a
 * receiving JO in mode B (Dr 2209 new JO / Cr 2209 old JO); the part that pays a receivable, or goes to a JO in another
 * mode, goes back to output VAT (Dr 2301 / Cr 2209). A deposit arriving on a mode-B JO from money with no VAT on it
 * (unapplied payments, a JO in mode A or C) gets its VAT then (Dr 2209 / Cr 2301). A JO with no downpayment yet takes the
 * mode of the JO the money comes from (the money was received under it), else the setting in force.
 * Cancel: the mirror, then settleJobOrder on the receiving JO, so a deposit that an invoice record has since applied
 * reopens its receivable instead of 2201 going below zero (D6), and 2209 follows. A refund or transfer that took the money
 * further blocks it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { customerRef } from '../../CUS/public.ts';
import { isAbandoned, jobOrderRef, jobOrdersOf, joLedger, joMoney } from '../../JO/public.ts';
import {
  depositModeOn, depositVatLines, depositVatRowsOf, lockedMode, modeKeptIssue, recordDepositVat, settleJobOrder, shareOf, vatLeaving, vatOnDeposit, vatRow, type DepositMode,
} from './deposit-vat.ts';
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
  /** The receiving JO's downpayment VAT mode. */
  toMode: DepositMode;
  /** 2209 of the old JO going back to output VAT (Dr 2301 / Cr 2209), and its VATable amount. */
  vatReleasedCents: number;
  baseReleasedCents: number;
  /** 2209 moving from the old JO to the new one (both mode B). */
  vatMovedCents: number;
  baseMovedCents: number;
  /** VAT recognised on the deposit arriving on a mode-B JO from money with none (Dr 2209 / Cr 2301). */
  vatRecognisedCents: number;
  baseRecognisedCents: number;
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
    const toDepositCents = input.amountCents - toReceivableCents;
    const fromMode = input.fromJobOrderId ? lockedMode(ctx.db, input.fromJobOrderId)?.mode : null;
    // No deposit arriving, no mode to keep (load reads it back from the deposit's row).
    const toMode: DepositMode = to && toDepositCents > 0 ? depositModeOn(ctx.db, to.id, ctx.businessDate, fromMode).mode : 'A';
    const out = input.fromJobOrderId ? vatLeaving(ctx.db, input.fromJobOrderId, input.amountCents) : { vatCents: 0, baseCents: 0 };
    const carries = out.vatCents !== 0 || out.baseCents !== 0;
    // 2209 on the deposit part moves along to a mode-B JO; what cannot move goes back to output VAT.
    const moved = toMode === 'B' && carries && toDepositCents > 0
      ? { vatCents: shareOf(out.vatCents, toDepositCents, input.amountCents), baseCents: shareOf(out.baseCents, toDepositCents, input.amountCents) }
      : { vatCents: 0, baseCents: 0 };
    const fresh = toMode === 'B' && !carries && toDepositCents > 0 ? vatOnDeposit(ctx.db, toDepositCents, ctx.businessDate) : { vatCents: 0, baseCents: 0 };
    return {
      ...input,
      customerName: customerRef(ctx.db, input.customerId)?.display_name ?? '?',
      fromJobOrderNumber: input.fromJobOrderId ? (jobOrderRef(ctx.db, input.fromJobOrderId)?.number ?? '?') : null,
      toJobOrderNumber: to?.number ?? '?',
      toReceivableCents,
      toDepositCents,
      toMode,
      vatReleasedCents: out.vatCents - moved.vatCents,
      baseReleasedCents: out.baseCents - moved.baseCents,
      vatMovedCents: moved.vatCents,
      baseMovedCents: moved.baseCents,
      vatRecognisedCents: fresh.vatCents,
      baseRecognisedCents: fresh.baseCents,
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
      if (doc.toDepositCents > 0 && isAbandoned(ctx.db, to.id)) add('error', 'toJobOrderId', 'JO_ABANDONED', `${to.number} was abandoned and its deposit forfeited, so no new deposit is taken on it.`);
    }
    const held = depositsHeld(ctx.db, doc.customerId, doc.fromJobOrderId ?? null);
    const what = from ? `for ${from.number}` : `as ${doc.customerName}'s unapplied payments`;
    if (doc.amountCents > held) add('error', 'amountCents', 'OVER_HELD', held > 0 ? `Only ${formatPeso(held)} is held ${what}.` : `No money is held ${what}.`);
    if (from?.customerId === doc.customerId && from.status === 'posted') add('warning', 'fromJobOrderId', 'JO_OPEN', `${from.number} is still open. Moving its deposit raises its balance due.`);
    if (to && doc.toDepositCents > 0) {
      const fromMode = doc.fromJobOrderId ? lockedMode(ctx.db, doc.fromJobOrderId)?.mode : null;
      const kept = modeKeptIssue(depositModeOn(ctx.db, to.id, ctx.businessDate, fromMode), to.number, 'toJobOrderId');
      if (kept) issues.push(kept);
      if (doc.toMode === 'C') {
        add('warning', 'toJobOrderId', 'DP_INVOICE_NEEDED', `${formatPeso(doc.toDepositCents)} becomes a downpayment on ${to.number} not yet invoiced. In mode C (invoice on downpayment) write it on a sales invoice and record it as ${to.number}'s downpayment invoice.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO col_deposit_transfers (document_id, customer_id, customer_name, from_job_order_id, to_job_order_id, to_receivable_cents, to_deposit_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.customerId, doc.customerName, doc.fromJobOrderId ?? null, doc.toJobOrderId, doc.toReceivableCents, doc.toDepositCents, doc.note ?? null);
    const rows = [];
    if (doc.fromJobOrderId && (doc.vatReleasedCents || doc.baseReleasedCents || doc.vatMovedCents || doc.baseMovedCents)) {
      rows.push(vatRow({
        jobOrderId: doc.fromJobOrderId, customerId: doc.customerId, mode: 'B', depositCents: -doc.totalCents,
        depositVatCents: -(doc.vatReleasedCents + doc.vatMovedCents), depositBaseCents: -(doc.baseReleasedCents + doc.baseMovedCents), registerBaseCents: -doc.baseReleasedCents,
      }));
    }
    // Every deposit on a JO, whatever its mode: the JO's first one fixes its mode (deposit-vat.ts).
    if (doc.toDepositCents > 0) {
      rows.push(vatRow({
        jobOrderId: doc.toJobOrderId, customerId: doc.customerId, mode: doc.toMode, depositCents: doc.toDepositCents,
        depositVatCents: doc.vatMovedCents + doc.vatRecognisedCents, depositBaseCents: doc.baseMovedCents + doc.baseRecognisedCents, registerBaseCents: doc.baseRecognisedCents,
      }));
    }
    recordDepositVat(db, h.documentId, 'original', rows);
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
        ...(doc.fromJobOrderId ? depositVatLines(doc.customerId, doc.fromJobOrderId, doc.fromJobOrderNumber ?? '?', -doc.vatReleasedCents) : []),
        ...(doc.fromJobOrderId && doc.vatMovedCents > 0
          ? [
              { account: { role: 'DEPOSIT_VAT' }, party, ref: to, debitCents: doc.vatMovedCents, memo: `VAT on the deposits of ${doc.toJobOrderNumber}` },
              { account: { role: 'DEPOSIT_VAT' }, party, ref: { documentId: doc.fromJobOrderId }, creditCents: doc.vatMovedCents, memo: `VAT on the deposits of ${doc.fromJobOrderNumber}` },
            ]
          : []),
        ...depositVatLines(doc.customerId, doc.toJobOrderId, doc.toJobOrderNumber, doc.vatRecognisedCents),
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
    const rows = depositVatRowsOf(db, documentId);
    const from = rows.find((v) => v.jobOrderId === r.from_job_order_id);
    const into = rows.find((v) => v.jobOrderId === r.to_job_order_id);
    const moved = { vatCents: from && into ? Math.min(0 - from.depositVatCents, into.depositVatCents) : 0, baseCents: from && into ? into.depositBaseCents - into.registerBaseCents : 0 };
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
      toMode: into?.mode ?? 'A', // recorded before these rows existed: mode A
      vatReleasedCents: 0 - (from?.depositVatCents ?? 0) - moved.vatCents,
      baseReleasedCents: 0 - (from?.registerBaseCents ?? 0),
      vatMovedCents: moved.vatCents,
      baseMovedCents: moved.baseCents,
      vatRecognisedCents: (into?.depositVatCents ?? 0) - moved.vatCents,
      baseRecognisedCents: into?.registerBaseCents ?? 0,
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
    const lines = settleJobOrder(db, documentId, d.customerId, d.toJobOrderId, d.toJobOrderNumber);
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
