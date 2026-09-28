/**
 * Loan Payment (LPAY-, PLAN D5 "LOAN-PAY", E10). One instalment of one loan, split into principal and interest from the
 * schedule. Staff may type another split (the lender applied it differently), only with a note. Principal is never
 * expensed: it always reduces the loan's liability.
 *   Dr 2601/2602 principal (party = the loan) ; Dr 7201 interest / Cr cash place
 * Instalments are paid in order. A loan whose LOAN- document is cancelled takes no payment.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { KINDS, loan, loanBalance, schedule, type LoanKind } from '../loans.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const paymentInput = z
  .object({
    loanId: z.string().trim().min(1).max(80),
    instalmentNo: z.number().int().positive().max(360),
    cashPlaceId: z.number().int().positive(), // where the money came from
    principalCents: z.number().int().min(0).max(MAX_CENTS).optional(), // typed only when the split differs from the schedule ...
    interestCents: z.number().int().min(0).max(MAX_CENTS).optional(),
    note: z.string().trim().min(3).max(500).optional(), // ... and then say why
  })
  .strict();
export type PaymentInput = z.infer<typeof paymentInput>;

export interface LoanPayment {
  loanId: string; instalmentNo: number; cashPlaceId: number; principalCents: number; interestCents: number; note?: string;
  scheduledPrincipalCents: number; scheduledInterestCents: number; changed: boolean; dueDate: string | null;
  loanNumber: string; lender: string; kind: LoanKind; instalments: number; cashPlaceName: string; totalCents: number;
}

function build(db: Db, input: PaymentInput): LoanPayment {
  const l = loan(db, input.loanId);
  const rows = l ? schedule(db, l.id) : [];
  const row = rows.find((r) => r.instalmentNo === input.instalmentNo);
  const scheduledPrincipalCents = row?.principalCents ?? 0;
  const scheduledInterestCents = row?.interestCents ?? 0;
  const principalCents = input.principalCents ?? scheduledPrincipalCents;
  const interestCents = input.interestCents ?? scheduledInterestCents;
  return {
    loanId: input.loanId, instalmentNo: input.instalmentNo, cashPlaceId: input.cashPlaceId, principalCents, interestCents, ...(input.note ? { note: input.note } : {}),
    scheduledPrincipalCents, scheduledInterestCents, changed: principalCents !== scheduledPrincipalCents || interestCents !== scheduledInterestCents, dueDate: row?.dueDate ?? null,
    loanNumber: l?.number ?? '?', lender: l?.lender ?? '?', kind: l?.kind ?? 'loan', instalments: rows.length,
    cashPlaceName: getCashPlace(db, input.cashPlaceId)?.name ?? '?', totalCents: principalCents + interestCents,
  };
}

export const paymentDoc: DocTypeDef<PaymentInput, LoanPayment> = {
  key: 'loan.payment',
  module: 'LOAN',
  title: 'Loan Payment',
  numbering: { series: { key: 'LPAY', prefix: 'LPAY-' } },
  permissions: { view: 'loan.pay.view', create: 'loan.pay.create', post: 'loan.pay.post', cancel: 'loan.pay.cancel' },
  dating: 'system',
  inputSchema: paymentInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const l = loan(ctx.db, doc.loanId);
    if (!l) return [{ field: 'loanId', code: 'LOAN', level: 'error', message: 'Pick the loan from the loan register.' }];
    if (l.status !== 'posted') {
      const by = l.replacedByNumber ? ` and replaced by ${l.replacedByNumber}` : '';
      return [{ field: 'loanId', code: 'LOAN_CANCELLED', level: 'error', message: `${l.number} was cancelled${by}. Record payments only on a loan that stands.` }];
    }
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) err('cashPlaceId', 'CASH_PLACE', 'Pick where the money came from.');
    const rows = schedule(ctx.db, l.id);
    const row = rows.find((r) => r.instalmentNo === doc.instalmentNo);
    const next = rows.find((r) => !r.paidBy);
    if (!row) err('instalmentNo', 'INSTALMENT', `${l.number} has ${rows.length} instalments.`);
    else if (row.paidBy) err('instalmentNo', 'PAID', `Instalment ${row.instalmentNo} of ${l.number} is already paid by ${row.paidBy}.`);
    else if (next && next.instalmentNo !== row.instalmentNo) err('instalmentNo', 'NOT_NEXT', `Pay instalment ${next.instalmentNo} of ${l.number} first.`);
    if (doc.changed && !doc.note) err('note', 'NOTE_REQUIRED', 'Say why the principal or interest differs from the schedule.');
    const owed = loanBalance(ctx.db, l.id, l.kind);
    if (doc.principalCents > owed) err('principalCents', 'MORE_THAN_OWED', `Only ${formatPeso(owed)} of principal is still owed on ${l.number}.`);
    if (doc.totalCents === 0) err('principalCents', 'ZERO', 'The payment is zero.');
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO loan_payments (document_id, loan_id, instalment_no, cash_account_id, principal_cents, interest_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.loanId, doc.instalmentNo, doc.cashPlaceId, doc.principalCents, doc.interestCents, doc.note ?? null);
  },

  journal(doc) {
    return {
      memo: `${doc.loanNumber} instalment ${doc.instalmentNo} to ${doc.lender}`,
      lines: [
        { account: { role: KINDS[doc.kind].role }, party: { type: 'loan', id: doc.loanId }, debitCents: doc.principalCents, memo: 'Principal' },
        { account: { role: 'INTEREST_EXPENSE' }, debitCents: doc.interestCents, memo: 'Interest' },
        { account: { cashPlace: doc.cashPlaceId }, creditCents: doc.totalCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM loan_payments WHERE document_id = ?').get(documentId) as
      | { loan_id: string; instalment_no: number; cash_account_id: number; principal_cents: number; interest_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Loan payment ${documentId} not found`);
    return build(db, {
      loanId: r.loan_id, instalmentNo: r.instalment_no, cashPlaceId: r.cash_account_id, principalCents: r.principal_cents, interestCents: r.interest_cents, ...(r.note ? { note: r.note } : {}),
    });
  },

  toInput(doc) {
    const { loanId, instalmentNo, cashPlaceId, principalCents, interestCents, note } = doc;
    return { loanId, instalmentNo, cashPlaceId, ...(doc.changed ? { principalCents, interestCents } : {}), ...(note ? { note } : {}) };
  },

  summary(doc) {
    const split = `${formatPeso(doc.principalCents)} principal and ${formatPeso(doc.interestCents)} interest`;
    const changed = doc.changed ? ` instead of the scheduled ${formatPeso(doc.scheduledPrincipalCents)} and ${formatPeso(doc.scheduledInterestCents)}` : '';
    return `This will record instalment ${doc.instalmentNo} of ${doc.instalments} on ${doc.loanNumber} (${doc.lender}): ${formatPeso(doc.totalCents)} from ${doc.cashPlaceName}, ${split}${changed}.`;
  },

  /** Instalments of the loans that stand, sometimes with a typed split; out-of-order or too-large ones are refused by validate. */
  arbitrary(db) {
    const loans = db.prepare(`SELECT l.document_id FROM loan_loans l JOIN documents d ON d.id = l.document_id WHERE d.status = 'posted'`).pluck().all() as string[];
    return fc
      .record({
        loanId: fc.constantFrom(...(loans.length > 0 ? loans : ['no-loan-yet'])),
        instalmentNo: fc.integer({ min: 1, max: 4 }),
        cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
        split: fc.option(fc.record({ principalCents: fc.integer({ min: 0, max: 100_000_00 }), interestCents: fc.integer({ min: 0, max: 50_000_00 }) }), { nil: undefined }),
      })
      .map(({ split, ...r }): PaymentInput => (split ? { ...r, ...split, note: 'The bank applied it differently' } : r));
  },
};
