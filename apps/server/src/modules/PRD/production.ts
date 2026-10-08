/**
 * Production (PLAN E7): the step catalogue, each JO line's route and step status, the board, and the JO stage it drives.
 * Routes and statuses are operational data, changed in place with an audit row (OWN-21) as new insert-only rows; a
 * step's status is read from its latest event and the pieces recorded on it.
 */
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentStage, jobOrderRef, jobOrdersOf, lineState, productionMove, stagesAll } from '../JO/public.ts';

export const COMPLEXITIES = ['simple', 'standard', 'complex'] as const;
export type Complexity = (typeof COMPLEXITIES)[number];
export type PayBasis = 'piece' | 'daily' | 'piece_or_daily';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'not_needed';
export interface Step { id: number; code: string; name: string; seq: number; payBasis: PayBasis; isActive: boolean; version: number }
export interface Who { userId: string; at: string }

const STEP = 'SELECT id, code, name, seq, pay_basis AS payBasis, is_active AS isActive, version FROM prd_steps';
type StepRow = Omit<Step, 'isActive'> & { isActive: number };
const asStep = (r: StepRow): Step => ({ ...r, isActive: r.isActive === 1 });

export const listSteps = (db: Db): Step[] => (db.prepare(`${STEP} ORDER BY seq`).all() as StepRow[]).map(asStep);
export function stepById(db: Db, id: number): Step | undefined {
  const r = db.prepare(`${STEP} WHERE id = ?`).get(id) as StepRow | undefined;
  return r && asStep(r);
}

/** Route templates (seed T1–T6) with their steps in canonical order. */
export function listTemplates(db: Db): { id: number; code: string; name: string; stepIds: number[] }[] {
  const steps = db.prepare('SELECT t.step_id FROM prd_route_template_steps t JOIN prd_steps s ON s.id = t.step_id WHERE t.template_id = ? ORDER BY s.seq').pluck();
  return (db.prepare('SELECT id, code, name FROM prd_route_templates ORDER BY code').all() as { id: number; code: string; name: string }[]).map((t) => ({ ...t, stepIds: steps.all(t.id) as number[] }));
}

export interface LineSetup { seq: number; templateId: number | null; garmentType: string; complexity: Complexity; stepIds: number[] }

/** A JO line's current setup: route, garment type and complexity (the latest row). */
export function lineSetup(db: Db, jobOrderId: string, lineNo: number): LineSetup | undefined {
  const r = db
    .prepare(
      `SELECT seq, template_id AS templateId, garment_type AS garmentType, complexity FROM prd_line_setups
       WHERE job_order_id = ? AND line_no = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(jobOrderId, lineNo) as Omit<LineSetup, 'stepIds'> | undefined;
  if (!r) return undefined;
  const stepIds = db
    .prepare('SELECT x.step_id FROM prd_line_setup_steps x JOIN prd_steps s ON s.id = x.step_id WHERE x.job_order_id = ? AND x.line_no = ? AND x.seq = ? ORDER BY s.seq')
    .pluck()
    .all(jobOrderId, lineNo, r.seq) as number[];
  return { ...r, stepIds };
}

/** Pieces recorded on one step of a JO line by recorded entries: work net of corrections, and rework (pasubra) apart. */
export function piecesOn(db: Db, jobOrderId: string, lineNo: number, stepId: number): { pieces: number; reworkPieces: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN a.kind <> 'rework' THEN a.pieces END), 0) AS pieces, COALESCE(SUM(CASE WHEN a.kind = 'rework' THEN a.pieces END), 0) AS reworkPieces
       FROM prd_assignments a JOIN documents d ON d.id = a.document_id
       WHERE a.job_order_id = ? AND a.line_no = ? AND a.step_id = ? AND d.status = 'posted'`,
    )
    .get(jobOrderId, lineNo, stepId) as { pieces: number; reworkPieces: number };
}

export interface RouteStep extends Step { status: StepStatus; pieces: number; reworkPieces: number }

/** The line's route in canonical order with each step's status, or null before the line is set up. */
export function lineRoute(db: Db, jobOrderId: string, lineNo: number): RouteStep[] | null {
  const setup = lineSetup(db, jobOrderId, lineNo);
  if (!setup) return null;
  const last = db.prepare('SELECT action FROM prd_step_events WHERE job_order_id = ? AND line_no = ? AND step_id = ? ORDER BY seq DESC LIMIT 1').pluck();
  return setup.stepIds.map((id) => {
    const step = stepById(db, id)!;
    const done = piecesOn(db, jobOrderId, lineNo, id);
    const action = last.get(jobOrderId, lineNo, id) as string | undefined;
    const status: StepStatus = action === 'complete' ? 'completed' : action === 'not_needed' ? 'not_needed' : done.pieces > 0 || done.reworkPieces > 0 ? 'in_progress' : 'pending';
    return { ...step, status, ...done };
  });
}

const closed = (s: { status: StepStatus }) => s.status === 'completed' || s.status === 'not_needed';
export const routeDone = (route: RouteStep[]) => route.length > 0 && route.every(closed);

/**
 * Pieces that came out of the step before this one (E7 rule 1): the previous step on the route that is needed. All of the
 * line once that step is completed (or when there is none), else the pieces recorded on it.
 */
export function availableFor(route: RouteStep[], stepId: number, lineQty: number): number {
  const i = route.findIndex((s) => s.id === stepId);
  const prev = route.slice(0, Math.max(0, i)).reverse().find((s) => s.status !== 'not_needed');
  if (!prev || prev.status === 'completed') return lineQty;
  return Math.min(lineQty, Math.max(0, prev.pieces));
}

/**
 * Moves the JO (E7 rule 3): Ready when every line's route is done; In production once any step has started, or when a
 * Ready JO is no longer done (a step reopened or added).
 */
export function syncStage(db: Db, jobOrderId: string, reason: string, who: Who): void {
  const routes = lineState(db, jobOrderId).map((l) => lineRoute(db, jobOrderId, l.lineNo));
  if (routes.every((r) => r !== null && routeDone(r))) productionMove(db, jobOrderId, 'ready', reason, who);
  else if (routes.some((r) => r?.some((s) => s.status !== 'pending')) || currentStage(db, jobOrderId) === 'ready') productionMove(db, jobOrderId, 'in_production', reason, who);
}

function recordedJo(db: Db, jobOrderId: string) {
  const jo = jobOrderRef(db, jobOrderId);
  if (!jo) throw notFound('The job order');
  if (jo.status !== 'posted') throw conflict('JO_CANCELLED', `${jo.number} is cancelled, so its production cannot change.`);
  return jo;
}
function lineOf(db: Db, jobOrderId: string, lineNo: number) {
  const line = lineState(db, jobOrderId).find((l) => l.lineNo === lineNo);
  if (!line) throw notFound('The job order line');
  return line;
}

export interface SetupRequest { templateId?: number | undefined; stepIds: number[]; garmentType: string; complexity: Complexity }

/** Sets a line's route, garment type and complexity. Steps keep the canonical order; a step with pieces stays on. */
export function setupLine(db: Db, jobOrderId: string, lineNo: number, req: SetupRequest, who: Who): RouteStep[] {
  recordedJo(db, jobOrderId);
  lineOf(db, jobOrderId, lineNo);
  const before = lineSetup(db, jobOrderId, lineNo);
  const ids = [...new Set(req.stepIds)];
  if (ids.length === 0) throw new AppError('NO_STEPS', 'Pick at least one step.', 400);
  for (const id of ids) {
    const s = stepById(db, id);
    if (!s) throw new AppError('STEP', 'Pick steps from the list.', 400);
    if (!s.isActive && !before?.stepIds.includes(id)) throw new AppError('STEP_OFF', `${s.name} is switched off. Ask the owner to switch it on first.`, 400);
  }
  if (req.templateId !== undefined && !listTemplates(db).some((t) => t.id === req.templateId)) throw new AppError('TEMPLATE', 'Pick a route template from the list.', 400);
  for (const id of before?.stepIds.filter((x) => !ids.includes(x)) ?? []) {
    const done = piecesOn(db, jobOrderId, lineNo, id);
    if (done.pieces !== 0 || done.reworkPieces !== 0) throw conflict('STEP_HAS_PIECES', `${stepById(db, id)!.name} has pieces recorded on line ${lineNo}, so it stays on the route.`);
  }
  const seq = (before?.seq ?? 0) + 1;
  db.prepare('INSERT INTO prd_line_setups (job_order_id, line_no, seq, template_id, garment_type, complexity, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    jobOrderId, lineNo, seq, req.templateId ?? null, req.garmentType, req.complexity, who.at, who.userId,
  );
  const step = db.prepare('INSERT INTO prd_line_setup_steps (job_order_id, line_no, seq, step_id) VALUES (?, ?, ?, ?)');
  for (const id of ids) step.run(jobOrderId, lineNo, seq, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.setup', entityType: 'jo.job_order', entityId: jobOrderId, data: { lineNo, seq, ...req, stepIds: ids } });
  syncStage(db, jobOrderId, `Route of line ${lineNo} changed`, who);
  return lineRoute(db, jobOrderId, lineNo)!;
}

export type StepAction = 'complete' | 'not_needed' | 'reopen';
const DONE_WORDS: Record<StepAction, string> = { complete: 'completed', not_needed: 'marked not needed', reopen: 'reopened' };

/**
 * Complete, Not needed or Reopen (reason) one step of a line (E7). Complete needs every piece of the line recorded on the
 * step; Reopen is allowed until the line is released.
 */
export function stepAction(db: Db, jobOrderId: string, lineNo: number, stepId: number, action: StepAction, reason: string | undefined, who: Who): RouteStep[] {
  const jo = recordedJo(db, jobOrderId);
  const line = lineOf(db, jobOrderId, lineNo);
  const route = lineRoute(db, jobOrderId, lineNo);
  if (!route) throw conflict('NO_ROUTE', `Line ${lineNo} of ${jo.number} has no route yet. Set it up first.`);
  const step = route.find((s) => s.id === stepId);
  if (!step) throw conflict('NOT_ON_ROUTE', `That step is not on the route of line ${lineNo}.`);
  const why = reason?.trim() ?? '';
  if (action === 'reopen') {
    if (!closed(step)) throw conflict('NOT_CLOSED', `${step.name} on line ${lineNo} is not completed or marked not needed, so there is nothing to reopen.`);
    if (line.releasedQty > 0) throw conflict('RELEASED', `Line ${lineNo} of ${jo.number} is already released, so its steps cannot be reopened.`);
    if (why.length < 10) throw new AppError('REASON_REQUIRED', 'Reopening a step needs a reason of at least 10 characters.', 400);
  } else {
    if (step.status === (action === 'complete' ? 'completed' : 'not_needed')) throw conflict('ALREADY', `${step.name} on line ${lineNo} is already ${DONE_WORDS[action]}.`);
    if (action === 'not_needed' && (step.pieces !== 0 || step.reworkPieces !== 0)) {
      throw conflict('HAS_PIECES', `${step.name} has pieces recorded on line ${lineNo}. Mark it Completed instead, or cancel those entries first.`);
    }
    // The owner's rule (Oct 2026): a step is completed only once all of the line's pieces are recorded on it (rework apart).
    if (action === 'complete' && step.pieces < line.qty) {
      throw conflict('PIECES_SHORT', `${step.name} on line ${lineNo} has ${step.pieces} of ${line.qty} pieces done. Record the other ${line.qty - step.pieces} first, or mark it Not needed if no piece goes through it.`);
    }
  }
  const seq = ((db.prepare('SELECT MAX(seq) FROM prd_step_events WHERE job_order_id = ? AND line_no = ? AND step_id = ?').pluck().get(jobOrderId, lineNo, stepId) as number | null) ?? 0) + 1;
  db.prepare('INSERT INTO prd_step_events (job_order_id, line_no, step_id, seq, action, reason, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    jobOrderId, lineNo, stepId, seq, action, why || null, who.at, who.userId,
  );
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.step', entityType: 'jo.job_order', entityId: jobOrderId, data: { lineNo, stepId, seq, action, reason: why || null } });
  syncStage(db, jobOrderId, `${step.name} of line ${lineNo} ${DONE_WORDS[action]}`, who);
  return lineRoute(db, jobOrderId, lineNo)!;
}

/**
 * The production board (E7): every line still to release of recorded JOs in production, oldest due first, with its route,
 * the step it is at (the first one not closed) and whether it is ready. The screen groups the cards by step.
 */
export function board(db: Db) {
  // Every recorded order's stage in one read: asking once per order costs seconds once the shop has years of finished ones.
  const stages = stagesAll(db);
  return jobOrdersOf(db).flatMap((jo) => {
    const stage = stages.get(jo.id) ?? 'open';
    if (stage === 'released' || stage === 'closed') return []; // (jobOrdersOf lists recorded orders only, so none is cancelled)
    return lineState(db, jo.id)
      .filter((l) => l.qty > l.releasedQty)
      .map((l) => {
        const setup = lineSetup(db, jo.id, l.lineNo);
        const route = lineRoute(db, jo.id, l.lineNo);
        return {
          jobOrderId: jo.id,
          number: jo.number,
          customerName: jo.customerName,
          dueDate: jo.dueDate,
          priority: jo.priority,
          stage,
          lineNo: l.lineNo,
          description: l.description,
          qty: l.qty,
          releasedQty: l.releasedQty,
          garmentType: setup?.garmentType ?? null,
          complexity: setup?.complexity ?? null,
          templateId: setup?.templateId ?? null,
          currentStepId: route?.find((s) => !closed(s))?.id ?? null,
          ready: route !== null && routeDone(route),
          // receivedPieces: what came out of the step before (all of the line once that one is closed, or for the first step).
          steps: route?.map((s) => ({ stepId: s.id, status: s.status, pieces: s.pieces, reworkPieces: s.reworkPieces, receivedPieces: availableFor(route, s.id, l.qty) })) ?? null,
        };
      });
  });
}
