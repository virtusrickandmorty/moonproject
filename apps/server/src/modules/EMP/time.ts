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
/** Night minutes (work between 10 PM and 6 AM, F1 night differential) go with any worked day, a half day included. */
const WITH_NIGHT = new Set<AttendanceStatus>(['present', 'half_day', 'holiday_worked', 'rest_day_worked']);
export const MAX_NIGHT_MINUTES = 480; // 10 PM to 6 AM
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
  notPaid(db, v.date);
  // A holiday added late (OWN-29) must not leave ordinary days on its date, or payroll would pay them as ordinary days.
  const ordinary = db
    .prepare(`SELECT e.full_name FROM (${LATEST}) a JOIN emp_employees e ON e.id = a.employee_id WHERE a.work_date = ? AND a.status NOT IN ('rest_day','rest_day_worked') ORDER BY e.full_name`)
    .pluck()
    .all(v.date) as string[];
  if (ordinary.length) {
    throw conflict(
      'ATTENDANCE_TYPED',
      `Attendance on ${v.date} is typed as an ordinary day for ${ordinary.join(', ')}. Mark those days Rest day or Rest day worked first, add the holiday, then mark them Holiday worked or Holiday off.`,
      { people: ordinary },
    );
  }
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
  notPaid(db, h.date);
  const marked = db.prepare(`SELECT COUNT(*) FROM (${LATEST}) WHERE work_date = ? AND status IN ('holiday_off','holiday_worked')`).pluck().get(h.date) as number;
  if (marked > 0) throw conflict('HOLIDAY_USED', `Attendance on ${h.date} is marked as a holiday for ${marked} ${marked === 1 ? 'person' : 'people'}. Change those days first.`);
  db.prepare('UPDATE emp_holidays SET is_active = 0, deactivated_reason = ? WHERE id = ?').run(reason, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'emp.holiday.deactivate', entityType: 'emp.holiday', entityId: String(id), data: { date: h.date, name: h.name, reason } });
  return { ...asHoliday(h), isActive: false, deactivatedReason: reason };
}

export interface AttendanceDay { employeeId: string; date: string; status: AttendanceStatus; otMinutes: number; nightMinutes: number; note: string | null }
/** The latest row of every employee-day. */
const LATEST = `SELECT a.employee_id, a.work_date, a.status, a.ot_minutes, a.night_minutes, a.note FROM emp_attendance a
  WHERE a.seq = (SELECT MAX(x.seq) FROM emp_attendance x WHERE x.employee_id = a.employee_id AND x.work_date = a.work_date)`;

/** Attendance from one date to another (both included), for one employee or all. */
export function attendanceBetween(db: Db, from: string, to: string, employeeId?: string): AttendanceDay[] {
  return db
    .prepare(
      `SELECT employee_id AS employeeId, work_date AS date, status, ot_minutes AS otMinutes, night_minutes AS nightMinutes, note FROM (${LATEST})
       WHERE work_date BETWEEN @from AND @to AND (@e IS NULL OR employee_id = @e) ORDER BY employee_id, work_date`,
    )
    .all({ from, to, e: employeeId ?? null }) as AttendanceDay[];
}

/** Days of employees paid by recorded payroll runs: attendance on them is locked until the run is cancelled (F3). */
export interface PaidDays { employeeId: string; from: string; to: string; number: string }
const PAID = `SELECT p.employee_id AS employeeId, p.from_date AS "from", p.to_date AS "to", d.number FROM emp_paid_days p JOIN documents d ON d.id = p.document_id
  WHERE d.status = 'posted'`;

/** Paid days overlapping a range (both included), for one employee or all, by employee and date. */
export const paidDaysBetween = (db: Db, from: string, to: string, employeeId?: string): PaidDays[] =>
  db.prepare(`${PAID} AND p.from_date <= @to AND p.to_date >= @from AND (@e IS NULL OR p.employee_id = @e) ORDER BY p.employee_id, p.from_date, d.number`)
    .all({ from, to, e: employeeId ?? null }) as PaidDays[];

/** The recorded payroll run that paid an employee's day, if one stands. */
export const paidBy = (db: Db, employeeId: string, day: string): string | undefined => paidDaysBetween(db, day, day, employeeId)[0]?.number;

/** A holiday changes the pay of its date, so it is added or switched off only while no recorded payroll paid that date. */
function notPaid(db: Db, day: string) {
  const runs = [...new Set(paidDaysBetween(db, day, day).map((p) => p.number))];
  if (runs.length) throw conflict('HOLIDAY_PAID', `${day} is paid by ${runs.join(', ')}. Cancel ${runs.length === 1 ? 'it' : 'them'} first to change the holiday.`, { runs });
}

/** Records the days a payroll run being recorded pays an employee (PAY run persist, through public.ts). */
export function markPaidDays(db: Db, v: { documentId: string; employeeId: string; from: string; to: string }): void {
  db.prepare('INSERT INTO emp_paid_days (document_id, employee_id, from_date, to_date) VALUES (?, ?, ?, ?)').run(v.documentId, v.employeeId, v.from, v.to);
}

export const addDays = (d: string, n: number) => manilaDate(new Date(Date.parse(`${d}T00:00:00+08:00`) + n * 86_400_000));
export function checkRange(from: string, to: string) {
  if (to < from) throw badRequest('BAD_RANGE', 'The end date is before the start date.');
  if (addDays(from, MAX_RANGE_DAYS - 1) < to) throw badRequest('BAD_RANGE', `Show at most ${MAX_RANGE_DAYS} days at a time.`);
}

/**
 * SIL for a year (PLAN E11): 5 days once the employee has worked a year; days taken are "leave" in attendance, and days
 * left unused may be paid in cash by a payroll run (final pay, or December's "Pay unused leave"): `paid`. Both use them up.
 */
export function silOf(db: Db, employeeId: string, year: number) {
  const e = employeeRecord(db, employeeId);
  if (!e) throw notFound('The employee');
  const eligibleFrom = `${Number(e.hireDate.slice(0, 4)) + 1}${e.hireDate.slice(4)}`.replace(/-02-29$/, '-03-01');
  const used = db.prepare(`SELECT COUNT(*) FROM (${LATEST}) WHERE employee_id = ? AND status = 'leave' AND work_date BETWEEN ? AND ?`).pluck().get(employeeId, `${year}-01-01`, `${year}-12-31`) as number;
  const paid = silPaidBy(db, employeeId, year).reduce((s, p) => s + p.days, 0);
  return { year, eligibleFrom, daysPerYear: SIL_DAYS, used, paid, left: eligibleFrom <= `${year}-12-31` ? Math.max(0, SIL_DAYS - used - paid) : 0 };
}

/** Unused SIL of a year paid in cash by recorded payroll runs, by run number. */
export const silPaidBy = (db: Db, employeeId: string, year: number): { number: string; days: number }[] =>
  db.prepare(`SELECT d.number, s.days FROM emp_sil_paid s JOIN documents d ON d.id = s.document_id WHERE d.status = 'posted' AND s.employee_id = ? AND s.year = ? ORDER BY d.number`)
    .all(employeeId, year) as { number: string; days: number }[];

/** Records unused SIL days a payroll run being recorded pays in cash (PAY run persist); never more than are left. */
export function markSilPaid(db: Db, v: { documentId: string; employeeId: string; year: number; days: number }): void {
  const sil = silOf(db, v.employeeId, v.year);
  if (v.days > sil.left) {
    const by = silPaidBy(db, v.employeeId, v.year).map((p) => p.number);
    throw conflict('SIL_PAID', `Only ${sil.left} of the ${v.year} leave (SIL) days are left${by.length ? `; ${by.join(', ')} already paid the rest` : ''}. Work the payroll out again.`);
  }
  db.prepare('INSERT INTO emp_sil_paid (document_id, employee_id, year, days) VALUES (?, ?, ?, ?)').run(v.documentId, v.employeeId, v.year, v.days);
}

const day = z.object({ employeeId: z.uuid(), date, status: z.enum(ATTENDANCE), otMinutes: z.number().int().min(0).max(960).optional(),
  nightMinutes: z.number().int().min(0).max(MAX_NIGHT_MINUTES).optional(), note: z.string().trim().max(200).optional() }).strict();
export const attendanceInput = z.object({ days: z.array(day).min(1).max(1000) }).strict();

const LABEL: Record<AttendanceStatus, string> = {
  present: 'Present', half_day: 'Half day', absent: 'Absent', rest_day: 'Rest day', leave: 'Leave (SIL)', unpaid_leave: 'Unpaid leave',
  holiday_off: 'Holiday off', holiday_worked: 'Holiday worked', rest_day_worked: 'Rest day worked',
};

/**
 * Saves grid cells. Every cell is checked first and nothing is saved if one is wrong: the day must be within the
 * employee's service and not in the future; holidays take the holiday statuses; overtime and night minutes go only with a worked day;
 * SIL needs a year of service and at most 5 days a year (days paid in cash count); a day a recorded payroll paid is
 * locked until that payroll is cancelled. Unchanged cells are skipped. Call inside a transaction.
 */
export function saveAttendance(db: Db, raw: unknown, who: Who): { saved: number; unchanged: number } {
  const { days } = attendanceInput.parse(raw);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const current = db.prepare(`SELECT status, ot_minutes AS otMinutes, night_minutes AS nightMinutes, note FROM (${LATEST}) WHERE employee_id = ? AND work_date = ?`);
  const silTaken = new Map<string, number>(); // employee|year -> SIL days after this save
  const changed: (z.infer<typeof day> & { otMinutes: number; nightMinutes: number; seq: number })[] = [];
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
    const night = d.nightMinutes ?? 0;
    if (night > 0 && !WITH_NIGHT.has(d.status)) add('NIGHT', `${at}: night hours go only with a worked day.`, `${f}.nightMinutes`);
    const was = current.get(d.employeeId, d.date) as { status: AttendanceStatus; otMinutes: number; nightMinutes: number; note: string | null } | undefined;
    if (was && was.status === d.status && was.otMinutes === ot && was.nightMinutes === night && (was.note ?? undefined) === d.note) return;
    const run = paidBy(db, d.employeeId, d.date);
    if (run) return add('PAID', `${at} is paid by ${run}. Cancel ${run} first to change it.`);
    if (d.status === 'leave' || was?.status === 'leave') {
      const year = Number(d.date.slice(0, 4));
      const key = `${d.employeeId}|${year}`;
      const sil = silOf(db, d.employeeId, year);
      const n = (silTaken.get(key) ?? sil.used + sil.paid) + (d.status === 'leave' ? 1 : 0) - (was?.status === 'leave' ? 1 : 0);
      silTaken.set(key, n);
      if (d.status === 'leave' && d.date < sil.eligibleFrom) add('SIL_NOT_YET', `${at}: paid leave (SIL) starts after a year of service, on ${sil.eligibleFrom}. Mark it Unpaid leave.`, `${f}.status`);
      else if (d.status === 'leave' && n > SIL_DAYS) add('SIL_USED', `${at}: ${e.fullName} has no paid leave (SIL) left in ${year} (${SIL_DAYS} days a year${sil.paid ? `, ${sil.paid} of them paid in cash` : ''}). Mark it Unpaid leave.`, `${f}.status`);
    }
    const seq = ((db.prepare('SELECT MAX(seq) FROM emp_attendance WHERE employee_id = ? AND work_date = ?').pluck().get(d.employeeId, d.date) as number | null) ?? 0) + 1;
    changed.push({ ...d, otMinutes: ot, nightMinutes: night, seq });
  });
  if (issues.length) throw new AppError('VALIDATION', issues[0]!.message, 422, issues);
  const ins = db.prepare('INSERT INTO emp_attendance (employee_id, work_date, seq, status, ot_minutes, night_minutes, note, at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of changed) ins.run(d.employeeId, d.date, d.seq, d.status, d.otMinutes, d.nightMinutes, d.note ?? null, who.at, who.userId);
  if (changed.length) {
    appendAudit(db, {
      at: who.at, userId: who.userId, action: 'emp.attendance.save', entityType: 'emp.attendance', entityId: null,
      data: { days: changed.map(({ employeeId, date: d, status, otMinutes, nightMinutes }) => ({ employeeId, date: d, status, otMinutes, ...(nightMinutes ? { nightMinutes } : {}) })) },
    });
  }
  return { saved: changed.length, unchanged: days.length - changed.length };
}
