/**
 * Production Entry (PE-, PLAN E7 assignments, C4, D6): the pieces workers did on one step of one job order, one row per
 * worker per line, with the piece rate taken as a snapshot. It posts no journal: payroll pays the rows later (F3).
 * - Rate: from the rate table (garment type × step × complexity on the work date), or typed with a reason (an override
 *   needs rate.override, OWN-26), or none (progress only, ₱0). Rework (pasubra) is paid the same table rate unless a rate
 *   is typed (the owner's decision, Oct 2026: rates are changed in payroll, not on Record pieces; it was OWN-25).
 * - Caps (E7 rules 1–2): the pieces of a step never pass the line quantity; passing what came out of the previous step
 *   needs a reason. Rework is outside both.
 * - Cancel: only while no row is paid; after payroll, a correction row (negative pieces, same rate) goes in the next run.
 * - Work date (audit B2-F2): the day the pieces were done, today unless typed (up to 31 days back). It picks the rate and
 *   dates the row for payroll.
 * - Repeated sheet (audit B2-F3): a work row matching a recorded one (worker, job order, line, step, work date and pieces)
 *   is refused unless a reason says it is a different sheet. Rework and corrections are never refused.
 * Recording pieces moves an open JO to In production (E7 rule 3).
 * Sets (the owner's request, Oct 2026): on a line made as a set, each row is for its upper or its lower part, paid at that
 * part's rate and counted, capped and ticked per part.
 * Wearers (the owner's request, Oct 2026): on a line with a wearer list, a work row may name the wearers it finished; its
 * pieces are then their quantities, and a wearer is done once per step (until that entry is cancelled). A step takes the
 * wearers forwarded from the step before (passing that needs the over-cap reason).
 * Rework sent back (the owner's request, Oct 2026): rework rows may name the wearers sent back to the step, and may go on
 * a completed step while rework sent back to it is open.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { conflict, isBusinessDate, manilaDate, newId, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { jobOrderRef, jobOrdersOf, lineState, rosterOf } from '../../JO/public.ts';
import { rateAt } from '../../RATE/public.ts';
import { activeEmployees, employee } from '../emp.ts';
import { SET_PARTS, autoComplete, availableFor, forwardedWearers, lineRoute, lineSetup, reworkOpen, stepById, syncStage, wearersDone, type Complexity, type Part } from '../production.ts';

const MAX_PIECES = 10_000;
const MAX_RATE_CENTS = 1_000_000; // ₱10,000 per piece: a typo guard
const MAX_DAYS_BACK = 31; // a late sheet, not an old one

const row = z
  .object({
    lineNo: z.number().int().min(1).max(50),
    employeeId: z.uuid(),
    pieces: z.number().int().min(-MAX_PIECES).max(MAX_PIECES).refine((n) => n !== 0, 'Type the number of pieces.'),
    rework: z.literal(true).optional(), // pasubra: paid at its own typed rate, outside the caps
    rateCents: z.number().int().min(0).max(MAX_RATE_CENTS).optional(), // typed per piece: an override, or the rework rate
    rateReason: z.string().trim().min(5).max(200).optional(),
    correctionOf: z.uuid().optional(), // a row already paid, corrected with negative pieces (D6)
    repeatReason: z.string().trim().min(5).max(200).optional(), // why a row matching a recorded one is a different sheet
    wearers: z.array(z.number().int().min(1).max(1000)).min(1).max(1000).optional(), // the line's wearers (roster rows) this row finished
    part: z.enum(SET_PARTS).optional(), // on a set: the upper or the lower part (paid at its own rate)
  })
  .strict();

export const entryInput = z
  .object({
    jobOrderId: z.uuid(),
    stepId: z.number().int().positive(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Type the date as YYYY-MM-DD.').optional(), // default: today
    rows: z.array(row).min(1).max(50),
    overCapReason: z.string().trim().min(10).max(500).optional(),
  })
  .strict();
export type EntryInput = z.infer<typeof entryInput>;

export type RateSource = 'table' | 'typed' | 'none' | 'original';
export interface Assignment extends Omit<z.infer<typeof row>, 'part'> {
  rowNo: number;
  employeeName: string;
  kind: 'work' | 'rework' | 'correction';
  garmentType: string;
  complexity: Complexity;
  rateCents: number;
  rateSource: RateSource;
  amountCents: number;
  part: Part;
}
export interface Entry extends Omit<EntryInput, 'rows' | 'workDate'> {
  workDate: string;
  jobOrderNumber: string;
  customerName: string;
  stepName: string;
  rows: Assignment[];
  pieces: number;
  totalCents: number;
}

interface Original { id: string; jobOrderId: string; lineNo: number; stepId: number; employeeId: string; pieces: number; garmentType: string; complexity: Complexity; rateCents: number; paid: boolean; corrected: number; part: Part }
function original(db: Parameters<typeof lineState>[0], id: string): Original | undefined {
  const r = db
    .prepare(
      `SELECT a.id, a.job_order_id AS jobOrderId, a.line_no AS lineNo, a.step_id AS stepId, a.employee_id AS employeeId, a.pieces, a.garment_type AS garmentType,
         a.complexity, a.rate_cents AS rateCents, a.pay_run_line_id IS NOT NULL AS paid, a.part,
         (SELECT COALESCE(SUM(c.pieces), 0) FROM prd_assignments c JOIN documents x ON x.id = c.document_id WHERE c.correction_of_id = a.id AND x.status = 'posted') AS corrected
       FROM prd_assignments a JOIN documents d ON d.id = a.document_id WHERE a.id = ? AND d.status = 'posted' AND a.kind <> 'correction'`,
    )
    .get(id) as (Omit<Original, 'paid'> & { paid: number }) | undefined;
  return r && { ...r, paid: r.paid === 1 };
}

const plural = (n: number) => `${n} ${Math.abs(n) === 1 ? 'piece' : 'pieces'}`;

/** Recorded entries with a work row for the same worker, job order, line, step, work date and pieces (B2-F3). */
/** A recorded work row with the same worker, job order, line, step (and part), work date and pieces: a sheet typed twice? */
function sameSheet(db: Parameters<typeof lineState>[0], jobOrderId: string, stepId: number, workDate: string, r: { lineNo: number; employeeId: string; pieces: number; part: Part }): string[] {
  return db
    .prepare(
      `SELECT DISTINCT d.number FROM prd_line_assignments a JOIN documents d ON d.id = a.document_id
       WHERE d.status = 'posted' AND a.kind = 'work' AND a.jo = ? AND a.line = ? AND a.step_id = ? AND a.employee_id = ? AND a.work_date = ? AND a.pieces = ? AND a.part = ?
       ORDER BY d.number`,
    )
    .pluck()
    .all(jobOrderId, r.lineNo, stepId, r.employeeId, workDate, r.pieces, r.part) as string[];
}

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
    const workDate = input.workDate ?? ctx.businessDate;
    const rows = input.rows.map((r, i): Assignment => {
      const was = r.correctionOf ? original(ctx.db, r.correctionOf) : undefined;
      const setup = lineSetup(ctx.db, input.jobOrderId, r.lineNo);
      const garmentType = was?.garmentType ?? setup?.garmentType ?? '';
      const complexity = was?.complexity ?? setup?.complexity ?? 'standard';
      const kind = r.correctionOf ? 'correction' : r.rework ? 'rework' : 'work';
      const part: Part = was?.part ?? r.part ?? 'whole';
      const table = kind !== 'correction' && step ? rateAt(ctx.db, garmentType, step.code, complexity, isBusinessDate(workDate) ? workDate : ctx.businessDate, part) : undefined;
      const [rateCents, rateSource]: [number, RateSource] =
        r.rateCents !== undefined ? [r.rateCents, 'typed'] : was ? [was.rateCents, 'original'] : table ? [table.rateCents, 'table'] : [0, 'none'];
      return { ...r, rowNo: i + 1, employeeName: employee(ctx.db, r.employeeId)?.name ?? '?', kind, garmentType, complexity, rateCents, rateSource, amountCents: r.pieces * rateCents, part };
    });
    return {
      ...input,
      workDate,
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
    const back = (Date.parse(ctx.businessDate) - Date.parse(doc.workDate)) / 86_400_000;
    if (!isBusinessDate(doc.workDate)) add('error', 'workDate', 'WORK_DATE', `${doc.workDate} is not a date. Type the day the pieces were done.`);
    else if (back < 0) add('error', 'workDate', 'WORK_DATE', `The work date ${doc.workDate} is after today. Record pieces once they are done.`);
    else if (back > MAX_DAYS_BACK) add('error', 'workDate', 'WORK_DATE', `The work date ${doc.workDate} is more than ${MAX_DAYS_BACK} days back. Ask the accountant how to pay work that old.`);
    const jo = jobOrderRef(ctx.db, doc.jobOrderId);
    if (!jo) add('error', 'jobOrderId', 'JOB_ORDER', 'Pick a job order.');
    else if (jo.status !== 'posted') add('error', 'jobOrderId', 'JO_CANCELLED', `${jo.number} is cancelled. Record the pieces on the job order that replaced it.`);
    const step = stepById(ctx.db, doc.stepId);
    if (!step) add('error', 'stepId', 'STEP', 'Pick the step.');
    if (!jo || jo.status !== 'posted' || !step) return issues;

    const lines = lineState(ctx.db, jo.id);
    const added = new Map<string, number>(); // work pieces per line and part in this entry ("1|whole", "2|upper")
    const redone = new Map<string, number>(); // rework pieces per line and part in this entry
    const takenOff = new Map<string, number>(); // correction pieces per corrected row in this entry
    const ticked = new Map<string, Set<number>>(); // wearers ticked per line and part in this entry
    for (const r of doc.rows) {
      const [f, at] = [`rows.${r.rowNo - 1}`, `Row ${r.rowNo}`];
      const line = lines.find((l) => l.lineNo === r.lineNo);
      const route = line ? lineRoute(ctx.db, jo.id, line.lineNo) : null;
      const onRoute = route?.find((s) => s.id === step.id);
      if (!line) add('error', `${f}.lineNo`, 'LINE', `${at}: ${jo.number} has no line ${r.lineNo}.`);
      else if (!route) add('error', `${f}.lineNo`, 'NO_ROUTE', `${at}: line ${r.lineNo} has no route yet. Set it up on the board first.`);
      else if (!onRoute) add('error', `${f}.lineNo`, 'NOT_ON_ROUTE', `${at}: ${step.name} is not on the route of line ${r.lineNo}.`);
      else if (r.kind !== 'correction' && (onRoute.status === 'completed' || onRoute.status === 'not_needed')
        && !(r.kind === 'rework' && reworkOpen(ctx.db, jo.id, r.lineNo, step.id, r.part).pieces > 0)) {
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
      if (r.kind === 'work' && r.rateSource === 'typed' && !ctx.can('rate.override')) add('error', `${f}.rateCents`, 'RATE_OVERRIDE', `${at}: you cannot type a different piece rate. Leave it to the rate table or ask the owner.`);
      if (r.kind !== 'work' && r.repeatReason) add('error', `${f}.repeatReason`, 'REPEAT_REASON', `${at}: a repeat reason goes with normal work only. Rework and corrections are never taken for a repeated sheet.`);
      // Wearers ticked say which garments the row is for, and each is done once per step: such a row is never a repeated sheet.
      const repeats = r.kind === 'work' && line && !r.repeatReason && !r.wearers ? sameSheet(ctx.db, jo.id, step.id, doc.workDate, r) : [];
      if (repeats.length > 0) {
        add('error', `${f}.repeatReason`, 'LIKELY_REPEAT', `${at}: ${repeats.join(', ')} already has ${plural(r.pieces)} of ${step.name} by ${r.employeeName} on line ${r.lineNo} dated ${doc.workDate}. If this is a different sheet, say why; if the pieces were redone, record them as rework.`);
      }
      const what = `${r.garmentType} (${r.complexity})`;
      if (onRoute && r.kind !== 'correction' && r.rateSource === 'none' && step.payBasis === 'piece') add('error', `${f}.rateCents`, 'NO_RATE', `${at}: there is no ${step.name} rate for ${what}. Type the rate and a reason.`);
      if (onRoute && r.kind !== 'correction' && r.rateSource === 'none' && step.payBasis === 'piece_or_daily') add('warning', `${f}.rateCents`, 'NO_RATE', `${at}: there is no ${step.name} rate for ${what}, so these pieces count as progress only (₱0).`);
      const isSet = !!line && !!lineSetup(ctx.db, jo.id, line.lineNo)?.isSet;
      if (line && isSet && r.kind !== 'correction' && r.part === 'whole') add('error', `${f}.part`, 'PART_REQUIRED', `${at}: line ${line.lineNo} is a set. Pick the upper or the lower part.`);
      if (line && !isSet && r.part !== 'whole') add('error', `${f}.part`, 'PART_NOT_SET', `${at}: line ${line.lineNo} is not a set, so it has no upper or lower part.`);
      if (line && r.kind === 'work') added.set(`${line.lineNo}|${r.part}`, (added.get(`${line.lineNo}|${r.part}`) ?? 0) + r.pieces);
      if (line && r.kind === 'rework') redone.set(`${line.lineNo}|${r.part}`, (redone.get(`${line.lineNo}|${r.part}`) ?? 0) + r.pieces);
      if (r.wearers && line) {
        if (r.kind === 'correction') add('error', `${f}.wearers`, 'WEARERS_KIND', `${at}: wearers are ticked on work and rework only, not on a correction.`);
        const roster = new Map(rosterOf(ctx.db, jo.id, line.lineNo).map((w) => [w.rowNo, w]));
        const done = wearersDone(ctx.db, jo.id, line.lineNo, step.id, r.part);
        // Rework is for a wearer done on this step, or sent back to it; a wearer still to come is not listed.
        const sentBack = new Set(r.kind === 'rework' ? [...reworkOpen(ctx.db, jo.id, line.lineNo, step.id, r.part).wearers, ...done.keys()] : []);
        const forwarded = r.kind === 'work' && route && onRoute ? forwardedWearers(ctx.db, jo.id, line.lineNo, route, step.id, r.part) : null;
        const key = `${line.lineNo}|${r.part}|${r.kind}`;
        const mine = ticked.get(key) ?? new Set<number>();
        let pieces = 0;
        for (const n of r.wearers) {
          const w = roster.get(n);
          if (!w) { add('error', `${f}.wearers`, 'WEARER', `${at}: line ${line.lineNo} has no wearer ${n}.`); continue; }
          if (r.kind === 'rework' && !sentBack.has(n)) add('error', `${f}.wearers`, 'WEARER_NOT_DONE', `${at}: ${w.wearerName} is not done on ${step.name} yet, so there is nothing to rework.`);
          else if (r.kind === 'work' && done.has(n)) add('error', `${f}.wearers`, 'WEARER_DONE', `${at}: ${w.wearerName}${r.part !== 'whole' ? ` (${r.part} part)` : ''} is already done on ${step.name} (${done.get(n)}).`);
          else if (mine.has(n)) add('error', `${f}.wearers`, 'WEARER_TWICE', `${at}: ${w.wearerName} is ticked on two rows of this entry.`);
          else if (forwarded && !forwarded.includes(n) && !doc.overCapReason) {
            add('error', 'overCapReason', 'WEARER_NOT_FORWARDED', `${at}: ${w.wearerName}${r.part !== 'whole' ? ` (${r.part} part)` : ''} has not come out of the step before ${step.name} yet. Give a reason to record it anyway.`);
          }
          mine.add(n);
          pieces += w.qty;
        }
        ticked.set(key, mine);
        if (r.kind !== 'correction' && pieces !== r.pieces) add('error', `${f}.pieces`, 'WEARERS_PIECES', `${at}: the wearers ticked are ${plural(pieces)}, so the row is ${pieces}, not ${r.pieces}.`);
      }
    }
    // Rework (the owner's rule, Oct 2026): at most the pieces done on the step, since only those can be redone.
    for (const [key, pieces] of redone) {
      const [lineNo, part] = [Number(key.split('|')[0]), key.split('|')[1] as Part];
      const here = lineRoute(ctx.db, jo.id, lineNo)?.find((s) => s.id === step.id);
      if (!here) continue;
      // What is done there, or the rework that reached it (sent back before this step had those pieces).
      const done = Math.max(part !== 'whole' && here.parts ? here.parts[part].pieces : here.pieces, reworkOpen(ctx.db, jo.id, lineNo, step.id, part).pieces);
      if (pieces > done) add('error', 'rows', 'REWORK_OVER', `Line ${lineNo} has ${plural(done)} done on ${step.name}, so at most ${done} can be recorded as rework.`);
    }
    for (const [key, pieces] of added) {
      const [lineNo, part] = [Number(key.split('|')[0]), key.split('|')[1] as Part];
      const line = lines.find((l) => l.lineNo === lineNo)!;
      const route = lineRoute(ctx.db, jo.id, lineNo);
      const here = route?.find((s) => s.id === step.id);
      if (!route || !here) continue;
      const before = part !== 'whole' && here.parts ? here.parts[part].pieces : here.pieces;
      const of = part !== 'whole' ? `${part} parts` : 'pieces';
      const after = before + pieces;
      if (after > line.qty) {
        const left = Math.max(0, line.qty - before);
        add('error', 'rows', 'OVER_QTY', `Line ${lineNo} is ${plural(line.qty)} and ${before} ${of} of ${step.name} are recorded, so at most ${left} more. Pieces done again go in as rework (pasubra).`);
      } else if (after > availableFor(route, step.id, line.qty, part) && !doc.overCapReason) {
        const avail = availableFor(route, step.id, line.qty, part);
        add('error', 'overCapReason', 'OVER_CAP', `Only ${avail} ${of} of line ${lineNo} came out of the step before ${step.name}. Give a reason to record more.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO prd_entries (document_id, job_order_id, step_id, over_cap_reason) VALUES (?, ?, ?, ?)').run(h.documentId, doc.jobOrderId, doc.stepId, doc.overCapReason ?? null);
    const ins = db.prepare(
      `INSERT INTO prd_assignments (id, document_id, row_no, job_order_id, line_no, step_id, employee_id, employee_name, work_date, kind, pieces, garment_type, complexity,
         rate_cents, rate_source, rate_reason, amount_cents, correction_of_id, part) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of doc.rows) {
      const id = newId();
      ins.run(id, h.documentId, r.rowNo, doc.jobOrderId, r.lineNo, doc.stepId, r.employeeId, r.employeeName, doc.workDate, r.kind, r.pieces, r.garmentType, r.complexity,
        r.rateCents, r.rateSource, r.rateSource === 'typed' ? r.rateReason! : null, r.amountCents, r.correctionOf ?? null, r.part);
      if (r.repeatReason) db.prepare('INSERT INTO prd_assignment_repeats (assignment_id, reason) VALUES (?, ?)').run(id, r.repeatReason);
      for (const n of r.wearers ?? []) db.prepare('INSERT INTO prd_assignment_wearers (assignment_id, roster_row_no) VALUES (?, ?)').run(id, n);
    }
    const who = db.prepare('SELECT posted_by AS userId, posted_at AS at FROM documents WHERE id = ?').get(h.documentId) as { userId: string; at: string };
    // A step whose pieces (and rework) are all recorded completes on its own (the owner's rule, Oct 2026).
    // Every step of the lines touched, so a step left with all its pieces before this rule completes too.
    for (const lineNo of new Set(doc.rows.map((r) => r.lineNo))) {
      for (const s of lineRoute(db, doc.jobOrderId, lineNo) ?? []) autoComplete(db, doc.jobOrderId, lineNo, s.id, who);
    }
    syncStage(db, doc.jobOrderId, `${h.number}: ${doc.stepName} pieces recorded`, who);
  },

  load(db, documentId) {
    const e = db.prepare('SELECT job_order_id AS jobOrderId, step_id AS stepId, over_cap_reason AS overCapReason FROM prd_entries WHERE document_id = ?').get(documentId) as
      | { jobOrderId: string; stepId: number; overCapReason: string | null }
      | undefined;
    if (!e) throw new Error(`Production entry ${documentId} not found`);
    const stored = (
      db
        .prepare(
          `SELECT row_no AS rowNo, line_no AS lineNo, employee_id AS employeeId, employee_name AS employeeName, kind, pieces, garment_type AS garmentType, complexity,
             rate_cents AS rateCents, rate_source AS rateSource, rate_reason AS rateReason, amount_cents AS amountCents, correction_of_id AS correctionOf, part,
             work_date AS workDate, (SELECT reason FROM prd_assignment_repeats WHERE assignment_id = a.id) AS repeatReason,
             (SELECT json_group_array(roster_row_no) FROM (SELECT roster_row_no FROM prd_assignment_wearers WHERE assignment_id = a.id ORDER BY roster_row_no)) AS wearers
           FROM prd_assignments a WHERE document_id = ? ORDER BY row_no`,
        )
        .all(documentId) as (Omit<Assignment, 'rework' | 'rateReason' | 'correctionOf' | 'repeatReason' | 'wearers'> & { rateReason: string | null; correctionOf: string | null; repeatReason: string | null; workDate: string; wearers: string })[]
    );
    const rows = stored.map(({ rateReason, correctionOf, repeatReason, workDate: _, wearers, ...r }): Assignment => ({
      ...r,
      ...((JSON.parse(wearers) as number[]).length > 0 ? { wearers: JSON.parse(wearers) as number[] } : {}),
      ...(r.kind === 'rework' ? { rework: true as const } : {}),
      ...(rateReason ? { rateReason } : {}),
      ...(correctionOf ? { correctionOf } : {}),
      ...(repeatReason ? { repeatReason } : {}),
    }));
    const jo = jobOrderRef(db, e.jobOrderId);
    return {
      jobOrderId: e.jobOrderId,
      stepId: e.stepId,
      workDate: stored[0]?.workDate ?? '',
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
      workDate: doc.workDate,
      rows: doc.rows.map((r) => ({
        lineNo: r.lineNo,
        employeeId: r.employeeId,
        pieces: r.pieces,
        ...(r.rework ? { rework: true as const } : {}),
        ...(r.rateSource === 'typed' ? { rateCents: r.rateCents } : {}),
        ...(r.rateReason ? { rateReason: r.rateReason } : {}),
        ...(r.correctionOf ? { correctionOf: r.correctionOf } : {}),
        ...(r.repeatReason ? { repeatReason: r.repeatReason } : {}),
        ...(r.wearers ? { wearers: r.wearers } : {}),
        ...(r.part !== 'whole' && r.kind !== 'correction' ? { part: r.part as 'upper' | 'lower' } : {}),
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

  summary(doc, ctx) {
    const who = doc.rows.map((r) => `${r.employeeName} ${r.pieces}${r.part !== 'whole' ? ` ${r.part}` : ''}${r.kind === 'rework' ? ' rework' : r.kind === 'correction' ? ' (correction)' : ''}${doc.rows.some((x) => x.lineNo !== r.lineNo) ? ` on line ${r.lineNo}` : ''}`);
    const late = doc.workDate !== ctx.businessDate ? ` done on ${doc.workDate}` : '';
    return `This will record ${plural(doc.pieces)} of ${doc.stepName}${late} for ${doc.jobOrderNumber} (${doc.customerName}): ${who.join(', ')}.`; // no piece pay: it shows in payroll (the owner's decision, Oct 2026)
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
