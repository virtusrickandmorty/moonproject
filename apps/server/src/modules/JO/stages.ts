/**
 * JO stages (PLAN E4): open → in_production → ready → partially_released → released → closed, or cancelled.
 * The engine has no stages hook yet, so JO keeps them itself: every change is a new jo_stage_events row
 * (insert-only; a trigger checks it follows on from the current stage) plus an audit row, in one transaction.
 * "Cancelled" is the document's status, so it is never written as a stage.
 */
import { AppError, conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

export const STAGES = ['open', 'in_production', 'ready', 'partially_released', 'released', 'closed'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage | 'cancelled', string> = {
  open: 'Open',
  in_production: 'In production',
  ready: 'Ready for release',
  partially_released: 'Partly released',
  released: 'Released',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** Moves staff make by hand. Releases move ready → partially_released → released (and back when cancelled): moveTo. */
const BY_HAND: Partial<Record<Stage, Stage[]>> = { open: ['in_production'], in_production: ['ready', 'open'], ready: ['in_production'], released: ['closed'] };
const isBack = (from: Stage, to: Stage) => STAGES.indexOf(to) < STAGES.indexOf(from);

export interface Who { userId: string; at: string }

const lastStage = (db: Db, documentId: string) =>
  (db.prepare('SELECT to_stage FROM jo_stage_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1').get(documentId) as { to_stage: Stage } | undefined)?.to_stage;

/** Documents that are job orders: one taken in Virtus, or one taken before the cut-over date (opening.ts). */
export const JO_DOC_TYPES_SQL = `doc_type IN ('jo.job_order', 'jo.opening')`;

export function currentStage(db: Db, documentId: string): Stage | 'cancelled' {
  const d = db.prepare(`SELECT status FROM documents WHERE id = ? AND ${JO_DOC_TYPES_SQL}`).get(documentId) as { status: string } | undefined;
  if (!d) throw notFound('The job order');
  return d.status === 'cancelled' ? 'cancelled' : (lastStage(db, documentId) ?? 'open');
}

export function movesFrom(stage: Stage | 'cancelled') {
  return (stage === 'cancelled' ? [] : (BY_HAND[stage] ?? [])).map((to) => ({ to, label: STAGE_LABELS[to], needsReason: isBack(stage as Stage, to) }));
}

function record(db: Db, documentId: string, from: Stage, to: Stage, reason: string | null, who: Who, abandoned = false) {
  const seq = ((db.prepare('SELECT MAX(seq) AS n FROM jo_stage_events WHERE document_id = ?').get(documentId) as { n: number | null }).n ?? 0) + 1;
  db.prepare('INSERT INTO jo_stage_events (document_id, seq, from_stage, to_stage, reason, at, user_id, abandoned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(documentId, seq, from, to, reason, who.at, who.userId, abandoned ? 1 : 0);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'jo.stage', entityType: 'jo.job_order', entityId: documentId, data: { seq, from, to, reason, ...(abandoned ? { abandoned } : {}) } });
  return { stage: to, seq };
}

/** The customer abandoned the job order (PLAN D5 DEP-FORFEIT): its latest stage event is a close marked abandoned. */
export function isAbandoned(db: Db, documentId: string): boolean {
  return db.prepare('SELECT abandoned FROM jo_stage_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1').pluck().get(documentId) === 1;
}

/**
 * A deposit forfeit closes the job order as abandoned, from any stage but Released or Closed. Nothing more is released
 * on it (the release refuses it, owner override included), so nothing more is invoiced either: the forfeit is refused
 * while a release still waits for its invoice. Returns false when there was nothing to mark (a cancelled job order).
 * Call inside a transaction.
 */
export function abandon(db: Db, documentId: string, reason: string, who: Who): boolean {
  const now = currentStage(db, documentId);
  if (now === 'cancelled' || now === 'released' || now === 'closed') return false;
  record(db, documentId, now, 'closed', reason, who, true);
  return true;
}

/** Cancelling the forfeit puts an abandoned job order back on the stage it was abandoned from. Call inside a transaction. */
export function unabandon(db: Db, documentId: string, reason: string, who: Who): void {
  if (currentStage(db, documentId) === 'cancelled' || !isAbandoned(db, documentId)) return;
  const back = db.prepare('SELECT from_stage FROM jo_stage_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1').pluck().get(documentId) as Stage;
  record(db, documentId, 'closed', back, reason, who);
}

/** `from` is the stage the user saw, so a double click or a stale screen changes nothing. Call inside a transaction. */
export function changeStage(db: Db, documentId: string, req: { from: Stage; to: Stage; reason?: string | undefined }, who: Who) {
  const now = currentStage(db, documentId);
  if (now === 'cancelled') throw conflict('JO_CANCELLED', 'This job order is cancelled, so its stage cannot change.');
  if (now !== req.from) throw conflict('STAGE_CHANGED', `This job order is already ${STAGE_LABELS[now]}. Reload and check.`);
  if (!movesFrom(now).some((m) => m.to === req.to)) {
    throw new AppError('STAGE_NOT_ALLOWED', `A job order cannot go from ${STAGE_LABELS[now]} to ${STAGE_LABELS[req.to]} by hand.`, 400);
  }
  const reason = req.reason?.trim() ?? '';
  if (isBack(now, req.to) && reason.length < 10) throw new AppError('REASON_REQUIRED', 'Moving a job order back needs a reason of at least 10 characters.', 400);
  return record(db, documentId, now, req.to, reason || null, who);
}

/** A move made by a document (a release or its cancel), not by hand: any stage, no reason check. Call inside a transaction. */
export function moveTo(db: Db, documentId: string, to: Stage, reason: string, who: Who): void {
  const now = currentStage(db, documentId);
  if (now !== 'cancelled' && now !== to) record(db, documentId, now, to, reason, who);
}

/**
 * Production moves a job order as its steps finish (PLAN E7 rule 3): to Ready when every line is done, back to In
 * production when a step is reopened or added. It never touches a job order that is being released, closed or cancelled.
 * Call inside a transaction.
 */
export function productionMove(db: Db, documentId: string, to: 'in_production' | 'ready', reason: string, who: Who): void {
  const now = currentStage(db, documentId);
  if ((now === 'open' || now === 'in_production' || now === 'ready') && now !== to) record(db, documentId, now, to, reason, who);
}

/**
 * Edit (cancel + reissue) keeps the job where it is on the floor: the replacement starts at the old stage. Only a job
 * still on the floor carries over, onto a replacement with no stage of its own yet (an opening job order with nothing
 * left to release starts Released).
 */
export function carryStageOver(db: Db, oldId: string, newId: string): void {
  const stage = lastStage(db, oldId);
  if ((stage !== 'in_production' && stage !== 'ready') || lastStage(db, newId)) return;
  const old = db.prepare('SELECT number, cancelled_by, cancelled_at FROM documents WHERE id = ?').get(oldId) as { number: string; cancelled_by: string; cancelled_at: string };
  record(db, newId, 'open', stage, `Carried over from ${old.number}`, { userId: old.cancelled_by, at: old.cancelled_at });
}

export function stageHistory(db: Db, documentId: string) {
  return (
    db
      .prepare(
        `SELECT e.seq, e.from_stage AS fromStage, e.to_stage AS toStage, e.reason, e.at, u.display_name AS byName, e.abandoned
         FROM jo_stage_events e JOIN users u ON u.id = e.user_id WHERE e.document_id = ? ORDER BY e.seq`,
      )
      .all(documentId) as { seq: number; fromStage: Stage; toStage: Stage; reason: string | null; at: string; byName: string; abandoned: number }[]
  ).map(({ abandoned, ...e }) => ({ ...e, ...(abandoned ? { abandoned: true } : {}) }));
}
