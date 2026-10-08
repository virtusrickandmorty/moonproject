/** PRD contract for other modules (RATE, PAY, DASH, RPT). Callers check their own route permission. */
import { conflict } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';

export { COMPLEXITIES, listSteps, stepById, type Complexity, type Step } from './production.ts';
export { board } from './production.ts';
import { lineRoute, routeDone } from './production.ts';
import { lineState } from '../JO/public.ts';

/**
 * Each line's production, for releasing what is ready (JO): 'done' when every step of its route is closed, 'in_production'
 * while one is not, 'none' when the line has no route (nothing to make, or not set up yet).
 */
export function lineProduction(db: Db, jobOrderId: string): Map<number, 'done' | 'in_production' | 'none'> {
  return new Map(lineState(db, jobOrderId).map((l) => {
    const route = lineRoute(db, jobOrderId, l.lineNo);
    return [l.lineNo, route === null ? 'none' : routeDone(route) ? 'done' : 'in_production'] as const;
  }));
}

/** Current route names and status for a production job ticket. */
export function jobTicketRoute(db: Db, jobOrderId: string, lineNo: number) {
  return lineRoute(db, jobOrderId, lineNo)?.map(({ name, status }) => ({ name, status })) ?? [];
}

/** Recorded (not cancelled) production entries of one job order, e.g. to block cancelling an opening job order (JO). */
export function entriesOf(db: Db, jobOrderId: string): { id: string; number: string }[] {
  return db
    .prepare(`SELECT d.id, d.number FROM prd_entries e JOIN documents d ON d.id = e.document_id WHERE e.job_order_id = ? AND d.status = 'posted' ORDER BY d.number`)
    .all(jobOrderId) as { id: string; number: string }[];
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

/** Rows recorded as a different sheet despite matching an earlier one (B2-F3), with the reason typed; PAY lists them. */
export function repeatedAssignments(db: Db, assignmentIds: string[]): { id: string; reason: string }[] {
  if (assignmentIds.length === 0) return [];
  return db
    .prepare('SELECT assignment_id AS id, reason FROM prd_assignment_repeats WHERE assignment_id IN (SELECT value FROM json_each(?)) ORDER BY assignment_id')
    .all(JSON.stringify(assignmentIds)) as { id: string; reason: string }[];
}

/**
 * Piece earnings per day of one worker, paid or not (work and rework of recorded entries; corrections are left out,
 * since they fix an earlier day). PAY averages them for a piece worker's regular-holiday pay (F1).
 */
export function pieceEarningsByDay(db: Db, employeeId: string, from: string, to: string): { date: string; amountCents: number }[] {
  return db
    .prepare(
      `SELECT a.work_date AS date, SUM(a.amount_cents) AS amountCents FROM prd_assignments a JOIN documents d ON d.id = a.document_id
       WHERE d.status = 'posted' AND a.employee_id = ? AND a.kind IN ('work', 'rework') AND a.work_date BETWEEN ? AND ? GROUP BY a.work_date ORDER BY a.work_date`,
    )
    .all(employeeId, from, to) as { date: string; amountCents: number }[];
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

/** Recorded production assignment snapshots for read-only operational reports. */
export function productionReportRows(db: Db, from: string, to: string) {
  return db.prepare(`SELECT a.document_id AS documentId,d.number,a.job_order_id AS jobOrderId,j.number AS jobOrderNumber,
    a.line_no AS lineNo,a.step_id AS stepId,s.code AS stepCode,s.name AS stepName,a.employee_id AS employeeId,
    a.work_date AS workDate,a.kind,a.pieces,a.amount_cents AS amountCents
    FROM prd_assignments a JOIN documents d ON d.id=a.document_id JOIN documents j ON j.id=a.job_order_id
    JOIN prd_steps s ON s.id=a.step_id WHERE d.status='posted' AND a.work_date BETWEEN ? AND ?
    ORDER BY a.work_date,d.number,a.row_no`).all(from,to) as Array<Record<string, string | number>>;
}
