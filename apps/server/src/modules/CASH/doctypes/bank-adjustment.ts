/**
 * Bank Adjustment (BADJ-, PLAN D5 BANK-ADJ, E10): what the bank did that the books do not have yet.
 *   charge:   Dr 6230 bank charges / Cr bank
 *   interest: Dr bank (net) ; Dr 8103 final tax on interest (tax.interest_final_tax_bp of the gross) / Cr 7101 (gross)
 * Only for banks. Usually made from the bank reconciliation, which matches it to the statement lines it explains;
 * while it is matched there it cannot be cancelled.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { applyRate, conflict, formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { settingAt } from '../../../engine/settings.ts';
import { listPlaces, place } from '../places.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

const text = (max: number) => z.string().trim().min(1).max(max);
export const bankAdjustmentInput = z
  .object({
    cashPlaceId: z.number().int().positive(),
    kind: z.enum(['charge', 'interest']),
    amountCents: z.number().int().positive().max(MAX_CENTS), // the charge, or the gross interest
    description: text(200),
    note: text(500).optional(),
  })
  .strict();
export type BankAdjustmentInput = z.infer<typeof bankAdjustmentInput>;
export interface BankAdjustment extends BankAdjustmentInput {
  placeName: string;
  finalTaxBp: number;
  finalTaxCents: number;
  /** What the bank credited (interest after final tax) or the charge. */
  netCents: number;
  totalCents: number;
}

export const bankAdjustmentDoc: DocTypeDef<BankAdjustmentInput, BankAdjustment> = {
  key: 'cash.bank_adj',
  module: 'CASH',
  title: 'Bank Adjustment',
  numbering: { series: { key: 'BADJ', prefix: 'BADJ-' } },
  permissions: { view: 'cash.badj.view', create: 'cash.badj.create', post: 'cash.badj.post', cancel: 'cash.badj.cancel' },
  dating: 'system',
  inputSchema: bankAdjustmentInput,

  compute(input, ctx) {
    const finalTaxBp = input.kind === 'interest' ? settingAt(ctx.db, 'tax.interest_final_tax_bp', ctx.businessDate) : 0;
    const finalTaxCents = applyRate(input.amountCents, finalTaxBp);
    return {
      ...input, placeName: place(ctx.db, input.cashPlaceId)?.name ?? '?', finalTaxBp, finalTaxCents,
      netCents: input.amountCents - finalTaxCents, totalCents: input.amountCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const p = place(ctx.db, doc.cashPlaceId);
    if (!p?.isActive || p.kind !== 'bank') issues.push({ field: 'cashPlaceId', code: 'CASH_PLACE', level: 'error', message: 'Pick the bank account.' });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO cash_bank_adjustments (document_id, cash_account_id, kind, amount_cents, final_tax_bp, final_tax_cents, net_cents, description, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.cashPlaceId, doc.kind, doc.amountCents, doc.finalTaxBp, doc.finalTaxCents, doc.netCents, doc.description, doc.note ?? null);
  },

  journal(doc) {
    const bank = { account: { cashPlace: doc.cashPlaceId }, memo: doc.description };
    if (doc.kind === 'charge') {
      return {
        memo: `Bank charge on ${doc.placeName}: ${doc.description}`,
        lines: [{ account: { role: 'BANK_CHARGES' }, debitCents: doc.amountCents, memo: doc.description }, { ...bank, creditCents: doc.amountCents }],
      };
    }
    return {
      memo: `Interest on ${doc.placeName}: ${doc.description}`,
      lines: [
        { ...bank, debitCents: doc.netCents },
        { account: { role: 'FINAL_TAX_INTEREST' }, debitCents: doc.finalTaxCents, memo: `Final tax ${doc.finalTaxBp / 100}% withheld by the bank` },
        { account: { role: 'INTEREST_INCOME' }, creditCents: doc.amountCents, memo: doc.description },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM cash_bank_adjustments WHERE document_id = ?').get(documentId) as
      | { cash_account_id: number; kind: 'charge' | 'interest'; amount_cents: number; final_tax_bp: number; final_tax_cents: number; net_cents: number; description: string; note: string | null }
      | undefined;
    if (!r) throw new Error(`Bank adjustment ${documentId} not found`);
    return {
      cashPlaceId: r.cash_account_id, kind: r.kind, amountCents: r.amount_cents, description: r.description, ...(r.note ? { note: r.note } : {}),
      placeName: place(db, r.cash_account_id)?.name ?? '?', finalTaxBp: r.final_tax_bp, finalTaxCents: r.final_tax_cents, netCents: r.net_cents, totalCents: r.amount_cents,
    };
  },

  toInput: ({ cashPlaceId, kind, amountCents, description, note }) => ({ cashPlaceId, kind, amountCents, description, ...(note ? { note } : {}) }),

  /** A matched adjustment explains a statement line; unmatch it in the reconciliation before cancelling it. */
  dependents(db, documentId) {
    const r = db
      .prepare(
        `SELECT d.number, r.month, a.name FROM cash_recon_cleared c JOIN journal_lines l ON l.id = c.journal_line_id JOIN journals j ON j.id = l.journal_id
         JOIN cash_recons r ON r.id = c.recon_id JOIN accounts a ON a.id = r.account_id JOIN documents d ON d.id = j.source_id
         WHERE c.active = 1 AND j.source_type = 'document' AND j.source_id = ?`,
      )
      .get(documentId) as { number: string; month: string; name: string } | undefined;
    if (r) throw conflict('RECONCILED', `${r.number} is matched in the ${r.month} reconciliation of ${r.name}. Unmatch it there first.`);
    return [];
  },

  summary(doc) {
    if (doc.kind === 'charge') return `This will record a bank charge of ${formatPeso(doc.amountCents)} on ${doc.placeName}: ${doc.description}.`;
    return `This will record interest of ${formatPeso(doc.amountCents)} on ${doc.placeName}: ${formatPeso(doc.netCents)} credited after ${formatPeso(doc.finalTaxCents)} final tax (${doc.finalTaxBp / 100}%).`;
  },

  arbitrary(db) {
    const banks = listPlaces(db, false).filter((p) => p.kind === 'bank').map((p) => p.id);
    return fc
      .record({
        cashPlaceId: fc.constantFrom(...banks),
        kind: fc.constantFrom<'charge' | 'interest'>('charge', 'interest'),
        amountCents: fc.integer({ min: 1, max: 50_000_00 }),
        description: fc.constantFrom('Service charge', 'Interest for the month', 'Checkbook'),
        note: fc.constantFrom(undefined, 'From the statement'),
      })
      .map(({ note, ...r }) => ({ ...r, ...(note ? { note } : {}) }));
  },
};
