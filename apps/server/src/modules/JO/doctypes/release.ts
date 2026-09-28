/**
 * Release (REL-, PLAN E4): what left the shop, who claimed it and what was still owed. It posts no journal: the sale is
 * the invoice record, recorded in the same action (POST /api/jo/releases) or later when the invoice is to follow (D3
 * release gate). A release moves the JO to Partly released or Released; cancelling it moves the JO back.
 * The released part's price: list = qty × unit price; the line's discount is shared out by quantity, and the release
 * that completes a line takes what is left of it, so the releases of a line always add up to the line.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { divRoundHalfAway, formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocHeader, DocTypeDef } from '../../../engine/documents/registry.ts';
import { jobOrderRef, jobOrdersOf, joMoney } from '../public.ts';
import { STAGE_LABELS, currentStage, isAbandoned, moveTo } from '../stages.ts';
import { addDays } from './job-order.ts';

export const ID_SEEN = ['government_id', 'school_id', 'company_id', 'other_id', 'none'] as const;
const ID_WORDS: Record<(typeof ID_SEEN)[number], string> = { government_id: 'government ID', school_id: 'school ID', company_id: 'company ID', other_id: 'an ID', none: 'no ID' };
const text = (max: number) => z.string().trim().min(1).max(max);

export const releaseInput = z
  .object({
    jobOrderId: z.uuid(),
    lines: z.array(z.object({ lineNo: z.number().int().min(1).max(50), qty: z.number().int().min(1).max(10_000) }).strict()).min(1).max(50),
    claimedBy: text(120),
    idSeen: z.enum(ID_SEEN), // the type only; no ID number is stored
    creditNote: text(500).optional(), // needed when a balance is still due (E4 rule 3)
    creditDueInDays: z.number().int().min(1).max(365).optional(), // the server turns this into the credit due date (NR-6)
    overrideReason: z.string().trim().min(10).max(500).optional(), // owner: release before the job is ready (E4 rule 2)
  })
  .strict();
export type ReleaseInput = z.infer<typeof releaseInput>;

export type LineKind = 'made_to_order' | 'service' | 'ready_made';
export interface ReleaseLine { lineNo: number; qty: number; kind: LineKind; description: string; listCents: number; discountCents: number; amountCents: number }
export interface Release extends Omit<ReleaseInput, 'lines'> {
  lines: ReleaseLine[];
  jobOrderNumber: string;
  customerId: string;
  customerName: string;
  /** The JO's balance due when released (snapshot). */
  balanceDueCents: number;
  creditDueDate?: string;
  totalCents: number;
}

/** Each line of a JO with what its recorded (not cancelled) releases took so far. */
export function lineState(db: Db, jobOrderId: string) {
  const released = (col: string) => `(SELECT COALESCE(SUM(rl.${col}), 0) FROM jo_release_lines rl JOIN jo_releases r ON r.document_id = rl.document_id
    JOIN documents d ON d.id = r.document_id WHERE r.job_order_id = l.document_id AND rl.line_no = l.line_no AND d.status = 'posted')`;
  return db
    .prepare(
      `SELECT l.line_no AS lineNo, l.kind, l.description, l.qty, l.unit_price_cents AS unitPriceCents, l.discount_cents AS discountCents,
         ${released('qty')} AS releasedQty, ${released('discount_cents')} AS releasedDiscountCents
       FROM jo_lines l WHERE l.document_id = ? ORDER BY l.line_no`,
    )
    .all(jobOrderId) as { lineNo: number; kind: LineKind; description: string; qty: number; unitPriceCents: number; discountCents: number; releasedQty: number; releasedDiscountCents: number }[];
}

const postedBy = (db: Db, h: DocHeader) => db.prepare('SELECT posted_by AS userId, posted_at AS at FROM documents WHERE id = ?').get(h.documentId) as { userId: string; at: string };
const joOf = (db: Db, releaseId: string) => db.prepare('SELECT job_order_id FROM jo_releases WHERE document_id = ?').pluck().get(releaseId) as string;
const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

export const releaseDoc: DocTypeDef<ReleaseInput, Release> = {
  key: 'jo.release',
  module: 'JO',
  title: 'Release Slip',
  numbering: { series: { key: 'REL', prefix: 'REL-' } },
  permissions: { view: 'jo.view', create: 'jo.release', post: 'jo.release', cancel: 'jo.cancel' },
  dating: 'system',
  inputSchema: releaseInput,

  compute(input, ctx) {
    const jo = jobOrderRef(ctx.db, input.jobOrderId);
    const state = new Map(lineState(ctx.db, input.jobOrderId).map((l) => [l.lineNo, l]));
    const lines = input.lines.map((l): ReleaseLine => {
      const s = state.get(l.lineNo);
      if (!s) return { ...l, kind: 'made_to_order', description: '?', listCents: 0, discountCents: 0, amountCents: 0 }; // refused in validate
      const listCents = l.qty * s.unitPriceCents;
      const left = Math.max(0, s.discountCents - s.releasedDiscountCents);
      const after = s.releasedQty + l.qty;
      const share = divRoundHalfAway(s.discountCents * Math.min(after, s.qty), s.qty) - s.releasedDiscountCents;
      const discountCents = after >= s.qty ? left : Math.min(Math.max(0, share), left, listCents);
      return { ...l, kind: s.kind, description: s.description, listCents, discountCents, amountCents: listCents - discountCents };
    });
    return {
      ...input,
      lines,
      jobOrderNumber: jo?.number ?? '?',
      customerId: jo?.customerId ?? '',
      customerName: jo?.customerName ?? '?',
      balanceDueCents: jo?.status === 'posted' ? joMoney(ctx.db, jo.id).balanceDueCents : 0,
      ...(input.creditDueInDays ? { creditDueDate: addDays(ctx.businessDate, input.creditDueInDays) } : {}),
      totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const jo = jobOrderRef(ctx.db, doc.jobOrderId);
    if (!jo) return [{ field: 'jobOrderId', code: 'JOB_ORDER', level: 'error', message: 'Pick a job order.' }];
    if (jo.status !== 'posted') return [{ field: 'jobOrderId', code: 'JO_CANCELLED', level: 'error', message: `${jo.number} is cancelled, so nothing can be released from it.` }];
    if (isAbandoned(ctx.db, jo.id)) return [{ field: 'jobOrderId', code: 'JO_ABANDONED', level: 'error', message: `${jo.number} was abandoned and its deposit forfeited, so nothing more is released from it. Cancel the forfeit first if the customer came back.` }];

    const state = new Map(lineState(ctx.db, jo.id).map((l) => [l.lineNo, l]));
    const seen = new Set<number>();
    doc.lines.forEach((l, i) => {
      const s = state.get(l.lineNo);
      const left = s ? s.qty - s.releasedQty : 0;
      if (!s) error(`lines.${i}.lineNo`, 'LINE', `${jo.number} has no line ${l.lineNo}.`);
      else if (seen.has(l.lineNo)) error(`lines.${i}.lineNo`, 'LINE_TWICE', `Line ${l.lineNo} is listed twice. Put all its pieces on one row.`);
      else if (l.qty > left) error(`lines.${i}.qty`, 'OVER_RELEASE', left > 0 ? `Line ${l.lineNo}: only ${pieces(left)} of ${s.qty} are left to release.` : `Line ${l.lineNo} is already fully released.`);
      else if (l.amountCents < 0) error(`lines.${i}.qty`, 'AMOUNT', `Line ${l.lineNo}: the discount is more than the pieces released. Release the rest of the line together.`);
      seen.add(l.lineNo);
    });

    const stage = currentStage(ctx.db, jo.id);
    const ready = stage === 'ready' || stage === 'partially_released';
    if (!ready && !doc.overrideReason) {
      error('overrideReason', 'NOT_READY', `${jo.number} is ${STAGE_LABELS[stage]}. Mark it Ready for release first, or ask the owner to release it anyway with a reason.`);
    } else if (!ready && !ctx.can('jo.release_override')) {
      error('overrideReason', 'OVERRIDE_NOT_ALLOWED', 'Only the owner can release a job order that is not ready yet.');
    } else if (ready && doc.overrideReason) {
      error('overrideReason', 'NO_OVERRIDE', `${jo.number} is ready for release. Leave the override reason empty.`);
    }

    const due = doc.balanceDueCents;
    if (due > 0) {
      if (!doc.creditNote || !doc.creditDueInDays) error('creditNote', 'CREDIT_NOTE', `${formatPeso(due)} is still due on ${jo.number}. Write why it goes out before it is paid, and when it will be paid.`);
      if (!ctx.can('jo.release_with_balance')) error('creditNote', 'CREDIT_NOT_ALLOWED', `${formatPeso(due)} is still due on ${jo.number}. Only the owner or the accountant can release it before it is paid.`);
    } else if (doc.creditNote || doc.creditDueInDays) {
      error('creditNote', 'NO_CREDIT', `Nothing is due on ${jo.number}. Leave the credit note and due date empty.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO jo_releases (document_id, job_order_id, claimed_by, id_seen, balance_due_cents, credit_note, credit_due_date, override_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.jobOrderId, doc.claimedBy, doc.idSeen, doc.balanceDueCents, doc.creditNote ?? null, doc.creditDueDate ?? null, doc.overrideReason ?? null);
    const line = db.prepare('INSERT INTO jo_release_lines (document_id, line_no, qty, list_cents, discount_cents, amount_cents) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.lineNo, l.qty, l.listCents, l.discountCents, l.amountCents);
    const left = lineState(db, doc.jobOrderId).some((l) => l.releasedQty < l.qty); // counts this release: its documents row is in
    moveTo(db, doc.jobOrderId, left ? 'partially_released' : 'released', h.number, postedBy(db, h));
  },

  afterCancel(db, documentId, h) {
    const jo = joOf(db, documentId);
    moveTo(db, jo, lineState(db, jo).some((l) => l.releasedQty > 0) ? 'partially_released' : 'ready', `${h.number} cancelled`, h);
    return null;
  },

  /** Its invoice record: cancel that first (the release stays; a new invoice record can then be recorded for it). */
  dependents(db, documentId) {
    return db
      .prepare(`SELECT d.id, d.number FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id WHERE i.release_id = ? AND d.status = 'posted'`)
      .all(documentId) as { id: string; number: string }[];
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT r.job_order_id AS jobOrderId, r.claimed_by AS claimedBy, r.id_seen AS idSeen, r.balance_due_cents AS balanceDueCents, r.credit_note AS creditNote,
           r.credit_due_date AS creditDueDate, CAST(julianday(r.credit_due_date) - julianday(d.business_date) AS INTEGER) AS creditDueInDays,
           r.override_reason AS overrideReason, d.total_cents AS totalCents
         FROM jo_releases r JOIN documents d ON d.id = r.document_id WHERE r.document_id = ?`,
      )
      .get(documentId) as (Omit<Release, 'lines' | 'jobOrderNumber' | 'customerId' | 'customerName'> & Record<string, unknown>) | undefined;
    if (!r) throw new Error(`Release ${documentId} not found`);
    const lines = db
      .prepare(
        `SELECT rl.line_no AS lineNo, rl.qty, l.kind, l.description, rl.list_cents AS listCents, rl.discount_cents AS discountCents, rl.amount_cents AS amountCents
         FROM jo_release_lines rl JOIN jo_releases r ON r.document_id = rl.document_id JOIN jo_lines l ON l.document_id = r.job_order_id AND l.line_no = rl.line_no
         WHERE rl.document_id = ? ORDER BY rl.rowid`,
      )
      .all(documentId) as ReleaseLine[];
    const jo = jobOrderRef(db, r.jobOrderId)!;
    const optional = Object.fromEntries(['creditNote', 'creditDueDate', 'creditDueInDays', 'overrideReason'].filter((k) => r[k] !== null).map((k) => [k, r[k]]));
    return {
      jobOrderId: r.jobOrderId,
      claimedBy: r.claimedBy,
      idSeen: r.idSeen,
      ...optional,
      lines,
      jobOrderNumber: jo.number,
      customerId: jo.customerId,
      customerName: jo.customerName,
      balanceDueCents: r.balanceDueCents,
      totalCents: r.totalCents,
    };
  },

  toInput(doc) {
    const { jobOrderId, claimedBy, idSeen, creditNote, creditDueInDays, overrideReason } = doc;
    return {
      jobOrderId,
      lines: doc.lines.map(({ lineNo, qty }) => ({ lineNo, qty })),
      claimedBy,
      idSeen,
      ...(creditNote ? { creditNote } : {}),
      ...(creditDueInDays ? { creditDueInDays } : {}),
      ...(overrideReason ? { overrideReason } : {}),
    };
  },

  summary(doc) {
    const n = doc.lines.reduce((s, l) => s + l.qty, 0);
    const credit = doc.balanceDueCents > 0 ? ` ${formatPeso(doc.balanceDueCents)} is still due${doc.creditDueDate ? `, to be paid by ${doc.creditDueDate}` : ''}.` : '';
    return `This will release ${pieces(n)} of ${doc.jobOrderNumber} (${formatPeso(doc.totalCents)}) to ${doc.claimedBy}, ${ID_WORDS[doc.idSeen]} seen.${credit}`;
  },

  arbitrary(db) {
    const open = jobOrdersOf(db)
      .filter((jo) => ['ready', 'partially_released'].includes(currentStage(db, jo.id)))
      .map((jo) => ({ jo, lines: lineState(db, jo.id).filter((l) => l.releasedQty < l.qty), dueCents: joMoney(db, jo.id).balanceDueCents }))
      .filter((x) => x.lines.length > 0);
    if (open.length === 0) throw new Error('jo.release.arbitrary needs a job order that is ready, with pieces left to release');
    return fc.constantFrom(...open).chain(({ jo, lines, dueCents }) =>
      fc
        .record({
          picked: fc.subarray(lines, { minLength: 1 }),
          qtys: fc.array(fc.nat(), { minLength: lines.length, maxLength: lines.length }),
          claimedBy: fc.constantFrom('Ari Sample', 'Coach Placeholder'),
          idSeen: fc.constantFrom(...ID_SEEN),
          creditDueInDays: fc.integer({ min: 1, max: 60 }),
        })
        .map(({ picked, qtys, claimedBy, idSeen, creditDueInDays }) => ({
          jobOrderId: jo.id,
          lines: picked.map((l, i) => ({ lineNo: l.lineNo, qty: 1 + (qtys[i]! % (l.qty - l.releasedQty)) })),
          claimedBy,
          idSeen,
          ...(dueCents > 0 ? { creditNote: 'Balance to follow by bank transfer', creditDueInDays } : {}),
        })),
    );
  },
};
