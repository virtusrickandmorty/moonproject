/**
 * The year-end income tax screens' rules (PLAN D5 IT-PROV and IT-SETTLE, D8 "Yearly", E12): the year a screen opens on,
 * which lines of the 1702-RT are totals, the reckoning under it, the deduction method in words and its form's body, the
 * date of a provision or settlement, and the links between them. Pure, so they are tested without a browser; the server
 * checks everything again.
 */
import type { AnnualIncomeTaxWorksheet, DeductionMethod, DeductionSetting } from '../../api.ts';

/** The annual returns of a year are filed early the next one: a screen opens on last year, or the year in its link. */
export function yearFromQuery(search: string, today: string): number {
  const y = new URLSearchParams(search).get('year') ?? '';
  return /^\d{4}$/.test(y) ? Number(y) : Number(today.slice(0, 4)) - 1;
}

/** The 1702-RT's totals, in bold. */
const TOTALS = new Set(['gross_income', 'total_gross_income', 'taxable_income', 'tax_due', 'payable']);
export const isAnnualTotal = (key: string) => TOTALS.has(key);

/** "Itemized (the default, not confirmed)" or "40% optional standard deduction, from 2027-01-20". */
export function deductionWords(d: Pick<DeductionSetting, 'method' | 'confirmed' | 'effectiveFrom'>): string {
  const what = d.method === 'osd' ? '40% optional standard deduction' : 'Itemized';
  return d.confirmed ? `${what}, from ${d.effectiveFrom}` : `${what} (the default, not confirmed)`;
}

/** Under the return: the provision, the settlement, what the 1702 pays and what is left after its payments. */
export function annualReckoning(w: Pick<AnnualIncomeTaxWorksheet, 'provision' | 'settlement' | 'opening' | 'provisionCents' | 'dueCents' | 'leftCents' | 'payableCents'>): { label: string; cents: number; strong?: boolean }[] {
  const rows: { label: string; cents: number; strong?: boolean }[] = [];
  if (w.opening) rows.push({ label: `Left to pay by the old books (${w.opening.number}, on 2320)`, cents: w.dueCents });
  else {
    rows.push(w.provision
      ? { label: `Provided with ${w.provision.number} on ${w.provision.date}`, cents: w.provision.amountCents }
      : { label: 'To provide on 31 December (not recorded yet)', cents: Math.max(w.provisionCents, 0) });
    rows.push(w.settlement
      ? { label: w.settlement.payableCents < 0 ? `Settled with ${w.settlement.number}: carried over to next year` : `Settled with ${w.settlement.number}: left to pay`, cents: Math.abs(w.settlement.payableCents) }
      : { label: 'Not settled yet', cents: 0 });
  }
  rows.push({ label: 'Due with the 1702', cents: w.dueCents, strong: true });
  return rows;
}

/** The provision form, opened on a year; the settlement form the same. */
export const provisionPath = (year: number) => `/docs/tax.it_provision/new?${new URLSearchParams({ year: String(year) })}`;
export const settlementPath = (year: number) => `/docs/tax.it_settlement/new?${new URLSearchParams({ year: String(year) })}`;

/**
 * The date a year-end document carries: a provision always the year's 31 December (someone who may backdate records
 * it after); a settlement today, or 31 December when the accountant picks it. Undefined = today.
 */
export function yearEndDate(kind: 'provision' | 'settlement', year: number, today: string, mayBackdate: boolean, onYearEnd: boolean): string | undefined {
  const end = `${year}-12-31`;
  if (!mayBackdate || today <= end) return undefined;
  return kind === 'provision' || onYearEnd ? end : undefined;
}

export interface DeductionValues { method: DeductionMethod; effectiveFrom: string; reason: string }
/** The deduction form -> the body POST /api/tax/income-tax-deductions takes, with plain errors. */
export function deductionInput(year: number, v: DeductionValues, today: string): { body: { year: number } & DeductionValues; errors: string[] } {
  const errors = [
    ...(/^\d{4}-\d{2}-\d{2}$/.test(v.effectiveFrom) && v.effectiveFrom >= today ? [] : ['Pick the date it takes effect: today or later.']),
    ...(v.reason.trim().length >= 10 ? [] : ['Say why, in 10 characters or more.']),
  ];
  return { body: { year, method: v.method, effectiveFrom: v.effectiveFrom, reason: v.reason.trim() }, errors };
}
