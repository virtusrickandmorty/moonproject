/**
 * The floor app's bell (the owner's request, Nov 2026): each worker is told of the jobs coming to their own steps and of
 * those falling due, worked out each time from the open jobs with pieces left on their steps (checks.ts openJobsFor).
 * - A new job: a job order line put on one of their steps in the last 7 days.
 * - Due: a job on their steps, due tomorrow, due today, or late; each of the three is told once.
 * Only what each worker has read is kept (prd_floor_reads); someone else reading theirs leaves this one's unread.
 */
import { z } from 'zod';
import { manilaDate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { openJobsFor } from './checks.ts';
import { addDays, floorWorker } from './floor.ts';

export const NEW_JOB_DAYS = 7;
export type FloorNoteKind = 'late' | 'today' | 'tomorrow' | 'new';
const ORDER: FloorNoteKind[] = ['late', 'today', 'tomorrow', 'new'];

export interface FloorNote {
  id: string; kind: FloorNoteKind; read: boolean;
  jobOrderNumber: string; customerName: string; dueDate: string; rush: boolean;
  lineNo: number; description: string; stepId: number; stepName: string; left: number; ready: number;
  /** A new job: when it was put on the step. */
  at?: string;
}

/** The worker's notifications, the late and due first, then the new jobs, newest first; with whether each is read. */
export function floorNotifications(db: Db, userId: string, today: string): FloorNote[] {
  const me = floorWorker(db, userId);
  const reads = new Set(db.prepare('SELECT notification_key FROM prd_floor_reads WHERE user_id = ?').pluck().all(userId) as string[]);
  // When the step first came on the line's production setup (a later change may add it).
  const putOn = db.prepare(`SELECT MIN(s.at) FROM prd_line_setups s
      JOIN prd_line_setup_steps t ON t.job_order_id = s.job_order_id AND t.line_no = s.line_no AND t.seq = s.seq
    WHERE s.job_order_id = ? AND s.line_no = ? AND t.step_id = ?`).pluck();
  const tomorrow = addDays(today, 1);
  const since = addDays(today, -NEW_JOB_DAYS);
  const notes = openJobsFor(db, me.id).jobs.flatMap((j) => {
    const job = { jobOrderNumber: j.jobOrderNumber, customerName: j.customerName, dueDate: j.dueDate, rush: j.rush,
      lineNo: j.lineNo, description: j.description, stepId: j.stepId, stepName: j.stepName, left: j.left, ready: j.ready };
    const where = `${j.jobOrderId}:${j.lineNo}:${j.stepId}`;
    const out: FloorNote[] = [];
    const due: FloorNoteKind | null = j.dueDate < today ? 'late' : j.dueDate === today ? 'today' : j.dueDate === tomorrow ? 'tomorrow' : null;
    if (due) out.push({ id: `due:${where}:${due}`, kind: due, read: false, ...job });
    const at = putOn.get(j.jobOrderId, j.lineNo, j.stepId) as string | null;
    if (at && manilaDate(new Date(at)) >= since) out.push({ id: `new:${where}`, kind: 'new', read: false, ...job, at });
    return out;
  }).map((n) => ({ ...n, read: reads.has(n.id) }));
  return notes.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.kind === 'new' ? (b.at ?? '').localeCompare(a.at ?? '')
    : a.dueDate.localeCompare(b.dueDate)) || a.jobOrderNumber.localeCompare(b.jobOrderNumber) || a.lineNo - b.lineNo);
}

export const floorReadInput = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(200) }).strict();

/** Marks the worker's own notifications read (those on their bell now; any other id is left alone). Run in a transaction. */
export function readFloorNotifications(db: Db, userId: string, raw: unknown, today: string, at: string): { read: number } {
  const { ids } = floorReadInput.parse(raw);
  const mine = new Set(floorNotifications(db, userId, today).filter((n) => !n.read).map((n) => n.id));
  const ins = db.prepare('INSERT INTO prd_floor_reads (user_id, notification_key, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, notification_key) DO NOTHING');
  const read = ids.filter((id) => mine.has(id));
  for (const id of read) ins.run(userId, id, at);
  return { read: read.length };
}
