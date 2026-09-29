/**
 * Opening Loan (OBLN-, PLAN D8 "Cut-over" step 3, MIG-02 part 2, ACC/public.ts): a loan or equipment financing received
 * before the cut-over date and not yet paid off, with the principal still owed on that date and the remaining schedule
 * (generated from the next due date and the months left, or typed from the lender's table). Accountant only; dated the
 * cut-over date, and refused once the opening is closed.
 *   Dr 3900 opening balance equity / Cr 2601 loans payable or 2602 equipment financing (principal still owed, party = this loan)
 * The OBLN- document is the loan, like a LOAN- (migration 0003): it is in the loan register, and a loan payment (LPAY-)
 * pays its schedule. The register shows its original principal and date received; what was repaid before is the difference.
 * Cancel mirrors it on the cut-over date (cancelOn), only while the opening is open and no payment stands against it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { assertOpeningOpen, duplicateOpeningIssue, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { addMonths, generateSchedule, KINDS, METHODS, schedule, type LoanKind, type Method, type ScheduleRow } from '../loans.ts';
import { loanDoc } from './loan.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

const date = z.string().refine(isBusinessDate, 'Use a date like 2026-10-28.');
const cents = z.number().int().min(0).max(MAX_CENTS);
export const openingLoanInput = z
  .object({
    lender: z.string().trim().min(2).max(120),
    kind: z.enum(['loan', 'equipment']),
    originalPrincipalCents: z.number().int().positive().max(MAX_CENTS), // the loan as received, for the register ...
    dateReceived: date, // ... and when
    principalCents: z.number().int().positive().max(MAX_CENTS), // still owed on the cut-over date
    interestRateBp: z.number().int().min(0).max(10_000), // yearly: 1200 = 12%
    monthsLeft: z.number().int().min(1).max(360),
    schedule: z.enum(METHODS),
    nextDueDate: date.optional(), // generated schedules: when the next instalment falls due
    rows: z.array(z.object({ dueDate: date, principalCents: cents, interestCents: cents }).strict()).min(1).max(360).optional(), // typed schedules
    reference: z.string().trim().min(1).max(60).optional(), // the lender's loan or promissory note number
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type OpeningLoanInput = z.infer<typeof openingLoanInput>;

export interface OpeningLoan {
  lender: string; kind: LoanKind; originalPrincipalCents: number; dateReceived: string; principalCents: number; interestRateBp: number; monthsLeft: number;
  schedule: Method; rows: ScheduleRow[]; reference?: string; note?: string; totalCents: number;
}

export const openingLoanDoc: DocTypeDef<OpeningLoanInput, OpeningLoan> = {
  key: 'loan.opening',
  module: 'LOAN',
  title: 'Opening Loan',
  numbering: { series: { key: 'OBLN', prefix: 'OBLN-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingLoanInput,

  compute(input) {
    const { nextDueDate, rows, reference, note, ...rest } = input;
    const due =
      input.schedule === 'typed'
        ? (rows ?? []).map((r, i) => ({ instalmentNo: i + 1, ...r }))
        : nextDueDate ? generateSchedule(input.principalCents, input.interestRateBp, input.monthsLeft, input.schedule, nextDueDate) : [];
    return { ...rest, rows: due, ...(reference ? { reference } : {}), ...(note ? { note } : {}), totalCents: input.principalCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [...openingIssues(ctx.db, ctx.businessDate)];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (doc.dateReceived > ctx.businessDate) {
      err('dateReceived', 'RECEIVED_AFTER', `A loan received on ${doc.dateReceived}, after ${ctx.businessDate}, is recorded as a loan (LOAN-), not an opening.`);
    }
    if (doc.principalCents > doc.originalPrincipalCents) {
      err('principalCents', 'OWED_MORE', `The principal still owed, ${formatPeso(doc.principalCents)}, is more than the loan of ${formatPeso(doc.originalPrincipalCents)}.`);
    }
    if (doc.rows.length === 0) {
      if (doc.schedule === 'typed') err('rows', 'SCHEDULE', 'Type the remaining instalments from the lender’s table.');
      else err('nextDueDate', 'NEXT_DUE_DATE', 'Type when the next instalment falls due.');
    }
    if (doc.rows.some((r) => r.principalCents + r.interestCents === 0)) err('rows', 'SCHEDULE_ZERO', 'Every instalment must pay some principal or interest.');
    const scheduled = doc.rows.reduce((s, r) => s + r.principalCents, 0);
    if (doc.rows.length > 0 && scheduled !== doc.principalCents) {
      err('rows', 'SCHEDULE_TOTAL', `The schedule repays ${formatPeso(scheduled)} of principal, not the ${formatPeso(doc.principalCents)} still owed.`);
    }
    if (doc.rows.some((r, i) => i > 0 && r.dueDate <= doc.rows[i - 1]!.dueDate)) err('rows', 'SCHEDULE_DATES', 'Each instalment must fall due after the one before.');
    if (doc.rows[0] && doc.rows[0].dueDate <= ctx.businessDate) {
      issues.push({ field: 'rows', code: 'DUE_ALREADY', level: 'warning', message: `The first instalment fell due on ${doc.rows[0].dueDate}, by the cut-over date. Please check it is still unpaid.` });
    }
    const earlier = ctx.db
      .prepare(
        `SELECT d.number FROM loan_loans l JOIN documents d ON d.id = l.document_id
         WHERE d.doc_type = 'loan.opening' AND d.status = 'posted' AND lower(l.lender) = lower(?) AND l.principal_cents = ? ORDER BY d.number LIMIT 1`,
      )
      .pluck()
      .get(doc.lender, doc.principalCents) as string | undefined;
    issues.push(...duplicateOpeningIssue(ctx.db, 'lender', earlier, `this loan (${doc.lender}, ${formatPeso(doc.principalCents)} still owed)`));
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO loan_loans (document_id, lender, kind, cash_account_id, principal_cents, fee_cents, rate_bp, term_months, schedule, reference, note)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.lender, doc.kind, resolveAccount(db, { role: 'OPENING_EQUITY' }).id, // no cash arrives: 3900 (migration 0003)
      doc.principalCents, doc.interestRateBp, doc.monthsLeft, doc.schedule, doc.reference ?? null, doc.note ?? null,
    );
    db.prepare('INSERT INTO loan_openings (document_id, original_principal_cents, date_received) VALUES (?, ?, ?)').run(h.documentId, doc.originalPrincipalCents, doc.dateReceived);
    const row = db.prepare('INSERT INTO loan_schedule (loan_id, instalment_no, due_date, principal_cents, interest_cents) VALUES (?, ?, ?, ?, ?)');
    for (const r of doc.rows) row.run(h.documentId, r.instalmentNo, r.dueDate, r.principalCents, r.interestCents);
  },

  journal(doc, _ctx, header) {
    // The loan is its own party, as for a LOAN-. A preview has no document id yet and shows the loan as "new".
    return {
      memo: `Opening loan from ${doc.lender}${doc.reference ? ` (${doc.reference})` : ''}`,
      lines: [
        { account: { role: 'OPENING_EQUITY' }, debitCents: doc.principalCents, memo: 'Opening balance equity' },
        { account: { role: KINDS[doc.kind].role }, party: { type: 'loan', id: header?.documentId ?? 'new' }, creditCents: doc.principalCents, memo: 'Principal still owed' },
      ],
    };
  },

  /** Payments that stand against the loan, as for a LOAN-: cancel them first (also before an edit). */
  dependents: (db, documentId) => loanDoc.dependents!(db, documentId),

  load(db, documentId) {
    const r = db
      .prepare(`SELECT l.*, o.original_principal_cents, o.date_received FROM loan_loans l JOIN loan_openings o ON o.document_id = l.document_id WHERE l.document_id = ?`)
      .get(documentId) as
      | { lender: string; kind: LoanKind; principal_cents: number; rate_bp: number; term_months: number; schedule: Method; reference: string | null; note: string | null; original_principal_cents: number; date_received: string }
      | undefined;
    if (!r) throw new Error(`Opening loan ${documentId} not found`);
    return {
      lender: r.lender, kind: r.kind, originalPrincipalCents: r.original_principal_cents, dateReceived: r.date_received, principalCents: r.principal_cents,
      interestRateBp: r.rate_bp, monthsLeft: r.term_months, schedule: r.schedule, rows: schedule(db, documentId).map(({ paidBy: _, ...row }) => row),
      ...(r.reference ? { reference: r.reference } : {}), ...(r.note ? { note: r.note } : {}), totalCents: r.principal_cents,
    };
  },

  toInput(doc) {
    const { lender, kind, originalPrincipalCents, dateReceived, principalCents, interestRateBp, monthsLeft, schedule: method, rows, reference, note } = doc;
    return {
      lender, kind, originalPrincipalCents, dateReceived, principalCents, interestRateBp, monthsLeft, schedule: method,
      ...(method === 'typed' ? { rows: rows.map(({ instalmentNo: _, ...r }) => r) } : rows[0] ? { nextDueDate: rows[0].dueDate } : {}),
      ...(reference ? { reference } : {}), ...(note ? { note } : {}),
    };
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its OBLN- documents. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const what = KINDS[doc.kind].label;
    const n = doc.rows.length;
    const first = doc.rows[0];
    const repaid = first ? `repaid in ${n} more ${n === 1 ? 'instalment' : 'instalments'} from ${first.dueDate} (the next is ${formatPeso(first.principalCents + first.interestCents)})` : 'with no schedule yet';
    return `This will open ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what} of ${formatPeso(doc.originalPrincipalCents)} from ${doc.lender}, received on ${doc.dateReceived}, with ${formatPeso(doc.principalCents)} of principal still owed on ${ctx.businessDate}, ${repaid}.`;
  },

  /** Loans received before a September 2026 cut-over, partly repaid; a typed schedule repays what is owed in quarterly parts. */
  arbitrary() {
    return fc
      .record({
        lender: fc.constantFrom('Sample Bank', 'Made-up Lending Co.'),
        kind: fc.constantFrom<LoanKind>('loan', 'equipment'),
        originalPrincipalCents: fc.integer({ min: 1_000_00, max: 10_000_000_00 }),
        owedPercent: fc.integer({ min: 1, max: 100 }),
        dateReceived: fc.constantFrom('2024-01-15', '2025-03-31', '2026-06-30'),
        interestRateBp: fc.integer({ min: 0, max: 3_600 }),
        monthsLeft: fc.integer({ min: 1, max: 60 }),
        schedule: fc.constantFrom<Method>(...METHODS),
      })
      .map(({ owedPercent, ...r }): OpeningLoanInput => {
        const principalCents = Math.max(1_000_00, Math.floor((r.originalPrincipalCents * owedPercent) / 100));
        if (r.schedule !== 'typed') return { ...r, principalCents, nextDueDate: '2026-10-15' };
        const parts = allocate(principalCents, Array<number>(Math.ceil(r.monthsLeft / 3)).fill(1));
        return { ...r, principalCents, rows: parts.map((p, i) => ({ dueDate: addMonths('2026-12-15', 3 * i), principalCents: p, interestCents: applyRate(p, r.interestRateBp) })) };
      });
  },
};
