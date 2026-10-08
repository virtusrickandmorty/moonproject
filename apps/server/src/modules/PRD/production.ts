/**
 * Production (PLAN E7): the step catalogue, each JO line's route and step status, the board, and the JO stage it drives.
 * Routes and statuses are operational data, changed in place with an audit row (OWN-21) as new insert-only rows; a
 * step's status is read from its latest event and the pieces recorded on it.
 */
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentStage, jobOrderRef, jobOrdersOf, lineState, productionMove, rosterOf, stagesAll } from '../JO/public.ts';
import { matchCatalogItem } from '../CAT/public.ts';

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

/** `isSet`: made as an upper and a lower part (a set on the price list). */
export interface LineSetup { seq: number; templateId: number | null; garmentType: string; complexity: Complexity; isSet: boolean; stepIds: number[] }
export type Part = 'whole' | 'upper' | 'lower';
export const SET_PARTS = ['upper', 'lower'] as const;

/** A JO line's current setup: route, garment type and complexity (the latest row). */
export function lineSetup(db: Db, jobOrderId: string, lineNo: number): LineSetup | undefined {
  const r = db
    .prepare(
      `SELECT seq, template_id AS templateId, garment_type AS garmentType, complexity, is_set AS isSet FROM prd_line_setups
       WHERE job_order_id = ? AND line_no = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(jobOrderId, lineNo) as (Omit<LineSetup, 'stepIds' | 'isSet'> & { isSet: number }) | undefined;
  if (!r) return undefined;
  const stepIds = db
    .prepare('SELECT x.step_id FROM prd_line_setup_steps x JOIN prd_steps s ON s.id = x.step_id WHERE x.job_order_id = ? AND x.line_no = ? AND x.seq = ? ORDER BY s.seq')
    .pluck()
    .all(jobOrderId, lineNo, r.seq) as number[];
  return { ...r, isSet: r.isSet === 1, stepIds };
}

/**
 * Pieces recorded on one step of a JO line by recorded entries: work net of corrections, and rework (pasubra) apart. A
 * part ('upper' or 'lower' of a set) counts that part only; none counts every row.
 */
export function piecesOn(db: Db, jobOrderId: string, lineNo: number, stepId: number, part?: Part): { pieces: number; reworkPieces: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN a.kind <> 'rework' THEN a.pieces END), 0) AS pieces, COALESCE(SUM(CASE WHEN a.kind = 'rework' THEN a.pieces END), 0) AS reworkPieces
       FROM prd_assignments a JOIN documents d ON d.id = a.document_id
       WHERE a.job_order_id = ? AND a.line_no = ? AND a.step_id = ? AND d.status = 'posted' AND (? IS NULL OR a.part = ?)`,
    )
    .get(jobOrderId, lineNo, stepId, part ?? null, part ?? null) as { pieces: number; reworkPieces: number };
}

/**
 * The wearers already done on one step of a JO line, by recorded entries (roster row → the entry that ticked it): the
 * owner's request, Oct 2026. A cancelled entry's wearers are free again.
 */
export function wearersDone(db: Db, jobOrderId: string, lineNo: number, stepId: number, part: Part = 'whole'): Map<number, string> {
  const rows = db.prepare(`SELECT w.roster_row_no AS rowNo, d.number FROM prd_assignment_wearers w JOIN prd_assignments a ON a.id = w.assignment_id
    JOIN documents d ON d.id = a.document_id WHERE a.job_order_id = ? AND a.line_no = ? AND a.step_id = ? AND a.part = ? AND d.status = 'posted'`).all(jobOrderId, lineNo, stepId, part) as { rowNo: number; number: string }[];
  return new Map(rows.map((r) => [r.rowNo, r.number]));
}

/**
 * `pieces` of a set are its complete sets: the fewer of its upper and lower parts done; `parts` has each part's own count
 * (null on a line made as one piece).
 */
export interface RouteStep extends Step { status: StepStatus; pieces: number; reworkPieces: number; parts: Record<'upper' | 'lower', { pieces: number; reworkPieces: number }> | null }

/** The line's route in canonical order with each step's status, or null before the line is set up. */
export function lineRoute(db: Db, jobOrderId: string, lineNo: number): RouteStep[] | null {
  const setup = lineSetup(db, jobOrderId, lineNo);
  if (!setup) return null;
  const last = db.prepare('SELECT action FROM prd_step_events WHERE job_order_id = ? AND line_no = ? AND step_id = ? ORDER BY seq DESC LIMIT 1').pluck();
  return setup.stepIds.map((id) => {
    const step = stepById(db, id)!;
    const all = piecesOn(db, jobOrderId, lineNo, id);
    const parts = setup.isSet ? { upper: piecesOn(db, jobOrderId, lineNo, id, 'upper'), lower: piecesOn(db, jobOrderId, lineNo, id, 'lower') } : null;
    const done = parts ? { pieces: Math.min(parts.upper.pieces, parts.lower.pieces), reworkPieces: all.reworkPieces } : all;
    const action = last.get(jobOrderId, lineNo, id) as string | undefined;
    const status: StepStatus = action === 'complete' ? 'completed' : action === 'not_needed' ? 'not_needed' : all.pieces !== 0 || all.reworkPieces > 0 ? 'in_progress' : 'pending';
    return { ...step, status, ...done, parts };
  });
}

const closed = (s: { status: StepStatus }) => s.status === 'completed' || s.status === 'not_needed';
export const routeDone = (route: RouteStep[]) => route.length > 0 && route.every(closed);

/**
 * Pieces that came out of the step before this one (E7 rule 1): the previous step on the route that is needed. All of the
 * line once that step is completed (or when there is none), else the pieces recorded on it.
 */
export function availableFor(route: RouteStep[], stepId: number, lineQty: number, part: Part = 'whole'): number {
  const i = route.findIndex((s) => s.id === stepId);
  const prev = route.slice(0, Math.max(0, i)).reverse().find((s) => s.status !== 'not_needed');
  if (!prev || prev.status === 'completed') return lineQty;
  const came = part !== 'whole' && prev.parts ? prev.parts[part].pieces : prev.pieces; // a set's part follows that part
  return Math.min(lineQty, Math.max(0, came));
}

/**
 * Rework sent back to one step of a line and not redone yet (the owner's request, Oct 2026): the pieces sent back less the
 * rework (pasubra) pieces recorded there since; with a wearer list, the wearers sent back with no rework ticked for them
 * since. The pieces done there before stay as recorded.
 */
export function reworkOpen(db: Db, jobOrderId: string, lineNo: number, stepId: number, part: Part = 'whole'): { pieces: number; wearers: number[] } {
  const sent = db.prepare('SELECT COALESCE(SUM(pieces), 0) AS pieces, MIN(at) AS since FROM prd_reworks WHERE job_order_id = ? AND line_no = ? AND step_id = ? AND part = ?')
    .get(jobOrderId, lineNo, stepId, part) as { pieces: number; since: string | null };
  if (sent.since === null) return { pieces: 0, wearers: [] };
  const redone = db.prepare(`SELECT COALESCE(SUM(a.pieces), 0) FROM prd_assignments a JOIN documents d ON d.id = a.document_id
    WHERE a.job_order_id = ? AND a.line_no = ? AND a.step_id = ? AND a.part = ? AND a.kind = 'rework' AND d.status = 'posted' AND d.posted_at >= ?`)
    .pluck().get(jobOrderId, lineNo, stepId, part, sent.since) as number;
  const wearers = db.prepare(`SELECT DISTINCT w.roster_row_no FROM prd_rework_wearers w JOIN prd_reworks r ON r.id = w.rework_id
    WHERE r.job_order_id = ? AND r.line_no = ? AND r.step_id = ? AND r.part = ? AND NOT EXISTS (
      SELECT 1 FROM prd_assignment_wearers x JOIN prd_assignments a ON a.id = x.assignment_id JOIN documents d ON d.id = a.document_id
      WHERE a.job_order_id = r.job_order_id AND a.line_no = r.line_no AND a.step_id = r.step_id AND a.part = r.part AND a.kind = 'rework'
        AND d.status = 'posted' AND d.posted_at >= r.at AND x.roster_row_no = w.roster_row_no)
    ORDER BY w.roster_row_no`).pluck().all(jobOrderId, lineNo, stepId, part) as number[];
  return { pieces: Math.max(0, sent.pieces - redone), wearers };
}

/** Rework still open on one step, in pieces of the line (a set counts the more of its parts). */
export const stepReworkOpen = (db: Db, jobOrderId: string, lineNo: number, s: RouteStep) => reworkOpen(db, jobOrderId, lineNo, s.id).pieces
  + (s.parts ? Math.max(reworkOpen(db, jobOrderId, lineNo, s.id, 'upper').pieces, reworkOpen(db, jobOrderId, lineNo, s.id, 'lower').pieces) : 0);

/** Rework still open on any step of a line, in pieces of the line. */
export const lineReworkOpen = (db: Db, jobOrderId: string, lineNo: number, route: RouteStep[] | null) =>
  (route ?? []).reduce((n, s) => n + stepReworkOpen(db, jobOrderId, lineNo, s), 0);

/** Every step of the line is closed and no rework is open on it. */
export const lineDone = (db: Db, jobOrderId: string, lineNo: number, route: RouteStep[] | null) =>
  route !== null && routeDone(route) && lineReworkOpen(db, jobOrderId, lineNo, route) === 0;

/**
 * The pieces of a line that went through every step (they can go out first): all once every step is done, else those
 * done on its last needed step; less the rework still open on it. Null: the line has no route.
 */
export function lineFinished(db: Db, jobOrderId: string, lineNo: number, qty: number, route: RouteStep[] | null): number | null {
  if (route === null) return null;
  const through = routeDone(route) ? qty : Math.min(qty, [...route].reverse().find((s) => s.status !== 'not_needed')?.pieces ?? 0);
  return Math.max(0, through - lineReworkOpen(db, jobOrderId, lineNo, route));
}

/**
 * The wearers forwarded to a step (the owner's request, Oct 2026: a step's wearer list shows only those): the wearers done
 * on the step before that is needed, less any sent back for rework to it or an earlier step. Null: every wearer (the first
 * step, the step before is completed, or pieces were recorded there without ticking wearers, so who is unknown).
 */
export function forwardedWearers(db: Db, jobOrderId: string, lineNo: number, route: RouteStep[], stepId: number, part: Part = 'whole'): number[] | null {
  const i = route.findIndex((s) => s.id === stepId);
  const prev = route.slice(0, Math.max(0, i)).reverse().find((s) => s.status !== 'not_needed');
  if (!prev || prev.status === 'completed') return null;
  const roster = new Map(rosterOf(db, jobOrderId, lineNo).map((w) => [w.rowNo, w.qty]));
  const done = [...wearersDone(db, jobOrderId, lineNo, prev.id, part).keys()];
  const prevPieces = part !== 'whole' && prev.parts ? prev.parts[part].pieces : prev.pieces;
  if (done.reduce((n, w) => n + (roster.get(w) ?? 0), 0) < prevPieces) return null;
  const back = new Set(route.slice(0, i).flatMap((s) => reworkOpen(db, jobOrderId, lineNo, s.id, part).wearers));
  return done.filter((w) => !back.has(w)).sort((a, b) => a - b);
}

/**
 * Moves the JO (E7 rule 3): Ready when every line's route is done; In production once any step has started, or when a
 * Ready JO is no longer done (a step reopened or added).
 */
export function syncStage(db: Db, jobOrderId: string, reason: string, who: Who): void {
  const lines = lineState(db, jobOrderId).map((l) => ({ lineNo: l.lineNo, route: lineRoute(db, jobOrderId, l.lineNo) }));
  const routes = lines.map((l) => l.route);
  if (lines.every((l) => lineDone(db, jobOrderId, l.lineNo, l.route))) productionMove(db, jobOrderId, 'ready', reason, who);
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

/** `garmentType`: none takes it from the price list item the line matches (the owner's request, Oct 2026), which also says whether it is a set. */
export interface SetupRequest { templateId?: number | undefined; stepIds: number[]; garmentType?: string | undefined; complexity: Complexity }

/** Sets a line's route, garment type and complexity. Steps keep the canonical order; a step with pieces stays on. */
export function setupLine(db: Db, jobOrderId: string, lineNo: number, req: SetupRequest, who: Who): RouteStep[] {
  recordedJo(db, jobOrderId);
  const theLine = lineOf(db, jobOrderId, lineNo);
  const before = lineSetup(db, jobOrderId, lineNo);
  const matched = matchCatalogItem(db, theLine.description);
  const garmentType = (req.garmentType?.trim() || matched?.garmentType || theLine.description).slice(0, 60);
  const isSet = matched?.unit === 'set';
  if (before?.isSet && !isSet) {
    // A line made in parts keeps its parts while pieces of a part are recorded on it.
    const parted = db.prepare(`SELECT 1 FROM prd_assignments a JOIN documents d ON d.id = a.document_id WHERE a.job_order_id = ? AND a.line_no = ? AND a.part <> 'whole' AND d.status = 'posted' LIMIT 1`).get(jobOrderId, lineNo);
    if (parted) throw conflict('PARTS_RECORDED', `Line ${lineNo} has upper and lower pieces recorded, so it stays a set.`);
  }
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
  db.prepare('INSERT INTO prd_line_setups (job_order_id, line_no, seq, template_id, garment_type, complexity, is_set, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    jobOrderId, lineNo, seq, req.templateId ?? null, garmentType, req.complexity, isSet ? 1 : 0, who.at, who.userId,
  );
  const step = db.prepare('INSERT INTO prd_line_setup_steps (job_order_id, line_no, seq, step_id) VALUES (?, ?, ?, ?)');
  for (const id of ids) step.run(jobOrderId, lineNo, seq, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.setup', entityType: 'jo.job_order', entityId: jobOrderId, data: { lineNo, seq, ...req, garmentType, isSet, stepIds: ids } });
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
    if (action === 'complete' && step.parts && step.pieces < line.qty) {
      throw conflict('PIECES_SHORT', `${step.name} on line ${lineNo} has ${step.parts.upper.pieces} of ${line.qty} upper and ${step.parts.lower.pieces} of ${line.qty} lower parts done. Record the rest of both first, or mark it Not needed if no piece goes through it.`);
    }
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

/** `wearers`: the wearers sent back (their pieces are then the pieces); `part`: on a set, the upper or the lower part. */
export interface ReworkRequest { pieces?: number | undefined; wearers?: number[] | undefined; part?: 'upper' | 'lower' | undefined; reason: string }

/**
 * Sends pieces back for rework to a step they went through (the owner's request, Oct 2026). The pieces done there stay
 * recorded; the step shows them as rework to do until rework (pasubra) pieces are recorded on it, and they are held back
 * from release meanwhile.
 */
export function sendBackForRework(db: Db, jobOrderId: string, lineNo: number, stepId: number, req: ReworkRequest, who: Who): RouteStep[] {
  const jo = recordedJo(db, jobOrderId);
  const line = lineOf(db, jobOrderId, lineNo);
  const route = lineRoute(db, jobOrderId, lineNo);
  if (!route) throw conflict('NO_ROUTE', `Line ${lineNo} of ${jo.number} has no route yet. Set it up first.`);
  const step = route.find((s) => s.id === stepId);
  if (!step) throw conflict('NOT_ON_ROUTE', `That step is not on the route of line ${lineNo}.`);
  const why = req.reason.trim();
  if (why.length < 10) throw new AppError('REASON_REQUIRED', 'Say what needs rework, in at least 10 characters.', 400);
  if (step.parts && !req.part) throw new AppError('PART_REQUIRED', `Line ${lineNo} is a set. Pick the upper or the lower part.`, 400);
  if (!step.parts && req.part) throw new AppError('PART_NOT_SET', `Line ${lineNo} is not a set, so it has no upper or lower part.`, 400);
  const part: Part = req.part ?? 'whole';
  const done = part !== 'whole' && step.parts ? step.parts[part].pieces : step.pieces;
  const open = reworkOpen(db, jobOrderId, lineNo, stepId, part);
  const of = part !== 'whole' ? `${part} parts` : 'pieces';
  let pieces = req.pieces ?? 0;
  const wearers = [...new Set(req.wearers ?? [])].sort((a, b) => a - b);
  if (wearers.length > 0) {
    const roster = new Map(rosterOf(db, jobOrderId, lineNo).map((w) => [w.rowNo, w]));
    const doneHere = wearersDone(db, jobOrderId, lineNo, stepId, part);
    pieces = 0;
    for (const n of wearers) {
      const w = roster.get(n);
      if (!w) throw new AppError('WEARER', `Line ${lineNo} has no wearer ${n}.`, 400);
      if (!doneHere.has(n)) throw conflict('WEARER_NOT_DONE', `${w.wearerName} is not done on ${step.name} yet, so there is nothing to send back.`);
      if (open.wearers.includes(n)) throw conflict('WEARER_IN_REWORK', `${w.wearerName} is already sent back to ${step.name} for rework.`);
      pieces += w.qty;
    }
  }
  if (!Number.isInteger(pieces) || pieces < 1) throw new AppError('PIECES', 'Type how many pieces need rework, or tick the wearers.', 400);
  if (pieces > done - open.pieces) {
    throw conflict('REWORK_OVER', `${step.name} of line ${lineNo} has ${done} ${of} done${open.pieces ? ` and ${open.pieces} already sent back` : ''}, so at most ${Math.max(0, done - open.pieces)} can go back for rework.`);
  }
  if (pieces > line.qty - line.releasedQty) throw conflict('RELEASED', `Only ${line.qty - line.releasedQty} pieces of line ${lineNo} are not released yet.`);
  const id = newId();
  db.prepare('INSERT INTO prd_reworks (id, job_order_id, line_no, step_id, part, pieces, reason, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, jobOrderId, lineNo, stepId, part, pieces, why, who.at, who.userId);
  for (const n of wearers) db.prepare('INSERT INTO prd_rework_wearers (rework_id, roster_row_no) VALUES (?, ?)').run(id, n);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.rework', entityType: 'jo.job_order', entityId: jobOrderId, data: { id, lineNo, stepId, part, pieces, wearers, reason: why } });
  syncStage(db, jobOrderId, `${pieces} ${of} of line ${lineNo} sent back to ${step.name} for rework`, who);
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
          ready: lineDone(db, jo.id, l.lineNo, route),
          // The pieces that went through every step (the owner's request, Oct 2026: they can go out first), less open rework.
          finishedPieces: lineFinished(db, jo.id, l.lineNo, l.qty, route) ?? 0,
          // receivedPieces: what came out of the step before (all of the line once that one is closed, or for the first step).
          isSet: setup?.isSet ?? false,
          // reworkOpen: pieces sent back to the step for rework and not redone yet (shown there labelled rework).
          steps: route?.map((s) => ({ stepId: s.id, status: s.status, pieces: s.pieces, reworkPieces: s.reworkPieces, receivedPieces: availableFor(route, s.id, l.qty),
            reworkOpen: stepReworkOpen(db, jo.id, l.lineNo, s),
            ...(s.parts ? { parts: { upper: s.parts.upper.pieces, lower: s.parts.lower.pieces } } : {}) })) ?? null,
        };
      });
  });
}
