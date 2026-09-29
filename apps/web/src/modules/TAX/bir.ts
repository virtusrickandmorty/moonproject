/**
 * The BIR payment form's and the EWT worksheets' rules (PLAN D5 VAT-PAY and EWT-REM, E12): which period each return
 * pays, the typed values to input, the amount the worksheet leaves to pay, and the months and links the screens open
 * on. Pure, so they are tested without a browser; the server checks the period and the amount again.
 */
import { formatPesos } from '@moonproject/shared';
import type { AnnualIncomeTaxWorksheet, BirForm, EwtMonthWorksheet, EwtQuarterWorksheet, IncomeTaxWorksheet, OpenedReturns, VatWorksheet } from '../../api.ts';
import { cents } from '../COL/money.ts';
import { lastEndedQuarter, monthName, type Quarter } from './reports.ts';

export const BIR_FORMS: BirForm[] = ['2550Q', '0619-E', '1601-EQ', '1702Q', '1702'];
export const BIR_FORM_WORDS: Record<BirForm, string> = {
  '2550Q': '2550Q (quarterly VAT)', '0619-E': '0619-E (monthly EWT)', '1601-EQ': '1601-EQ (quarterly EWT)', '1702Q': '1702Q (quarterly income tax)',
  '1702': '1702 (annual income tax)',
};
/** The quarters a return pays: a 1702Q only Q1 to Q3 (the annual 1702 covers Q4); a 1702 pays a year, no quarter. */
export const quartersOf = (form: BirForm | null): Quarter[] => (form === '1702' ? [] : form === '1702Q' ? [1, 2, 3] : [1, 2, 3, 4]);
/** The annual 1702 pays a whole year. */
export const paysYear = (form: BirForm | null) => form === '1702';
export const isBirForm = (s: string | null): s is BirForm => BIR_FORMS.includes(s as BirForm);
/** A 0619-E pays one month; the 2550Q and the 1601-EQ pay a quarter. */
export const paysMonth = (form: BirForm) => form === '0619-E';
/** The months a 0619-E pays: the first two of each quarter (the third goes on the 1601-EQ). */
export const EWT_MONTHS = [1, 2, 4, 5, 7, 8, 10, 11];

const pad = (n: number) => String(n).padStart(2, '0');
/** The month picker of a 0619-E: value "7", label "July". */
export const ewtMonthChoices = EWT_MONTHS.map((m) => ({ value: String(m), label: monthName(`2000-${pad(m)}`) }));

/** The period a return pays, as the server takes it: "2026-Q3", "2026-07" for a 0619-E, "2026" for a 1702; null while incomplete. */
export function periodOf(form: BirForm, year: string, part: string): string | null {
  if (!/^\d{4}$/.test(year)) return null;
  if (paysYear(form)) return year;
  const n = Number(part);
  if (paysMonth(form)) return EWT_MONTHS.includes(n) ? `${year}-${pad(n)}` : null;
  return quartersOf(form).includes(n as Quarter) && /^\d$/.test(part) ? `${year}-Q${n}` : null;
}

/** "2026-Q3", "2026-07" or "2026" -> the year and the quarter or month (none for a year), to prefill the pickers. */
export function periodParts(period: string): { year: string; part: string } | null {
  if (/^\d{4}$/.test(period)) return { year: period, part: '' };
  const m = /^(\d{4})-(?:Q([1-4])|(0[1-9]|1[0-2]))$/.exec(period);
  return m ? { year: m[1]!, part: m[2] ?? String(Number(m[3])) } : null;
}

/** The last month whose 0619-E can be due: last month, or the one before when last month ends a quarter. */
export function ewtMonthDefault(today: string): string {
  let [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  for (;;) {
    if (m === 0) [y, m] = [y - 1, 12];
    if (EWT_MONTHS.includes(m)) return `${y}-${pad(m)}`;
    m -= 1;
  }
}

/** The period a new payment opens on: the month (0619-E) or the quarter just ended, whose return is due now. */
export function defaultPeriod(form: BirForm, today: string): string {
  if (paysMonth(form)) return ewtMonthDefault(today);
  if (paysYear(form)) return String(Number(today.slice(0, 4)) - 1); // the 1702 is paid by 15 April of the next year
  const q = form === '1702Q' ? incomeTaxQuarter(today) : lastEndedQuarter(today);
  return `${q.year}-Q${q.quarter}`;
}

/** The 1702Q due now: the quarter just ended; after Q4 (the annual return's), Q3 of that year. */
export function incomeTaxQuarter(today: string): { year: number; quarter: 1 | 2 | 3 } {
  const q = lastEndedQuarter(today);
  return { year: q.year, quarter: q.quarter === 4 ? 3 : q.quarter };
}

/** "August 2026" for the 0619-E month pickers. */
export const monthLabel = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;

export interface BirValues { form: string; year: string; part: string; cashPlaceId: string; amount: string; penalty: string; reference: string; note: string }
export interface BirPaymentInput { form: BirForm; period: string; cashPlaceId: number; amountCents: number; penaltyCents?: number; reference: string; note?: string }

/** The form's values -> BIR payment input, with plain errors. A blank penalty is none. */
export function birPaymentInput(v: BirValues): { input: BirPaymentInput; errors: string[] } {
  const form = isBirForm(v.form) ? v.form : null;
  const period = form ? periodOf(form, v.year, v.part) : null;
  const amount = cents(v.amount);
  const penalty = cents(v.penalty);
  const errors = [
    ...(form ? [] : ['Pick the return paid.']),
    ...(!form || period ? [] : [paysMonth(form) ? 'Pick the month: a 0619-E pays the first or second month of a quarter.' : paysYear(form) ? 'Pick the year.' : 'Pick the year and quarter.']),
    ...(v.cashPlaceId ? [] : ['Pick where the money came from.']),
    ...(amount && amount > 0 ? [] : ['Type the amount paid, like 12,500.00']),
    ...(penalty === undefined || penalty < 0 ? ['Type the penalty like 250.00, or leave it blank.'] : []),
    ...(v.reference.trim().length >= 3 ? [] : ['Type the eFPS, eBIRForms or bank reference.']),
  ];
  return {
    input: {
      form: form ?? '2550Q', period: period ?? '', cashPlaceId: Number(v.cashPlaceId), amountCents: amount ?? 0, ...(penalty ? { penaltyCents: penalty } : {}),
      reference: v.reference.trim(), ...(v.note.trim() ? { note: v.note.trim() } : {}),
    },
    errors,
  };
}

/** What the worksheet leaves to pay with the return: the EWT, 1702Q and 1702-RT worksheets' "left to pay"; the 2550Q's "tax still payable". */
export function leftToPay(form: BirForm, w: EwtMonthWorksheet | EwtQuarterWorksheet | VatWorksheet | IncomeTaxWorksheet | AnnualIncomeTaxWorksheet): number {
  const cents = form === '2550Q' ? ((w as VatWorksheet).lines.find((l) => l.key === 'payable')?.taxCents ?? 0) : (w as EwtMonthWorksheet).leftCents;
  return Math.max(cents, 0);
}

/**
 * The 2550Q of a quarter before the cut-over date has no VAT close here, so its worksheet leaves nothing: what the
 * opening left comes from the server's list of returns with something left to pay.
 */
export function leftWithDue(form: BirForm, period: string, fromWorksheet: number, due: { form: BirForm; period: string; payableCents: number }[]): number {
  if (form !== '2550Q' || fromWorksheet > 0) return fromWorksheet;
  return due.find((d) => d.form === form && d.period === period)?.payableCents ?? 0;
}

/** A worksheet's line for what the old books left to pay with the return (none when nothing was opened). */
export const openingReckoning = (w: OpenedReturns): { label: string; cents: number }[] =>
  w.openingCents ? [{ label: `Left to pay by the old books (${[...new Set(w.openings.map((o) => o.number))].join(', ')})`, cents: w.openingCents }] : [];

/** The amount box's default: what is left, or blank when nothing is. */
export const amountText = (cents: number) => (cents > 0 ? formatPesos(cents) : '');

/** The BIR payment form, opened on a return and its period (the worksheets' "Record BIR payment"). */
export const birPaymentPath = (form: BirForm, period: string) => `/docs/tax.bir_payment/new?${new URLSearchParams({ form, period })}`;

/** The quarter of a "2026-Q3" period. */
export const quarterOfPeriod = (period: string) => ({ year: Number(period.slice(0, 4)), quarter: Number(period.slice(6)) as Quarter });

/** The EWT, 1702Q or 1702-RT worksheet screen of a period, opened on it; the 2550Q worksheet screen opens on its own quarter, so none. */
export function worksheetPath(form: BirForm, period: string): string | null {
  if (form === '2550Q') return null;
  if (paysYear(form)) return `/tax/1702rt?${new URLSearchParams({ year: period })}`;
  if (paysMonth(form)) return `/tax/0619e?${new URLSearchParams({ month: period })}`;
  const { year, quarter } = quarterOfPeriod(period);
  return `/tax/${form === '1702Q' ? '1702q' : '1601eq'}?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}`;
}

/** The worksheet screens open on the period in their link (?month=2026-07, ?year=2026&quarter=3), if it is one. */
export function monthFromQuery(search: string): string | null {
  const m = new URLSearchParams(search).get('month') ?? '';
  const p = periodParts(m);
  return p && !m.includes('Q') && EWT_MONTHS.includes(Number(p.part)) ? m : null;
}
export function quarterFromQuery(search: string): { year: number; quarter: Quarter } | null {
  const q = new URLSearchParams(search);
  const p = periodParts(`${q.get('year')}-Q${q.get('quarter')}`);
  return p ? { year: Number(p.year), quarter: Number(p.part) as Quarter } : null;
}
