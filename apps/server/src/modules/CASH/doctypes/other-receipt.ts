/**
 * Other Receipt (ORC-, PLAN D5 OTH-RCV, E10): money in that is not a sale, by a fixed category.
 *   Dr cash place / Cr 7101 interest income | 7103 other income | 1290 other receivables
 * Sales never go here: they need an invoice record (JO, QS). Bank interest with final tax withheld comes from the bank
 * reconciliation (BANK-ADJ), not from this document.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { listPlaces, place } from '../places.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

/** Category → account role (fixed, like expense categories). */
export const CATEGORIES = {
  interest: { role: 'INTEREST_INCOME', label: 'Interest received (not from a bank statement)' },
  other_income: { role: 'OTHER_INCOME', label: 'Other income (for example scrap sold as waste)' },
  other_receivable: { role: 'OTHER_RECEIVABLES', label: 'Money owed to the shop, paid back (a refund, a returned deposit, an insurance claim)' },
} as const;
export type Category = keyof typeof CATEGORIES;

const text = (max: number) => z.string().trim().min(1).max(max);
export const otherReceiptInput = z
  .object({
    cashPlaceId: z.number().int().positive(),
    category: z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]]),
    receivedFrom: text(120),
    description: text(200),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    reference: text(60).optional(), // the payer's check or transfer reference
    note: text(500).optional(),
  })
  .strict();
export type OtherReceiptInput = z.infer<typeof otherReceiptInput>;
export interface OtherReceipt extends OtherReceiptInput { placeName: string; totalCents: number }

export const otherReceiptDoc: DocTypeDef<OtherReceiptInput, OtherReceipt> = {
  key: 'cash.other_receipt',
  module: 'CASH',
  title: 'Other Receipt',
  numbering: { series: { key: 'ORC', prefix: 'ORC-' } },
  permissions: { view: 'cash.orc.view', create: 'cash.orc.create', post: 'cash.orc.post', cancel: 'cash.orc.cancel' },
  dating: 'system',
  inputSchema: otherReceiptInput,

  compute(input, ctx) {
    return { ...input, placeName: place(ctx.db, input.cashPlaceId)?.name ?? '?', totalCents: input.amountCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    if (!place(ctx.db, doc.cashPlaceId)?.isActive) issues.push({ field: 'cashPlaceId', code: 'CASH_PLACE', level: 'error', message: 'Pick where the money went.' });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      'INSERT INTO cash_other_receipts (document_id, cash_account_id, category, received_from, description, amount_cents, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(h.documentId, doc.cashPlaceId, doc.category, doc.receivedFrom, doc.description, doc.amountCents, doc.reference ?? null, doc.note ?? null);
  },

  journal(doc) {
    return {
      memo: `Received from ${doc.receivedFrom}: ${doc.description}`,
      lines: [
        { account: { cashPlace: doc.cashPlaceId }, debitCents: doc.amountCents, ...(doc.reference ? { memo: doc.reference } : {}) },
        { account: { role: CATEGORIES[doc.category].role }, creditCents: doc.amountCents, memo: doc.description },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM cash_other_receipts WHERE document_id = ?').get(documentId) as
      | { cash_account_id: number; category: Category; received_from: string; description: string; amount_cents: number; reference: string | null; note: string | null }
      | undefined;
    if (!r) throw new Error(`Other receipt ${documentId} not found`);
    return {
      cashPlaceId: r.cash_account_id, category: r.category, receivedFrom: r.received_from, description: r.description, amountCents: r.amount_cents,
      ...(r.reference ? { reference: r.reference } : {}), ...(r.note ? { note: r.note } : {}), placeName: place(db, r.cash_account_id)?.name ?? '?', totalCents: r.amount_cents,
    };
  },

  toInput: ({ cashPlaceId, category, receivedFrom, description, amountCents, reference, note }) => ({
    cashPlaceId, category, receivedFrom, description, amountCents, ...(reference ? { reference } : {}), ...(note ? { note } : {}),
  }),

  summary(doc) {
    return `This will record ${formatPeso(doc.amountCents)} received from ${doc.receivedFrom} into ${doc.placeName} as ${CATEGORIES[doc.category].label.split(' (')[0]!.toLowerCase()}: ${doc.description}.`;
  },

  arbitrary(db) {
    const places = listPlaces(db, false).map((p) => p.id);
    return fc
      .record({
        cashPlaceId: fc.constantFrom(...places),
        category: fc.constantFrom<Category>('interest', 'other_income', 'other_receivable'),
        receivedFrom: fc.constantFrom('Juan Dela Cruz', 'ABC Trading', 'Insurance Co.'),
        description: fc.constantFrom('Interest on a staff loan', 'Scrap cloth', 'Refund of a utility deposit'),
        amountCents: fc.integer({ min: 1, max: 5_000_000_00 }),
        reference: fc.constantFrom(undefined, 'BDO 12345'),
      })
      .map(({ reference, ...r }) => ({ ...r, ...(reference ? { reference } : {}) }));
  },
};
