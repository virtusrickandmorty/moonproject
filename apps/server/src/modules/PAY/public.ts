/** PAY contract for other modules (STAT). Read-only; callers check their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { sssRateAt } from './statutory.ts';

/** One employee's recorded pay for a contribution month (PAY-RUN's month M, F3), over the month's recorded runs. */
export interface MonthPay {
  employeeId: string; code: string; name: string; isMwe: boolean; runs: string[];
  grossCents: number; taxableCents: number; wtaxCents: number;
  /** The month's SSS MSC (and its part above the regular SS maximum, the MPF) and PhilHealth basis, as the last run worked them out. */
  sssMscCents: number; sssMpfMscCents: number; phicBasisCents: number;
  sssEeCents: number; sssErCents: number; sssEcCents: number; phicEeCents: number; phicErCents: number; hdmfEeCents: number; hdmfErCents: number;
  /** Employee shares the pay could not cover, still not deducted after the last run of the month (EE_SHORT). */
  eeShortCents: number;
  /** A minimum wage earner's tax-exempt pay (F1): basic pay (the SMW part), and holiday, rest-day and overtime pay. */
  mweBasicCents: number; mwePremiumCents: number;
}

type Row = Record<string, any>;

/** Per employee, the month's recorded (not cancelled) runs added up, by name. */
export function payOfMonth(db: Db, month: string): MonthPay[] {
  const rows = db
    .prepare(
      `SELECT e.*, d.number,
         (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_run_lines l WHERE l.run_employee_id = e.id AND l.taxable = 0 AND l.kind IN ('basic', 'leave', 'salary', 'absence', 'piece')) AS mwe_basic,
         (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_run_lines l WHERE l.run_employee_id = e.id AND l.taxable = 0 AND l.kind IN ('holiday', 'rest_day', 'ot')) AS mwe_premium
       FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND r.contribution_month = ? ORDER BY e.employee_name, e.employee_id, d.number`,
    )
    .all(month) as Row[];
  if (!rows.length) return [];
  const regularMax = sssRateAt(db, `${month}-01`).regularMaxCents;
  const out = new Map<string, MonthPay>();
  for (const r of rows) {
    const m = out.get(r.employee_id) ?? {
      employeeId: r.employee_id, code: r.employee_code, name: r.employee_name, isMwe: false, runs: [], grossCents: 0, taxableCents: 0, wtaxCents: 0, sssMscCents: 0, sssMpfMscCents: 0,
      phicBasisCents: 0, sssEeCents: 0, sssErCents: 0, sssEcCents: 0, phicEeCents: 0, phicErCents: 0, hdmfEeCents: 0, hdmfErCents: 0, eeShortCents: 0, mweBasicCents: 0, mwePremiumCents: 0,
    };
    out.set(r.employee_id, {
      ...m, code: r.employee_code, name: r.employee_name, isMwe: r.is_mwe === 1, runs: [...m.runs, r.number],
      grossCents: m.grossCents + r.gross_cents, taxableCents: m.taxableCents + r.taxable_cents, wtaxCents: m.wtaxCents + r.wtax_cents,
      // The last run of the month (runs are in number order) holds the month's MSC, basis and remaining shortfall.
      sssMscCents: r.sss_msc_cents, sssMpfMscCents: Math.max(0, r.sss_msc_cents - regularMax), phicBasisCents: r.phic_basis_cents, eeShortCents: r.ee_short_cents,
      sssEeCents: m.sssEeCents + r.sss_ee_cents, sssErCents: m.sssErCents + r.sss_er_cents, sssEcCents: m.sssEcCents + r.sss_ec_cents,
      phicEeCents: m.phicEeCents + r.phic_ee_cents, phicErCents: m.phicErCents + r.phic_er_cents, hdmfEeCents: m.hdmfEeCents + r.hdmf_ee_cents, hdmfErCents: m.hdmfErCents + r.hdmf_er_cents,
      mweBasicCents: m.mweBasicCents + (r.is_mwe === 1 ? r.mwe_basic : 0), mwePremiumCents: m.mwePremiumCents + (r.is_mwe === 1 ? r.mwe_premium : 0),
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

/** A run's contribution month, or undefined if the id is not a payroll run. */
export function runMonth(db: Db, runId: string): { number: string; status: 'posted' | 'cancelled'; contributionMonth: string } | undefined {
  return db
    .prepare('SELECT d.number, d.status, r.contribution_month AS contributionMonth FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?')
    .get(runId) as { number: string; status: 'posted' | 'cancelled'; contributionMonth: string } | undefined;
}
