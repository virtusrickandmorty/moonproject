/**
 * Open jobs and checked scans on the floor app (the owner's request, Nov 2026):
 * - The steps a worker does are ticked on their employee page; the floor app lists every open job order with pieces left
 *   on those steps, so a worker sees what is waiting at their station.
 * - On an item with a wearer list, the worker picks the wearers and how many of each they did (on a set, for the upper or
 *   the lower part); each wearer is a row of their own on the Production Entry (a row with one wearer may be part of their
 *   pieces).
 * - What a worker scans and records waits for the production head's check (prd.verify). Approved, it is recorded as a
 *   Production Entry dated the day of the scan, with every rule of Record pieces; only then does it count on the job and
 *   in the worker's pay. Rejected, nothing is recorded and the worker sees why.
 */
import { z } from 'zod';
import { AppError, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import type { EngineEnv } from '../../engine/documents/lifecycle.ts';
import { postDocument, previewDocument } from '../../engine/documents/lifecycle.ts';
import { appendAudit } from '../../engine/audit.ts';
import { activeJobOrders, jobOrderRef, lineState, rosterOf } from '../JO/public.ts';
import { employee } from './emp.ts';
import { entryDoc, type EntryInput } from './doctypes/entry.ts';
import { availableFor, lineRoute, listSteps, stepById, wearerPieces, type Who } from './production.ts';

type Actor = { userId: string; permissions: ReadonlySet<string> };

/** The steps a worker does now (step ids in the steps' order). */
export function workerSteps(db: Db, employeeId: string): number[] {
  const on = new Set(db.prepare(`SELECT w.step_id FROM prd_worker_steps w WHERE w.employee_id = ? AND w.is_on = 1
      AND w.seq = (SELECT MAX(x.seq) FROM prd_worker_steps x WHERE x.employee_id = w.employee_id AND x.step_id = w.step_id)`).pluck().all(employeeId) as number[]);
  return listSteps(db).filter((s) => on.has(s.id)).map((s) => s.id);
}

export const workerStepsBody = z.object({ stepIds: z.array(z.number().int().positive()).max(20) }).strict();

/** Sets the steps a worker does: a row for each step switched on or off. */
export function setWorkerSteps(db: Db, employeeId: string, raw: unknown, who: Who): number[] {
  const { stepIds } = workerStepsBody.parse(raw);
  if (!employee(db, employeeId)) throw notFound('The employee');
  const unknown = stepIds.find((id) => !stepById(db, id));
  if (unknown) throw new AppError('UNKNOWN_STEP', 'That step does not exist. Reload the page and pick again.', 422);
  const before = workerSteps(db, employeeId);
  const ins = db.prepare('INSERT INTO prd_worker_steps (employee_id, step_id, is_on, at, by_user_id) VALUES (?, ?, ?, ?, ?)');
  for (const id of stepIds) if (!before.includes(id)) ins.run(employeeId, id, 1, who.at, who.userId);
  for (const id of before) if (!stepIds.includes(id)) ins.run(employeeId, id, 0, who.at, who.userId);
  const after = workerSteps(db, employeeId);
  if (after.join() !== before.join()) appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.worker_steps', entityType: 'emp.employee', entityId: employeeId, data: { before, after } });
  return after;
}

/** Pieces scanned on a step of a line and still waiting for the check (all workers); on a set, of one part when given. */
export function waitingPieces(db: Db, jobOrderId: string, lineNo: number, stepId: number, part?: 'upper' | 'lower'): number {
  return db.prepare(`SELECT COALESCE(SUM(pieces), 0) FROM prd_floor_claims WHERE job_order_id = ? AND line_no = ? AND step_id = ? AND status = 'waiting'${part ? ' AND part = ?' : ''}`)
    .pluck().get(jobOrderId, lineNo, stepId, ...(part ? [part] : [])) as number;
}

/** Each wearer's pieces on scans still waiting for the check, on one step of a line (roster row → pieces; all workers). */
export function waitingByWearer(db: Db, jobOrderId: string, lineNo: number, stepId: number, part: 'upper' | 'lower' | null = null): Map<number, number> {
  const qty = new Map(rosterOf(db, jobOrderId, lineNo).map((w) => [w.rowNo, w.qty]));
  const rows = db.prepare(`SELECT w.roster_row_no AS rowNo, w.pieces, c.pieces AS claimPieces, (SELECT COUNT(*) FROM prd_floor_claim_wearers x WHERE x.claim_id = c.id) AS n
    FROM prd_floor_claim_wearers w JOIN prd_floor_claims c ON c.id = w.claim_id
    WHERE c.status = 'waiting' AND c.job_order_id = ? AND c.line_no = ? AND c.step_id = ? AND c.part IS ?`).all(jobOrderId, lineNo, stepId, part) as { rowNo: number; pieces: number | null; claimPieces: number; n: number }[];
  const out = new Map<number, number>();
  // A scan from before the counts: one wearer, the scan's pieces; several, all of theirs.
  for (const r of rows) out.set(r.rowNo, (out.get(r.rowNo) ?? 0) + (r.pieces ?? (r.n === 1 ? r.claimPieces : qty.get(r.rowNo) ?? 0)));
  return out;
}

/** The open job orders with pieces left on the worker's steps, rush first, then the earliest due. */
export function openJobsFor(db: Db, employeeId: string) {
  const mine = workerSteps(db, employeeId);
  const steps = listSteps(db).filter((s) => mine.includes(s.id)).map((s) => ({ id: s.id, name: s.name }));
  if (mine.length === 0) return { steps, jobs: [] };
  const jobs = activeJobOrders(db).filter((jo) => jo.stage !== 'released').flatMap((jo) => lineState(db, jo.id).filter((l) => l.qty > l.releasedQty).flatMap((l) => {
    const route = lineRoute(db, jo.id, l.lineNo);
    return (route ?? []).filter((s) => mine.includes(s.id) && s.status !== 'completed' && s.status !== 'not_needed').flatMap((s) => {
      const left = Math.max(0, l.qty - s.pieces);
      if (left === 0) return [];
      // ready: the pieces that came out of the step before and are not done here yet.
      return [{ jobOrderId: jo.id, jobOrderNumber: jo.number, customerName: jo.customerName, dueDate: jo.dueDate, rush: jo.priority === 'rush',
        lineNo: l.lineNo, description: l.description, qty: l.qty, stepId: s.id, stepName: s.name, done: s.pieces, left,
        ready: Math.max(0, availableFor(route!, s.id, l.qty) - s.pieces), waiting: waitingPieces(db, jo.id, l.lineNo, s.id) }];
    });
  }));
  jobs.sort((a, b) => Number(b.rush) - Number(a.rush) || a.dueDate.localeCompare(b.dueDate) || a.jobOrderNumber.localeCompare(b.jobOrderNumber) || a.lineNo - b.lineNo);
  return { steps, jobs };
}

export const floorScanInput = z.object({
  jobOrderId: z.uuid(),
  lineNo: z.number().int().min(1).max(50),
  stepId: z.number().int().positive(),
  pieces: z.number().int().min(1).max(10_000),
  // The wearers the pieces were for and how many of each (their sum is the pieces).
  wearers: z.array(z.object({ rowNo: z.number().int().min(1).max(1000), pieces: z.number().int().min(1).max(10_000) }).strict()).min(1).max(1000).optional(),
  part: z.enum(['upper', 'lower']).optional(),
  // The same pieces on the same line and step already scanned today: a second batch, confirmed by the worker.
  again: z.literal(true).optional(),
}).strict();

interface Claim {
  id: string; employeeId: string; jobOrderId: string; lineNo: number; stepId: number; part: 'upper' | 'lower' | null; pieces: number; again: number;
  workDate: string; at: string; userId: string; status: 'waiting' | 'approved' | 'rejected'; checkedPieces: number | null; reason: string | null; entryId: string | null; checkedAt: string | null; checkedBy: string | null;
}
const CLAIM = `SELECT id, employee_id AS employeeId, job_order_id AS jobOrderId, line_no AS lineNo, step_id AS stepId, part, pieces, again, work_date AS workDate, at,
  user_id AS userId, status, checked_pieces AS checkedPieces, reason, entry_id AS entryId, checked_at AS checkedAt, checked_by AS checkedBy FROM prd_floor_claims`;
type ScanWearer = { rowNo: number; pieces: number | null };
const wearersOf = (db: Db, id: string) => db.prepare('SELECT roster_row_no AS rowNo, pieces FROM prd_floor_claim_wearers WHERE claim_id = ? ORDER BY roster_row_no').all(id) as ScanWearer[];

/**
 * The Production Entry a scan records, dated the day of the scan: a row for each wearer with their count, or (no wearers,
 * or a scan from before the counts) the worker's one row.
 */
function entryOf(c: Pick<Claim, 'employeeId' | 'jobOrderId' | 'lineNo' | 'stepId' | 'part' | 'workDate'> & { pieces: number; again: boolean; wearers: ScanWearer[] }): EntryInput {
  const row = { lineNo: c.lineNo, employeeId: c.employeeId, ...(c.part ? { part: c.part } : {}) };
  const counted = c.wearers.length > 0 && c.wearers.every((w) => w.pieces !== null);
  return {
    jobOrderId: c.jobOrderId, stepId: c.stepId, workDate: c.workDate,
    rows: counted ? c.wearers.map((w) => ({ ...row, pieces: w.pieces!, wearers: [w.rowNo] }))
      : [{ ...row, pieces: c.pieces, ...(c.wearers.length ? { wearers: c.wearers.map((w) => w.rowNo) } : {}), ...(c.again ? { repeatReason: 'Another batch, scanned on the floor app' } : {}) }],
  };
}

/** Recording pieces needs prd.assign; the worker and the head use it for this one entry only. */
const recorder = (a: Actor): Actor => ({ userId: a.userId, permissions: new Set([...a.permissions, 'prd.assign', 'prd.view']) });

/**
 * A worker's scan: checked against every rule of Record pieces now (so a mistake is said at once), then kept waiting for
 * the production head. Nothing counts on the job or in pay until it is approved.
 */
export function scanPieces(env: EngineEnv, worker: { id: string }, actor: Actor, raw: unknown, today: string, at: string) {
  const v = floorScanInput.parse(raw);
  const { db } = env;
  // Only the steps ticked on the worker's employee page are theirs to record.
  if (!workerSteps(db, worker.id).includes(v.stepId)) {
    throw new AppError('NOT_YOUR_STEP', `${stepById(db, v.stepId)?.name ?? 'That step'} is not one of your steps. If you do it now, ask the office to tick it on your employee page.`, 403);
  }
  const wearers = v.wearers ?? [];
  const roster = rosterOf(db, v.jobOrderId, v.lineNo);
  const name = (n: number) => { const r = roster.find((x) => x.rowNo === n); return r ? r.jerseyName ?? r.wearerName : `wearer ${n}`; };
  // An item with a wearer list: who the pieces were for, and how many of each (a set: of the part scanned).
  if (roster.length > 0 && wearers.length === 0) throw new AppError('WEARERS_NEEDED', 'Pick who the pieces were for, and how many for each.', 422);
  if (new Set(wearers.map((w) => w.rowNo)).size < wearers.length) throw new AppError('WEARER_TWICE', 'A wearer is picked twice. Pick each one once.', 422);
  if (wearers.length && wearers.reduce((n, w) => n + w.pieces, 0) !== v.pieces) throw new AppError('WEARERS_PIECES', "The pieces are not the sum of the wearers' counts. Reload and try again.", 422);
  // Pieces on someone's scan still waiting for the check are not free to scan again.
  if (wearers.length) {
    const recorded = wearerPieces(db, v.jobOrderId, v.lineNo, v.stepId, v.part ?? 'whole');
    const waiting = waitingByWearer(db, v.jobOrderId, v.lineNo, v.stepId, v.part ?? null);
    const free = (n: number) => (recorded.get(n)?.left ?? roster.find((r) => r.rowNo === n)?.qty ?? 0) - (waiting.get(n) ?? 0);
    const over = wearers.filter((w) => waiting.has(w.rowNo) && w.pieces > free(w.rowNo));
    if (over.length) {
      const who = over.map((w) => name(w.rowNo)).join(', ');
      throw new AppError('WEARER_WAITING', `${who}: some of their pieces are on a scan still waiting for the check. Count only the ones not scanned yet.`, 422);
    }
  }
  const preview = previewDocument(env, entryDoc, recorder(actor), entryOf({ ...v, part: v.part ?? null, employeeId: worker.id, workDate: today, again: !!v.again, wearers }));
  const errors = preview.issues.filter((i) => i.level === 'error');
  // Wearers counted say which garments the pieces are for: such a scan is never the same sheet twice.
  const repeat = errors.some((i) => i.code === 'LIKELY_REPEAT') || (!v.again && !wearers.length && !!db.prepare(`SELECT 1 FROM prd_floor_claims WHERE status = 'waiting' AND employee_id = ? AND job_order_id = ?
      AND line_no = ? AND step_id = ? AND part IS ? AND work_date = ? AND pieces = ?`).get(worker.id, v.jobOrderId, v.lineNo, v.stepId, v.part ?? null, today, v.pieces));
  if (repeat) throw new AppError('ALREADY_TODAY', `You already recorded ${v.pieces} pieces here today. Is this another batch?`, 422);
  if (errors.length) throw new AppError(errors[0]!.code, errors.map((i) => i.message).join(' '), 422);

  const id = newId();
  db.prepare(`INSERT INTO prd_floor_claims (id, employee_id, job_order_id, line_no, step_id, part, pieces, again, work_date, at, user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`).run(id, worker.id, v.jobOrderId, v.lineNo, v.stepId, v.part ?? null, v.pieces, v.again ? 1 : 0, today, at, actor.userId);
  const insW = db.prepare('INSERT INTO prd_floor_claim_wearers (claim_id, roster_row_no, pieces) VALUES (?, ?, ?)');
  for (const w of wearers) insW.run(id, w.rowNo, w.pieces);
  appendAudit(db, { at, userId: actor.userId, action: 'prd.floor_scan', entityType: 'prd.floor_claim', entityId: id, data: { ...v, employeeId: worker.id, workDate: today } });
  return { id, pieces: v.pieces, amountCents: preview.totalCents, waiting: true as const };
}

/** A scan as the screens show it: who, which job, line and step, the wearers, and how it was decided. */
function describe(db: Db, c: Claim) {
  const jo = jobOrderRef(db, c.jobOrderId);
  const roster = rosterOf(db, c.jobOrderId, c.lineNo);
  const wearers = wearersOf(db, c.id);
  return {
    id: c.id, at: c.at, workDate: c.workDate, status: c.status, employeeId: c.employeeId, employeeName: employee(db, c.employeeId)?.name ?? '?',
    jobOrderId: c.jobOrderId, jobOrderNumber: jo?.number ?? '?', customerName: jo?.customerName ?? '', jobOrderCancelled: jo?.status === 'cancelled',
    lineNo: c.lineNo, description: lineState(db, c.jobOrderId).find((l) => l.lineNo === c.lineNo)?.description ?? '', stepId: c.stepId, stepName: stepById(db, c.stepId)?.name ?? '?',
    part: c.part, pieces: c.pieces, again: c.again === 1,
    // pieces: the wearer's count (null: a scan from before the counts).
    wearers: wearers.flatMap((w) => roster.filter((r) => r.rowNo === w.rowNo).map((r) => ({ rowNo: r.rowNo, name: r.jerseyName ?? r.wearerName, qty: r.qty, pieces: w.pieces }))),
    checkedPieces: c.checkedPieces, reason: c.reason, checkedAt: c.checkedAt,
    entryNumber: c.entryId ? (db.prepare('SELECT number FROM documents WHERE id = ?').pluck().get(c.entryId) as string) : null,
  };
}

/** The worker's own scans waiting for the check, and those checked in the last week. */
export function scansOf(db: Db, employeeId: string, since: string) {
  return (db.prepare(`${CLAIM} WHERE employee_id = ? AND (status = 'waiting' OR checked_at >= ?) ORDER BY at DESC LIMIT 50`).all(employeeId, since) as Claim[]).map((c) => describe(db, c));
}

/**
 * The production head's list: every scan waiting (oldest first) with what it would pay and anything that now stops it,
 * and the last ones checked.
 */
export function floorChecks(env: EngineEnv, actor: Actor) {
  const { db } = env;
  const waiting = (db.prepare(`${CLAIM} WHERE status = 'waiting' ORDER BY at, id`).all() as Claim[]).map((c) => {
    const preview = previewDocument(env, entryDoc, recorder(actor), entryOf({ ...c, again: c.again === 1, wearers: wearersOf(db, c.id) }));
    const problems = preview.issues.filter((i) => i.level === 'error').map((i) => i.message);
    return { ...describe(db, c), amountCents: preview.totalCents, problems };
  });
  const checked = (db.prepare(`${CLAIM} WHERE status <> 'waiting' ORDER BY checked_at DESC, id LIMIT 40`).all() as Claim[]).map((c) => ({
    ...describe(db, c), checkedBy: c.checkedBy ? (db.prepare('SELECT display_name FROM users WHERE id = ?').pluck().get(c.checkedBy) as string) : null,
  }));
  return { waiting, checked };
}

/** How many scans wait for the check (the production board's note). */
export const waitingCount = (db: Db) => db.prepare("SELECT COUNT(*) FROM prd_floor_claims WHERE status = 'waiting'").pluck().get() as number;

function waitingClaim(db: Db, id: string): Claim {
  const c = db.prepare(`${CLAIM} WHERE id = ?`).get(id) as Claim | undefined;
  if (!c) throw notFound('That scan');
  if (c.status !== 'waiting') throw conflict('ALREADY_CHECKED', `This scan was already ${c.status}. Reload the list.`);
  return c;
}

export const approveBody = z.object({ pieces: z.number().int().min(1).max(10_000).optional() }).strict();
export const rejectBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/** Approves a scan: records it as a Production Entry dated the day of the scan, with the pieces the head counted. */
export function approveScan(env: EngineEnv, actor: Actor, id: string, raw: unknown, at: string) {
  const body = approveBody.parse(raw ?? {});
  const { db } = env;
  const c = waitingClaim(db, id);
  if (jobOrderRef(db, c.jobOrderId)?.status === 'cancelled') {
    throw new AppError('JO_CHANGED', 'The job order was edited after this scan. Reject it, and ask the worker to scan the new job ticket.', 422);
  }
  const pieces = body.pieces ?? c.pieces;
  const wearers = wearersOf(db, c.id);
  // Several wearers counted: the head approves the counts as scanned, or rejects them; one wearer: their count may change.
  if (pieces !== c.pieces && wearers.length > 1 && wearers.every((w) => w.pieces !== null)) {
    throw new AppError('BY_WEARER', 'This scan has a count for each wearer. Approve it as scanned, or reject it and ask the worker to scan again.', 422);
  }
  const input = entryOf({ ...c, pieces, again: c.again === 1, wearers: wearers.length === 1 && wearers[0]!.pieces !== null ? [{ ...wearers[0]!, pieces }] : wearers });
  const preview = previewDocument(env, entryDoc, recorder(actor), input);
  const errors = preview.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new AppError(errors[0]!.code, errors.map((i) => i.message).join(' '), 422);
  const posted = postDocument(env, entryDoc, recorder(actor), { input, expectedTotalCents: preview.totalCents });
  db.prepare("UPDATE prd_floor_claims SET status = 'approved', checked_pieces = ?, entry_id = ?, checked_at = ?, checked_by = ? WHERE id = ?")
    .run(pieces === c.pieces ? null : pieces, posted.id, at, actor.userId, id);
  appendAudit(db, { at, userId: actor.userId, action: 'prd.floor_scan_approve', entityType: 'prd.floor_claim', entityId: id, data: { pieces, scanned: c.pieces, entry: posted.number } });
  return { number: posted.number, pieces, amountCents: posted.totalCents };
}

/** Rejects a scan: nothing is recorded; the worker sees the reason. */
export function rejectScan(db: Db, who: Who, id: string, raw: unknown) {
  const { reason } = rejectBody.parse(raw);
  waitingClaim(db, id);
  db.prepare("UPDATE prd_floor_claims SET status = 'rejected', reason = ?, checked_at = ?, checked_by = ? WHERE id = ?").run(reason, who.at, who.userId, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'prd.floor_scan_reject', entityType: 'prd.floor_claim', entityId: id, data: { reason } });
  return { rejected: true };
}
