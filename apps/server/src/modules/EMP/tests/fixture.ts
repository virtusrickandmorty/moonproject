/** Made-up employees for tests (never real people). Written straight into EMP's tables, as the importer's rows would be. */
import { newId } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { PayGroup, PayType } from '../public.ts';

let n = 0;
const AT = '2026-01-05T08:00:00.000+08:00';

export function addEmployee(db: Db, name: string, o: { costCentre?: 'production' | 'office'; hireDate?: string; separatedOn?: string } = {}): string {
  const id = newId();
  db.prepare(
    `INSERT INTO emp_employees (id, code, full_name, is_active, cost_centre, hire_date, separated_on, separation_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `EMP-T${++n}`, name, o.separatedOn ? 0 : 1, o.costCentre ?? 'production', o.hireDate ?? '2025-01-06', o.separatedOn ?? null, o.separatedOn ? 'Made-up separation for tests' : null, AT, AT);
  return id;
}

export interface TestPay { payType: PayType; payGroup: PayGroup; dailyRateCents?: number; monthlyRateCents?: number; workweekDays?: 5 | 6; isMwe?: boolean; effectiveFrom?: string }
export function addPay(db: Db, employeeId: string, userId: string, p: TestPay): void {
  db.prepare(
    `INSERT INTO emp_pay_profiles (employee_id, effective_from, pay_type, daily_rate_cents, monthly_rate_cents, pay_group, workweek_days, is_mwe, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Made-up pay for tests', ?, ?)`,
  ).run(employeeId, p.effectiveFrom ?? '2025-01-06', p.payType, p.dailyRateCents ?? null, p.monthlyRateCents ?? null, p.payGroup, p.workweekDays ?? 6, +(p.isMwe ?? false), AT, userId);
}
