/**
 * The statutory screens' rules: the remittance form's typed values to input, and the check's plain words. Pure, so they
 * are tested without a browser; the server works everything out again.
 */
import { formatPeso, isBusinessDate } from '@moonproject/shared';
import type { ExposureLine, RemittanceInput, Scheme, SchemeCheck, UploadScheme } from '../../api.ts';
import { cents } from '../COL/money.ts';

export const SCHEME_LABEL: Record<Scheme, string> = { SSS: 'SSS', PHIC: 'PhilHealth', HDMF: 'Pag-IBIG', WTAX: 'Withholding tax (1601-C)' };
export const SCHEME_LIST = Object.keys(SCHEME_LABEL) as Scheme[];
export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface RemittanceValues { scheme: string; month: string; cashPlaceId: string; amount: string; penalty: string; reference: string; note: string }

/** The form's values -> remittance input, with plain errors. A blank penalty is none. */
export function remittanceInput(v: RemittanceValues): { input: RemittanceInput; errors: string[] } {
  const amount = cents(v.amount);
  const penalty = cents(v.penalty);
  const errors = [
    ...(SCHEME_LIST.includes(v.scheme as Scheme) ? [] : ['Pick what is being paid.']),
    ...(isMonth(v.month) ? [] : ['Pick the month paid for.']),
    ...(v.cashPlaceId ? [] : ['Pick where the money came from.']),
    ...(amount && amount > 0 ? [] : ['Type the amount paid, like 7,560.00']),
    ...(penalty === undefined || penalty < 0 ? ['Type the penalty like 250.00, or leave it blank.'] : []),
    ...(v.reference.trim().length >= 3 ? [] : ['Type the PRN, payment reference or receipt number.']),
  ];
  return {
    input: {
      scheme: v.scheme as Scheme, month: v.month, cashPlaceId: Number(v.cashPlaceId), amountCents: amount ?? 0, ...(penalty ? { penaltyCents: penalty } : {}),
      reference: v.reference.trim(), ...(v.note.trim() ? { note: v.note.trim() } : {}),
    },
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

/**
 * One line of the remittance check: "Remitted in full", "₱2,280.00 to remit", "Remitted ₱3,770.00 more than the payrolls
 * show", or for the withholding tax, the year-end tax refunds: taken off the month's own remittance, carried from an
 * earlier month, or more than the month's tax and taken off the next month's remittance.
 */
export function checkWords(c: SchemeCheck): { text: string; tone: 'success' | 'warning' | 'info' } {
  if (c.recordedCents === 0 && c.remittedCents === 0 && !c.refundCents) return { text: 'Nothing recorded', tone: 'info' };
  if (c.carriedOutCents > 0) return { text: `Nothing to remit: ${formatPeso(c.carriedOutCents)} of year-end tax refunds above the month's tax come off the next month's remittance`, tone: 'info' };
  if (c.balanceCents === 0 && c.refundOpenCents > 0) return { text: "Nothing to remit: the year-end tax refunds are the same as the month's tax", tone: 'info' };
  if (c.balanceCents === 0) return { text: 'Remitted in full', tone: 'success' };
  if (c.balanceCents > 0 && c.carriedInCents > 0) {
    return { text: `${formatPeso(c.dueCents)} to remit: ${formatPeso(c.balanceCents)} less ${formatPeso(c.carriedInCents)} of year-end tax refunds carried from ${c.carriedFrom.join(', ')}`, tone: 'info' };
  }
  if (c.balanceCents > 0) return { text: `${formatPeso(c.balanceCents)} to remit${c.refundOpenCents > 0 ? `, after ${formatPeso(c.refundOpenCents)} of year-end tax refunds` : ''}`, tone: 'info' };
  return { text: `Remitted ${formatPeso(-c.balanceCents)} more than the payrolls show`, tone: 'warning' };
}

/** The agencies' upload files, in the order the screen offers them. */
export const UPLOAD_LIST: { scheme: UploadScheme; label: string; layout: string }[] = [
  { scheme: 'SSS', label: 'SSS', layout: 'R3 / e-collection contribution list' },
  { scheme: 'PHIC', label: 'PhilHealth', layout: 'RF-1 / EPRS contribution list' },
  { scheme: 'HDMF', label: 'Pag-IBIG', layout: 'MCRF / eSRS contribution list' },
];

/** The upload files carry ID numbers, so they are for whoever has both permissions (the server refuses anyone else). */
export const canDownloadUploads = (permissions: readonly string[]) => permissions.includes('stat.upload') && permissions.includes('emp.view_ids');

/** One exposure line's months in words: "2 months: 2026-06, 2026-07". */
export const exposureMonths = (l: Pick<ExposureLine, 'months'>) => `${l.months.length} ${l.months.length === 1 ? 'month' : 'months'}: ${l.months.map((m) => m.month).join(', ')}`;
