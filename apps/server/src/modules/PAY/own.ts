/**
 * A worker's own payslips on the floor app (the owner's request, Nov 2026): the net pay of each recorded payroll run they
 * are on, with its breakdown (what they earned, each deduction) and whether it was released to them. Read-only, from the
 * recorded runs; the signed-in account's linked employee only, so nobody sees anyone else's pay.
 */
import { AppError } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { employeeOfUser } from '../EMP/public.ts';
import { runDoc } from './doctypes/run.ts';
import { releaseStatus } from './doctypes/release.ts';
import { KIND_LABEL } from './loans.ts';

export interface OwnPayslip {
  runId: string; number: string; payDate: string; periodStart: string; periodEnd: string;
  earnings: { description: string; amountCents: number }[]; grossCents: number;
  /** Each deduction, in the payslip's order; a tax refund comes back as `refundCents`. */
  deductions: { what: string; amountCents: number }[]; refundCents: number;
  netCents: number; released: boolean;
}

/** The payslips of the signed-in account's employee, newest first. */
export function ownPayslips(db: Db, userId: string, limit = 8): OwnPayslip[] {
  const me = employeeOfUser(db, userId);
  if (!me) throw new AppError('FLOOR_NOT_LINKED', 'Your sign-in is not linked to an employee yet. Ask the office to link it on your employee page.', 403);
  const runs = db.prepare(`SELECT d.id, d.number, d.business_date AS payDate FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id
      JOIN documents d ON d.id = e.document_id WHERE e.employee_id = ? AND d.status = 'posted' ORDER BY r.period_end DESC, d.number DESC LIMIT ?`)
    .all(me.id, limit) as { id: string; number: string; payDate: string }[];
  return runs.flatMap((r) => {
    const run = runDoc.load(db, r.id);
    const e = run.employees.find((x) => x.employeeId === me.id);
    if (!e) return [];
    const deductions = [
      { what: 'SSS', amountCents: e.sssEeCents }, { what: 'PhilHealth', amountCents: e.phicEeCents }, { what: 'Pag-IBIG', amountCents: e.hdmfEeCents },
      { what: 'Withholding tax', amountCents: e.wtaxCents }, { what: 'Cash advance', amountCents: e.caCents },
      ...(e.loans ?? []).map((l) => ({ what: KIND_LABEL[l.kind], amountCents: l.amountCents })),
      ...(e.charges ?? []).map((c) => ({ what: `Charge: ${c.what}`, amountCents: c.amountCents })),
      ...(e.deductions ?? []).map((d) => ({ what: d.reason, amountCents: d.amountCents })),
    ].filter((d) => d.amountCents > 0);
    return [{
      runId: r.id, number: r.number, payDate: r.payDate, periodStart: run.periodStart, periodEnd: run.periodEnd,
      earnings: e.lines.map((l) => ({ description: l.description, amountCents: l.amountCents })), grossCents: e.grossCents,
      deductions, refundCents: e.wtaxRefundCents ?? 0, netCents: e.netCents,
      released: !!releaseStatus(db, r.id).find((s) => s.employeeId === me.id)?.releasedBy,
    }];
  });
}
