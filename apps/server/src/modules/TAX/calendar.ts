/**
 * Tax calendar (PLAN E12, D8; research vat-cwt-ewt §0 item 10 and §3.8): the BIR returns Virtus files or gives out,
 * each with the period it covers and its due date. Computed, never stored: the accountant home, the calendar and the
 * notifications read it. A calendar (January to December) taxable year is assumed.
 *   Monthly: 0619-E (months 1 and 2 of a quarter) and 1601-C, the 10th of the next month (December's 1601-C: 15 Jan).
 *   Quarterly: 2307s to payees by the 20th day after the quarter; 2550Q with the SLSP by the 25th; 1601-EQ with the QAP
 *   by the last day of the next month; 1702Q within 60 days after Q1 to Q3.
 *   Yearly: 2316 to employees and 1604-C by 31 January, 1604-E by 1 March, 1702-RT by 15 April.
 * A due date on a Saturday, a Sunday or an active holiday (EMP's holiday list) moves to the next working day [P, S21];
 * the date in the rules stays beside it. Whether a special non-working day moves a deadline is inferred; the
 * accountant confirms (the BIR usually says so in an RMC).
 */
import { manilaDate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { holidaysBetween } from '../EMP/public.ts';

export const TAX_FORMS = ['0619-E', '1601-C', '2307', '2550Q', '1601-EQ', '1702Q', '2316', '1604-C', '1604-E', '1702-RT'] as const;
export type TaxForm = (typeof TAX_FORMS)[number];

const TITLES: Record<TaxForm, string> = {
  '0619-E': 'Expanded withholding tax for the month (file when tax was withheld)',
  '1601-C': 'Withholding tax on compensation for the month',
  '2307': 'Give each supplier its 2307 for the quarter',
  '2550Q': 'Quarterly VAT return, with the SLSP and the SAWT for VAT withheld',
  '1601-EQ': 'Quarterly expanded withholding tax return, with the QAP',
  '1702Q': 'Quarterly income tax return (cumulative), with the SAWT',
  '2316': 'Give each employee their 2316 for the year',
  '1604-C': 'Annual information return of compensation withheld, with the alphalist',
  '1604-E': 'Annual information return of expanded withholding, with the alphalist',
  '1702-RT': 'Annual income tax return, with the SAWT',
};

export interface Deadline {
  form: TaxForm;
  title: string;
  /** '2026-09' for a month, '2026-Q3' for a quarter, '2026' for a year. */
  period: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** The date in the rules, and the day it is actually due after weekends and holidays. */
  statutoryDate: string;
  dueDate: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** The last day of month m (1-12) of year y. */
const monthEnd = (y: number, m: number) => ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
export const addDays = (date: string, days: number) => manilaDate(new Date(Date.parse(`${date}T00:00:00+08:00`) + days * 86_400_000));
/** Month m + k of year y, as [year, month]. */
const shift = (y: number, m: number, k: number): [number, number] => [y + Math.floor((m - 1 + k) / 12), ((m - 1 + k) % 12 + 12) % 12 + 1];

/** Every deadline for the periods of year y (so those due early in y + 1 too), before the working-day move. */
function deadlinesOfYear(y: number): Omit<Deadline, 'dueDate'>[] {
  const out: Omit<Deadline, 'dueDate'>[] = [];
  const add = (form: TaxForm, period: string, periodLabel: string, periodStart: string, periodEnd: string, statutoryDate: string) =>
    out.push({ form, title: TITLES[form], period, periodLabel, periodStart, periodEnd, statutoryDate });

  for (let m = 1; m <= 12; m++) {
    const [ny, nm] = shift(y, m, 1);
    const period = `${y}-${pad(m)}`;
    const label = `${MONTHS[m - 1]} ${y}`;
    if (m % 3 !== 0) add('0619-E', period, label, ymd(y, m, 1), monthEnd(y, m), ymd(ny, nm, 10));
    add('1601-C', period, label, ymd(y, m, 1), monthEnd(y, m), ymd(ny, nm, m === 12 ? 15 : 10));
  }
  for (let q = 1; q <= 4; q++) {
    const first = 3 * q - 2;
    const start = ymd(y, first, 1);
    const end = monthEnd(y, 3 * q);
    const [ny, nm] = shift(y, 3 * q, 1);
    const period = `${y}-Q${q}`;
    const label = `Q${q} ${y} (${MONTHS[first - 1]} to ${MONTHS[3 * q - 1]})`;
    add('2307', period, label, start, end, addDays(end, 20));
    add('2550Q', period, label, start, end, addDays(end, 25));
    add('1601-EQ', period, label, start, end, monthEnd(ny, nm));
    // 1702Q is cumulative: it covers the year up to the quarter's end. Q4 is the annual return.
    if (q < 4) add('1702Q', period, `${label}, year to date`, ymd(y, 1, 1), end, addDays(end, 60));
  }
  const year = String(y);
  const [ys, ye] = [ymd(y, 1, 1), ymd(y, 12, 31)];
  add('2316', year, year, ys, ye, ymd(y + 1, 1, 31));
  add('1604-C', year, year, ys, ye, ymd(y + 1, 1, 31));
  add('1604-E', year, year, ys, ye, ymd(y + 1, 3, 1));
  add('1702-RT', year, year, ys, ye, ymd(y + 1, 4, 15));
  return out;
}

/** The first day on or after `date` that is not a Saturday, a Sunday or in `holidays`. */
export function nextWorkingDay(date: string, holidays: ReadonlySet<string>): string {
  let d = date;
  for (;;) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(d)) return d;
    d = addDays(d, 1);
  }
}

/** The deadlines due (after the working-day move) from one date to another, both included, earliest first. */
export function taxDeadlines(db: Db, from: string, to: string): Deadline[] {
  // A rule date a few days before `from` can move into the range, and the periods of the year before are due early in
  // `from`'s year (1702-RT by 15 April at the latest).
  const holidays = new Set(holidaysBetween(db, addDays(from, -31), addDays(to, 31)).map((h) => h.date));
  const out: Deadline[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)); y++) {
    for (const d of deadlinesOfYear(y)) {
      const dueDate = nextWorkingDay(d.statutoryDate, holidays);
      if (dueDate >= from && dueDate <= to) out.push({ ...d, dueDate });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || TAX_FORMS.indexOf(a.form) - TAX_FORMS.indexOf(b.form));
}

/** The 2550Q deadline of one quarter (the VAT summary shows it). */
export function vatReturnDue(db: Db, year: number, quarter: Quarter): string {
  const statutory = addDays(monthEnd(year, 3 * quarter), 25);
  const holidays = new Set(holidaysBetween(db, statutory, addDays(statutory, 31)).map((h) => h.date));
  return nextWorkingDay(statutory, holidays);
}

export type Quarter = 1 | 2 | 3 | 4;

/** First and last day of quarter q of year y. */
export const quarterRange = (y: number, q: Quarter) => ({ from: ymd(y, 3 * q - 2, 1), to: monthEnd(y, 3 * q) });

/** The quarter that holds a date. */
export function quarterOf(date: string): { year: number; quarter: Quarter } {
  return { year: Number(date.slice(0, 4)), quarter: Math.ceil(Number(date.slice(5, 7)) / 3) as Quarter };
}
