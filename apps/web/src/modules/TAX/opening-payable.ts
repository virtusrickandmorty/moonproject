/**
 * The opening tax payable form's rules (OBTP-, PLAN D8 "Cut-over" step 3): the BIR returns of periods before the
 * cut-over date prepared from the old books and not yet paid, one row per return, typed into input with plain errors;
 * the periods each return may be for (a 2550Q, 1702Q or 1702 ended before the cut-over date; a 0619-E or 1601-EQ began
 * before it); back to rows for an edit; and what the rows add up to. Pure, so they are tested without a browser; the
 * server checks everything again.
 */
import { formatPesos } from '@moonproject/shared';
import { cents } from '../COL/money.ts';
import { monthName } from './reports.ts';

export const OPENING_FORMS = ['2550Q', '0619-E', '1601-EQ', '1702Q', '1702'] as const;
export type OpeningForm = (typeof OPENING_FORMS)[number];
export const OPENING_FORM_WORDS: Record<OpeningForm, string> = {
  '2550Q': '2550Q (quarterly VAT)', '0619-E': '0619-E (monthly EWT)', '1601-EQ': '1601-EQ (quarterly EWT)',
  '1702Q': '1702Q (quarterly income tax)', '1702': '1702 (annual income tax)',
};
/** The ATCs the server takes (the EWT classes' own, and "other"). */
export const OPENING_ATCS = ['WC010', 'WC011', 'WC100', 'WC120', 'WC158', 'WC160', 'WI010', 'WI011', 'WI100', 'WI120', 'WI158', 'WI160', 'other'] as const;
export type OpeningAtc = (typeof OPENING_ATCS)[number];
export const isEwtForm = (form: string): form is '0619-E' | '1601-EQ' => form === '0619-E' || form === '1601-EQ';
const isForm = (s: string): s is OpeningForm => (OPENING_FORMS as readonly string[]).includes(s);

/** One typed payee of a 0619-E or 1601-EQ. */
export interface PayeeRow { supplierId: string; atc: OpeningAtc | ''; amount: string }
/** One typed return; `amount` for a 2550Q, 1702Q or 1702, `payees` for a 0619-E or 1601-EQ. */
export interface ReturnRow { form: OpeningForm | ''; period: string; amount: string; payees: PayeeRow[] }
export const emptyPayee = (): PayeeRow => ({ supplierId: '', atc: '', amount: '' });
export const emptyReturn = (): ReturnRow => ({ form: '', period: '', amount: '', payees: [emptyPayee()] });

export type OpeningPayableRowInput =
  | { form: '2550Q' | '1702Q' | '1702'; period: string; amountCents: number }
  | { form: '0619-E' | '1601-EQ'; period: string; payees: { supplierId: string; atc: OpeningAtc; amountCents: number }[] };
export interface OpeningPayableInput { rows: OpeningPayableRowInput[]; note?: string }

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;

/** The periods a return may be for at this cut-over date, newest first: two years of quarters or months, three years. */
export function periodChoices(form: OpeningForm | '', cutover: string | null): { value: string; label: string }[] {
  if (!form || !cutover) return [];
  const y0 = Number(cutover.slice(0, 4));
  const out: { value: string; label: string }[] = [];
  if (form === '1702') {
    for (let y = y0 - 1; y > y0 - 4; y--) out.push({ value: String(y), label: String(y) }); // a year ends before the next one's cut-over
    return out;
  }
  for (let y = y0; y > y0 - 2; y--) {
    for (let q = 4; q >= 1; q--) {
      if (form === '0619-E') {
        for (const m of [3 * q - 1, 3 * q - 2]) if (`${y}-${pad(m)}-01` < cutover) out.push({ value: `${y}-${pad(m)}`, label: `${monthName(`${y}-${pad(m)}`)} ${y}` });
        continue;
      }
      const [from, to] = [`${y}-${pad(3 * q - 2)}-01`, lastDay(y, 3 * q)];
      const ok = form === '1601-EQ' ? from < cutover : to < cutover && !(form === '1702Q' && q === 4);
      if (ok) out.push({ value: `${y}-Q${q}`, label: `Q${q} ${y}` });
    }
  }
  return out;
}

const isBlankPayee = (p: PayeeRow) => !p.supplierId && !p.atc && !p.amount.trim();
const isBlank = (r: ReturnRow) => !r.form && !r.period && !r.amount.trim() && r.payees.every(isBlankPayee);

/** Typed rows -> input, with plain errors. Blank rows and payees are left out. */
export function payableInput(rows: ReturnRow[], note: string): { input: OpeningPayableInput; errors: string[] } {
  const errors: string[] = [];
  const out: OpeningPayableRowInput[] = [];
  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const n = `Row ${i + 1}`;
    if (!r.form) {
      errors.push(`${n}: pick the return.`);
      return;
    }
    if (!r.period) errors.push(`${n}: pick the period the ${r.form} is for.`);
    if (!isEwtForm(r.form)) {
      const amount = cents(r.amount);
      if (!amount || amount <= 0) errors.push(`${n}: type the amount still to pay with the ${r.form}, like 12,500.00`);
      out.push({ form: r.form, period: r.period, amountCents: Math.max(amount ?? 0, 0) });
      return;
    }
    const payees = r.payees.filter((p) => !isBlankPayee(p));
    if (payees.length === 0) errors.push(`${n}: add the EWT still to pay per supplier and ATC.`);
    payees.forEach((p, j) => {
      const amount = cents(p.amount);
      if (!p.supplierId) errors.push(`${n}, payee ${j + 1}: pick the supplier.`);
      if (!p.atc) errors.push(`${n}, payee ${j + 1}: pick the ATC.`);
      if (!amount || amount <= 0) errors.push(`${n}, payee ${j + 1}: type the EWT still to pay, like 1,250.00`);
    });
    out.push({ form: r.form, period: r.period, payees: payees.map((p) => ({ supplierId: p.supplierId, atc: (p.atc || 'other') as OpeningAtc, amountCents: Math.max(cents(p.amount) ?? 0, 0) })) });
  });
  if (out.length === 0) errors.push('Enter at least one return.');
  return { input: { rows: out, ...(note.trim() ? { note: note.trim() } : {}) }, errors };
}

/** A recorded one -> typed rows, to prefill an edit. */
export const payableRows = (rows: OpeningPayableRowInput[]): ReturnRow[] =>
  rows.map((r) =>
    'payees' in r
      ? { form: r.form, period: r.period, amount: '', payees: r.payees.map((p) => ({ supplierId: p.supplierId, atc: p.atc, amount: formatPesos(p.amountCents) })) }
      : { form: r.form, period: r.period, amount: formatPesos(r.amountCents), payees: [emptyPayee()] },
  );

/** What the typed rows add up to by tax; an unreadable amount counts as nothing. */
export function payableTotals(rows: ReturnRow[]): { vatCents: number; ewtCents: number; incomeTaxCents: number } {
  const add = (text: string) => Math.max(cents(text) ?? 0, 0);
  const sum = (forms: string[]) => rows.filter((r) => forms.includes(r.form)).reduce((s, r) => s + add(r.amount), 0);
  return {
    vatCents: sum(['2550Q']),
    ewtCents: rows.filter((r) => isEwtForm(r.form)).reduce((s, r) => s + r.payees.reduce((t, p) => t + add(p.amount), 0), 0),
    incomeTaxCents: sum(['1702Q', '1702']),
  };
}

/** A form picked from the list (the select gives a string). */
export const formOf = (s: string): OpeningForm | '' => (isForm(s) ? s : '');
