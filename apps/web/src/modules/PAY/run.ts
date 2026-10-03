/**
 * The payroll screens' rules: typed manual lines, cash-advance and government loan changes to run input, and the
 * deductions a payslip lists. Pure, so they are tested without a browser; the server works everything out again.
 */
import { formatPeso as peso } from '@moonproject/shared';
import type { LoanKind, PayEmployee, PayGroup, PayLoan, PayRunInput, PayThirteenthInput, Payslips, PriorAmounts } from '../../api.ts';
import { cents } from '../COL/money.ts';

export const GROUP_LABEL: Record<PayGroup, string> = { WEEKLY_PIECE: 'Weekly (piece rate)', SEMI_DAILY: 'Semi-monthly (daily paid)', SEMI_MONTHLY: 'Semi-monthly (monthly staff)' };

export const LOAN_KIND: Record<LoanKind, string> = { SSS_SALARY: 'SSS salary loan', SSS_CALAMITY: 'SSS calamity loan', HDMF_MPL: 'Pag-IBIG multi-purpose loan', HDMF_CALAMITY: 'Pag-IBIG calamity loan' };
/** A loan deduction typed on the run: blank amount = the plan; 0 skips the month. A note is needed either way. */
export interface LoanRow { amount: string; reason: string }

export interface ManualRow { employeeId: string; kind: 'allowance' | 'adjustment'; amount: string; reason: string }
export const emptyManual = (): ManualRow => ({ employeeId: '', kind: 'allowance', amount: '', reason: '' });

/** The form's rows and typed values -> run input, with plain errors. Blank manual rows and blank deductions are left out. */
export function runInput(
  payGroup: PayGroup,
  periodStart: string,
  rows: ManualRow[],
  advances: Record<string, string>,
  skip: Record<string, string>,
  loanRows: Record<string, LoanRow> = {},
  yearEnd = false,
  unusedLeave = false,
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
  const loans: NonNullable<PayRunInput['loans']> = [];
  for (const [loanId, r] of Object.entries(loanRows)) {
    if (!r.amount.trim()) continue;
    const amount = cents(r.amount);
    if (amount === undefined || amount < 0) errors.push('Type the loan deduction like 1500.00 (0 skips this month), or leave it blank for the plan.');
    else if (r.reason.trim().length < 5) errors.push('Say why the loan deduction is changed (5 characters or more).');
    else loans.push({ loanId, amountCents: amount, reason: r.reason.trim() });
  }
  const left = Object.entries(skip).map(([employeeId, reason]) => ({ employeeId, reason: reason.trim() }));
  if (left.some((s) => s.reason.length < 5)) errors.push('Say why each person is left out (5 characters or more).');
  if (!periodStart) errors.push('Pick the period.');
  return {
    input: {
      payGroup, periodStart, ...(lines.length ? { lines } : {}), ...(deductions.length ? { advances: deductions } : {}), ...(left.length ? { skip: left } : {}), ...(loans.length ? { loans } : {}),
      ...(yearEnd ? { yearEnd } : {}), ...(unusedLeave ? { unusedLeave } : {}),
    },
    errors,
  };
}

/** Whether a period can carry the year-end tax adjustment: it ends in December. */
export const endsInDecember = (periodEnd: string | undefined) => !!periodEnd && periodEnd.slice(5, 7) === '12';

/**
 * One employee's year-end tax adjustment in words (run form, run view, payslip): "Refund ₱1,347.47" or "Deficiency
 * ₱6,657.55 withheld" (with what the pay could not cover); empty when there is none.
 */
export function yearEndText(e: Pick<PayEmployee, 'yearEnd'>): string {
  const y = e.yearEnd;
  if (!y) return '';
  if (y.refundCents > 0) return `Refund ${peso(y.refundCents)}`;
  if (y.deficiencyCents === 0) return 'No adjustment';
  return `Deficiency ${peso(y.deficiencyCents)}${y.shortCents > 0 ? `: ${peso(y.withheldCents)} withheld, ${peso(y.shortCents)} not covered by the pay` : ' withheld'}`;
}
/** The payslip's year-end line: the year's taxable pay, the annual tax, what was withheld before, and the adjustment. */
export function yearEndDetail(e: Pick<PayEmployee, 'yearEnd'>): string {
  const y = e.yearEnd;
  if (!y) return '';
  return `Year-end tax ${y.year}: taxable ${peso(y.taxableCents)}, tax due ${peso(y.annualTaxCents)}, withheld before ${peso(y.withheldBeforeCents)}. ${yearEndText(e)}.`;
}

/**
 * A final pay in words (run view, payslip): "Final pay: left on 2026-09-10; ₱3,174.52 of cash advances still owed;
 * ₱16,500.00 of government loans left (not deducted)". Empty when the run is not the employee's final pay.
 */
export function finalPayText(e: Pick<PayEmployee, 'final'>): string {
  const f = e.final;
  if (!f) return '';
  return [
    `Final pay: left on ${f.separatedOn}`, ...(f.caLeftCents ? [`${peso(f.caLeftCents)} of cash advances still owed`] : []),
    ...(f.loansLeftCents ? [`${peso(f.loansLeftCents)} of government loans left (not deducted)`] : []),
  ].join('; ');
}

/** A loan's name on a payslip: "SSS salary loan 0301-555-01". */
export const loanLabel = (l: Pick<PayLoan, 'kind' | 'loanNo'>) => `${LOAN_KIND[l.kind]} ${l.loanNo}`;

/** The deductions a payslip shows (non-zero only), in the F3 order: shares, tax, government loans, cash advance. */
export function deductionsOf(e: PayEmployee): [string, number][] {
  const rows: [string, number][] = [
    ['SSS', e.sssEeCents], ['PhilHealth', e.phicEeCents], ['Pag-IBIG', e.hdmfEeCents], [e.yearEnd ? 'Withholding tax (year-end adjustment)' : 'Withholding tax', e.wtaxCents],
    ...(e.loans ?? []).map((l): [string, number] => [loanLabel(l), l.amountCents]), ['Cash advance', e.caCents],
  ];
  return rows.filter(([, c]) => c !== 0);
}

/** What the payslip says is left of each loan deducted: "SSS salary loan 0301-555-01: ₱16,500.00 left". */
export const loansLeft = (e: PayEmployee): [string, number][] => (e.loans ?? []).filter((l) => l.amountCents > 0).map((l) => [loanLabel(l), l.balanceAfterCents]);

/** The loan register form -> input, with plain errors. Months are typed like 2026-10. */
export function loanInput(v: { employeeId: string; kind: LoanKind; loanNo: string; amortization: string; firstMonth: string; lastMonth: string; note: string }) {
  const errors: string[] = [];
  const amortizationCents = cents(v.amortization);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!v.employeeId) errors.push('Pick the employee.');
  if (!/^[0-9A-Za-z-]{3,30}$/.test(v.loanNo.trim())) errors.push('Type the loan number from the agency (letters, digits and dashes).');
  if (!amortizationCents || amortizationCents <= 0) errors.push('Type the monthly amortization, like 1500.00.');
  if (!month.test(v.firstMonth) || !month.test(v.lastMonth)) errors.push('Type the first and last months deducted, like 2026-10.');
  else if (v.lastMonth < v.firstMonth) errors.push('The last month cannot be before the first month.');
  return {
    input: { employeeId: v.employeeId, kind: v.kind, loanNo: v.loanNo.trim(), amortizationCents: amortizationCents ?? 0, firstMonth: v.firstMonth, lastMonth: v.lastMonth, ...(v.note.trim() ? { note: v.note.trim() } : {}) },
    errors,
  };
}

/** "10 days", "1:30 h" or "30" for a line's quantity (days are stored × 1000, overtime and night differential in minutes). */
export function qtyText(kind: string, qty: number): string {
  if (kind === 'ot' || kind === 'night') return `${Math.floor(qty / 60)}:${String(qty % 60).padStart(2, '0')} h`;
  if (['basic', 'leave', 'holiday', 'rest_day', 'absence', 'unused_leave'].includes(kind)) return `${qty / 1000} ${qty === 1000 ? 'day' : 'days'}`;
  return kind === 'piece' ? `${qty} pcs` : '';
}

/** A changed 13th-month amount as typed: the amount and why. */
export interface ChangedAmount { amount: string; reason: string }

/** The 13th-month form's pay group, year, changed amounts and people left out -> input, with plain errors. Blank amounts are left out. */
export function thirteenthInput(
  payGroup: PayGroup,
  year: number | null,
  amounts: Record<string, ChangedAmount>,
  skip: Record<string, string>,
  employeeId = '',
): { input: PayThirteenthInput; errors: string[] } {
  const errors: string[] = [];
  const changed: NonNullable<PayThirteenthInput['amounts']> = [];
  for (const [employeeId, a] of Object.entries(amounts)) {
    if (!a.amount.trim() || employeeId in skip) continue;
    const amount = cents(a.amount);
    if (amount === undefined || amount < 0) errors.push('Type a changed 13th-month amount like 12,500.00, or leave it blank for one twelfth of the basic pay.');
    else if (a.reason.trim().length < 5) errors.push('Say why each 13th-month amount is changed (5 characters or more).');
    else changed.push({ employeeId, amountCents: amount, reason: a.reason.trim() });
  }
  const left = Object.entries(skip).map(([employeeId, reason]) => ({ employeeId, reason: reason.trim() }));
  if (left.some((s) => s.reason.length < 5)) errors.push('Say why each person is left out (5 characters or more).');
  if (!year) errors.push('Pick the year.');
  return {
    input: { payGroup, year: year ?? 0, ...(changed.length ? { amounts: changed } : {}), ...(left.length ? { skip: left } : {}), ...(employeeId ? { employeeId } : {}) },
    errors: [...new Set(errors)],
  };
}

/** The payslip's 13th-month line: this payroll's accrual, the year so far, and the payout once recorded. */
export function thirteenthText(e: Payslips['employees'][number]): string {
  const paid = e.thirteenthPaid.map((p) => `paid ${peso(p.amountCents)} by ${p.number}`);
  return [`13th month: ${peso(e.thirteenthCents)} this payroll, ${peso(e.ytd.thirteenthCents)} so far this year`, ...paid].join('; ');
}

/** The pay-before-Virtus form's amounts, as typed. */
export type PriorForm = Record<'gross' | 'benefits' | 'deMinimis' | 'sss' | 'phic' | 'hdmf' | 'otherNontax' | 'taxable' | 'wtax', string>;
export const PRIOR_FIELDS: [keyof PriorForm, string][] = [
  ['gross', 'Gross compensation'], ['benefits', '13th month and other benefits (exempt, up to ₱90,000)'], ['deMinimis', 'De minimis benefits'], ['sss', 'SSS (employee share)'],
  ['phic', 'PhilHealth (employee share)'], ['hdmf', 'Pag-IBIG (employee share)'], ['otherNontax', 'Other non-taxable pay (an MWE’s minimum wage, holiday and overtime pay)'],
  ['taxable', 'Taxable compensation (after the shares and exempt benefits)'], ['wtax', 'Tax withheld'],
];
/** Typed amounts -> centavos, with plain errors; blanks are ₱0; the parts must add up to the gross (as on the 2316). */
export function priorAmounts(v: PriorForm): { amounts: PriorAmounts; errors: string[] } {
  const errors: string[] = [];
  const c = (k: keyof PriorForm) => {
    if (!v[k].trim()) return 0;
    const n = cents(v[k]);
    if (n === undefined || n < 0) errors.push(`${PRIOR_FIELDS.find(([f]) => f === k)![1]}: type an amount like 12,500.00.`);
    return n ?? 0;
  };
  const amounts: PriorAmounts = {
    grossCents: c('gross'), benefitsCents: c('benefits'), deMinimisCents: c('deMinimis'), sssCents: c('sss'), phicCents: c('phic'), hdmfCents: c('hdmf'),
    otherNontaxCents: c('otherNontax'), taxableCents: c('taxable'), wtaxCents: c('wtax'),
  };
  const parts = amounts.benefitsCents + amounts.deMinimisCents + amounts.sssCents + amounts.phicCents + amounts.hdmfCents + amounts.otherNontaxCents + amounts.taxableCents;
  if (!errors.length && parts !== amounts.grossCents) errors.push(`The parts add up to ${peso(parts)}, not the gross ${peso(amounts.grossCents)}.`);
  return { amounts, errors };
}
