/**
 * The statutory screens' rules: the remittance form's typed values to input, and the check's plain words. Pure, so they
 * are tested without a browser; the server works everything out again.
 */
import { formatPeso, isBusinessDate } from '@moonproject/shared';
import type { RemittanceInput, Scheme, SchemeCheck } from '../../api.ts';
import { cents } from '../COL/money.ts';

export const SCHEME_LABEL: Record<Scheme, string> = { SSS: 'SSS', PHIC: 'PhilHealth', HDMF: 'Pag-IBIG', WTAX: 'Withholding tax (1601-C)' };
export const SCHEME_LIST = Object.keys(SCHEME_LABEL) as Scheme[];
export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface RemittanceValues { scheme: string; month: string; cashPlaceId: string; amount: string; reference: string; note: string }

/** The form's values -> remittance input, with plain errors. */
export function remittanceInput(v: RemittanceValues): { input: RemittanceInput; errors: string[] } {
  const amount = cents(v.amount);
  const errors = [
    ...(SCHEME_LIST.includes(v.scheme as Scheme) ? [] : ['Pick what is being paid.']),
    ...(isMonth(v.month) ? [] : ['Pick the month paid for.']),
    ...(v.cashPlaceId ? [] : ['Pick where the money came from.']),
    ...(amount && amount > 0 ? [] : ['Type the amount paid, like 7,560.00']),
    ...(v.reference.trim().length >= 3 ? [] : ['Type the PRN, payment reference or receipt number.']),
  ];
  return {
    input: { scheme: v.scheme as Scheme, month: v.month, cashPlaceId: Number(v.cashPlaceId), amountCents: amount ?? 0, reference: v.reference.trim(), ...(v.note.trim() ? { note: v.note.trim() } : {}) },
    errors,
  };
}

/**
 * The date paid (STAT-1), offered only to someone who may backdate (acc.backdate): empty is today, so the client sends
 * no date; the server refuses a day after today.
 */
export function paidOn(value: string): { businessDate?: string; error?: string } {
  const v = value.trim();
  if (!v) return {};
  return isBusinessDate(v) ? { businessDate: v } : { error: 'Type the date paid like 2026-10-02, or leave it empty for today.' };
}

/** One line of the remittance check: "Remitted in full", "₱2,280.00 to remit", or "Remitted ₱3,770.00 more than the payrolls show". */
export function checkWords(c: SchemeCheck): { text: string; tone: 'success' | 'warning' | 'info' } {
  if (c.recordedCents === 0 && c.remittedCents === 0) return { text: 'Nothing recorded', tone: 'info' };
  if (c.balanceCents === 0) return { text: 'Remitted in full', tone: 'success' };
  if (c.balanceCents > 0) return { text: `${formatPeso(c.balanceCents)} to remit`, tone: 'info' };
  return { text: `Remitted ${formatPeso(-c.balanceCents)} more than the payrolls show`, tone: 'warning' };
}
