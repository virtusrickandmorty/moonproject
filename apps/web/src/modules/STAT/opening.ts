/**
 * The opening statutory payable screen's rules (OBST-, PLAN D8 "Cut-over" step 3): a grid of active employees, typed
 * amounts still to remit for SSS, PhilHealth, Pag-IBIG, withholding tax on compensation, and any SSS or Pag-IBIG loan
 * amortizations, for one contribution month on or before the cut-over date. Blank is nothing to remit for that employee
 * and scheme. Pure, so it is tested without a browser; the server recomputes and checks everything again.
 */
import { formatPesos } from '@moonproject/shared';
import type { ActiveEmployee, OpeningStatInput } from '../../api.ts';
import { cents } from '../COL/money.ts';

export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface OpeningStatRow { sss: string; phic: string; hdmf: string; wtax: string; sssLoan: string; hdmfLoan: string }
export const emptyRow = (): OpeningStatRow => ({ sss: '', phic: '', hdmf: '', wtax: '', sssLoan: '', hdmfLoan: '' });

/** [typed field, server field, plain label] for each amount column. */
const COLUMNS = [
  ['sss', 'sssCents', 'SSS'],
  ['phic', 'phicCents', 'PhilHealth'],
  ['hdmf', 'hdmfCents', 'Pag-IBIG'],
  ['wtax', 'wtaxCents', 'Withholding tax'],
  ['sssLoan', 'sssLoanCents', 'SSS loan amortization'],
  ['hdmfLoan', 'hdmfLoanCents', 'Pag-IBIG loan amortization'],
] as const satisfies readonly [keyof OpeningStatRow, keyof Omit<OpeningStatInput['employees'][number], 'employeeId'>, string][];

/** The month and the grid's typed rows -> server input, with plain errors, and the live total. */
export function openingStatInput(month: string, rows: Record<string, OpeningStatRow>, employees: Pick<ActiveEmployee, 'id' | 'name'>[]): { input: OpeningStatInput; errors: string[]; totalCents: number } {
  const errors: string[] = [];
  if (!isMonth(month)) errors.push('Pick the contribution month, like 2026-08.');
  const employeesInput: OpeningStatInput['employees'] = [];
  let totalCents = 0;
  for (const e of employees) {
    const row = rows[e.id];
    if (!row) continue;
    const line: Record<string, number> = {};
    for (const [typed, field] of COLUMNS) {
      const text = row[typed].trim();
      if (!text) continue;
      const amount = cents(text);
      if (amount === undefined || amount <= 0) errors.push(`${e.name}: type an amount like 1,250.00, or leave it blank.`);
      else {
        line[field] = amount;
        totalCents += amount;
      }
    }
    if (Object.keys(line).length > 0) employeesInput.push({ employeeId: e.id, ...line } as OpeningStatInput['employees'][number]);
  }
  if (employeesInput.length === 0 && errors.length === 0) errors.push('Type at least one amount still to remit.');
  return { input: { month, employees: employeesInput }, errors, totalCents };
}

/** A recorded input -> the grid's typed rows, for Edit (cancel + reissue, NR-4). */
export function openingStatValues(input: OpeningStatInput): Record<string, OpeningStatRow> {
  const rows: Record<string, OpeningStatRow> = {};
  for (const e of input.employees) {
    const row = emptyRow();
    for (const [typed, field] of COLUMNS) {
      const cents = e[field];
      if (cents) row[typed] = formatPesos(cents);
    }
    rows[e.employeeId] = row;
  }
  return rows;
}
