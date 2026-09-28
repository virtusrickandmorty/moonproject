/**
 * The tax report screens' rules (PLAN E12, E13): the dates each screen opens on, the range check the server makes, how a
 * register row shows a cancel, the ledger check and the VAT of a quarter in words. Pure, so they are tested without a
 * browser; every figure comes from the server, read from the ledger.
 */
import { formatPeso, isBusinessDate } from '@moonproject/shared';
import type { TaxDeadline, TaxRegisterRow, VatSummary } from '../../api.ts';
import { plusDays } from '../EMP/time.ts';

export type Quarter = 1 | 2 | 3 | 4;
export const QUARTERS: Quarter[] = [1, 2, 3, 4];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** The quarter that holds a date. */
export const quarterOf = (date: string) => ({ year: Number(date.slice(0, 4)), quarter: Math.ceil(Number(date.slice(5, 7)) / 3) as Quarter });

/** First and last day of a quarter. */
export function quarterRange(year: number, quarter: Quarter): { from: string; to: string } {
  const last = 3 * quarter;
  return { from: `${year}-${pad(last - 2)}-01`, to: `${year}-${pad(last)}-${pad(new Date(Date.UTC(year, last, 0)).getUTCDate())}` };
}

/** The registers open on this quarter so far: its first day to today. */
export function quarterSoFar(today: string): { from: string; to: string } {
  const q = quarterOf(today);
  return { from: quarterRange(q.year, q.quarter).from, to: today };
}

/** The tax calendar opens on today and the 60 days after. */
export const nextSixtyDays = (today: string) => ({ from: today, to: plusDays(today, 60) });

/** The year picker of the VAT screen: this year and the five before, newest first. */
export const yearChoices = (today: string) => Array.from({ length: 6 }, (_, i) => Number(today.slice(0, 4)) - i);

/** The server's own range check, named before asking: both dates, in order, at most five years apart. */
export function rangeError(from: string, to: string): string | null {
  if (!isBusinessDate(from) || !isBusinessDate(to)) return 'Pick the first and last dates.';
  if (to < from) return 'The last date is before the first.';
  if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 5) return 'Pick at most five years at a time.';
  return null;
}

/** The "Download for Excel" link: the register's own URL with &format=csv. */
export const excelUrl = (registerUrl: string) => `${registerUrl}&format=csv`;

/**
 * How a register row shows a cancel. The cancel is its own negative row on the day it was cancelled, the way it lands in
 * that period's return; the original row stays on its own day, counted, and says it was cancelled later.
 */
export function cancelMark(r: Pick<TaxRegisterRow, 'posting' | 'documentStatus'>): { text: string; hint: string } | null {
  if (r.posting === 'reversal') return { text: 'Cancelled', hint: 'The cancel: takes the document back out on the day it was cancelled.' };
  if (r.documentStatus === 'cancelled') return { text: 'Cancelled later', hint: 'Counted on its own day; the cancel is its own negative row on the day it was cancelled.' };
  return null;
}

export const certificateWords = (c: 'pending' | 'received' | null) => (c === 'received' ? 'In hand' : c === 'pending' ? 'Pending' : '—');

export function pendingWords(count: number): string {
  if (count === 0) return 'No 2307 is still to come.';
  return count === 1 ? '1 collection still waits for its 2307.' : `${count} collections still wait for their 2307s.`;
}

/**
 * A register total that is not its account's movement in the ledger for the same dates: something posted to the
 * account is missing from the register. Each check is [what, account, register total, ledger movement].
 */
export function ledgerWarnings(checks: [what: string, account: string, registerCents: number, ledgerCents: number][]): string[] {
  return checks
    .filter(([, , register, ledger]) => register !== ledger)
    .map(([what, account, register, ledger]) =>
      `The ${what} in this register (${formatPeso(register)}) is not what the ledger shows on ${account} for these dates (${formatPeso(ledger)}). Look at the general ledger before filing.`);
}

/** "moved from 2026-10-10" when a weekend or a holiday moved the due date; nothing when it did not. */
export const movedFrom = (d: Pick<TaxDeadline, 'statutoryDate' | 'dueDate'>) => (d.statutoryDate === d.dueDate ? null : `moved from ${d.statutoryDate}`);

/** "Q3 2026 (July to September), so far" while the quarter runs. */
export function quarterTitle(year: number, quarter: Quarter, today: string): string {
  const { from, to } = quarterRange(year, quarter);
  const when = today < from ? ', not started yet' : today <= to ? ', so far' : '';
  return `Q${quarter} ${year} (${MONTHS[3 * quarter - 3]} to ${MONTHS[3 * quarter - 1]})${when}`;
}

/** The VAT of a quarter's last line: what goes with the 2550Q, or what is carried over. */
export function vatBottomLine(v: Pick<VatSummary, 'payableCents' | 'carryForwardCents' | 'returnDue'>): string {
  return v.carryForwardCents > 0 ? `Carried over to next quarter: ${formatPeso(v.carryForwardCents)}` : `VAT payable ${formatPeso(v.payableCents)} with the 2550Q, due ${v.returnDue}`;
}

/** The part of VAT withheld that may be claimed only once the buyer's 2307 is in hand. */
export const withheldPendingWords = (cents: number) =>
  (cents > 0 ? `${formatPeso(cents)} of it still waits for its 2307; it may be claimed only with the certificate in hand.` : null);
