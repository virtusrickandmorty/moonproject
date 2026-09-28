/**
 * Loan (LOAN-, PLAN D5 "LOAN-IN", E10). A loan is recorded when its proceeds arrive, with its repayment schedule.
 *   Dr cash place (principal − fees) ; Dr 7201 fees, or the account the accountant directs
 *     / Cr 2601 loans payable or 2602 equipment financing (principal, party = this loan)
 * The schedule is generated (equal monthly instalments, declining or flat interest) or typed from the lender's table.
 * Edit = cancel + reissue, only while no payment stands against the loan.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getAccount, getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { addMonths, generateSchedule, KINDS, METHODS, type LoanKind, type Method, type ScheduleRow } from '../loans.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
export const FEE_ACCOUNT_PERMISSION = 'loan.in.fee_account';

const date = z.string().refine(isBusinessDate, 'Use a date like 2026-10-28.');
const cents = z.number().int().min(0).max(MAX_CENTS);
export const loanInput = z
  .object({
    lender: z.string().trim().min(2).max(120),
    kind: z.enum(['loan', 'equipment']),
    cashPlaceId: z.number().int().positive(), // where the proceeds arrived
    principalCents: z.number().int().positive().max(MAX_CENTS),
    feeCents: cents.optional(), // deducted by the lender from the proceeds
    feeAccountId: z.number().int().positive().optional(), // the accountant's choice instead of 7201
    interestRateBp: z.number().int().min(0).max(10_000), // yearly: 1200 = 12%
    termMonths: z.number().int().min(1).max(360),
    schedule: z.enum(METHODS),
    firstDueDate: date.optional(), // generated schedules; left out: one month after the loan date
    rows: z.array(z.object({ dueDate: date, principalCents: cents, interestCents: cents }).strict()).min(1).max(360).optional(), // typed schedules
    reference: z.string().trim().min(1).max(60).optional(), // the lender's loan or promissory note number
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type LoanInput = z.infer<typeof loanInput>;

export interface Loan {
  lender: string; kind: LoanKind; cashPlaceId: number; principalCents: number; feeCents: number; feeAccountId: number | null;
  interestRateBp: number; termMonths: number; schedule: Method; rows: ScheduleRow[]; reference?: string; note?: string;
  netCents: number; cashPlaceName: string; totalCents: number;
}

type Fields = Omit<Loan, 'netCents' | 'cashPlaceName' | 'totalCents'>;
const named = (db: Parameters<typeof getCashPlace>[0], f: Fields): Loan => ({
  ...f,
  netCents: f.principalCents - f.feeCents,
  cashPlaceName: getCashPlace(db, f.cashPlaceId)?.name ?? '?',
  totalCents: f.principalCents,
});

export const loanDoc: DocTypeDef<LoanInput, Loan> = {
  key: 'loan.loan',
  module: 'LOAN',
  title: 'Loan',
  numbering: { series: { key: 'LOAN', prefix: 'LOAN-' } },
  permissions: { view: 'loan.in.view', create: 'loan.in.create', post: 'loan.in.post', cancel: 'loan.in.cancel' },
  dating: 'system',
  inputSchema: loanInput,

  compute(input, ctx) {
    const { firstDueDate, rows, feeCents, feeAccountId, reference, note, ...rest } = input;
    const schedule =
      input.schedule === 'typed'
        ? (rows ?? []).map((r, i) => ({ instalmentNo: i + 1, ...r }))
        : generateSchedule(input.principalCents, input.interestRateBp, input.termMonths, input.schedule, firstDueDate ?? addMonths(ctx.businessDate, 1));
    return named(ctx.db, { ...rest, feeCents: feeCents ?? 0, feeAccountId: feeAccountId ?? null, rows: schedule, ...(reference ? { reference } : {}), ...(note ? { note } : {}) });
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) err('cashPlaceId', 'CASH_PLACE', 'Pick where the loan money arrived.');
    if (doc.feeCents >= doc.principalCents) err('feeCents', 'FEE_TOO_BIG', 'The fees must be less than the loan.');
    if (doc.feeAccountId !== null) {
      const a = getAccount(ctx.db, doc.feeAccountId);
      if (!ctx.can(FEE_ACCOUNT_PERMISSION)) err('feeAccountId', 'NOT_ALLOWED', 'Only the accountant picks another account for loan fees.');
      // A subledger account (receivables, input VAT, ...) needs a party this document does not have; 'free' ones do not.
      else if (!a?.is_active || !a.is_postable || a.is_header || a.is_cash_place || (a.party_type && a.party_type !== 'free') || !['expense', 'asset'].includes(a.type)) {
        err('feeAccountId', 'FEE_ACCOUNT', 'Pick an expense or prepaid account with no subledger for the fees.');
      }
    }
    if (doc.rows.length === 0) err('rows', 'SCHEDULE', 'Type the schedule rows from the lender’s table.');
    if (doc.rows.some((r) => r.principalCents + r.interestCents === 0)) err('rows', 'SCHEDULE_ZERO', 'Every instalment must pay some principal or interest.');
    const scheduled = doc.rows.reduce((s, r) => s + r.principalCents, 0);
    if (doc.rows.length > 0 && scheduled !== doc.principalCents) {
      err('rows', 'SCHEDULE_TOTAL', `The schedule repays ${formatPeso(scheduled)} of principal, not ${formatPeso(doc.principalCents)}.`);
    }
    if (doc.rows.some((r, i) => i > 0 && r.dueDate <= doc.rows[i - 1]!.dueDate)) err('rows', 'SCHEDULE_DATES', 'Each instalment must fall due after the one before.');
    if (doc.rows[0] && doc.rows[0].dueDate <= ctx.businessDate) {
      issues.push({ field: 'rows', code: 'DUE_ALREADY', level: 'warning', message: `The first instalment falls due on ${doc.rows[0].dueDate}, not after today. Please check.` });
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO loan_loans (document_id, lender, kind, cash_account_id, principal_cents, fee_cents, fee_account_id, rate_bp, term_months, schedule, reference, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.lender, doc.kind, doc.cashPlaceId, doc.principalCents, doc.feeCents, doc.feeAccountId, doc.interestRateBp, doc.termMonths, doc.schedule, doc.reference ?? null, doc.note ?? null);
    const row = db.prepare('INSERT INTO loan_schedule (loan_id, instalment_no, due_date, principal_cents, interest_cents) VALUES (?, ?, ?, ?, ?)');
    for (const r of doc.rows) row.run(h.documentId, r.instalmentNo, r.dueDate, r.principalCents, r.interestCents);
  },

  journal(doc, _ctx, header) {
    // The loan is its own party. A preview has no document id yet and shows the loan as "new".
    const party = { type: 'loan', id: header?.documentId ?? 'new' };
    return {
      memo: `Loan from ${doc.lender}${doc.reference ? ` (${doc.reference})` : ''}`,
      lines: [
        { account: { cashPlace: doc.cashPlaceId }, debitCents: doc.netCents },
        { account: doc.feeAccountId !== null ? { accountId: doc.feeAccountId } : { role: 'INTEREST_EXPENSE' }, debitCents: doc.feeCents, memo: 'Loan fees deducted' },
        { account: { role: KINDS[doc.kind].role }, party, creditCents: doc.principalCents, memo: 'Principal' },
      ],
    };
  },

  /** Payments that stand against the loan: cancel them first (also before an edit, which keeps no payments). */
  dependents(db, documentId) {
    return db
      .prepare(`SELECT d.id, d.number FROM loan_payments p JOIN documents d ON d.id = p.document_id WHERE p.loan_id = ? AND d.status = 'posted' ORDER BY d.number DESC`)
      .all(documentId) as { id: string; number: string }[];
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM loan_loans WHERE document_id = ?').get(documentId) as
      | { lender: string; kind: LoanKind; cash_account_id: number; principal_cents: number; fee_cents: number; fee_account_id: number | null; rate_bp: number; term_months: number; schedule: Method; reference: string | null; note: string | null }
      | undefined;
    if (!r) throw new Error(`Loan ${documentId} not found`);
    const rows = db
      .prepare('SELECT instalment_no AS instalmentNo, due_date AS dueDate, principal_cents AS principalCents, interest_cents AS interestCents FROM loan_schedule WHERE loan_id = ? ORDER BY instalment_no')
      .all(documentId) as ScheduleRow[];
    return named(db, {
      lender: r.lender, kind: r.kind, cashPlaceId: r.cash_account_id, principalCents: r.principal_cents, feeCents: r.fee_cents, feeAccountId: r.fee_account_id,
      interestRateBp: r.rate_bp, termMonths: r.term_months, schedule: r.schedule, rows, ...(r.reference ? { reference: r.reference } : {}), ...(r.note ? { note: r.note } : {}),
    });
  },

  toInput(doc) {
    const { lender, kind, cashPlaceId, principalCents, feeCents, feeAccountId, interestRateBp, termMonths, schedule, rows, reference, note } = doc;
    return {
      lender, kind, cashPlaceId, principalCents, ...(feeCents ? { feeCents } : {}), ...(feeAccountId !== null ? { feeAccountId } : {}), interestRateBp, termMonths, schedule,
      ...(schedule === 'typed' ? { rows: rows.map(({ instalmentNo: _, ...r }) => r) } : { firstDueDate: rows[0]!.dueDate }),
      ...(reference ? { reference } : {}), ...(note ? { note } : {}),
    };
  },

  summary(doc) {
    const received = doc.feeCents > 0 ? `${formatPeso(doc.netCents)} received in ${doc.cashPlaceName} after ${formatPeso(doc.feeCents)} in fees` : `received in ${doc.cashPlaceName}`;
    const first = doc.rows[0];
    const repaid = first ? `repaid in ${doc.rows.length} instalments from ${first.dueDate} (the first is ${formatPeso(first.principalCents + first.interestCents)})` : 'with no schedule yet';
    return `This will record a ${KINDS[doc.kind].label} of ${formatPeso(doc.principalCents)} from ${doc.lender}, ${received}, ${repaid}.`;
  },

  /** Any kind and schedule; a typed schedule repays the principal in quarterly parts. */
  arbitrary(db) {
    return fc
      .record({
        lender: fc.constantFrom('Sample Bank', 'Made-up Lending Co.'),
        kind: fc.constantFrom<LoanKind>('loan', 'equipment'),
        cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
        principalCents: fc.integer({ min: 1_000_00, max: 10_000_000_00 }),
        feePercent: fc.integer({ min: 0, max: 5 }),
        interestRateBp: fc.integer({ min: 0, max: 3_600 }),
        termMonths: fc.integer({ min: 1, max: 60 }),
        schedule: fc.constantFrom<Method>(...METHODS),
      })
      .map(({ feePercent, ...r }): LoanInput => {
        const feeCents = Math.floor((r.principalCents * feePercent) / 100);
        const base = { ...r, ...(feeCents ? { feeCents } : {}) };
        if (r.schedule !== 'typed') return { ...base, firstDueDate: '2026-10-28' };
        const parts = allocate(r.principalCents, Array<number>(Math.ceil(r.termMonths / 3)).fill(1));
        return { ...base, rows: parts.map((p, i) => ({ dueDate: addMonths('2026-12-28', 3 * i), principalCents: p, interestCents: applyRate(p, r.interestRateBp) })) };
      });
  },
};
