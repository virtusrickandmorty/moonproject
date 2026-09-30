/**
 * The monthly statutory lists (PLAN E11, F4): SSS contributions list, PhilHealth RF-1-style list, Pag-IBIG MCRF-style
 * list and the BIR 1601-C worksheet, from the recorded payroll runs of one contribution month (PAY public.ts), with the
 * remittance check of each scheme from the ledger (ledger.ts). Each list's total equals the payable the payrolls
 * recorded for the month. The SSS and Pag-IBIG loan lists are the loan amortizations the month's payrolls deducted
 * (2404 / 2405), paid on the same remittance as the contributions. Government IDs are shown only to users with emp.view_ids.
 * The 1601-C worksheet's taxable pay and tax withheld also include a month's posted 13th-month pays (TH13-): the part
 * of the year's 13th-month pay above the ₱90,000 ceiling is added to the employee's taxable compensation and its tax
 * to the tax withheld, so the worksheet ties to the withholding-tax remittance (ledger.ts schemeCheck).
 * Year-end tax refunds (K23): item 25 is the tax withheld before them; the refunds of the month's runs, and an earlier
 * month's refunds above its tax carried into this month, are on their own line (the 1601-C's item 26, adjustment, as a
 * negative), and item 27 is what is left to remit, never below zero: the excess is carried to the next month.
 */
import type { Db } from '../../platform/db/driver.ts';
import { governmentIds } from '../EMP/public.ts';
import { KIND_LABEL, loansOfMonth, payOfMonth, thirteenthTaxOfMonth, type LoanKind, type MonthPay } from '../PAY/public.ts';
import { SCHEMES, carriedInto, remittancesOf, schemeCheck, type SchemeCheck } from './ledger.ts';

interface Person { employeeId: string; code: string; name: string; idNo: string | null }
export interface SssRow extends Person { mscCents: number; mpfMscCents: number; eeCents: number; erCents: number; ecCents: number; totalCents: number }
export interface PhicRow extends Person { basisCents: number; eeCents: number; erCents: number; totalCents: number }
export interface HdmfRow extends Person { compensationCents: number; eeCents: number; erCents: number; totalCents: number }
export interface LoanListRow extends Person { loanNo: string; kind: LoanKind; kindLabel: string; totalCents: number }
/** taxCents is the tax withheld before any year-end refund; refundCents is the year-end refund of the month's runs. */
export interface TaxRow extends Person { isMwe: boolean; grossCents: number; nonTaxableCents: number; taxableCents: number; taxCents: number; refundCents: number }

/**
 * The 1601-C worksheet (BIR Form 1601-C, 2018 version, items 14–25) for the month. Item 17 (13th month and other
 * benefits) is the part of the month's 13th-month pays within the ceiling; item 18 (de minimis) is zero: payroll runs
 * pay none yet. Item 23 (taxable pay not subject to tax, ₱250,000
 * a year and below) is the accountant's call; `noTaxWithheldCents` is the taxable pay of employees with no tax
 * withheld this month, as a starting point. Item 25 (`taxWithheldCents`) is before year-end tax refunds; the refunds of
 * the month's runs (`yearEndRefundCents`) and an earlier month's excess refunds taken off this month
 * (`refundCarriedInCents`, from `refundCarriedFrom`) go in item 26 as a negative adjustment; item 27
 * (`taxToRemitCents`) is what is left, never below zero, and `refundCarriedOutCents` is the excess the next month's
 * remittance takes off.
 */
export interface Worksheet1601C {
  employees: number; totalCompensationCents: number; mweBasicCents: number; mwePremiumCents: number; thirteenthMonthCents: number; deMinimisCents: number;
  eeSharesCents: number; otherNonTaxableCents: number; nonTaxableCents: number; taxableCents: number; noTaxWithheldCents: number; taxWithheldCents: number;
  yearEndRefundCents: number; refundCarriedInCents: number; refundCarriedFrom: string[]; taxToRemitCents: number; refundCarriedOutCents: number; rows: TaxRow[];
}

/**
 * An earlier month's excess year-end refunds taken off this month's withholding-tax remittance: what the recorded
 * remittances of the month settled of earlier months, or, before one is recorded, what ledger.ts carries into it.
 */
function refundsCarriedIn(db: Db, month: string): { cents: number; from: string[] } {
  const settled = remittancesOf(db, 'WTAX', month)
    .filter((r) => r.status === 'posted')
    .flatMap((r) =>
      db
        .prepare(`SELECT month, credit_cents - debit_cents AS cents FROM stat_remittance_adjustments WHERE document_id = ? AND month <> ?`)
        .all(r.id, month) as { month: string; cents: number }[],
    );
  const open = carriedInto(db, month);
  return {
    cents: settled.reduce((s, x) => s + x.cents, 0) - open.cents,
    from: [...new Set([...settled.map((x) => x.month), ...open.months.map((p) => p.month)])].sort(),
  };
}

export interface MonthLists {
  month: string;
  sss: { rows: SssRow[]; totalCents: number };
  phic: { rows: PhicRow[]; totalCents: number };
  hdmf: { rows: HdmfRow[]; totalCents: number };
  /** Loan amortizations deducted for the month, per loan: SSS salary and calamity loans, Pag-IBIG multi-purpose and calamity loans. */
  sssLoans: { rows: LoanListRow[]; totalCents: number };
  hdmfLoans: { rows: LoanListRow[]; totalCents: number };
  tax: Worksheet1601C;
  check: SchemeCheck[];
  /** Employee shares not deducted by the month's last payroll (EE_SHORT): the employer owes them all the same (ACC-05). */
  notDeducted: { employeeId: string; name: string; cents: number }[];
}

const total = <T extends { totalCents: number }>(rows: T[]) => ({ rows, totalCents: rows.reduce((s, r) => s + r.totalCents, 0) });

export function monthLists(db: Db, month: string, canSeeIds: boolean): MonthLists {
  const pay = payOfMonth(db, month);
  const th13 = thirteenthTaxOfMonth(db, month);
  const ids = canSeeIds ? governmentIds(db, [...new Set([...pay.map((p) => p.employeeId), ...th13.map((t) => t.employeeId)])]) : new Map();
  const person = (p: MonthPay, key: 'sssNo' | 'phicNo' | 'hdmfNo' | 'tin'): Person => ({ employeeId: p.employeeId, code: p.code, name: p.name, idNo: ids.get(p.employeeId)?.[key] ?? null });

  const sss = pay
    .filter((p) => p.sssEeCents + p.sssErCents + p.sssEcCents > 0)
    .map((p): SssRow => ({ ...person(p, 'sssNo'), mscCents: p.sssMscCents, mpfMscCents: p.sssMpfMscCents, eeCents: p.sssEeCents, erCents: p.sssErCents, ecCents: p.sssEcCents, totalCents: p.sssEeCents + p.sssErCents + p.sssEcCents }));
  const phic = pay
    .filter((p) => p.phicEeCents + p.phicErCents > 0)
    .map((p): PhicRow => ({ ...person(p, 'phicNo'), basisCents: p.phicBasisCents, eeCents: p.phicEeCents, erCents: p.phicErCents, totalCents: p.phicEeCents + p.phicErCents }));
  const hdmf = pay
    .filter((p) => p.hdmfEeCents + p.hdmfErCents > 0)
    .map((p): HdmfRow => ({ ...person(p, 'hdmfNo'), compensationCents: p.grossCents, eeCents: p.hdmfEeCents, erCents: p.hdmfErCents, totalCents: p.hdmfEeCents + p.hdmfErCents }));

  const loans = loansOfMonth(db, month);
  const loanIds = canSeeIds ? governmentIds(db, loans.map((l) => l.employeeId)) : new Map();
  const loanRows = (agency: 'SSS' | 'HDMF') =>
    loans
      .filter((l) => l.agency === agency)
      .map((l): LoanListRow => ({
        employeeId: l.employeeId, code: l.code, name: l.name, idNo: loanIds.get(l.employeeId)?.[agency === 'SSS' ? 'sssNo' : 'hdmfNo'] ?? null,
        loanNo: l.loanNo, kind: l.kind, kindLabel: KIND_LABEL[l.kind], totalCents: l.amountCents,
      }));

  // 1601-C: for an MWE the exempt part is the minimum wage and the holiday, rest-day and overtime pay (items 15–16); for
  // anyone else it is the employee shares taken off taxable pay (item 19). Anything left over (a negative adjustment of
  // an MWE) is item 20, so that 14 − 21 = 22 always.
  // A 13th-month pay dated in the month is in the employee's compensation: its part within the ceiling is item 17, the
  // excess is taxable pay, and its tax is withheld tax (PAY/doctypes/thirteenth.ts).
  const th13ByEmployee = new Map(th13.map((t) => [t.employeeId, t]));
  const rows = pay.map((p): TaxRow => {
    const t = th13ByEmployee.get(p.employeeId);
    return {
      ...person(p, 'tin'), isMwe: p.isMwe, grossCents: p.grossCents + (t?.amountCents ?? 0), nonTaxableCents: p.grossCents - p.taxableCents + (t ? t.amountCents - t.taxableCents : 0),
      taxableCents: p.taxableCents + (t?.taxableCents ?? 0), taxCents: p.wtaxCents + p.wtaxRefundCents + (t?.wtaxCents ?? 0), refundCents: p.wtaxRefundCents,
    };
  });
  const th13Only = th13.filter((t) => !pay.some((p) => p.employeeId === t.employeeId));
  const th13OnlyRows = th13Only.map((t): TaxRow => ({
    employeeId: t.employeeId, code: t.code, name: t.name, idNo: ids.get(t.employeeId)?.tin ?? null,
    isMwe: false, grossCents: t.amountCents, nonTaxableCents: t.amountCents - t.taxableCents, taxableCents: t.taxableCents, taxCents: t.wtaxCents, refundCents: 0,
  }));
  const allRows = [...rows, ...th13OnlyRows];
  const th13AmountCents = th13.reduce((s, t) => s + t.amountCents, 0);
  const th13TaxableCents = th13.reduce((s, t) => s + t.taxableCents, 0);
  const th13WtaxCents = th13.reduce((s, t) => s + t.wtaxCents, 0);
  const sum = (f: (p: MonthPay) => number, which = pay) => which.reduce((s, p) => s + f(p), 0);
  const mwe = pay.filter((p) => p.isMwe);
  const taxWithheldCents = sum((p) => p.wtaxCents + p.wtaxRefundCents) + th13WtaxCents; // payOfMonth's wtaxCents is net of refunds
  const yearEndRefundCents = sum((p) => p.wtaxRefundCents);
  const carried = refundsCarriedIn(db, month);
  const leftCents = taxWithheldCents - yearEndRefundCents - carried.cents;
  const others = pay.filter((p) => !p.isMwe);
  const tax: Worksheet1601C = {
    employees: allRows.length, totalCompensationCents: sum((p) => p.grossCents) + th13AmountCents, mweBasicCents: sum((p) => p.mweBasicCents, mwe), mwePremiumCents: sum((p) => p.mwePremiumCents, mwe),
    thirteenthMonthCents: th13AmountCents - th13TaxableCents, deMinimisCents: 0, eeSharesCents: sum((p) => p.grossCents - p.taxableCents, others),
    otherNonTaxableCents: sum((p) => p.grossCents - p.taxableCents - p.mweBasicCents - p.mwePremiumCents, mwe),
    nonTaxableCents: sum((p) => p.grossCents - p.taxableCents) + th13AmountCents - th13TaxableCents, taxableCents: sum((p) => p.taxableCents) + th13TaxableCents,
    noTaxWithheldCents: sum((p) => p.taxableCents, others.filter((p) => p.wtaxCents + p.wtaxRefundCents === 0)), taxWithheldCents,
    yearEndRefundCents, refundCarriedInCents: carried.cents, refundCarriedFrom: carried.from, taxToRemitCents: Math.max(0, leftCents), refundCarriedOutCents: Math.max(0, -leftCents), rows: allRows,
  };
  return {
    month, sss: total(sss), phic: total(phic), hdmf: total(hdmf), sssLoans: total(loanRows('SSS')), hdmfLoans: total(loanRows('HDMF')), tax,
    check: SCHEMES.map((s) => schemeCheck(db, s, month)),
    notDeducted: pay.filter((p) => p.eeShortCents > 0).map((p) => ({ employeeId: p.employeeId, name: p.name, cents: p.eeShortCents })),
  };
}
