/** EMP contract for other modules (PRD, PAY, CAL, DASH). Read-only; callers check their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { payProfileAt, type PayGroup } from './employees.ts';

export { PAY_GROUPS, PAY_TYPES, payProfileAt, type PayGroup, type PayProfile, type PayType } from './employees.ts';
export { attendanceBetween, holidaysBetween, type AttendanceDay, type AttendanceStatus, type Holiday } from './time.ts';

/** What other modules see of an employee: no government IDs, contact details or pay. */
export interface Employee {
  id: string; code: string; name: string; active: boolean; costCentre: 'production' | 'office'; hireDate: string; separatedOn: string | null;
  statutory: { sss: boolean; phic: boolean; hdmf: boolean; wtax: boolean };
}
type Row = { id: string; code: string; name: string; active: number; costCentre: Employee['costCentre']; hireDate: string; separatedOn: string | null; sss: number; phic: number; hdmf: number; wtax: number };
const EMPLOYEE = `SELECT id, code, full_name AS name, is_active AS active, cost_centre AS costCentre, hire_date AS hireDate, separated_on AS separatedOn,
  sss_on AS sss, phic_on AS phic, hdmf_on AS hdmf, wtax_on AS wtax FROM emp_employees`;
const asEmployee = ({ sss, phic, hdmf, wtax, active, ...r }: Row): Employee => ({ ...r, active: active === 1, statutory: { sss: sss === 1, phic: phic === 1, hdmf: hdmf === 1, wtax: wtax === 1 } });

export function employee(db: Db, id: string): Employee | undefined {
  const r = db.prepare(`${EMPLOYEE} WHERE id = ?`).get(id) as Row | undefined;
  return r && asEmployee(r);
}

/** Employees not separated, by name. */
export const activeEmployees = (db: Db): Employee[] => (db.prepare(`${EMPLOYEE} WHERE is_active = 1 ORDER BY full_name, id`).all() as Row[]).map(asEmployee);

/**
 * Who a payroll run covers (F2, F3): employees in service on some day of the period whose pay on its last day (or their
 * last day, if they left during it) is in the pay group. A worker who left keeps being listed for the period they worked.
 */
export function employeesInGroup(db: Db, payGroup: PayGroup, from: string, to: string): Employee[] {
  const rows = db.prepare(`${EMPLOYEE} WHERE hire_date <= ? AND (separated_on IS NULL OR separated_on >= ?) ORDER BY full_name, id`).all(to, from) as Row[];
  return rows.map(asEmployee).filter((e) => payProfileAt(db, e.id, e.separatedOn && e.separatedOn < to ? e.separatedOn : to)?.payGroup === payGroup);
}
