/**
 * The final tax withheld on dividends (PLAN D5 DIV): per stockholder, with TIN, for a quarter (what the 1601-FQ reports
 * and pays) or a year (the 1604-F alphalist of payees). The rows are the dividend declarations still recorded dated in
 * the period (EQ public.ts); the books' figure is 2312's withholding in the period (payments.ts finalTaxDue), which
 * the rows add up to unless a journal voucher touched 2312.
 */
import type { Db } from '../../platform/db/driver.ts';
import { dividendsWithheld, type DividendWithheld } from '../EQ/public.ts';
import { quarterRange, type Quarter } from './calendar.ts';
import { finalTaxDue, quarterPeriod, type BirPaymentRef } from './payments.ts';

export interface FinalTaxList {
  year: number;
  /** null for the whole year (the 1604-F). */
  quarter: Quarter | null;
  period: string;
  from: string;
  to: string;
  rows: DividendWithheld[];
  totals: { grossCents: number; taxCents: number; netCents: number };
  /** 2312: withheld in the period, paid with its 1601-FQ payments, and left (a year: its four quarters). */
  withheldCents: number;
  paidCents: number;
  leftCents: number;
  /** The rows' tax equals the books'. */
  tied: boolean;
  payments: BirPaymentRef[];
}

export function finalTaxList(db: Db, year: number, quarter: Quarter | null): FinalTaxList {
  const quarters = quarter ? [quarter] : ([1, 2, 3, 4] as Quarter[]);
  const from = quarterRange(year, quarters[0]!).from;
  const to = quarterRange(year, quarters[quarters.length - 1]!).to;
  const rows = dividendsWithheld(db, from, to);
  const sum = (k: 'grossCents' | 'taxCents' | 'netCents') => rows.reduce((s, r) => s + r[k], 0);
  const due = quarters.map((q) => finalTaxDue(db, year, q));
  const add = (k: 'withheldCents' | 'paidCents' | 'leftCents') => due.reduce((s, d) => s + d[k], 0);
  const totals = { grossCents: sum('grossCents'), taxCents: sum('taxCents'), netCents: sum('netCents') };
  return {
    year, quarter, period: quarter ? quarterPeriod(year, quarter) : String(year), from, to, rows, totals,
    withheldCents: add('withheldCents'), paidCents: add('paidCents'), leftCents: add('leftCents'), tied: totals.taxCents === add('withheldCents'),
    payments: due.flatMap((d) => d.payments),
  };
}
