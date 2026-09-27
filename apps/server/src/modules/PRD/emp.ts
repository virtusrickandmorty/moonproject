/**
 * The only PRD file that reads employees. EMP (Claude #2, PLAN E11) is not built yet. Until it is, this reads the employee
 * master EMP will create, `emp_employees (id, code, full_name, is_active)`, and finds nobody while that table does not
 * exist. When EMP lands, each function becomes a call into modules/EMP/public.ts and nothing else in PRD changes.
 */
import type { Db } from '../../platform/db/driver.ts';

export interface Employee { id: string; code: string; name: string; active: boolean }

const hasEmployees = (db: Db) => db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'emp_employees'`).get() !== undefined;
const EMPLOYEE = 'SELECT id, code, full_name AS name, is_active = 1 AS active FROM emp_employees';
const asEmployee = (r: Omit<Employee, 'active'> & { active: number }): Employee => ({ ...r, active: r.active === 1 });

export function employee(db: Db, id: string): Employee | undefined {
  if (!hasEmployees(db)) return undefined;
  const r = db.prepare(`${EMPLOYEE} WHERE id = ?`).get(id) as (Omit<Employee, 'active'> & { active: number }) | undefined;
  return r && asEmployee(r);
}

export function activeEmployees(db: Db): Employee[] {
  if (!hasEmployees(db)) return [];
  return (db.prepare(`${EMPLOYEE} WHERE is_active = 1 ORDER BY full_name, id`).all() as (Omit<Employee, 'active'> & { active: number })[]).map(asEmployee);
}
