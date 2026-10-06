/**
 * One lifecycle for every document (PLAN C4). Each action runs in a single BEGIN IMMEDIATE transaction.
 */
import { AppError, conflict, forbidden, isBusinessDate, newId, notFound, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { CLOCK_TOLERANCE_MS, clockBackwardsError, stamp, today, type Clock } from '../../platform/clock.ts';
import { appendAudit, lastAuditAt } from '../audit.ts';
import { ensureSeries, allocateNumber } from '../numbering.ts';
import { postJournal, resolveDraft, reverseJournalOf } from '../ledger/post.ts';
import type { DependentsFn, DocContext, DocTypeDef, NoticeFn, NoticeTarget, Registry } from './registry.ts';

export interface Actor {
  userId: string;
  permissions: ReadonlySet<string>;
}

export interface EngineEnv {
  db: Db;
  clock: Clock;
  /** The modules' notices (Registry.notices()), run after validate on preview, record and cancel. */
  notices?: readonly NoticeFn[];
  /** The modules' dependents of other modules' documents (Registry.dependents()), asked on cancel and edit. */
  dependents?: readonly DependentsFn[];
}

/** The engine's view of the app: the database, the clock, and every module's notices and cross-module dependents. */
export function engineEnv(deps: { db: Db; clock: Clock; registry: Pick<Registry, 'notices' | 'dependents'> }): EngineEnv {
  return { db: deps.db, clock: deps.clock, notices: deps.registry.notices(), dependents: deps.registry.dependents() };
}

export const BACKDATE_PERMISSION = 'acc.backdate';

function need(actor: Actor, perm: string): void {
  if (!actor.permissions.has(perm)) throw forbidden(perm);
}

function context(env: EngineEnv, actor: Actor, businessDate?: string): DocContext {
  return {
    db: env.db,
    businessDate: businessDate ?? today(env.clock),
    typedOn: today(env.clock),
    at: stamp(env.clock),
    userId: actor.userId,
    can: (p) => actor.permissions.has(p),
  };
}

/** Blocks writes when the clock went backwards (PLAN C8, N-09). */
export function clockGuard(env: EngineEnv): void {
  const last = lastAuditAt(env.db);
  if (last && env.clock.now().getTime() < new Date(last).getTime() - CLOCK_TOLERANCE_MS) throw clockBackwardsError(last);
}

function parseInput<I>(def: DocTypeDef<I>, raw: unknown): I {
  const r = def.inputSchema.safeParse(raw);
  if (!r.success) {
    throw new AppError(
      'INVALID_INPUT',
      'Some fields are missing or not allowed.',
      400,
      r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

function resolveBusinessDate(def: DocTypeDef, actor: Actor, env: EngineEnv, requested?: string): string {
  if (requested === undefined) return today(env.clock);
  if (def.dating === 'printed') return printedDate(env, requested);
  if (def.dating !== 'accountant_may_backdate') {
    throw new AppError('DATE_NOT_ALLOWED', 'This document always carries today’s date.', 400);
  }
  need(actor, BACKDATE_PERMISSION);
  if (typeof requested !== 'string' || !isBusinessDate(requested) || requested > today(env.clock)) {
    throw new AppError('BAD_DATE', 'The date must be today or earlier (YYYY-MM-DD).', 400);
  }
  return requested;
}

/** The date printed on a booklet or supplier form (dating 'printed'): a real date, today or earlier. Anyone who may record it gives it. */
function printedDate(env: EngineEnv, requested: unknown): string {
  if (typeof requested !== 'string' || !isBusinessDate(requested)) {
    const what = typeof requested === 'string' && requested.trim() ? `"${requested.slice(0, 20)}" is not a real date. ` : '';
    throw new AppError('BAD_DATE', `${what}Type the date printed on the document like 2026-09-30.`, 400);
  }
  const now = today(env.clock);
  if (requested > now) throw new AppError('BAD_DATE', `The date printed on the document cannot be after today (${now}).`, 400);
  return requested;
}

const errorsOf = (issues: Issue[]) => issues.filter((i) => i.level === 'error');

/** The modules' notices on this record or cancel, always as warnings: a notice never blocks. */
function noticesOf(env: EngineEnv, target: NoticeTarget): Issue[] {
  return (env.notices ?? []).flatMap((n) => n(env.db, target)).map((i) => ({ ...i, level: 'warning' as const }));
}

export interface PreviewResult {
  totalCents: number;
  summary: string;
  issues: Issue[];
  doc: unknown;
  /** Journal preview; the web shows it only to users with acc.journal.view. */
  journal: { accountCode: string; accountName: string; partyType: string | null; partyId: string | null; debitCents: number; creditCents: number }[] | null;
}

export function previewDocument(env: EngineEnv, def: DocTypeDef, actor: Actor, rawInput: unknown, businessDate?: string): PreviewResult {
  need(actor, def.permissions.create);
  const input = parseInput(def, rawInput);
  const ctx = context(env, actor, resolveBusinessDate(def, actor, env, businessDate));
  const doc = def.compute(input, ctx);
  const issues = [...def.validate(doc, ctx), ...noticesOf(env, { docType: def.key, action: 'post', businessDate: ctx.businessDate, posts: !!def.journal, doc })];
  let journal: PreviewResult['journal'] = null;
  if (errorsOf(issues).length === 0 && def.journal) {
    const draft = def.journal(doc, ctx);
    journal = draft
      ? resolveDraft(env.db, draft).map((l) => ({
          accountCode: l.account.code,
          accountName: l.account.name,
          partyType: l.party?.type ?? null,
          partyId: l.party?.id ?? null,
          debitCents: l.debitCents,
          creditCents: l.creditCents,
        }))
      : null;
  }
  return { totalCents: doc.totalCents, summary: def.summary(doc, ctx), issues, doc, journal };
}

export interface PostResult {
  id: string;
  number: string;
  businessDate: string;
  totalCents: number;
  summary: string;
  warnings: Issue[];
  journalNumber: string | null;
}

export interface PostRequest {
  input: unknown;
  /** What the user saw in the confirm dialog; if the server's total differs, nothing is recorded. */
  expectedTotalCents: number;
  businessDate?: string;
}

/** Posts inside the caller's transaction (used by post and reissue). */
function postInTx(env: EngineEnv, def: DocTypeDef, actor: Actor, req: PostRequest, replacesId: string | null): PostResult {
  const db = env.db;
  const input = parseInput(def, req.input);
  const ctx = context(env, actor, resolveBusinessDate(def, actor, env, req.businessDate));
  const doc = def.compute(input, ctx);
  if (doc.totalCents !== req.expectedTotalCents) {
    throw conflict('TOTALS_CHANGED', 'Totals changed. Please review again before recording.', { totalCents: doc.totalCents });
  }
  const issues = def.validate(doc, ctx);
  if (errorsOf(issues).length > 0) throw new AppError('VALIDATION', errorsOf(issues)[0]!.message, 422, issues);
  // Before anything is written, as in the preview: a return's own payment does not warn about itself.
  const notices = noticesOf(env, { docType: def.key, action: 'post', businessDate: ctx.businessDate, posts: !!def.journal, doc });

  ensureSeries(db, def.numbering.series);
  const number = allocateNumber(db, def.numbering.series.key);
  const id = newId();
  const summary = def.summary(doc, ctx);
  db.prepare(
    `INSERT INTO documents (id, doc_type, module, series_key, number, external_number, business_date, status, total_cents, summary, posted_at, posted_by, replaces_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`,
  ).run(id, def.key, def.module, def.numbering.series.key, number, def.externalNumber?.(doc) ?? null, ctx.businessDate, doc.totalCents, summary, ctx.at, actor.userId, replacesId);
  const header = { documentId: id, number, businessDate: ctx.businessDate };
  def.persist(db, doc, header);

  let journalNumber: string | null = null;
  const draft = def.journal?.(doc, ctx, header);
  if (draft) {
    journalNumber = postJournal(db, { ...draft, memo: `${number}: ${draft.memo}` }, {
      sourceType: 'document',
      sourceId: id,
      businessDate: ctx.businessDate,
      userId: actor.userId,
      at: ctx.at,
    }).number;
  }
  appendAudit(db, {
    at: ctx.at,
    userId: actor.userId,
    action: 'document.post',
    entityType: def.key,
    entityId: id,
    // A printed date: the document carries it, and the trail keeps the day it was typed too.
    data: { number, totalCents: doc.totalCents, businessDate: ctx.businessDate, replacesId, journalNumber, ...(def.dating === 'printed' ? { typedOn: ctx.typedOn } : {}) },
  });
  return { id, number, businessDate: ctx.businessDate, totalCents: doc.totalCents, summary, warnings: [...issues, ...notices], journalNumber };
}

export function postDocument(env: EngineEnv, def: DocTypeDef, actor: Actor, req: PostRequest): PostResult {
  need(actor, def.permissions.post);
  return tx(env.db, () => {
    clockGuard(env);
    return postInTx(env, def, actor, req, null);
  });
}

interface DocRow {
  id: string;
  doc_type: string;
  number: string;
  status: string;
  business_date: string;
}

function cancelInTx(env: EngineEnv, def: DocTypeDef, actor: Actor, id: string, reason: string, reissuing = false): { reversalNumber: string | null; warnings: Issue[] } {
  const db = env.db;
  const d = db.prepare('SELECT id, doc_type, number, status, business_date FROM documents WHERE id = ?').get(id) as DocRow | undefined;
  if (!d || d.doc_type !== def.key) throw notFound('The document');
  if (d.status !== 'posted') throw conflict('ALREADY_CANCELLED', `${d.number} is already cancelled.`);
  // On reissue, children are moved to the replacement by relinkOnReissue instead.
  const deps = reissuing && def.relinkOnReissue ? [] : [...(def.dependents?.(db, id) ?? []), ...(env.dependents ?? []).flatMap((f) => f(db, def.key, id, reissuing))];
  if (deps.length > 0) {
    throw conflict('HAS_DEPENDENTS', `Cancel these first: ${deps.map((x) => x.number).join(', ')}.`, deps);
  }
  const at = stamp(env.clock);
  const date = def.cancelOn === 'document_date' ? d.business_date : today(env.clock);
  if (date < today(env.clock)) need(actor, BACKDATE_PERMISSION);
  // Before anything is written, as in the preview before Cancel.
  const warnings = noticesOf(env, { docType: def.key, action: 'cancel', businessDate: d.business_date, posts: !!def.journal, documentId: id });
  const rev = reverseJournalOf(db, 'document', id, { sourceType: 'document', sourceId: id, businessDate: date, userId: actor.userId, at }, `Cancel ${d.number}: ${reason}`);
  db.prepare(`UPDATE documents SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?`).run(at, actor.userId, reason, id);
  // D6 follow-ups read the ledger after the mirror; their journal has its own source so L4 still nets the mirror.
  const follow = def.afterCancel?.(db, id, { documentId: id, number: d.number, businessDate: date, userId: actor.userId, at });
  const followUp = follow
    ? postJournal(db, { ...follow, memo: `Cancel ${d.number}: ${follow.memo}` }, { sourceType: 'document-cancel', sourceId: id, businessDate: date, userId: actor.userId, at })
    : null;
  appendAudit(db, {
    at,
    userId: actor.userId,
    action: 'document.cancel',
    entityType: def.key,
    entityId: id,
    data: { number: d.number, reason, reversalJournal: rev?.number ?? null, ...(followUp ? { followUpJournal: followUp.number } : {}) },
  });
  return { reversalNumber: rev?.number ?? null, warnings };
}

export interface CancelPreview {
  number: string;
  /** The document's own date, and the date its mirror will carry (NR-4, ACC-09). */
  businessDate: string;
  cancelDate: string;
  /** The modules' notices (warnings) about this cancel; nothing is written. */
  issues: Issue[];
}

/** What a cancel would say before it is confirmed: the same notices the cancel returns, with no writes. */
export function previewCancel(env: EngineEnv, def: DocTypeDef, actor: Actor, id: string): CancelPreview {
  need(actor, def.permissions.cancel);
  const d = env.db.prepare('SELECT id, doc_type, number, status, business_date FROM documents WHERE id = ?').get(id) as DocRow | undefined;
  if (!d || d.doc_type !== def.key) throw notFound('The document');
  if (d.status !== 'posted') throw conflict('ALREADY_CANCELLED', `${d.number} is already cancelled.`);
  const cancelDate = def.cancelOn === 'document_date' ? d.business_date : today(env.clock);
  return { number: d.number, businessDate: d.business_date, cancelDate, issues: noticesOf(env, { docType: def.key, action: 'cancel', businessDate: d.business_date, posts: !!def.journal, documentId: id }) };
}

function checkReason(reason: unknown): string {
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError('REASON_REQUIRED', 'Please give a reason of at least 10 characters.', 400);
  }
  return reason.trim();
}

export function cancelDocument(env: EngineEnv, def: DocTypeDef, actor: Actor, id: string, reason: unknown) {
  need(actor, def.permissions.cancel);
  const why = checkReason(reason);
  return tx(env.db, () => {
    clockGuard(env);
    return cancelInTx(env, def, actor, id, why);
  });
}

/** Edit of a posted document = cancel + post replacement, linked, in one transaction (NR-4). */
export function reissueDocument(env: EngineEnv, def: DocTypeDef, actor: Actor, id: string, req: PostRequest & { reason: unknown }) {
  need(actor, def.permissions.cancel);
  need(actor, def.permissions.post);
  const why = checkReason(req.reason);
  return tx(env.db, () => {
    clockGuard(env);
    const cancelled = cancelInTx(env, def, actor, id, why, true);
    const posted = postInTx(env, def, actor, req, id);
    env.db.prepare('UPDATE documents SET replaced_by_id = ? WHERE id = ?').run(posted.id, id);
    def.relinkOnReissue?.(env.db, id, posted.id);
    return { ...posted, cancelledReversalNumber: cancelled.reversalNumber };
  });
}
