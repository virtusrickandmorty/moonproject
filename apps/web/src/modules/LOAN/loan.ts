/**
 * The loan screens' rules (PLAN D5 LOAN-IN, LOAN-PAY, E10, D8 "Cut-over"): the loan form's typed values to input (where
 * the proceeds went, the yearly rate as a percent, a generated or typed schedule), the opening loan's, and the loan
 * payment's. Pure, so they are tested without a browser; the server works out the schedule and checks everything again.
 */
import { formatPeso, formatPesos, isBusinessDate } from '@moonproject/shared';
import type { Account } from '../../api.ts';
import { cents } from '../COL/money.ts';

export type Method = 'declining' | 'flat' | 'typed';
export const METHOD_WORDS: Record<Method, [string, string]> = {
  declining: ['Equal payments, declining balance', 'The same payment every month; interest on what is still owed (a bank amortization table).'],
  flat: ['Flat (add-on) interest', 'Interest on the original amount every month; the principal in equal parts.'],
  typed: ['Type the lender’s table', 'Copy each instalment from the lender’s schedule.'],
};

/** "12" or "10.5" (% a year) -> basis points; undefined if not a rate from 0 to 100 with at most two decimals. */
export function percentToBp(text: string): number | undefined {
  const v = text.trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return undefined;
  const [whole, frac = ''] = v.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bp <= 10_000 ? bp : undefined;
}
export const bpToPercent = (bp: number) => String(bp / 100);

export interface RowText { dueDate: string; principal: string; interest: string }
export const emptyRowText = (): RowText => ({ dueDate: '', principal: '', interest: '' });

export interface LoanValues {
  lender: string; reference: string; kind: 'loan' | 'equipment'; proceeds: 'cash' | 'asset'; cashPlaceId: string; assetPurchaseId: string;
  principal: string; fee: string; feeAccountId: string; rate: string; term: string; schedule: Method; firstDueDate: string; rows: RowText[]; note: string;
}
export const emptyLoan = (): LoanValues => ({
  lender: '', reference: '', kind: 'loan', proceeds: 'cash', cashPlaceId: '', assetPurchaseId: '', principal: '', fee: '', feeAccountId: '', rate: '', term: '',
  schedule: 'declining', firstDueDate: '', rows: [emptyRowText()], note: '',
});

/** Principal the typed schedule repays; unreadable amounts count as nothing. */
export const scheduledPrincipal = (rows: RowText[]) => rows.reduce((s, r) => s + Math.max(cents(r.principal) ?? 0, 0), 0);

/** The typed instalments (blank lines left out) as input rows, with their typing slips. */
function typedRows(text: RowText[]) {
  const filled = text.filter((r) => r.dueDate || r.principal.trim() || r.interest.trim());
  const errors = filled.length === 0 ? ['Type the instalments from the lender’s table.'] : [];
  filled.forEach((r, i) => {
    const p = cents(r.principal), n = cents(r.interest);
    if (!isBusinessDate(r.dueDate)) errors.push(`Instalment ${i + 1}: pick the due date.`);
    if (p === undefined || p < 0 || n === undefined || n < 0) errors.push(`Instalment ${i + 1}: type the principal and interest like 12,500.00`);
  });
  const rows = filled.map((r) => ({ dueDate: r.dueDate, principalCents: cents(r.principal) ?? 0, interestCents: cents(r.interest) ?? 0 }));
  return { rows, errors, repaid: scheduledPrincipal(filled) };
}

/** The loan form's values -> loan input, with plain errors. */
export function loanInput(v: LoanValues): { input: Record<string, unknown>; errors: string[] } {
  const principal = cents(v.principal);
  const fee = cents(v.fee);
  const rateBp = percentToBp(v.rate);
  const term = /^\d+$/.test(v.term.trim()) ? Number(v.term) : 0;
  const typed = typedRows(v.rows);
  const errors = [
    ...(v.lender.trim().length >= 2 ? [] : ['Type the lender’s name.']),
    ...(v.proceeds === 'cash' && !v.cashPlaceId ? ['Pick where the loan money arrived.'] : []),
    ...(v.proceeds === 'asset' && !v.assetPurchaseId ? ['Pick the asset purchase the lender paid for.'] : []),
    ...(principal && principal > 0 ? [] : ['Type the loan amount (principal) like 500,000.00']),
    ...(fee === undefined || fee < 0 ? ['Type the fees deducted like 5,000.00, or leave them blank.'] : []),
    ...(rateBp === undefined ? ['Type the yearly interest rate like 12 or 10.5 (0 if none).'] : []),
    ...(term >= 1 && term <= 360 ? [] : ['Type the term in months, from 1 to 360.']),
    ...(v.schedule !== 'typed' && v.firstDueDate && !isBusinessDate(v.firstDueDate) ? ['Type the first due date like 2026-10-28, or leave it empty.'] : []),
  ];
  if (v.schedule === 'typed') {
    errors.push(...typed.errors);
    if (principal && typed.rows.length > 0 && typed.repaid !== principal) errors.push(`The instalments repay ${formatPeso(typed.repaid)} of principal, not ${formatPeso(principal)}.`);
  }
  const input = {
    lender: v.lender.trim(), kind: v.kind,
    ...(v.proceeds === 'cash' ? { cashPlaceId: Number(v.cashPlaceId) } : { assetPurchaseId: v.assetPurchaseId }),
    principalCents: principal ?? 0, ...(fee ? { feeCents: fee, ...(v.feeAccountId ? { feeAccountId: Number(v.feeAccountId) } : {}) } : {}),
    interestRateBp: rateBp ?? 0, termMonths: term, schedule: v.schedule,
    ...(v.schedule === 'typed' ? { rows: typed.rows } : v.firstDueDate ? { firstDueDate: v.firstDueDate } : {}),
    ...(v.reference.trim() ? { reference: v.reference.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { input, errors };
}

type StoredLoan = {
  lender: string; kind: 'loan' | 'equipment'; cashPlaceId?: number; assetPurchaseId?: string; principalCents: number; feeCents?: number; feeAccountId?: number; interestRateBp: number;
  termMonths: number; schedule: Method; firstDueDate?: string; rows?: { dueDate: string; principalCents: number; interestCents: number }[]; reference?: string; note?: string;
};
/** Stored input -> the form's values, to prefill an edit. */
export const loanValues = (s: StoredLoan): LoanValues => ({
  lender: s.lender, reference: s.reference ?? '', kind: s.kind, proceeds: s.assetPurchaseId ? 'asset' : 'cash', cashPlaceId: s.cashPlaceId ? String(s.cashPlaceId) : '', assetPurchaseId: s.assetPurchaseId ?? '',
  principal: formatPesos(s.principalCents), fee: s.feeCents ? formatPesos(s.feeCents) : '', feeAccountId: s.feeAccountId ? String(s.feeAccountId) : '', rate: bpToPercent(s.interestRateBp),
  term: String(s.termMonths), schedule: s.schedule, firstDueDate: s.firstDueDate ?? '', note: s.note ?? '',
  rows: s.rows?.map((r) => ({ dueDate: r.dueDate, principal: formatPesos(r.principalCents), interest: formatPesos(r.interestCents) })) ?? [emptyRowText()],
});

export interface OpeningValues {
  lender: string; reference: string; kind: 'loan' | 'equipment'; original: string; dateReceived: string; owed: string; rate: string; monthsLeft: string;
  schedule: Method; nextDueDate: string; rows: RowText[]; note: string;
}
export const emptyOpening = (): OpeningValues => ({
  lender: '', reference: '', kind: 'loan', original: '', dateReceived: '', owed: '', rate: '', monthsLeft: '', schedule: 'declining', nextDueDate: '', rows: [emptyRowText()], note: '',
});

/** The opening loan form's values -> input: the loan as received, the principal still owed at the cut-over, the rest of the schedule. */
export function openingInput(v: OpeningValues): { input: Record<string, unknown>; errors: string[] } {
  const original = cents(v.original);
  const owed = cents(v.owed);
  const rateBp = percentToBp(v.rate);
  const months = /^\d+$/.test(v.monthsLeft.trim()) ? Number(v.monthsLeft) : 0;
  const typed = typedRows(v.rows);
  const errors = [
    ...(v.lender.trim().length >= 2 ? [] : ['Type the lender’s name.']),
    ...(original && original > 0 ? [] : ['Type the loan as received (principal) like 1,000,000.00']),
    ...(isBusinessDate(v.dateReceived) ? [] : ['Pick the date the loan was received.']),
    ...(owed && owed > 0 ? [] : ['Type the principal still owed on the cut-over date like 738,900.00']),
    ...(original && owed && owed > original ? ['The principal still owed cannot be more than the loan as received.'] : []),
    ...(rateBp === undefined ? ['Type the yearly interest rate like 12 or 10.5 (0 if none).'] : []),
    ...(months >= 1 && months <= 360 ? [] : ['Type the months left, from 1 to 360.']),
    ...(v.schedule !== 'typed' && !isBusinessDate(v.nextDueDate) ? ['Pick when the next instalment falls due.'] : []),
    ...(v.schedule === 'typed' ? typed.errors : []),
    ...(v.schedule === 'typed' && owed && typed.rows.length > 0 && typed.repaid !== owed ? [`The instalments repay ${formatPeso(typed.repaid)} of principal, not the ${formatPeso(owed)} still owed.`] : []),
  ];
  const input = {
    lender: v.lender.trim(), kind: v.kind, originalPrincipalCents: original ?? 0, dateReceived: v.dateReceived, principalCents: owed ?? 0,
    interestRateBp: rateBp ?? 0, monthsLeft: months, schedule: v.schedule,
    ...(v.schedule === 'typed' ? { rows: typed.rows } : { nextDueDate: v.nextDueDate }),
    ...(v.reference.trim() ? { reference: v.reference.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { input, errors };
}

type StoredOpening = {
  lender: string; kind: 'loan' | 'equipment'; originalPrincipalCents: number; dateReceived: string; principalCents: number; interestRateBp: number; monthsLeft: number;
  schedule: Method; nextDueDate?: string; rows?: { dueDate: string; principalCents: number; interestCents: number }[]; reference?: string; note?: string;
};
/** Stored input -> the opening form's values, to prefill an edit. */
export const openingValues = (s: StoredOpening): OpeningValues => ({
  lender: s.lender, reference: s.reference ?? '', kind: s.kind, original: formatPesos(s.originalPrincipalCents), dateReceived: s.dateReceived, owed: formatPesos(s.principalCents),
  rate: bpToPercent(s.interestRateBp), monthsLeft: String(s.monthsLeft), schedule: s.schedule, nextDueDate: s.nextDueDate ?? '', note: s.note ?? '',
  rows: s.rows?.map((r) => ({ dueDate: r.dueDate, principal: formatPesos(r.principalCents), interest: formatPesos(r.interestCents) })) ?? [emptyRowText()],
});

/** Accounts the accountant may put loan fees on instead of interest and financing charges: expense or prepaid, no subledger. */
export const feeAccounts = (accounts: Account[]) =>
  accounts.filter((a) => a.isActive && !a.isHeader && !a.isCashPlace && (!a.partyType || a.partyType === 'free') && (a.type === 'expense' || a.type === 'asset'));

export interface PaymentValues { loanId: string; instalmentNo: number; cashPlaceId: string; differs: boolean; principal: string; interest: string; note: string }

/** The loan payment's values -> input. The split is sent only when the lender applied it differently, and then with a note. */
export function paymentInput(v: PaymentValues): { input: Record<string, unknown>; errors: string[] } {
  const principal = cents(v.principal), interest = cents(v.interest);
  const errors = [
    ...(v.loanId && v.instalmentNo ? [] : ['Pick the loan.']),
    ...(v.cashPlaceId ? [] : ['Pick where the money came from.']),
    ...(v.differs && (principal === undefined || principal < 0 || interest === undefined || interest < 0) ? ['Type the principal and interest the lender applied, like 12,500.00'] : []),
    ...(v.differs && v.note.trim().length < 3 ? ['Say why the split differs from the schedule.'] : []),
  ];
  const input = {
    loanId: v.loanId, instalmentNo: v.instalmentNo, cashPlaceId: Number(v.cashPlaceId),
    ...(v.differs ? { principalCents: principal ?? 0, interestCents: interest ?? 0, ...(v.note.trim() ? { note: v.note.trim() } : {}) } : {}),
  };
  return { input, errors };
}

export interface ForgiveValues { loanId: string; instalmentNo: number; reason: string; note: string }

/** The loan forgiveness form's values -> input. The amount is never sent: the server forgives all that is still due. */
export function forgivenessInput(v: ForgiveValues): { input: Record<string, unknown>; errors: string[] } {
  const reason = v.reason.trim();
  const errors = [
    ...(v.loanId && v.instalmentNo ? [] : ['Open this from the loan’s schedule or the late list.']),
    ...(reason.length < 10 ? ['Say why the lender forgave it (at least 10 characters).'] : reason.length > 200 ? ['Keep the reason to 200 characters.'] : []),
  ];
  const input = { loanId: v.loanId, instalmentNo: v.instalmentNo, reason, ...(v.note.trim() ? { note: v.note.trim() } : {}) };
  return { input, errors };
}
