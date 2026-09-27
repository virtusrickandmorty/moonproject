/**
 * Fund Transfer (PLAN D5 "TRF", E10). THE REFERENCE DOCUMENT TYPE: copy its shape for new documents.
 *
 * Staff pick where the money came from and where it went, and type what was sent and what arrived.
 * The difference is the bank or e-wallet fee.
 *   Dr cash-to (received) ; Dr 6230 bank charges (fee) / Cr cash-from (sent)
 * Petty cash replenishment and check deposits (Checks on hand -> bank) are transfers too.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@virtus/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const transferInput = z
  .object({
    fromCashPlaceId: z.number().int().positive(),
    toCashPlaceId: z.number().int().positive(),
    amountSentCents: z.number().int().positive().max(MAX_CENTS),
    amountReceivedCents: z.number().int().positive().max(MAX_CENTS),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type TransferInput = z.infer<typeof transferInput>;

export interface Transfer extends TransferInput {
  feeCents: number;
  totalCents: number;
  fromName: string;
  toName: string;
}

export const transferDoc: DocTypeDef<TransferInput, Transfer> = {
  key: 'cash.transfer',
  module: 'CASH',
  title: 'Fund Transfer',
  numbering: { series: { key: 'TRF', prefix: 'TRF-' } },
  permissions: { view: 'cash.trf.view', create: 'cash.trf.create', post: 'cash.trf.post', cancel: 'cash.trf.cancel' },
  dating: 'system',
  inputSchema: transferInput,

  compute(input, ctx) {
    return {
      ...input,
      feeCents: input.amountSentCents - input.amountReceivedCents,
      totalCents: input.amountSentCents,
      fromName: getCashPlace(ctx.db, input.fromCashPlaceId)?.name ?? '?',
      toName: getCashPlace(ctx.db, input.toCashPlaceId)?.name ?? '?',
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const from = getCashPlace(ctx.db, doc.fromCashPlaceId);
    const to = getCashPlace(ctx.db, doc.toCashPlaceId);
    if (!from?.isActive) issues.push({ field: 'fromCashPlaceId', code: 'CASH_PLACE', level: 'error', message: 'Pick where the money came from.' });
    if (!to?.isActive) issues.push({ field: 'toCashPlaceId', code: 'CASH_PLACE', level: 'error', message: 'Pick where the money went.' });
    if (doc.fromCashPlaceId === doc.toCashPlaceId) {
      issues.push({ field: 'toCashPlaceId', code: 'SAME_PLACE', level: 'error', message: 'Money must go to a different place.' });
    }
    if (doc.feeCents < 0) {
      issues.push({ field: 'amountReceivedCents', code: 'RECEIVED_MORE', level: 'error', message: 'The amount received cannot be more than the amount sent.' });
    }
    if (doc.feeCents > 0 && doc.feeCents * 10 > doc.amountSentCents) {
      issues.push({ field: 'amountReceivedCents', code: 'BIG_FEE', level: 'warning', message: `The fee of ${formatPeso(doc.feeCents)} is more than 10% of the amount. Please check.` });
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO cash_transfers (document_id, from_account_id, to_account_id, amount_sent_cents, amount_received_cents, fee_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.fromCashPlaceId, doc.toCashPlaceId, doc.amountSentCents, doc.amountReceivedCents, doc.feeCents, doc.note ?? null);
  },

  journal(doc) {
    return {
      memo: `Transfer ${doc.fromName} to ${doc.toName}`,
      lines: [
        { account: { cashPlace: doc.toCashPlaceId }, debitCents: doc.amountReceivedCents },
        { account: { role: 'BANK_CHARGES' }, debitCents: doc.feeCents, memo: 'Transfer fee' },
        { account: { cashPlace: doc.fromCashPlaceId }, creditCents: doc.amountSentCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM cash_transfers WHERE document_id = ?').get(documentId) as
      | { from_account_id: number; to_account_id: number; amount_sent_cents: number; amount_received_cents: number; fee_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Transfer ${documentId} not found`);
    return {
      fromCashPlaceId: r.from_account_id,
      toCashPlaceId: r.to_account_id,
      amountSentCents: r.amount_sent_cents,
      amountReceivedCents: r.amount_received_cents,
      ...(r.note ? { note: r.note } : {}),
      feeCents: r.fee_cents,
      totalCents: r.amount_sent_cents,
      fromName: getCashPlace(db, r.from_account_id)?.name ?? '?',
      toName: getCashPlace(db, r.to_account_id)?.name ?? '?',
    };
  },

  toInput(doc) {
    const { fromCashPlaceId, toCashPlaceId, amountSentCents, amountReceivedCents, note } = doc;
    return { fromCashPlaceId, toCashPlaceId, amountSentCents, amountReceivedCents, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const fee = doc.feeCents > 0 ? ` (${formatPeso(doc.amountReceivedCents)} arrived, fee ${formatPeso(doc.feeCents)})` : '';
    return `This will move ${formatPeso(doc.amountSentCents)} from ${doc.fromName} to ${doc.toName}${fee}.`;
  },

  arbitrary(db) {
    const ids = listCashPlaces(db).map((c) => c.id);
    return fc
      .tuple(fc.constantFrom(...ids), fc.constantFrom(...ids), fc.integer({ min: 1, max: 5_000_000_00 }), fc.integer({ min: 0, max: 50_000 }))
      .filter(([a, b, sent, fee]) => a !== b && fee < sent)
      .map(([a, b, sent, fee]) => ({ fromCashPlaceId: a, toCashPlaceId: b, amountSentCents: sent, amountReceivedCents: sent - fee }));
  },
};
