/** The yearly SIL list. Every balance comes from the same silOf calculation shown on an employee's record. */
import type { Db } from '../../platform/db/driver.ts';
import { listEmployees } from './employees.ts';
import { silOf } from './time.ts';

export interface LeaveBalanceRow {
  employeeId: string;
  code: string;
  fullName: string;
  hireDate: string;
  separatedOn: string | null;
  eligibleFrom: string;
  earned: number;
  used: number;
  paid: number;
  left: number;
}

export function leaveBalances(db: Db, year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows: LeaveBalanceRow[] = listEmployees(db, { search: '', status: 'all' })
    .filter((e) => e.hireDate <= to && (!e.separatedOn || e.separatedOn >= from))
    .map((e) => {
      const sil = silOf(db, e.id, year);
      return {
        employeeId: e.id,
        code: e.code,
        fullName: e.fullName,
        hireDate: e.hireDate,
        separatedOn: e.separatedOn,
        eligibleFrom: sil.eligibleFrom,
        earned: sil.eligibleFrom <= to ? sil.daysPerYear : 0,
        used: sil.used,
        paid: sil.paid,
        left: sil.left,
      };
    });
  return {
    year,
    rows,
    totals: rows.reduce((t, r) => ({ earned: t.earned + r.earned, used: t.used + r.used, paid: t.paid + r.paid, left: t.left + r.left }), { earned: 0, used: 0, paid: 0, left: 0 }),
  };
}
