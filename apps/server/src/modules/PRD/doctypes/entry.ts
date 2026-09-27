/**
 * Production Entry (PE-, PLAN E7 assignments, C4, D6): the pieces workers did on one step of one job order, one row per
 * worker per line, with the piece rate taken as a snapshot. It posts no journal: payroll pays the rows later (F3).
 * - Rate: from the rate table (garment type × step × complexity on the work date), or typed with a reason (an override
 *   needs rate.override, OWN-26), or none (progress only, ₱0). Rework (pasubra) is paid at a rate typed per entry (OWN-25).
 * - Caps (E7 rules 1–2): the pieces of a step never pass the line quantity; passing what came out of the previous step
 *   needs a reason. Rework is outside both.
 * - Cancel: only while no row is paid; after payroll, a correction row (negative pieces, same rate) goes in the next run.
 * Recording pieces moves an open JO to In production (E7 rule 3).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { conflict, formatPeso, manilaDate, newId, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { jobOrderRef, jobOrdersOf, lineState } from '../../JO/public.ts';
import { rateAt } from '../../RATE/public.ts';
import { activeEmployees, employee } from '../emp.ts';
import { availableFor, lineRoute, lineSetup, stepById, syncStage, type Complexity } from '../production.ts';

const MAX_PIECES = 10_000;
const MAX_RATE_CENTS = 1_000_000; // ₱10,000 per piece: a typo guard

const row = z
  .object({
    lineNo: z.number().int().min(1).max(50),
    employeeId: z.uuid(),
    pieces: z.number().int().min(-MAX_PIECES).max(MAX_PIECES).refine((n) => n !== 0, 'Type the number of pieces.'),
    rework: z.literal(true).optional(), // pasubra: paid at its own typed rate, outside the caps
    rateCents: z.number().int().min(0).max(MAX_RATE_CENTS).optional(), // typed per piece: an override, or the rework rate
    rateReason: z.string().trim().min(5).max(200).optional(),
    correctionOf: z.uuid().optional(), // a row already paid, corrected with negative pieces (D6)
  })
  .strict();

export const entryInput = z
  .object({
    jobOrderId: z.uuid(),
    stepId: z.number().int().positive(),
    rows: z.array(row).min(1).max(50),
    overCapReason: z.string().trim().min(10).max(500).optional(),
  })
  .strict();
export type EntryInput = z.infer<typeof entryInput>;

export type RateSource = 'table' | 'typed' | 'none' | 'original';
export interface Assignment extends z.infer<typeof row> {
  rowNo: number;
  employeeName: string;
  kind: 'work' | 'rework' | 'correction';
  garmentType: string;
  complexity: Complexity;
  rateCents: number;
  rateSource: RateSource;
  amountCents: number;
}
export interface Entry extends Omit<EntryInput, 'rows'> {
  jobOrderNumber: string;
  customerName: string;
  stepName: string;
  rows: Assignment[];
  pieces: number;
  totalCents: number;
}

interface Original { id: string; jobOrderId: string; lineNo: number; stepId: number; employeeId: string; pieces: number; garmentType: string; complexity: Complexity; rateCents: number; paid: boolean; corrected: number }
function original(db: Parameters<typeof lineState>[0], id: string): Original | undefined {
  const r = db
    .prepare(
      `SELECT a.id, a.job_order_id AS jobOrderId, a.line_no AS lineNo, a.step_id AS stepId, a.employee_id AS employeeId, a.pieces, a.garment_type AS garmentType,
         a.complexity, a.rate_cents AS rateCents, a.pay_run_line_id IS NOT NULL AS paid,
         (SELECT COALESCE(SUM(c.pieces), 0) FROM prd_assignments c JOIN documents x ON x.id = c.document_id WHERE c.correction_of_id = a.id AND x.status = 'posted') AS corrected
       FROM prd_assignments a JOIN documents d ON d.id = a.document_id WHERE a.id = ? AND d.status = 'posted' AND a.kind <> 'correction'`,
    )
    .get(id) as (Omit<Original, 'paid'> & { paid: number }) | undefined;
  return r && { ...r, paid: r.paid === 1 };
}

const plural = (n: number) => `${n} ${Math.abs(n) === 1 ? 'piece' : 'pieces'}`;

export const entryDoc: DocTypeDef<EntryInput, Entry> = {
  key: 'prd.entry',
  module: 'PRD',
  title: 'Production Entry',
  numbering: { series: { key: 'PE', prefix: 'PE-' } },
  permissions: { view: 'prd.view', create: 'prd.assign', post: 'prd.assign', cancel: 'prd.assign' },
  dating: 'system',
  inputSchema: entryInput,

  compute(input, ctx) {
    const jo = jobOrderRef(ctx.db, input.jobOrderId);
    const step = stepById(ctx.db, input.stepId);
    const rows = input.rows.map((r, i): Assignment => {
      const was = r.correctionOf ? original(ctx.db, r.correctionOf) : undefined;
      const setup = lineSetup(ctx.db, input.jobOrderId, r.lineNo);
      const garmentType = was?.garmentType ?? setup?.garmentType ?? '';
      const complexity = was?.complexity ?? setup?.complexity ?? 'standard';
      const kind = r.correctionOf ? 'correction' : r.rework ? 'rework' : 'work';
      const table = kind === 'work' && step ? rateAt(ctx.db, garmentType, step.code, complexity, ctx.businessDate) : undefined;
      const [rateCents, rateSource]: [number, RateSource] =
        r.rateCents !== undefined ? [r.rateCents, 'typed'] : was ? [was.rateCents, 'original'] : table ? [table.rateCents, 'table'] : [0, 'none'];
      return { ...r, rowNo: i + 1, employeeName: employee(ctx.db, r.employeeId)?.name ?? '?', kind, garmentType, complexity, rateCents, rateSource, amountCents: r.pieces * rateCents };
    });
    return {
      ...input,
      jobOrderNumber: jo?.number ?? '?',
      customerName: jo?.customerName ?? '?',
      stepName: step?.name ?? '?',
      rows,
      pieces: rows.reduce((s, r) => s + r.pieces, 0),
      totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const jo = jobOrderRef(ctx.db, doc.jobOrderId);
    if (!jo) add('error', 'jobOrderId', 'JOB_ORDER', 'Pick a job order.');
    else if (jo.status !== 'posted') add('error', 'jobOrderId', 'JO_CANCELLED', `${jo.number} is cancelled. Record the pieces on the job order that replaced it.`);
    const step = stepById(ctx.db, doc.stepId);
    if (!step) add('error', 'stepId', 'STEP', 'Pick the step.');
    if (!jo || jo.status !== 'posted' || !step) return issues;

    const lines = lineState(ctx.db, jo.id);
    const added = new Map<number, number>(); // work pieces per line in this entry
    const takenOff = new Map<string, number>(); // correction pieces per corrected row in this entry
    for (const r of doc.rows) {
      const [f, at] = [`rows.${r.rowNo - 1}`, `Row ${r.rowNo}`];
      const line = lines.find((l) => l.lineNo === r.lineNo);
      const route = line ? lineRoute(ctx.db, jo.id, line.lineNo) : null;
      const onRoute = route?.find((s) => s.id === step.id);
      if (!line) add('error', `${f}.lineNo`, 'LINE', `${at}: ${jo.number} has no line ${r.lineNo}.`);
      else if (!route) add('error', `${f}.lineNo`, 'NO_ROUTE', `${at}: line ${r.lineNo} has no route yet. Set it up on the board first.`);
      else if (!onRoute) add('error', `${f}.lineNo`, 'NOT_ON_ROUTE', `${at}: ${step.name} is not on the route of line ${r.lineNo}.`);
      else if (r.kind !== 'correction' && (onRoute.status === 'completed' || onRoute.status === 'not_needed')) {
        add('error', `${f}.lineNo`, 'STEP_CLOSED', `${at}: ${step.name} of line ${r.lineNo} is ${onRoute.status === 'completed' ? 'completed' : 'marked not needed'}. Reopen it first.`);
      }
      const who = employee(ctx.db, r.employeeId);
      if (!who?.active && r.kind !== 'correction') add('error', `${f}.employeeId`, 'EMPLOYEE', `${at}: pick an active worker.`);
      if (r.kind === 'correction') {
        const was = original(ctx.db, r.correctionOf!);
        if (!was || was.jobOrderId !== jo.id || was.lineNo !== r.lineNo || was.stepId !== step.id || was.employeeId !== r.employeeId) {
          add('error', `${f}.correctionOf`, 'CORRECTION', `${at}: a correction must be for the same job order, line, step and worker as the row it corrects.`);
        } else if (!was.paid) {
          add('error', `${f}.correctionOf`, 'NOT_PAID', `${at}: that row is not paid yet. Cancel its entry instead of correcting it.`);
        } else {
          const left = was.pieces + was.corrected + (takenOff.get(was.id) ?? 0);
          if (r.pieces >= 0 || left + r.pieces < 0) add('error', `${f}.pieces`, 'CORRECTION_PIECES', `${at}: a correction takes off pieces, at most the ${plural(left)} still counted.`);
          takenOff.set(was.id, (takenOff.get(was.id) ?? 0) + Math.min(0, r.pieces));
        }
        if (r.rateSource === 'typed' || r.rework) add('error', `${f}.rateCents`, 'CORRECTION_RATE', `${at}: a correction keeps the rate of the row it corrects.`);
      } else if (r.pieces < 0) {
        add('error', `${f}.pieces`, 'PIECES', `${at}: type the pieces done. Taking pieces off a paid row is a correction.`);
      }
      if (r.rateSource === 'typed' && !r.rateReason) add('error', `${f}.rateReason`, 'RATE_REASON', `${at}: say why this rate is typed.`);
      if (r.rateSource !== 'typed' && r.rateReason) add('error', `${f}.rateReason`, 'RATE_REASON', `${at}: a reason goes with a typed rate only.`);
      if (r.kind === 'rework' && r.rateSource !== 'typed') add('error', `${f}.rateCents`, 'REWORK_RATE', `${at}: type the rework (pasubra) rate for these pieces.`);
      if (r.kind === 'work' && r.rateSource === 'typed' && !ctx.can('rate.override')) add('error', `${f}.rateCents`, 'RATE_OVERRIDE', `${at}: you cannot type a different piece rate. Leave it to the rate table or ask the owner.`);
      const what = `${r.garmentType} (${r.complexity})`;
      if (onRoute && r.kind === 'work' && r.rateSource === 'none' && step.payBasis === 'piece') add('error', `${f}.rateCents`, 'NO_RATE', `${at}: there is no ${step.name} rate for ${what}. Type the rate and a reason.`);
      if (onRoute && r.kind === 'work' && r.rateSource === 'none' && step.payBasis === 'piece_or_daily') add('warning', `${f}.rateCents`, 'NO_RATE', `${at}: there is no ${step.name} rate for ${what}, so these pieces count as progress only (₱0).`);
      if (line && r.kind === 'work') added.set(line.lineNo, (added.get(line.lineNo) ?? 0) + r.pieces);
    }
    for (const [lineNo, pieces] of added) {
      const line = lines.find((l) => l.lineNo === lineNo)!;
      const route = lineRoute(ctx.db, jo.id, lineNo);
      const here = route?.find((s) => s.id === step.id);
      if (!route || !here) continue;
      const after = here.pieces + pieces;
      if (after > line.qty) {
        const left = Math.max(0, line.qty - here.pieces);
        add('error', 'rows', 'OVER_QTY', `Line ${lineNo} is ${plural(line.qty)} and ${plural(here.pieces)} of ${step.name} are recorded, so at most ${left} more. Pieces done again go in as rework (pasubra).`);
      } else if (after > availableFor(route, step.id, line.qty) && !doc.overCapReason) {
        const avail = availableFor(route, step.id, line.qty);
        add('error', 'overCapReason', 'OVER_CAP', `Only ${plural(avail)} of line ${lineNo} came out of the step before ${step.name}. Give a reason to record more.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO prd_entries (document_id, job_order_id, step_id, over_cap_reason) VALUES (?, ?, ?, ?)').run(h.documentId, doc.jobOrderId, doc.stepId, doc.overCapReason ?? null);
    const ins = db.prepare(
      `INSERT INTO prd_assignments (id, document_id, row_no, job_order_id, line_no, step_id, employee_id, employee_name, work_date, kind, pieces, garment_type, complexity,
         rate_cents, rate_source, rate_reason, amount_cents, correction_of_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of doc.rows) {
      ins.run(newId(), h.documentId, r.rowNo, doc.jobOrderId, r.lineNo, doc.stepId, r.employeeId, r.employeeName, h.businessDate, r.kind, r.pieces, r.garmentType, r.complexity,
        r.rateCents, r.rateSource, r.rateSource === 'typed' ? r.rateReason! : null, r.amountCents, r.correctionOf ?? null);
    }
    const who = db.prepare('SELECT posted_by AS userId, posted_at AS at FROM documents WHERE id = ?').get(h.documentId) as { userId: string; at: string };
    syncStage(db, doc.jobOrderId, `${h.number}: ${doc.stepName} pieces recorded`, who);
  },

  load(db, documentId) {
    const e = db.prepare('SELECT job_order_id AS jobOrderId, step_id AS stepId, over_cap_reason AS overCapReason FROM prd_entries WHERE document_id = ?').get(documentId) as
      | { jobOrderId: string; stepId: number; overCapReason: string | null }
      | undefined;
    if (!e) throw new Error(`Production entry ${documentId} not found`);
    const rows = (
      db
        .prepare(
          `SELECT row_no AS rowNo, line_no AS lineNo, employee_id AS employeeId, employee_name AS employeeName, kind, pieces, garment_type AS garmentType, complexity,
             rate_cents AS rateCents, rate_source AS rateSource, rate_reason AS rateReason, amount_cents AS amountCents, correction_of_id AS correctionOf
           FROM prd_assignments WHERE document_id = ? ORDER BY row_no`,
        )
        .all(documentId) as (Omit<Assignment, 'rework' | 'rateReason' | 'correctionOf'> & { rateReason: string | null; correctionOf: string | null })[]
    ).map(({ rateReason, correctionOf, ...r }): Assignment => ({
      ...r,
      ...(r.kind === 'rework' ? { rework: true as const } : {}),
      ...(rateReason ? { rateReason } : {}),
      ...(correctionOf ? { correctionOf } : {}),
    }));
    const jo = jobOrderRef(db, e.jobOrderId);
    return {
      jobOrderId: e.jobOrderId,
      stepId: e.stepId,
      ...(e.overCapReason ? { overCapReason: e.overCapReason } : {}),
      jobOrderNumber: jo?.number ?? '?',
      customerName: jo?.customerName ?? '?',
      stepName: stepById(db, e.stepId)?.name ?? '?',
      rows,
      pieces: rows.reduce((s, r) => s + r.pieces, 0),
      totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
    };
  },

  toInput(doc) {
    return {
      jobOrderId: doc.jobOrderId,
      stepId: doc.stepId,
      rows: doc.rows.map((r) => ({
        lineNo: r.lineNo,
        employeeId: r.employeeId,
        pieces: r.pieces,
        ...(r.rework ? { rework: true as const } : {}),
        ...(r.rateSource === 'typed' ? { rateCents: r.rateCents } : {}),
        ...(r.rateReason ? { rateReason: r.rateReason } : {}),
        ...(r.correctionOf ? { correctionOf: r.correctionOf } : {}),
      })),
      ...(doc.overCapReason ? { overCapReason: doc.overCapReason } : {}),
    };
  },

  /** Rows paid by a payroll run stay: they are corrected with negative pieces in the next run instead (D6). */
  dependents(db, documentId) {
    const paid = db.prepare('SELECT COUNT(*) FROM prd_assignments WHERE document_id = ? AND pay_run_line_id IS NOT NULL').pluck().get(documentId) as number;
    if (paid > 0) throw conflict('PAID', 'Some of these pieces are already paid in a payroll run. Record a correction with negative pieces instead.');
    return [];
  },

  summary(doc) {
    const who = doc.rows.map((r) => `${r.employeeName} ${r.pieces}${r.kind === 'rework' ? ' rework' : r.kind === 'correction' ? ' (correction)' : ''}${doc.rows.some((x) => x.lineNo !== r.lineNo) ? ` on line ${r.lineNo}` : ''}`);
    const pay = doc.totalCents !== 0 ? ` Piece pay: ${formatPeso(doc.totalCents)}.` : ' Progress only: no piece pay.';
    return `This will record ${plural(doc.pieces)} of ${doc.stepName} for ${doc.jobOrderNumber} (${doc.customerName}): ${who.join(', ')}.${pay}`;
  },

  arbitrary(db) {
    const workers = activeEmployees(db).map((e) => e.id);
    const today = manilaDate(new Date());
    const open: { jobOrderId: string; lineNo: number; stepId: number; room: number; needsRate: boolean }[] = [];
    for (const jo of jobOrdersOf(db)) {
      for (const line of lineState(db, jo.id)) {
        const route = lineRoute(db, jo.id, line.lineNo);
        const setup = lineSetup(db, jo.id, line.lineNo);
        for (const s of route ?? []) {
          if (s.status === 'completed' || s.status === 'not_needed') continue;
          const room = Math.min(line.qty, availableFor(route!, s.id, line.qty)) - s.pieces;
          const needsRate = s.payBasis === 'piece' && !rateAt(db, setup!.garmentType, s.code, setup!.complexity, today);
          if (room > 0) open.push({ jobOrderId: jo.id, lineNo: line.lineNo, stepId: s.id, room, needsRate });
        }
      }
    }
    if (open.length === 0 || workers.length === 0) throw new Error('prd.entry.arbitrary needs an active worker and a set-up JO line with a step open for pieces');
    return fc
      .constantFrom(...open)
      .chain((o) =>
        fc.record({
          o: fc.constant(o),
          pieces: fc.integer({ min: 1, max: o.room }),
          employeeId: fc.constantFrom(...workers),
          rework: fc.option(fc.record({ employeeId: fc.constantFrom(...workers), pieces: fc.integer({ min: 1, max: 20 }), rateCents: fc.integer({ min: 0, max: 5_000 }) }), { nil: undefined }),
        }),
      )
      .map(({ o, pieces, employeeId, rework }) => ({
        jobOrderId: o.jobOrderId,
        stepId: o.stepId,
        rows: [
          { lineNo: o.lineNo, employeeId, pieces, ...(o.needsRate ? { rateCents: 4_000, rateReason: 'No rate in the table yet' } : {}) },
          ...(rework ? [{ lineNo: o.lineNo, ...rework, rework: true as const, rateReason: 'Pasubra' }] : []),
        ],
      }));
  },
};
