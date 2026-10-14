/**
 * A job order's production summary (the owner's request, Oct 2026): for each item, every step in its order with who made
 * the pieces, how many, which part of a set, the wearers ticked, on which entry and date, and whether it is paid. The
 * owner and the accountant may move a row to another worker while its entry is not paid yet (reassignWorker).
 */
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { reissueDocument, type Actor, type EngineEnv } from '../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../engine/documents/registry.ts';
import { currentStage, jobOrderRef, lineState, rosterOf } from '../JO/public.ts';
import { lineDone, lineRoute, lineSetup } from './production.ts';

export interface SummaryRow {
  assignmentId: string; entryId: string; entryNumber: string; rowNo: number; workDate: string;
  employeeId: string; employeeName: string; kind: 'work' | 'rework' | 'correction'; pieces: number; part: 'whole' | 'upper' | 'lower';
  wearers: string[]; paid: boolean; carried: boolean;
}

export function jobSummary(db: Db, jobOrderId: string) {
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('The job order');
  const rowsOf = db.prepare(`SELECT a.id AS assignmentId, a.document_id AS entryId, d.number AS entryNumber, a.row_no AS rowNo, a.work_date AS workDate,
      a.employee_id AS employeeId, a.employee_name AS employeeName, a.kind, a.pieces, a.part, a.step_id AS stepId,
      a.pay_run_line_id IS NOT NULL AS paid, a.job_order_id <> a.jo AS carried
    FROM prd_line_assignments a JOIN documents d ON d.id = a.document_id
    WHERE a.jo = ? AND a.line = ? AND d.status = 'posted' ORDER BY a.work_date, d.number, a.row_no`);
  const wearersOf = db.prepare('SELECT roster_row_no FROM prd_line_assignment_wearers WHERE assignment_id = ? AND jo = ? AND line = ? ORDER BY roster_row_no').pluck();
  const lines = lineState(db, jobOrderId).map((l) => {
    const route = lineRoute(db, jobOrderId, l.lineNo);
    const roster = rosterOf(db, jobOrderId, l.lineNo);
    const nameOf = new Map(roster.map((w) => [w.rowNo, [w.wearerName, w.size && (w.lowerSize ? `${w.size}/${w.lowerSize}` : w.size), w.jerseyNumber && `#${w.jerseyNumber}`].filter(Boolean).join(' · ')]));
    const rows = (rowsOf.all(jobOrderId, l.lineNo) as (Omit<SummaryRow, 'wearers' | 'paid' | 'carried'> & { stepId: number; paid: number; carried: number })[])
      .map(({ paid, carried, ...r }) => ({ ...r, paid: paid === 1, carried: carried === 1,
        wearers: (wearersOf.all(r.assignmentId, jobOrderId, l.lineNo) as number[]).map((n) => nameOf.get(n) ?? `Row ${n}`) }));
    return {
      lineNo: l.lineNo, description: l.description, qty: l.qty, isSet: lineSetup(db, jobOrderId, l.lineNo)?.isSet ?? false,
      done: lineDone(db, jobOrderId, l.lineNo, route),
      steps: (route ?? []).map((s) => ({ stepId: s.id, name: s.name, status: s.status, rows: rows.filter((r) => r.stepId === s.id).map(({ stepId: _, ...r }) => r) })),
    };
  });
  return {
    jobOrder: { id: jo.id, number: jo.number, customerName: jo.customerName, dueDate: jo.dueDate, stage: currentStage(db, jo.id) },
    allDone: lines.length > 0 && lines.every((l) => l.done), lines,
  };
}

/**
 * Moves one row of a production entry to another worker: the entry is edited (cancelled and recorded again, the same work
 * with the worker changed, PE numbers and the audit keeping both). Refused once any row of the entry is paid: the pay of
 * two people would change after it went out (a correction in the next payroll run is the way then).
 */
export function reassignWorker(env: EngineEnv, def: DocTypeDef, actor: Actor, entryId: string, req: { rowNo: number; employeeId: string; reason: string }) {
  const { db } = env;
  const head = db.prepare("SELECT number, status FROM documents WHERE id = ? AND doc_type = 'prd.entry'").get(entryId) as { number: string; status: string } | undefined;
  if (!head) throw notFound('The production entry');
  if (head.status !== 'posted') throw conflict('CANCELLED', `${head.number} was cancelled or edited already. Open the summary again.`);
  const jo = db.prepare("SELECT j.number, j.status FROM prd_entries e JOIN documents j ON j.id = e.job_order_id WHERE e.document_id = ?").get(entryId) as { number: string; status: string };
  if (jo.status !== 'posted') throw conflict('EARLIER_VERSION', `${head.number} was recorded on ${jo.number}, before that job order was edited, so its worker cannot be changed now.`);
  if (db.prepare('SELECT 1 FROM prd_assignments WHERE document_id = ? AND pay_run_line_id IS NOT NULL LIMIT 1').get(entryId)) {
    throw conflict('PAID', `${head.number} is already paid in a payroll run, so its worker cannot be changed here. Correct it in the next payroll run.`);
  }
  const doc = def.load(db, entryId) as { totalCents: number; rows: { rowNo: number; employeeId: string; employeeName: string }[] };
  const row = doc.rows.find((r) => r.rowNo === req.rowNo);
  if (!row) throw notFound(`Row ${req.rowNo} of ${head.number}`);
  if (row.employeeId === req.employeeId) throw new AppError('SAME_WORKER', `Row ${req.rowNo} of ${head.number} is already ${row.employeeName}'s.`, 400);
  const input = def.toInput(doc) as { rows: { employeeId: string }[] };
  input.rows = input.rows.map((r, i) => (i === req.rowNo - 1 ? { ...r, employeeId: req.employeeId } : r));
  return reissueDocument(env, def, actor, entryId, { input, expectedTotalCents: doc.totalCents, reason: `Worker changed on row ${req.rowNo} (was ${row.employeeName}): ${req.reason.trim()}` });
}
