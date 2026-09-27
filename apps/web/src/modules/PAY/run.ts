/**
 * The payroll screens' rules: typed manual lines and cash-advance changes to run input, and the deductions a payslip
 * lists. Pure, so they are tested without a browser; the server works everything out again.
 */
import type { PayEmployee, PayGroup, PayRunInput } from '../../api.ts';
import { cents } from '../COL/money.ts';

export const GROUP_LABEL: Record<PayGroup, string> = { WEEKLY_PIECE: 'Weekly (piece rate)', SEMI_DAILY: 'Semi-monthly (daily paid)', SEMI_MONTHLY: 'Semi-monthly (monthly staff)' };

export interface ManualRow { employeeId: string; kind: 'allowance' | 'adjustment'; amount: string; reason: string }
export const emptyManual = (): ManualRow => ({ employeeId: '', kind: 'allowance', amount: '', reason: '' });

/** The form's rows and typed values -> run input, with plain errors. Blank manual rows and blank deductions are left out. */
export function runInput(
  payGroup: PayGroup,
  periodStart: string,
  rows: ManualRow[],
  advances: Record<string, string>,
  skip: Record<string, string>,
): { input: PayRunInput; errors: string[] } {
  const errors: string[] = [];
  const lines: NonNullable<PayRunInput['lines']> = [];
  rows.forEach((r, i) => {
    if (!r.employeeId && !r.amount.trim() && !r.reason.trim()) return;
    const at = `Line ${i + 1}`;
    const amount = cents(r.amount);
    if (!r.employeeId) errors.push(`${at}: pick the employee.`);
    if (amount === undefined || amount === 0) errors.push(`${at}: type the amount, like 250.00${r.kind === 'adjustment' ? ' (with a minus sign to take pay away)' : ''}.`);
    else if (r.kind === 'allowance' && amount < 0) errors.push(`${at}: an allowance is more than zero; use an adjustment to take pay away.`);
    if (r.reason.trim().length < 5) errors.push(`${at}: say what it is for (5 characters or more).`);
    if (r.employeeId && amount && (r.kind === 'adjustment' || amount > 0) && r.reason.trim().length >= 5) lines.push({ employeeId: r.employeeId, kind: r.kind, amountCents: amount, reason: r.reason.trim() });
  });
  const deductions: NonNullable<PayRunInput['advances']> = [];
  for (const [employeeId, text] of Object.entries(advances)) {
    if (!text.trim()) continue;
    const amount = cents(text);
    if (amount === undefined || amount < 0) errors.push('Type the cash-advance deduction like 500.00, or leave it blank for the plan.');
    else deductions.push({ employeeId, amountCents: amount });
  }
  const left = Object.entries(skip).map(([employeeId, reason]) => ({ employeeId, reason: reason.trim() }));
  if (left.some((s) => s.reason.length < 5)) errors.push('Say why each person is left out (5 characters or more).');
  if (!periodStart) errors.push('Pick the period.');
  return {
    input: { payGroup, periodStart, ...(lines.length ? { lines } : {}), ...(deductions.length ? { advances: deductions } : {}), ...(left.length ? { skip: left } : {}) },
    errors,
  };
}

/** The deductions a payslip shows (non-zero only), in the F3 order. */
export function deductionsOf(e: PayEmployee): [string, number][] {
  const rows: [string, number][] = [['SSS', e.sssEeCents], ['PhilHealth', e.phicEeCents], ['Pag-IBIG', e.hdmfEeCents], ['Withholding tax', e.wtaxCents], ['Cash advance', e.caCents]];
  return rows.filter(([, c]) => c !== 0);
}

/** "10 days", "1:30 h" or "30" for a line's quantity (days are stored × 1000, overtime in minutes). */
export function qtyText(kind: string, qty: number): string {
  if (kind === 'ot') return `${Math.floor(qty / 60)}:${String(qty % 60).padStart(2, '0')} h`;
  if (['basic', 'leave', 'holiday', 'rest_day', 'absence'].includes(kind)) return `${qty / 1000} ${qty === 1000 ? 'day' : 'days'}`;
  return kind === 'piece' ? `${qty} pcs` : '';
}
