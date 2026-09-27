/** PRD contract for other modules (RATE, PAY, DASH, RPT). Callers check their own route permission. */
import { conflict } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';

export { COMPLEXITIES, listSteps, stepById, type Complexity, type Step } from './production.ts';
import { lineRoute } from './production.ts';

/** Current route names and status for a production job ticket. */
export function jobTicketRoute(db: Db, jobOrderId: string, lineNo: number) {
  return lineRoute(db, jobOrderId, lineNo)?.map(({ name, status }) => ({ name, status })) ?? [];
}

export interface UnpaidAssignment {
  id: string; documentId: string; jobOrderId: string; lineNo: number; stepId: number; employeeId: string; workDate: string;
  kind: 'work' | 'rework' | 'correction'; pieces: number; rateCents: number; amountCents: number;
}

/**
 * Piece work not paid yet, dated up to a day (F3 "piece assignments dated in the period and unpaid"): rows of recorded
 * entries with no payroll run line, corrections included. A row paid by a run (pay_run_line_id) is never listed again.
 */
export function unpaidAssignments(db: Db, upTo: string, employeeId?: string): UnpaidAssignment[] {
  return db
    .prepare(
      `SELECT a.id, a.document_id AS documentId, a.job_order_id AS jobOrderId, a.line_no AS lineNo, a.step_id AS stepId, a.employee_id AS employeeId,
         a.work_date AS workDate, a.kind, a.pieces, a.rate_cents AS rateCents, a.amount_cents AS amountCents
       FROM prd_assignments a JOIN documents d ON d.id = a.document_id
       WHERE d.status = 'posted' AND a.pay_run_line_id IS NULL AND a.work_date <= @upTo AND (@e IS NULL OR a.employee_id = @e)
       ORDER BY a.employee_id, a.work_date, d.number, a.row_no`,
    )
    .all({ upTo, e: employeeId ?? null }) as UnpaidAssignment[];
}

/**
 * PAY's one write into PRD (F3 "paid once"): a payroll run line pays one assignment row. Only a row still unpaid can be
 * marked, and the unique index on pay_run_line_id keeps a run line to one row.
 */
export function markAssignmentPaid(db: Db, assignmentId: string, payRunLineId: string): void {
  const r = db.prepare('UPDATE prd_assignments SET pay_run_line_id = ? WHERE id = ? AND pay_run_line_id IS NULL').run(payRunLineId, assignmentId);
  if (r.changes !== 1) throw conflict('ALREADY_PAID', 'Some of these pieces were paid by another payroll meanwhile. Work the payroll out again.');
}

/** Cancelling a payroll run makes the rows its lines paid unpaid again, for the next run (D6, F3). */
export function clearAssignmentsPaidBy(db: Db, payRunLineIds: string[]): number {
  const clear = db.prepare('UPDATE prd_assignments SET pay_run_line_id = NULL WHERE pay_run_line_id = ?');
  return payRunLineIds.reduce((n, id) => n + clear.run(id).changes, 0);
}
