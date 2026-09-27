/**
 * The monthly statutory lists (PLAN E11, F4): SSS contributions list, PhilHealth RF-1-style list, Pag-IBIG MCRF-style
 * list and the BIR 1601-C worksheet, from the recorded payroll runs of one contribution month (PAY public.ts), with the
 * remittance check of each scheme from the ledger (ledger.ts). Each list's total equals the payable the payrolls
 * recorded for the month. Government IDs are shown only to users with emp.view_ids.
 */
import type { Db } from '../../platform/db/driver.ts';
import { governmentIds } from '../EMP/public.ts';
import { payOfMonth, type MonthPay } from '../PAY/public.ts';
import { SCHEMES, schemeCheck, type SchemeCheck } from './ledger.ts';

interface Person { employeeId: string; code: string; name: string; idNo: string | null }
export interface SssRow extends Person { mscCents: number; mpfMscCents: number; eeCents: number; erCents: number; ecCents: number; totalCents: number }
export interface PhicRow extends Person { basisCents: number; eeCents: number; erCents: number; totalCents: number }
export interface HdmfRow extends Person { compensationCents: number; eeCents: number; erCents: number; totalCents: number }
export interface TaxRow extends Person { isMwe: boolean; grossCents: number; nonTaxableCents: number; taxableCents: number; taxCents: number }

/**
 * The 1601-C worksheet (BIR Form 1601-C, 2018 version, items 14–25) for the month. Items 17 (13th month and other
 * benefits) and 18 (de minimis) are zero: payroll runs pay neither yet. Item 23 (taxable pay not subject to tax, ₱250,000
 * a year and below) is the accountant's call; `noTaxWithheldCents` is the taxable pay of employees with no tax
 * withheld this month, as a starting point.
 */
export interface Worksheet1601C {
  employees: number; totalCompensationCents: number; mweBasicCents: number; mwePremiumCents: number; thirteenthMonthCents: number; deMinimisCents: number;
  eeSharesCents: number; otherNonTaxableCents: number; nonTaxableCents: number; taxableCents: number; noTaxWithheldCents: number; taxWithheldCents: number; rows: TaxRow[];
}

export interface MonthLists {
  month: string;
  sss: { rows: SssRow[]; totalCents: number };
  phic: { rows: PhicRow[]; totalCents: number };
  hdmf: { rows: HdmfRow[]; totalCents: number };
  tax: Worksheet1601C;
  check: SchemeCheck[];
  /** Employee shares not deducted by the month's last payroll (EE_SHORT): the employer owes them all the same (ACC-05). */
  notDeducted: { employeeId: string; name: string; cents: number }[];
}

const total = <T extends { totalCents: number }>(rows: T[]) => ({ rows, totalCents: rows.reduce((s, r) => s + r.totalCents, 0) });

export function monthLists(db: Db, month: string, canSeeIds: boolean): MonthLists {
  const pay = payOfMonth(db, month);
  const ids = canSeeIds ? governmentIds(db, pay.map((p) => p.employeeId)) : new Map();
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

  // 1601-C: for an MWE the exempt part is the minimum wage and the holiday, rest-day and overtime pay (items 15–16); for
  // anyone else it is the employee shares taken off taxable pay (item 19). Anything left over (a negative adjustment of
  // an MWE) is item 20, so that 14 − 21 = 22 always.
  const rows = pay.map((p): TaxRow => ({ ...person(p, 'tin'), isMwe: p.isMwe, grossCents: p.grossCents, nonTaxableCents: p.grossCents - p.taxableCents, taxableCents: p.taxableCents, taxCents: p.wtaxCents }));
  const sum = (f: (p: MonthPay) => number, which = pay) => which.reduce((s, p) => s + f(p), 0);
  const mwe = pay.filter((p) => p.isMwe);
  const others = pay.filter((p) => !p.isMwe);
  const tax: Worksheet1601C = {
    employees: pay.length, totalCompensationCents: sum((p) => p.grossCents), mweBasicCents: sum((p) => p.mweBasicCents, mwe), mwePremiumCents: sum((p) => p.mwePremiumCents, mwe),
    thirteenthMonthCents: 0, deMinimisCents: 0, eeSharesCents: sum((p) => p.grossCents - p.taxableCents, others),
    otherNonTaxableCents: sum((p) => p.grossCents - p.taxableCents - p.mweBasicCents - p.mwePremiumCents, mwe),
    nonTaxableCents: sum((p) => p.grossCents - p.taxableCents), taxableCents: sum((p) => p.taxableCents),
    noTaxWithheldCents: sum((p) => p.taxableCents, others.filter((p) => p.wtaxCents === 0)), taxWithheldCents: sum((p) => p.wtaxCents), rows,
  };
  return {
    month, sss: total(sss), phic: total(phic), hdmf: total(hdmf), tax,
    check: SCHEMES.map((s) => schemeCheck(db, s, month)),
    notDeducted: pay.filter((p) => p.eeShortCents > 0).map((p) => ({ employeeId: p.employeeId, name: p.name, cents: p.eeShortCents })),
  };
}
