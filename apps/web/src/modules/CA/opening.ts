/**
 * Opening cash advance form's rules (PLAN D8 "Cut-over" step 3, OBCA-): what an employee still owed on cash advances on
 * the cut-over date, the deduction per payroll, and the old CA numbers it replaces. Pure, so they are tested without a
 * browser; the server checks everything again and the first payroll after the cut-over deducts it like any CA-.
 */
import { formatPesos } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

export interface OpeningValues { employeeId: string; owed: string; installment: string; note: string }
export const emptyOpening = (): OpeningValues => ({ employeeId: '', owed: '', installment: '', note: '' });

/** The form's values -> opening cash advance input, with plain errors. */
export function openingInput(v: OpeningValues): { input: Record<string, unknown>; errors: string[] } {
  const owed = cents(v.owed);
  const installment = cents(v.installment);
  const errors = [
    ...(v.employeeId ? [] : ['Pick the employee.']),
    ...(owed && owed > 0 ? [] : ['Type what is still owed, like 2,000.00']),
    ...(installment && installment > 0 ? [] : ['Type the deduction per payroll, like 500.00']),
    ...(owed && installment && installment > owed ? ['The deduction per payroll cannot be more than what is owed.'] : []),
    ...(v.note.trim().length >= 3 ? [] : ['Type the old CA numbers this replaces.']),
  ];
  const input = { employeeId: v.employeeId, owedCents: owed ?? 0, installmentCents: installment ?? 0, note: v.note.trim() };
  return { input, errors };
}

type Stored = { employeeId: string; owedCents: number; installmentCents: number; note: string };
/** Stored input -> the form's values, to prefill an edit. */
export const openingValues = (s: Stored): OpeningValues => ({ employeeId: s.employeeId, owed: formatPesos(s.owedCents), installment: formatPesos(s.installmentCents), note: s.note });
