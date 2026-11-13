/** The only PRD file that reads employees: through EMP's contract (modules/EMP/public.ts), as PLAN C3 requires. */
import type { Db } from '../../platform/db/driver.ts';
import { payProfileAt } from '../EMP/public.ts';
export { activeEmployees, employee, type Employee } from '../EMP/public.ts';

/**
 * How the worker is paid on a day, when it is not per piece: a monthly or daily worker's pieces count as progress only
 * (₱0), since the payroll never pays them (the owner's request, Nov 2026). Undefined when paid per piece ("piece" or
 * "daily and per piece") or with no pay profile yet.
 */
export function notPaidPerPiece(db: Db, employeeId: string, day: string): 'monthly' | 'daily' | undefined {
  const type = payProfileAt(db, employeeId, day)?.payType;
  return type === 'monthly' || type === 'daily' ? type : undefined;
}
