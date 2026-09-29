/** PAY contract for other modules (STAT). Read-only; callers check their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { sssRateAt } from './statutory.ts';
import type { Agency, LoanKind } from './loans.ts';
export { KIND_LABEL, LOAN_ACCOUNT, type Agency, type LoanKind } from './loans.ts';

/** One employee's recorded pay for a contribution month (PAY-RUN's month M, F3), over the month's recorded runs. */
export interface MonthPay {
  employeeId: string; code: string; name: string; isMwe: boolean; runs: string[];
  /** wtaxCents is the tax withheld less any year-end refund (what the month's 2310 carries, so it can be below zero). */
  grossCents: number; taxableCents: number; wtaxCents: number; wtaxRefundCents: number;
  /** The month's SSS MSC (and its part above the regular SS maximum, the MPF) and PhilHealth basis, as the last run worked them out. */
  sssMscCents: number; sssMpfMscCents: number; phicBasisCents: number;
  sssEeCents: number; sssErCents: number; sssEcCents: number; phicEeCents: number; phicErCents: number; hdmfEeCents: number; hdmfErCents: number;
  /** Employee shares the pay could not cover, still not deducted after the last run of the month (EE_SHORT). */
  eeShortCents: number;
  /** A minimum wage earner's tax-exempt pay (F1): basic pay (the SMW part), and holiday, rest-day and overtime pay. */
  mweBasicCents: number; mwePremiumCents: number;
  /** Unused leave paid in cash up to the de minimis days (RR 11-2018): not taxable, and not an employee share. */
  deMinimisCents: number;
}

/** One employee's line of a recorded run, with the run's number and, for an MWE, the exempt basic and premium pay. */
interface RunEmployeeRow {
  number: string; employee_id: string; employee_code: string; employee_name: string; is_mwe: 0 | 1;
  gross_cents: number; taxable_cents: number; wtax_cents: number; wtax_refund_cents: number; sss_msc_cents: number; phic_basis_cents: number; ee_short_cents: number;
  sss_ee_cents: number; sss_er_cents: number; sss_ec_cents: number; phic_ee_cents: number; phic_er_cents: number; hdmf_ee_cents: number; hdmf_er_cents: number;
  mwe_basic: number; mwe_premium: number; de_minimis: number;
}

/** Per employee, the month's recorded (not cancelled) runs added up, by name. */
export function payOfMonth(db: Db, month: string): MonthPay[] {
  const rows = db
    .prepare(
      `SELECT d.number, e.employee_id, e.employee_code, e.employee_name, e.is_mwe, e.gross_cents, e.taxable_cents, e.wtax_cents, e.wtax_refund_cents, e.sss_msc_cents,
         e.phic_basis_cents, e.ee_short_cents, e.sss_ee_cents, e.sss_er_cents, e.sss_ec_cents, e.phic_ee_cents, e.phic_er_cents, e.hdmf_ee_cents, e.hdmf_er_cents,
         (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_run_lines l WHERE l.run_employee_id = e.id AND l.taxable = 0 AND l.kind IN ('basic', 'leave', 'salary', 'absence', 'piece')
            AND l.id NOT IN (SELECT run_line_id FROM pay_run_unused_leave)) AS mwe_basic,
         (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_run_lines l WHERE l.run_employee_id = e.id AND l.taxable = 0 AND l.kind IN ('holiday', 'rest_day', 'ot')) AS mwe_premium,
         (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_run_lines l JOIN pay_run_unused_leave u ON u.run_line_id = l.id WHERE l.run_employee_id = e.id AND l.taxable = 0) AS de_minimis
       FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND r.contribution_month = ? ORDER BY e.employee_name, e.employee_id, d.number`,
    )
    .all(month) as RunEmployeeRow[];
  if (!rows.length) return [];
  const regularMax = sssRateAt(db, `${month}-01`).regularMaxCents;
  const out = new Map<string, MonthPay>();
  for (const r of rows) {
    const m = out.get(r.employee_id) ?? {
      employeeId: r.employee_id, code: r.employee_code, name: r.employee_name, isMwe: false, runs: [], grossCents: 0, taxableCents: 0, wtaxCents: 0, wtaxRefundCents: 0, sssMscCents: 0, sssMpfMscCents: 0,
      phicBasisCents: 0, sssEeCents: 0, sssErCents: 0, sssEcCents: 0, phicEeCents: 0, phicErCents: 0, hdmfEeCents: 0, hdmfErCents: 0, eeShortCents: 0, mweBasicCents: 0, mwePremiumCents: 0,
      deMinimisCents: 0,
    };
    out.set(r.employee_id, {
      ...m, code: r.employee_code, name: r.employee_name, isMwe: r.is_mwe === 1, runs: [...m.runs, r.number],
      grossCents: m.grossCents + r.gross_cents, taxableCents: m.taxableCents + r.taxable_cents, wtaxCents: m.wtaxCents + r.wtax_cents - r.wtax_refund_cents, wtaxRefundCents: m.wtaxRefundCents + r.wtax_refund_cents,
      // The last run of the month (runs are in number order) holds the month's MSC, basis and remaining shortfall.
      sssMscCents: r.sss_msc_cents, sssMpfMscCents: Math.max(0, r.sss_msc_cents - regularMax), phicBasisCents: r.phic_basis_cents, eeShortCents: r.ee_short_cents,
      sssEeCents: m.sssEeCents + r.sss_ee_cents, sssErCents: m.sssErCents + r.sss_er_cents, sssEcCents: m.sssEcCents + r.sss_ec_cents,
      phicEeCents: m.phicEeCents + r.phic_ee_cents, phicErCents: m.phicErCents + r.phic_er_cents, hdmfEeCents: m.hdmfEeCents + r.hdmf_ee_cents, hdmfErCents: m.hdmfErCents + r.hdmf_er_cents,
      mweBasicCents: m.mweBasicCents + (r.is_mwe === 1 ? r.mwe_basic : 0), mwePremiumCents: m.mwePremiumCents + (r.is_mwe === 1 ? r.mwe_premium : 0),
      deMinimisCents: m.deMinimisCents + r.de_minimis,
    });
  }
  return [...out.values()];
}

export interface MonthRun { id: string; number: string; status: 'posted' | 'cancelled'; postedAt: string; cancelledAt: string | null }

/** The payroll runs of a contribution month, recorded or cancelled (their journals carry the month's payables). */
export function runsOfMonth(db: Db, month: string): MonthRun[] {
  return db
    .prepare(
      `SELECT d.id, d.number, d.status, d.posted_at AS postedAt, d.cancelled_at AS cancelledAt FROM pay_runs r JOIN documents d ON d.id = r.document_id
       WHERE r.contribution_month = ? ORDER BY d.number`,
    )
    .all(month) as MonthRun[];
}

/** Contribution months that have a recorded or cancelled run, newest first. */
export const payrollMonths = (db: Db): string[] => db.prepare('SELECT DISTINCT contribution_month FROM pay_runs ORDER BY 1 DESC').pluck().all() as string[];

/** Months (by their own document date) with a recorded or cancelled 13th-month pay, newest first. */
export const thirteenthMonths = (db: Db): string[] =>
  db.prepare(`SELECT DISTINCT substr(d.business_date, 1, 7) AS month FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id ORDER BY 1 DESC`).pluck().all() as string[];

/** A run's contribution month, or undefined if the id is not a payroll run. */
export function runMonth(db: Db, runId: string): { number: string; status: 'posted' | 'cancelled'; contributionMonth: string } | undefined {
  return db
    .prepare('SELECT d.number, d.status, r.contribution_month AS contributionMonth FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?')
    .get(runId) as { number: string; status: 'posted' | 'cancelled'; contributionMonth: string } | undefined;
}

/** 13th-month pays (TH13-, pay.thirteenth) dated in a month, recorded or cancelled (their journals carry the month's withholding tax, 2310). */
export function thirteenthsOfMonth(db: Db, month: string): MonthRun[] {
  return db
    .prepare(
      `SELECT d.id, d.number, d.status, d.posted_at AS postedAt, d.cancelled_at AS cancelledAt FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id
       WHERE substr(d.business_date, 1, 7) = ? ORDER BY d.number`,
    )
    .all(month) as MonthRun[];
}

/** A 13th-month pay's own month (its document date), or undefined if the id is not one. */
export function thirteenthMonth(db: Db, id: string): { number: string; status: 'posted' | 'cancelled'; month: string } | undefined {
  return db
    .prepare(`SELECT d.number, d.status, substr(d.business_date, 1, 7) AS month FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE t.document_id = ?`)
    .get(id) as { number: string; status: 'posted' | 'cancelled'; month: string } | undefined;
}

/** amountCents is the 13th-month pay; taxableCents its part above the ceiling (the rest is 1601-C item 17). */
export interface ThirteenthMonthTax { employeeId: string; code: string; name: string; amountCents: number; taxableCents: number; wtaxCents: number }

/** Per employee, the withholding tax a month's recorded (posted) 13th-month pays credited to 2310 (STAT's 1601-C list and remittance). */
export function thirteenthTaxOfMonth(db: Db, month: string): ThirteenthMonthTax[] {
  return db
    .prepare(
      `SELECT e.employee_id AS employeeId, e.employee_code AS code, e.employee_name AS name, SUM(e.amount_cents) AS amountCents, SUM(e.taxable_cents) AS taxableCents, SUM(e.wtax_cents) AS wtaxCents
       FROM pay_thirteenth_employees e JOIN documents d ON d.id = e.document_id
       WHERE d.status = 'posted' AND substr(d.business_date, 1, 7) = ? GROUP BY e.employee_id, e.employee_code, e.employee_name`,
    )
    .all(month) as ThirteenthMonthTax[];
}

/** One government loan's deductions in a contribution month, over the month's recorded runs (the SSS and Pag-IBIG loan lists). */
export interface MonthLoan { employeeId: string; code: string; name: string; loanId: string; agency: Agency; kind: LoanKind; loanNo: string; runs: string[]; amountCents: number }

export function loansOfMonth(db: Db, month: string): MonthLoan[] {
  const rows = db
    .prepare(
      `SELECT e.employee_id AS employeeId, e.employee_code AS code, e.employee_name AS name, x.loan_id AS loanId, x.agency, x.kind, x.loan_no AS loanNo, d.number, x.amount_cents AS amountCents
       FROM pay_run_loans x JOIN pay_run_employees e ON e.id = x.run_employee_id JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND r.contribution_month = ? AND x.amount_cents > 0 ORDER BY e.employee_name, e.employee_id, x.loan_no, d.number`,
    )
    .all(month) as (Omit<MonthLoan, 'runs'> & { number: string })[];
  const out = new Map<string, MonthLoan>();
  for (const { number, ...r } of rows) {
    const m = out.get(r.loanId);
    out.set(r.loanId, m ? { ...m, runs: [...m.runs, number], amountCents: m.amountCents + r.amountCents } : { ...r, runs: [number] });
  }
  return [...out.values()];
}

/** Immutable payroll snapshots for RPT. Amounts are the figures sealed with each recorded run. */
export function payrollReportRows(db: Db) {
  return db.prepare(`SELECT d.id AS documentId, d.number, d.business_date AS businessDate, d.status,
    r.period_start AS periodStart, r.period_end AS periodEnd, r.contribution_month AS contributionMonth,
    e.id AS runEmployeeId, e.employee_id AS employeeId, e.employee_code AS employeeCode, e.employee_name AS employeeName,
    e.gross_cents AS grossCents, e.sss_ee_cents AS sssEeCents, e.sss_er_cents AS sssErCents,
    e.sss_ec_cents AS sssEcCents, e.phic_ee_cents AS phicEeCents, e.phic_er_cents AS phicErCents,
    e.hdmf_ee_cents AS hdmfEeCents, e.hdmf_er_cents AS hdmfErCents, e.wtax_cents AS taxCents,
    e.ca_cents AS caCents, COALESCE((SELECT SUM(x.amount_cents) FROM pay_run_loans x WHERE x.run_employee_id=e.id),0) AS loanCents,
    e.thirteenth_cents AS accruedCents, e.net_cents AS netCents
    FROM pay_run_employees e JOIN pay_runs r ON r.document_id=e.document_id JOIN documents d ON d.id=r.document_id
    WHERE d.status='posted' ORDER BY d.business_date,d.number,e.employee_name`) .all() as Array<Record<string, string | number>>;
}

/** Recorded earning lines, including their JO tags, for payroll reports. */
export function payrollEarningRows(db: Db) {
  return db.prepare(`SELECT e.document_id AS documentId,r.period_start AS periodStart,r.period_end AS periodEnd,e.employee_id AS employeeId,e.employee_code AS employeeCode,e.employee_name AS employeeName,
    l.kind,l.description,l.qty,l.amount_cents AS amountCents,l.job_order_id AS jobOrderId
    FROM pay_run_lines l JOIN pay_run_employees e ON e.id=l.run_employee_id JOIN pay_runs r ON r.document_id=e.document_id JOIN documents d ON d.id=e.document_id
    WHERE d.status='posted' ORDER BY e.document_id,e.employee_name,l.line_no`).all() as Array<Record<string, string | number | null>>;
}

/** Recorded 13th-month snapshots for a year. */
export function thirteenthReportRows(db: Db, year: number) {
  return db.prepare(`SELECT d.id AS documentId,d.number,e.employee_id AS employeeId,e.employee_code AS employeeCode,e.employee_name AS employeeName,
    e.due_cents AS dueCents,e.accrued_cents AS accruedCents,e.amount_cents AS paidCents,e.taxable_cents AS taxableCents
    FROM pay_thirteenth_employees e JOIN pay_thirteenths t ON t.document_id=e.document_id JOIN documents d ON d.id=e.document_id
    WHERE d.status='posted' AND t.year=? ORDER BY e.employee_name,d.number`).all(year) as Array<Record<string, string | number>>;
}
