/**
 * The 1702Q worksheet screen's rules (PLAN D5 IT-QPAY, D8 "Quarterly", E12): which lines are totals, the reckoning
 * under the return, the words for the settings in force, and the settings form's values to input. Pure, so they are
 * tested without a browser; the server checks everything again.
 */
import type { IncomeTaxSettings, IncomeTaxSettingsValue, IncomeTaxWorksheet } from '../../api.ts';

/** The worksheet's totals, in bold. */
const TOTALS = new Set(['gross_income', 'total_gross_income', 'taxable_income', 'tax_due', 'payable']);
export const isIncomeTaxTotal = (key: string) => TOTALS.has(key);

/** 2000 -> "20%", 250 -> "2.5%". */
export const percentWords = (bp: number) => `${bp / 100}%`;

/** The settings in force, in words: "Regular rate 20%, MCIT 2% from 2019 (operations began 2015)". */
export function settingsWords(s: Pick<IncomeTaxSettings, 'regularRateBp' | 'mcitRateBp' | 'operationsBeganYear'>): string {
  const mcit = s.operationsBeganYear === null
    ? `MCIT ${percentWords(s.mcitRateBp)}, year operations began not confirmed`
    : `MCIT ${percentWords(s.mcitRateBp)} from ${s.operationsBeganYear + 4} (operations began ${s.operationsBeganYear})`;
  return `Regular rate ${percentWords(s.regularRateBp)}, ${mcit}`;
}

/** Under the return: what the old books left (a quarter they filed), what is due, and what is left after the payments. */
export function incomeTaxReckoning(w: Pick<IncomeTaxWorksheet, 'opening' | 'openingCents' | 'dueCents' | 'leftCents'>): { label: string; cents: number; strong?: boolean }[] {
  return [
    ...(w.opening ? [{ label: `Left to pay by the old books (${w.opening.number}, on 2320)`, cents: w.openingCents }] : []),
    { label: 'Due with the 1702Q', cents: w.dueCents, strong: true },
  ];
}

export interface SettingsValues { effectiveFrom: string; regularRate: string; mcitRate: string; operationsBeganYear: string; reason: string }
export const settingsValues = (s: IncomeTaxSettings, today: string): SettingsValues => ({
  effectiveFrom: today, regularRate: String(s.regularRateBp / 100), mcitRate: String(s.mcitRateBp / 100),
  operationsBeganYear: s.operationsBeganYear === null ? '' : String(s.operationsBeganYear), reason: '',
});

/** "20" or "2.5" (percent) -> basis points, or null. */
function bp(text: string, max: number): number | null {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text.trim())) return null;
  const n = Math.round(Number(text.trim()) * 100);
  return n <= max ? n : null;
}

/** The settings form -> the body POST /api/tax/income-tax-settings takes, with plain errors. */
export function settingsInput(v: SettingsValues, today: string): { body: { effectiveFrom: string; value: IncomeTaxSettingsValue; reason: string }; errors: string[] } {
  const regular = bp(v.regularRate, 5000);
  const mcit = bp(v.mcitRate, 1000);
  const year = v.operationsBeganYear.trim();
  const began = /^\d{4}$/.test(year) ? Number(year) : null;
  const errors = [
    ...(/^\d{4}-\d{2}-\d{2}$/.test(v.effectiveFrom) && v.effectiveFrom >= today ? [] : ['Pick the date it takes effect: today or later.']),
    ...(regular === null ? ['Type the regular rate in percent, like 20 or 25.'] : []),
    ...(mcit === null ? ['Type the MCIT rate in percent, like 2.'] : []),
    ...(year === '' || began ? [] : ['Type the year operations began, like 2015, or leave it blank until it is confirmed.']),
    ...(v.reason.trim().length >= 10 ? [] : ['Say why, in 10 characters or more.']),
  ];
  return { body: { effectiveFrom: v.effectiveFrom, value: { regularRateBp: regular ?? 0, mcitRateBp: mcit ?? 0, operationsBeganYear: began }, reason: v.reason.trim() }, errors };
}
