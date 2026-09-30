/** Read-only PRT contract for other modules. */
import type { Db } from '../../platform/db/driver.ts';
import { renderPrint, type PrintHeader, type Profile } from './print.ts';

/** The company's registered name from the print profile, or undefined until an owner has filled the profile in. */
export function companyRegisteredName(db: Db): string | undefined {
  return (db.prepare('SELECT registered_name FROM prt_company_profile WHERE id = 1').pluck().get() as string | undefined)?.trim() || undefined;
}

/**
 * One employee's payslip from a recorded payroll run, as the very HTML the payslip print makes (same title, layout and
 * lines; the print route with `employeeId` filters the run the same way). For the payslip email (COM): it is not a
 * print, so it is not counted in the reprint log. `undefined` when the run, the employee on it or the company profile is missing.
 */
export function renderEmployeePayslip(db: Db, run: { id: string; doc: { employees: { employeeId: string }[] } }, employeeId: string, madeBy: string, madeAt: string): string | undefined {
  const profile = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
  const h = db.prepare(`SELECT id, number, business_date, doc_type, status FROM documents WHERE id = ? AND doc_type = 'pay.run'`).get(run.id) as PrintHeader | undefined;
  const employees = run.doc.employees.filter((e) => e.employeeId === employeeId);
  if (!profile || !h || employees.length === 0) return undefined;
  return renderPrint(db, h, { ...run.doc, employees }, profile, 'document', madeBy, madeAt, 1);
}
