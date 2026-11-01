/**
 * The floor app (the owner's request, Nov 2026): a production worker's own phone screens. The signed-in account is linked
 * to one employee (EMP floor-users), and everything here is that employee's own:
 * - Today: this pay week's earnings (Friday to Thursday, or Monday to Saturday: setting pay.week_start) and their work:
 *   the job order lines and steps they worked in the last three weeks with pieces still left on the step.
 * - A job: its lines, each step with its pieces and what is left, and the wearers done on each step.
 * - Record: their own pieces on one step of one line, dated today, through a Production Entry (prd.entry) like any
 *   other, so every rule of Record pieces applies (caps, wearers, sets, a sheet typed twice). The worker's role does not
 *   hold prd.assign (recording anyone's pieces); this one route records only theirs, today.
 * - Earnings: the week by day and by job, and the past weeks, paid or not.
 */
import { z } from 'zod';
import { AppError, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import type { EngineEnv } from '../../engine/documents/lifecycle.ts';
import { postDocument, previewDocument } from '../../engine/documents/lifecycle.ts';
import { employeeOfUser } from '../EMP/public.ts';
import { jobOrderRef, lineState, liveReplacementOf } from '../JO/public.ts';
import { rateAt } from '../RATE/public.ts';
import { entryDoc } from './doctypes/entry.ts';
import { SET_PARTS, availableFor, lineRoute, lineSetup, type Part } from './production.ts';

/** YYYY-MM-DD plus some days, as calendar arithmetic on the date alone (no clock, no time zone). */
const addDays = (d: string, n: number) => {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** The employee the signed-in account is on the floor app, or a refusal that says what to do. */
export function floorWorker(db: Db, userId: string) {
  const e = employeeOfUser(db, userId);
  if (!e) throw new AppError('FLOOR_NOT_LINKED', 'Your sign-in is not linked to an employee yet. Ask the office to link it on your employee page.', 403);
  return e;
}

/** The pay week holding a day: from its Friday (or Monday, as setting pay.week_start says on that day), seven days. */
export function payWeekOf(db: Db, day: string): { from: string; to: string } {
  const start = (JSON.parse((db.prepare("SELECT value_json FROM settings WHERE key = 'pay.week_start' AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1").pluck().get(day) as string | undefined) ?? '"monday"') as string) === 'friday' ? 5 : 1;
  const from = addDays(day, -((weekday(day) - start + 7) % 7));
  return { from, to: addDays(from, 6) };
}

const POSTED = "JOIN documents d ON d.id = a.document_id AND d.status = 'posted'";

/** One week of the worker's pieces: by day, by job and step, and the total; paid when every row of it is in a payroll. */
function weekOf(db: Db, employeeId: string, week: { from: string; to: string }) {
  const rows = db.prepare(`SELECT a.work_date AS date, a.job_order_id AS jobOrderId, s.name AS stepName, a.rate_cents AS rateCents, SUM(a.pieces) AS pieces, SUM(a.amount_cents) AS amountCents,
      SUM(a.pay_run_line_id IS NULL) AS unpaid
    FROM prd_assignments a ${POSTED} JOIN prd_steps s ON s.id = a.step_id
    WHERE a.employee_id = ? AND a.work_date BETWEEN ? AND ? GROUP BY a.work_date, a.job_order_id, a.step_id, a.rate_cents ORDER BY a.work_date`)
    .all(employeeId, week.from, week.to) as { date: string; jobOrderId: string; stepName: string; rateCents: number; pieces: number; amountCents: number; unpaid: number }[];
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.from, i)).map((date) => {
    const of = rows.filter((r) => r.date === date);
    return { date, pieces: of.reduce((s, r) => s + r.pieces, 0), amountCents: of.reduce((s, r) => s + r.amountCents, 0) };
  });
  const jobs = new Map<string, { jobOrderNumber: string; stepName: string; rateCents: number; pieces: number; amountCents: number }>();
  for (const r of rows) {
    const key = `${r.jobOrderId}|${r.stepName}|${r.rateCents}`;
    const j = jobs.get(key) ?? { jobOrderNumber: jobOrderRef(db, r.jobOrderId)?.number ?? '?', stepName: r.stepName, rateCents: r.rateCents, pieces: 0, amountCents: 0 };
    j.pieces += r.pieces; j.amountCents += r.amountCents;
    jobs.set(key, j);
  }
  return {
    ...week, days, jobs: [...jobs.values()],
    pieces: rows.reduce((s, r) => s + r.pieces, 0), amountCents: rows.reduce((s, r) => s + r.amountCents, 0),
    paid: rows.length > 0 && rows.every((r) => r.unpaid === 0),
  };
}

/** Today's screen: the week so far, the work with pieces left, and the two weeks before. */
export function floorToday(db: Db, userId: string, today: string) {
  const me = floorWorker(db, userId);
  const week = payWeekOf(db, today);
  // The lines and steps worked lately, with pieces still left on the step.
  const worked = db.prepare(`SELECT a.job_order_id AS jobOrderId, a.line_no AS lineNo, a.step_id AS stepId, MAX(a.work_date) AS last
    FROM prd_assignments a ${POSTED} WHERE a.employee_id = ? AND a.work_date >= ? GROUP BY a.job_order_id, a.line_no, a.step_id ORDER BY last DESC LIMIT 30`)
    .all(me.id, addDays(today, -21)) as { jobOrderId: string; lineNo: number; stepId: number }[];
  const work = worked.flatMap((w) => {
    const jo = jobOrderRef(db, w.jobOrderId);
    const line = lineState(db, w.jobOrderId).find((l) => l.lineNo === w.lineNo);
    const route = lineRoute(db, w.jobOrderId, w.lineNo);
    const step = route?.find((s) => s.id === w.stepId);
    if (!jo || !line || !route || !step || step.status === 'completed' || step.status === 'not_needed' || jo.status === 'cancelled') return [];
    const left = Math.max(0, line.qty - step.pieces);
    if (left === 0) return [];
    return [{ jobOrderId: jo.id, jobOrderNumber: jo.number, customerName: jo.customerName, dueDate: jo.dueDate, lineNo: line.lineNo, description: line.description,
      stepId: step.id, stepName: step.name, qty: line.qty, done: step.pieces, left }];
  });
  return {
    employee: { name: me.name, code: me.code }, today, week: weekOf(db, me.id, week), work,
    pastWeeks: [1, 2].map((n) => weekOf(db, me.id, payWeekOf(db, addDays(week.from, -7 * n)))).map(({ from, to, pieces, amountCents, paid }) => ({ from, to, pieces, amountCents, paid })),
  };
}

/** A job order as the worker sees it: each line's steps with pieces and what is left, the wearers, and their rate. */
export function floorJob(db: Db, userId: string, ref: string, today: string) {
  floorWorker(db, userId);
  // A ticket's QR or a typed number: "231", "JO-000231" or the id; an edited job order opens its replacement.
  const t = ref.trim().toUpperCase();
  const number = /^\d{1,6}$/.test(t) ? `JO-${t.padStart(6, '0')}` : t;
  const id = (db.prepare("SELECT id FROM documents WHERE number = ? AND doc_type = 'jo.job_order'").pluck().get(number) as string | undefined) ?? ref.trim();
  const found = jobOrderRef(db, id);
  const jo = found?.status === 'cancelled' ? liveReplacementOf(db, found.id) : found;
  if (!jo) throw notFound('That job order');
  const lines = lineState(db, jo.id).flatMap((l) => {
    const route = lineRoute(db, jo.id, l.lineNo);
    const setup = lineSetup(db, jo.id, l.lineNo);
    if (!route || !setup) return []; // not set up for production yet
    const parts: Part[] = setup.isSet ? [...SET_PARTS] : ['whole'];
    return [{
      lineNo: l.lineNo, description: l.description, qty: l.qty, isSet: setup.isSet, garmentType: setup.garmentType,
      steps: route.map((s) => ({
        id: s.id, name: s.name, status: s.status, pieces: s.pieces, available: availableFor(route, s.id, l.qty), payBasis: s.payBasis,
        rates: parts.map((part) => ({ part, rateCents: s.payBasis === 'daily' ? null : rateAt(db, setup.garmentType, s.code, setup.complexity, today, part)?.rateCents ?? null })),
      })),
    }];
  });
  return { jobOrder: { id: jo.id, number: jo.number, customerName: jo.customerName, dueDate: jo.dueDate, status: jo.status }, lines };
}

export const floorRecordInput = z.object({
  jobOrderId: z.uuid(),
  lineNo: z.number().int().min(1).max(50),
  stepId: z.number().int().positive(),
  pieces: z.number().int().min(1).max(10_000),
  wearers: z.array(z.number().int().min(1).max(1000)).min(1).max(1000).optional(),
  part: z.enum(SET_PARTS).optional(),
  // The same pieces on the same line and step already recorded today: a second batch, confirmed by the worker.
  again: z.literal(true).optional(),
}).strict();

/**
 * Records the worker's own pieces, today, as a Production Entry. The entry's own rules decide (caps, wearers, a sheet
 * typed twice); its errors come back in words. The worker's role holds prd.floor, not prd.assign: the entry is recorded
 * with prd.assign for this one document, whose only row is the signed-in worker's, dated today.
 */
export function floorRecord(env: EngineEnv, user: { userId: string; permissions: ReadonlySet<string> }, raw: unknown) {
  const v = floorRecordInput.parse(raw);
  const me = floorWorker(env.db, user.userId);
  const input = {
    jobOrderId: v.jobOrderId, stepId: v.stepId,
    rows: [{ lineNo: v.lineNo, employeeId: me.id, pieces: v.pieces, ...(v.wearers ? { wearers: v.wearers } : {}), ...(v.part ? { part: v.part } : {}),
      ...(v.again ? { repeatReason: 'Another batch, recorded on the floor app' } : {}) }],
  };
  const actor = { userId: user.userId, permissions: new Set([...user.permissions, 'prd.assign', 'prd.view']) };
  const preview = previewDocument(env, entryDoc, actor, input);
  const errors = preview.issues.filter((i) => i.level === 'error');
  if (errors.length) {
    const repeat = errors.find((i) => i.code === 'LIKELY_REPEAT');
    throw new AppError(repeat ? 'ALREADY_TODAY' : errors[0]!.code, repeat ? `You already recorded ${v.pieces} pieces here today. Is this another batch?` : errors.map((i) => i.message).join(' '), 422);
  }
  const posted = postDocument(env, entryDoc, actor, { input, expectedTotalCents: preview.totalCents });
  return { number: posted.number, pieces: v.pieces, amountCents: posted.totalCents };
}
