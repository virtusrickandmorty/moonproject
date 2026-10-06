/**
 * Loan Forgiveness (LFGV-, the owner's decision of 6 Oct 2026): the lender forgives all that is still due on one
 * instalment, typically the rest a short payment left (audit A1-002), never more. Same instalment order as a payment.
 *   Dr 2601/2602 forgiven principal (party = the loan) / Cr gain on debt forgiveness (7104, other income)
 * The forgiven interest posts nothing: interest is expensed only when paid (doctypes/payment.ts), so it was never booked.
 * It is recorded here and closes the instalment with the principal. Once posted the instalment counts as settled
 * (loans.ts schedule); cancelling it mirrors the journal and opens the instalment again. Never made automatically.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { KINDS, loan, loanBalance, schedule, type LoanKind } from '../loans.ts';

export const forgivenessInput = z
  .object({
    loanId: z.string().trim().min(1).max(80),
    instalmentNo: z.number().int().positive().max(360),
    reason: z.string().trim().min(10).max(200),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ForgivenessInput = z.infer<typeof forgivenessInput>;

export interface LoanForgiveness {
  loanId: string; instalmentNo: number; reason: string; note?: string;
  /** What is forgiven: all that was still due on the instalment. Only the principal posts. */
  principalCents: number; interestCents: number;
  /** The instalment as scheduled, and what payments had covered of it before the forgiveness. */
  dueDate: string | null; scheduledCents: number; earlierPaidCents: number;
  loanNumber: string; lender: string; kind: LoanKind; instalments: number; totalCents: number;
}

/**
 * `forgiven`: a recorded forgiveness reads back what it forgave. Otherwise what is still due on the instalment now; when a
 * standing forgiveness already closed it, what that one forgave (validate refuses it, and an edit's reissue, which cancels
 * it first, forgives the same again).
 */
function build(db: Db, input: ForgivenessInput, forgiven?: { principalCents: number; interestCents: number }): LoanForgiveness {
  const l = loan(db, input.loanId);
  const rows = l ? schedule(db, l.id) : [];
  const row = rows.find((r) => r.instalmentNo === input.instalmentNo);
  const due = forgiven ?? (row?.forgivenBy
    ? { principalCents: row.forgivenPrincipalCents ?? 0, interestCents: row.forgivenInterestCents ?? 0 }
    : { principalCents: row?.remainingPrincipalCents ?? 0, interestCents: row?.remainingInterestCents ?? 0 });
  const scheduledCents = row ? row.principalCents + row.interestCents : 0;
  const totalCents = due.principalCents + due.interestCents;
  return {
    loanId: input.loanId, instalmentNo: input.instalmentNo, reason: input.reason, ...(input.note ? { note: input.note } : {}),
    principalCents: due.principalCents, interestCents: due.interestCents,
    dueDate: row?.dueDate ?? null, scheduledCents, earlierPaidCents: Math.max(0, scheduledCents - totalCents),
    loanNumber: l?.number ?? '?', lender: l?.lender ?? '?', kind: l?.kind ?? 'loan', instalments: rows.length, totalCents,
  };
}

export const forgivenessDoc: DocTypeDef<ForgivenessInput, LoanForgiveness> = {
  key: 'loan.forgiveness',
  module: 'LOAN',
  title: 'Loan Forgiveness',
  numbering: { series: { key: 'LFGV', prefix: 'LFGV-' } },
  permissions: { view: 'loan.pay.view', create: 'loan.forgive', post: 'loan.forgive', cancel: 'loan.forgive' },
  dating: 'system',
  inputSchema: forgivenessInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const err = (field: string, code: string, message: string): Issue[] => [{ field, code, level: 'error', message }];
    const l = loan(ctx.db, doc.loanId);
    if (!l) return err('loanId', 'LOAN', 'Pick the loan from the loan register.');
    if (l.status !== 'posted') {
      const by = l.replacedByNumber ? ` and replaced by ${l.replacedByNumber}` : '';
      return err('loanId', 'LOAN_CANCELLED', `${l.number} was cancelled${by}. Forgive instalments only on a loan that stands.`);
    }
    const rows = schedule(ctx.db, l.id);
    const row = rows.find((r) => r.instalmentNo === doc.instalmentNo);
    if (!row) return err('instalmentNo', 'INSTALMENT', `${l.number} has ${rows.length} instalments.`);
    if (row.forgivenBy) return err('instalmentNo', 'PAID', `The rest of instalment ${row.instalmentNo} of ${l.number} is already forgiven by ${row.forgivenBy}.`);
    if (row.paidBy) return err('instalmentNo', 'PAID', `Instalment ${row.instalmentNo} of ${l.number} is already paid in full by ${row.paidBy}.`);
    const owed = loanBalance(ctx.db, l.id, l.kind);
    if (doc.totalCents === 0 || owed <= 0) return err('instalmentNo', 'NOTHING_DUE', `Nothing is due on instalment ${row.instalmentNo} of ${l.number}.`);
    const next = rows.find((r) => !r.paidBy);
    if (next && next.instalmentNo !== row.instalmentNo) {
      const rest = next.remainingPrincipalCents + next.remainingInterestCents;
      return err('instalmentNo', 'NOT_NEXT', `Instalment ${next.instalmentNo} of ${l.number} is still due first (${formatPeso(rest)}). Pay or forgive it before this one.`);
    }
    // Earlier payments took more principal than scheduled: what the schedule still shows is more than is owed.
    if (doc.principalCents > owed) {
      return err('instalmentNo', 'MORE_THAN_OWED', `Only ${formatPeso(owed)} of principal is still owed on ${l.number}, less than the ${formatPeso(doc.principalCents)} due on this instalment. Record what the lender applied as a payment instead.`);
    }
    return [];
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO loan_forgivenesses (document_id, loan_id, instalment_no, principal_cents, interest_cents, reason, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.loanId, doc.instalmentNo, doc.principalCents, doc.interestCents, doc.reason, doc.note ?? null);
  },

  /** Only the principal posts; forgiven interest alone (never expensed) posts nothing. */
  journal(doc) {
    if (doc.principalCents === 0) return null;
    return {
      memo: `${doc.loanNumber} instalment ${doc.instalmentNo}: ${doc.lender} forgave the rest`,
      lines: [
        { account: { role: KINDS[doc.kind].role }, party: { type: 'loan', id: doc.loanId }, debitCents: doc.principalCents, memo: 'Principal forgiven' },
        { account: { role: 'GAIN_ON_DEBT_FORGIVENESS' }, creditCents: doc.principalCents, memo: 'Gain on debt forgiveness' },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM loan_forgivenesses WHERE document_id = ?').get(documentId) as
      | { loan_id: string; instalment_no: number; principal_cents: number; interest_cents: number; reason: string; note: string | null }
      | undefined;
    if (!r) throw new Error(`Loan forgiveness ${documentId} not found`);
    return build(db, { loanId: r.loan_id, instalmentNo: r.instalment_no, reason: r.reason, ...(r.note ? { note: r.note } : {}) }, { principalCents: r.principal_cents, interestCents: r.interest_cents });
  },

  toInput: ({ loanId, instalmentNo, reason, note }) => ({ loanId, instalmentNo, reason, ...(note ? { note } : {}) }),

  summary(doc) {
    const what = doc.earlierPaidCents > 0 ? `the rest of instalment ${doc.instalmentNo}` : `instalment ${doc.instalmentNo}`;
    const interest = doc.interestCents > 0 ? ` The ${formatPeso(doc.interestCents)} interest was never expensed, so it posts nothing; it closes the instalment.` : '';
    return `This will record that ${doc.lender} forgave ${what} of ${doc.instalments} on ${doc.loanNumber}: ${formatPeso(doc.totalCents)}, ${formatPeso(doc.principalCents)} principal booked as a gain and ${formatPeso(doc.interestCents)} interest.${interest} Reason: ${doc.reason}`;
  },

  /** Instalments of the loans that stand; settled, out-of-order or nothing-due ones are refused by validate. */
  arbitrary(db) {
    const loans = db.prepare(`SELECT l.document_id FROM loan_loans l JOIN documents d ON d.id = l.document_id WHERE d.status = 'posted'`).pluck().all() as string[];
    return fc.record({
      loanId: fc.constantFrom(...(loans.length > 0 ? loans : ['no-loan-yet'])),
      instalmentNo: fc.integer({ min: 1, max: 4 }),
      reason: fc.constantFrom('The bank waived the rest (made up)', 'Lender forgave the balance of this instalment'),
      note: fc.option(fc.constantFrom('Letter from the bank on file', 'Agreed by phone'), { nil: undefined }),
    }).map(({ note, ...r }): ForgivenessInput => (note ? { ...r, note } : r));
  },
};
