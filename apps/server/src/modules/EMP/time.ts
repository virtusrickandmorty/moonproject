/**
 * Time (PLAN E11): the attendance day grid, the holiday calendar and service incentive leave (SIL). Attendance is typed
 * by the encoder or accountant; a change to a day is a new row and the latest counts. Holidays are added and switched off
 * by the accountant. Payroll reads all of it through EMP/public.ts.
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, manilaDate, notFound, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { date, employeeRecord, type Who } from './employees.ts';

export const ATTENDANCE = ['present', 'half_day', 'absent', 'rest_day', 'leave', 'unpaid_leave', 'holiday_off', 'holiday_worked', 'rest_day_worked'] as const;
export type AttendanceStatus = (typeof ATTENDANCE)[number];
/** Statuses allowed on a holiday, and off one (a worked holiday is "holiday worked", so its premium is never missed). */
const ON_HOLIDAY = new Set<AttendanceStatus>(['holiday_off', 'holiday_worked', 'rest_day', 'rest_day_worked']);
const OFF_HOLIDAY = new Set<AttendanceStatus>(['present', 'half_day', 'absent', 'rest_day', 'leave', 'unpaid_leave', 'rest_day_worked']);
const WITH_OT = new Set<AttendanceStatus>(['present', 'holiday_worked', 'rest_day_worked']);
export const SIL_DAYS = 5; // a year, after one year of service (Labor Code Art. 95)
const MAX_RANGE_DAYS = 31;

export interface Holiday { id: number; date: string; name: string; kind: 'regular' | 'special'; source: string; isActive: boolean; deactivatedReason: string | null }
const HOLIDAY = `SELECT id, holiday_date AS date, name, kind, source, is_active AS isActive, deactivated_reason AS deactivatedReason FROM emp_holidays`;
const asHoliday = (r: Omit<Holiday, 'isActive'> & { isActive: number }): Holiday => ({ ...r, isActive: r.isActive === 1 });

/** Active holidays from one date to another, both included. */
export const holidaysBetween = (db: Db, from: string, to: string): Holiday[] =>
  (db.prepare(`${HOLIDAY} WHERE is_active = 1 AND holiday_date BETWEEN ? AND ? ORDER BY holiday_date`).all(from, to) as (Omit<Holiday, 'isActive'> & { isActive: number })[]).map(asHoliday);

/** Every holiday of a year, switched-off ones included (the holidays screen). */
export const holidaysOf = (db: Db, year: number): Holiday[] =>
  (db.prepare(`${HOLIDAY} WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date, id`).all(`${year}-01-01`, `${year}-12-31`) as (Omit<Holiday, 'isActive'> & { isActive: number })[]).map(asHoliday);

export const holidayInput = z.object({ date, name: z.string().trim().min(3).max(80), kind: z.enum(['regular', 'special']), source: z.string().trim().min(10).max(200) }).strict();

export function addHoliday(db: Db, raw: unknown, who: Who): Holiday {
  const v = holidayInput.parse(raw);
  const taken = holidaysBetween(db, v.date, v.date)[0];
  if (taken) throw conflict('HOLIDAY_TAKEN', `${v.date} is already ${taken.name}. Switch that one off first.`);
  const id = Number(
    db.prepare('INSERT INTO emp_holidays (holiday_date, name, kind, source, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(v.date, v.name, v.kind, v.source, who.at, who.userId).lastInsertRowid,
  );
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.holiday.add', entityType: 'emp.holiday', entityId: String(id), data: v });
  return holidaysOf(db, Number(v.date.slice(0, 4))).find((h) => h.id === id)!;
}

export function deactivateHoliday(db: Db, id: number, raw: unknown, who: Who): Holiday {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(300) }).strict().parse(raw);
  const h = db.prepare(`${HOLIDAY} WHERE id = ?`).get(id) as (Omit<Holiday, 'isActive'> & { isActive: number }) | undefined;
  if (!h) throw notFound('The holiday');
  if (!h.isActive) throw conflict('ALREADY_OFF', `${h.name} (${h.date}) is already switched off.`);
  const marked = db.prepare(`SELECT COUNT(*) FROM (${LATEST}) WHERE work_date = ? AND status IN ('holiday_off','holiday_worked')`).pluck().get(h.date) as number;
  if (marked > 0) throw conflict('HOLIDAY_USED', `Attendance on ${h.date} is marked as a holiday for ${marked} ${marked === 1 ? 'person' : 'people'}. Change those days first.`);
  db.prepare('UPDATE emp_holidays SET is_active = 0, deactivated_reason = ? WHERE id = ?').run(reason, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.holiday.deactivate', entityType: 'emp.holiday', entityId: String(id), data: { date: h.date, name: h.name, reason } });
  return { ...asHoliday(h), isActive: false, deactivatedReason: reason };
}

export interface AttendanceDay { employeeId: string; date: string; status: AttendanceStatus; otMinutes: number; note: string | null }
/** The latest row of every employee-day. */
const LATEST = `SELECT a.employee_id, a.work_date, a.status, a.ot_minutes, a.note FROM emp_attendance a
  WHERE a.seq = (SELECT MAX(x.seq) FROM emp_attendance x WHERE x.employee_id = a.employee_id AND x.work_date = a.work_date)`;

/** Attendance from one date to another (both included), for one employee or all. */
export function attendanceBetween(db: Db, from: string, to: string, employeeId?: string): AttendanceDay[] {
  return db
    .prepare(
      `SELECT employee_id AS employeeId, work_date AS date, status, ot_minutes AS otMinutes, note FROM (${LATEST})
       WHERE work_date BETWEEN @from AND @to AND (@e IS NULL OR employee_id = @e) ORDER BY employee_id, work_date`,
    )
    .all({ from, to, e: employeeId ?? null }) as AttendanceDay[];
}

export const addDays = (d: string, n: number) => manilaDate(new Date(Date.parse(`${d}T00:00:00+08:00`) + n * 86_400_000));
export function checkRange(from: string, to: string) {
  if (to < from) throw badRequest('BAD_RANGE', 'The end date is before the start date.');
  if (addDays(from, MAX_RANGE_DAYS - 1) < to) throw badRequest('BAD_RANGE', `Show at most ${MAX_RANGE_DAYS} days at a time.`);
}

/** SIL for a year (PLAN E11): 5 days once the employee has worked a year; days taken are "leave" in attendance. */
export function silOf(db: Db, employeeId: string, year: number) {
  const e = employeeRecord(db, employeeId);
  if (!e) throw notFound('The employee');
  const eligibleFrom = `${Number(e.hireDate.slice(0, 4)) + 1}${e.hireDate.slice(4)}`.replace(/-02-29$/, '-03-01');
  const used = db.prepare(`SELECT COUNT(*) FROM (${LATEST}) WHERE employee_id = ? AND status = 'leave' AND work_date BETWEEN ? AND ?`).pluck().get(employeeId, `${year}-01-01`, `${year}-12-31`) as number;
  return { year, eligibleFrom, daysPerYear: SIL_DAYS, used, left: eligibleFrom <= `${year}-12-31` ? Math.max(0, SIL_DAYS - used) : 0 };
}

const day = z.object({ employeeId: z.uuid(), date, status: z.enum(ATTENDANCE), otMinutes: z.number().int().min(0).max(960).optional(), note: z.string().trim().max(200).optional() }).strict();
export const attendanceInput = z.object({ days: z.array(day).min(1).max(1000) }).strict();

const LABEL: Record<AttendanceStatus, string> = {
  present: 'Present', half_day: 'Half day', absent: 'Absent', rest_day: 'Rest day', leave: 'Leave (SIL)', unpaid_leave: 'Unpaid leave',
  holiday_off: 'Holiday off', holiday_worked: 'Holiday worked', rest_day_worked: 'Rest day worked',
};

/**
 * Saves grid cells. Every cell is checked first and nothing is saved if one is wrong: the day must be within the
 * employee's service and not in the future; holidays take the holiday statuses; overtime goes only with a worked day;
 * SIL needs a year of service and at most 5 days a year. Unchanged cells are skipped. Call inside a transaction.
 */
export function saveAttendance(db: Db, raw: unknown, who: Who): { saved: number; unchanged: number } {
  const { days } = attendanceInput.parse(raw);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const current = db.prepare(`SELECT status, ot_minutes AS otMinutes, note FROM (${LATEST}) WHERE employee_id = ? AND work_date = ?`);
  const silTaken = new Map<string, number>(); // employee|year -> SIL days after this save
  const changed: (z.infer<typeof day> & { otMinutes: number; seq: number })[] = [];
  days.forEach((d, i) => {
    const f = `days.${i}`;
    const add = (code: string, message: string, field = f) => issues.push({ field, code, message, level: 'error' });
    const e = employeeRecord(db, d.employeeId);
    if (!e) return add('EMPLOYEE', `Row ${i + 1}: the employee was not found.`);
    const at = `${e.fullName} on ${d.date}`;
    if (seen.has(`${d.employeeId}|${d.date}`)) return add('DUPLICATE', `${at} is in the list twice.`);
    seen.add(`${d.employeeId}|${d.date}`);
    if (d.date < e.hireDate) return add('NOT_EMPLOYED', `${at}: that is before the hire date (${e.hireDate}).`);
    if (e.separatedOn && d.date > e.separatedOn) return add('NOT_EMPLOYED', `${at}: that is after the last day (${e.separatedOn}).`);
    if (d.date > who.today) return add('FUTURE', `${at}: attendance is typed on or after the day.`);
    const holiday = holidaysBetween(db, d.date, d.date)[0];
    if (holiday && !ON_HOLIDAY.has(d.status)) add('HOLIDAY', `${at} is ${holiday.name}: mark it Holiday worked, Holiday off, Rest day or Rest day worked.`, `${f}.status`);
    if (!holiday && !OFF_HOLIDAY.has(d.status)) add('NOT_HOLIDAY', `${at} is not a holiday on the calendar, so it cannot be ${LABEL[d.status]}.`, `${f}.status`);
    const ot = d.otMinutes ?? 0;
    if (ot > 0 && !WITH_OT.has(d.status)) add('OT', `${at}: overtime goes only with a worked day.`, `${f}.otMinutes`);
    const was = current.get(d.employeeId, d.date) as { status: AttendanceStatus; otMinutes: number; note: string | null } | undefined;
    if (was && was.status === d.status && was.otMinutes === ot && (was.note ?? undefined) === d.note) return;
    if (d.status === 'leave' || was?.status === 'leave') {
      const year = Number(d.date.slice(0, 4));
      const key = `${d.employeeId}|${year}`;
      const sil = silOf(db, d.employeeId, year);
      const n = (silTaken.get(key) ?? sil.used) + (d.status === 'leave' ? 1 : 0) - (was?.status === 'leave' ? 1 : 0);
      silTaken.set(key, n);
      if (d.status === 'leave' && d.date < sil.eligibleFrom) add('SIL_NOT_YET', `${at}: paid leave (SIL) starts after a year of service, on ${sil.eligibleFrom}. Mark it Unpaid leave.`, `${f}.status`);
      else if (d.status === 'leave' && n > SIL_DAYS) add('SIL_USED', `${at}: ${e.fullName} has no paid leave (SIL) left in ${year} (${SIL_DAYS} days a year). Mark it Unpaid leave.`, `${f}.status`);
    }
    const seq = ((db.prepare('SELECT MAX(seq) FROM emp_attendance WHERE employee_id = ? AND work_date = ?').pluck().get(d.employeeId, d.date) as number | null) ?? 0) + 1;
    changed.push({ ...d, otMinutes: ot, seq });
  });
  if (issues.length) throw new AppError('VALIDATION', issues[0]!.message, 422, issues);
  const ins = db.prepare('INSERT INTO emp_attendance (employee_id, work_date, seq, status, ot_minutes, note, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of changed) ins.run(d.employeeId, d.date, d.seq, d.status, d.otMinutes, d.note ?? null, who.at, who.userId);
  if (changed.length) {
    appendAudit(db, {
      at: who.at, userId: who.userId, action: 'emp.attendance.save', entityType: 'emp.attendance', entityId: null,
      data: { days: changed.map(({ employeeId, date: d, status, otMinutes }) => ({ employeeId, date: d, status, otMinutes })) },
    });
  }
  return { saved: changed.length, unchanged: days.length - changed.length };
}
