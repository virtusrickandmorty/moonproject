/**
 * The tax report screens' rules (PLAN E12, E13): the dates each screen opens on, the range check the server makes, how a
 * register row shows a cancel, the ledger check, the VAT of a quarter in words, and the purchases side: classes, ATCs and
 * the 2550Q worksheet's checks. Pure, so they are tested without a browser; every figure comes from the server, read from
 * the ledger.
 */
import { formatPeso, isBusinessDate } from '@moonproject/shared';
import type { EwtAtc, PurchaseClass, PurchaseSums, PurchasesRegister, TaxDeadline, TaxJournalRef, VatSummary, VatWorksheet, WorksheetCheck } from '../../api.ts';
import { EWT_WORDS } from '../AP/payables.ts';
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
export function cancelMark(r: Pick<TaxJournalRef, 'posting' | 'documentStatus'>): { text: string; hint: string } | null {
  if (r.posting === 'reversal') return { text: 'Cancelled', hint: 'The cancel: takes the document back out on the day it was cancelled.' };
  if (r.documentStatus === 'cancelled') return { text: 'Cancelled later', hint: 'Counted on its own day; the cancel is its own negative row on the day it was cancelled.' };
  return null;
}

export const certificateWords = (c: 'pending' | 'received' | null) => (c === 'received' ? 'In hand' : c === 'pending' ? 'Pending' : '—');

export function pendingWords(count: number): string {
  if (count === 0) return 'No 2307 is still to come.';
  return count === 1 ? '1 2307 is still to come.' : `${count} 2307s are still to come.`;
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

/** The worksheet a calendar row opens: the 1702Q of its quarter, the 1702-RT or 1604-E of its year; none for the others. */
export function worksheetOfDeadline(d: Pick<TaxDeadline, 'form' | 'period'>): string | null {
  const m = /^(\d{4})-Q([1-3])$/.exec(d.period);
  if (d.form === '1702Q' && m) return `/tax/1702q?${new URLSearchParams({ year: m[1]!, quarter: m[2]! })}`;
  const y = /^\d{4}$/.test(d.period) ? d.period : null;
  if (y && d.form === '1702-RT') return `/tax/1702rt?${new URLSearchParams({ year: y })}`;
  if (y && d.form === '1604-E') return `/tax/1604e?${new URLSearchParams({ year: y })}`;
  return null;
}

/** "Q3 2026 (July to September), so far" while the quarter runs. */
export function quarterTitle(year: number, quarter: Quarter, today: string): string {
  const { from, to } = quarterRange(year, quarter);
  const when = today < from ? ', not started yet' : today <= to ? ', so far' : '';
  return `Q${quarter} ${year} (${MONTHS[3 * quarter - 3]} to ${MONTHS[3 * quarter - 1]})${when}`;
}

/** The VAT of a quarter's last line: what goes with the 2550Q, or what is carried over. The close's preview has no due date. */
export function vatBottomLine(v: Pick<VatSummary, 'payableCents' | 'carryForwardCents'> & { returnDue?: string }): string {
  if (v.carryForwardCents > 0) return `Carried over to next quarter: ${formatPeso(v.carryForwardCents)}`;
  return `VAT payable ${formatPeso(v.payableCents)} with the 2550Q${v.returnDue ? `, due ${v.returnDue}` : ''}`;
}

/** The figures above the bottom line, as [what, amount, note]: the same for "VAT this quarter" and the close's preview. */
export type VatFigures = Pick<VatSummary, 'outputVatCents' | 'inputVatCents' | 'vatWithheldCents' | 'carryOverCents' | 'vatWithheldPendingCents'>;
export const vatLines = (v: VatFigures): [string, number, string | null][] => [
  ['Output VAT on sales', v.outputVatCents, null],
  ['Less input VAT on purchases', v.inputVatCents, null],
  ['Less VAT withheld by government buyers', v.vatWithheldCents, withheldPendingWords(v.vatWithheldPendingCents)],
  ['Less input VAT carried over from earlier quarters', v.carryOverCents, null],
];

/** The quarter before today's: the one a VAT close is usually for. */
export function lastEndedQuarter(today: string): { year: number; quarter: Quarter } {
  const q = quarterOf(today);
  return q.quarter === 1 ? { year: q.year - 1, quarter: 4 } : { year: q.year, quarter: (q.quarter - 1) as Quarter };
}

/** The VAT close form, opened on a quarter. */
const vatCloseForm = (year: number, quarter: number) => `/docs/tax.vat_close/new?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}`;

/** "VAT this quarter" offers the close once the quarter has ended and nothing closed it. */
export function closeLink(v: Pick<VatSummary, 'year' | 'quarter' | 'to' | 'close'>, today: string): string | null {
  if (v.close || !today || today <= v.to) return null;
  return vatCloseForm(v.year, v.quarter);
}

/**
 * The close's date: the quarter's last day or later. Someone who may backdate (acc.backdate) dates it on the last day
 * unless they choose today; everyone else closes today. Undefined = today, so no date is sent.
 */
export function closeDate(to: string, today: string, mayBackdate: boolean, onLastDay: boolean): string | undefined {
  return mayBackdate && onLastDay && today > to ? to : undefined;
}

/** VAT withheld whose 2307 is not in hand: not counted above; it is claimed in the quarter the certificate comes. */
export const withheldPendingWords = (cents: number) =>
  (cents > 0 ? `Not counted: ${formatPeso(cents)} more still waits for its 2307. It is claimed in the quarter the certificate comes.` : null);

/**
 * The quarter the 2307s-to-issue and 2550Q screens open on: in a quarter's first month, the one just ended (its 2307s
 * and its 2550Q are due that month); later on, today's quarter so far.
 */
export const returnQuarter = (today: string) => (Number(today.slice(5, 7)) % 3 === 1 ? lastEndedQuarter(today) : quarterOf(today));

/** "July" for "2026-07": the months of the 2307s to issue. */
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

/** A purchase's class on the 2550Q and the SLP; a journal voucher on input VAT has none until the accountant classes it. */
const CLASS_WORDS: Record<PurchaseClass, string> = { capital_goods: 'Capital goods', goods: 'Goods', services: 'Services' };
export const classWords = (c: PurchaseClass | null) => (c ? CLASS_WORDS[c] : 'To classify');

/** The purchases register's totals by class, in the order of the 2550Q, with what is still to classify last. */
export const classTotals = (by: PurchasesRegister['byClass']): [string, PurchaseSums][] => [
  [classWords('capital_goods'), by.capital_goods], [classWords('goods'), by.goods], [classWords('services'), by.services], [classWords(null), by.unclassified],
];

/** An EWT class in words ("Rent"); a line with no class (a journal voucher on EWT payable) shows a dash. */
export const ewtClassWords = (cls: string | null) => (cls ? (EWT_WORDS[cls] ?? cls) : '—');

/** "1.5%" for 150 basis points; a dash where the document gives no rate. */
export const rateWords = (bp: number | null) => (bp === null ? '—' : `${bp / 100}%`);

/**
 * The ATC of an EWT row, or "ATC to confirm" with the ATCs its class can be: the supplier's file does not say
 * whether the payee is an individual or a company (the same words as the server's CSV).
 */
export function atcWords(r: EwtAtc): string {
  if (r.atc) return r.atc;
  return r.ewtClass ? `ATC to confirm (${r.atcChoices.join(' or ')})` : '—';
}

export function atcToConfirmWords(count: number): string {
  if (count === 0) return 'Every row has its ATC.';
  const rows = count === 1 ? '1 row has its ATC to confirm' : `${count} rows have their ATC to confirm`;
  return `${rows}: the supplier's file does not say whether the payee is an individual or a company.`;
}

/** A 2550Q check's colour: an error red, a warning amber, information grey. */
const CHECK_TONES = { error: 'error', warning: 'warning', info: 'note' } as const;
export const checkTone = (level: WorksheetCheck['level']) => CHECK_TONES[level];

/** The checks before filing, errors first, then warnings, then information, each kept in the server's order. */
const LEVELS: WorksheetCheck['level'][] = ['error', 'warning', 'info'];
export const sortedChecks = (checks: WorksheetCheck[]) => [...checks].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));

/** The 2550Q worksheet links to the VAT close form while its NOT_CLOSED check shows. */
export function worksheetCloseLink(w: Pick<VatWorksheet, 'year' | 'quarter' | 'checks'>): string | null {
  return w.checks.some((c) => c.code === 'NOT_CLOSED') ? vatCloseForm(w.year, w.quarter) : null;
}

/** The worksheet's totals, shown in bold: output tax, input tax, net VAT, and what is payable or carried over. */
const WORKSHEET_TOTALS = new Set(['output_tax', 'input_tax', 'net_vat', 'payable', 'carry_forward']);
export const isWorksheetTotal = (key: string) => WORKSHEET_TOTALS.has(key);
