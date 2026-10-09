/**
 * Attendance from the biometric (the owner's request, Oct 2026): the device's "Employee Attendance Record" report (.xls,
 * one block per person: User ID, Name, Department; a row of day numbers; the punch times under each day) is read, each
 * biometric user is linked to an employee once, and each day's punches are turned into an attendance day for review.
 * Nothing is saved here: the screen saves what the owner accepts through the attendance grid's own save (saveAttendance),
 * with its checks (service dates, holidays, days a payroll paid).
 *
 * The owner's rules (Oct 9, 2026): shift 9:00 am to 6:00 pm with a 1-hour lunch; rest day Saturday; overtime from 7:30 pm
 * on, and work before 6:00 am is real night work, counted as overtime too; night differential 10:00 pm to 6:00 am. A day
 * with one punch is present, flagged to check the missing time. Late and undertime are shown, not deducted.
 */
import { isBusinessDate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { readXls } from './xls.ts';
import { attendanceBetween, holidaysBetween, paidDaysBetween, type AttendanceStatus } from './time.ts';

export const BIOMETRIC_RULES = { shiftStart: 9 * 60, shiftEnd: 18 * 60, lunchMinutes: 60, overtimeFrom: 19 * 60 + 30, earlyNightUntil: 6 * 60, nightFrom: 22 * 60, restWeekday: 6 } as const;
/** The note an imported day carries; a day typed by hand (another note, or none) is kept unless the owner ticks it. */
export const BIOMETRIC_NOTE = 'From biometric';

export interface ReportPerson { userId: string; name: string; department: string; days: Record<string, string[]> }
export interface Report { from: string; to: string; people: ReportPerson[] }

const label = (cell: string) => cell.trim().replace(/\s*:$/, '').toLowerCase();
/** The cell right of a label in a row ("User ID:" → "1"). */
const after = (row: string[], name: string) => {
  const i = row.findIndex((c) => label(c) === name);
  return i < 0 ? undefined : row.slice(i + 1).find((c) => c.trim())?.trim();
};
const isoOf = (mdy: string) => { const [m, d, y] = mdy.split('-'); return `${y}-${m}-${d}`; };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Reads the report's grid: the date range, and each person's punches by date (HH:MM, in order). */
export function parseReport(grid: string[][]): Report {
  const range = grid.flat().map((c) => /attendance date\s*:\s*(\d{2}-\d{2}-\d{4})\s*~\s*(\d{2}-\d{2}-\d{4})/i.exec(c)).find(Boolean);
  if (!range) throw new Error('This is not the biometric "Employee Attendance Record" report: its "Attendance date" range is missing.');
  const [from, to] = [isoOf(range[1]!), isoOf(range[2]!)];
  if (!isBusinessDate(from) || !isBusinessDate(to) || to < from || addDays(from, 62) < to) throw new Error('The report\'s "Attendance date" range is not a range of up to two months.');
  // The day numbers name dates in the range, in order: 25, 26 … 31, 1, 2 … across a month end.
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const people: ReportPerson[] = [];
  let person: ReportPerson | null = null;
  let columns = new Map<number, string>();
  for (const row of grid) {
    const id = after(row, 'user id');
    if (id !== undefined) {
      person = { userId: id, name: after(row, 'name') ?? '', department: after(row, 'department') ?? '', days: {} };
      people.push(person);
      columns = new Map();
      continue;
    }
    if (!person) continue;
    if (columns.size === 0) {
      // The row of day numbers under the person's header.
      let at = 0;
      row.forEach((c, col) => {
        const n = Number(c.trim());
        if (!c.trim() || !Number.isInteger(n) || n < 1 || n > 31) return;
        const k = dates.findIndex((d, i) => i >= at && Number(d.slice(8)) === n);
        if (k >= 0) { columns.set(col, dates[k]!); at = k + 1; }
      });
      continue;
    }
    row.forEach((c, col) => {
      const date = columns.get(col);
      const times = c.match(/\b\d{1,2}:\d{2}\b/g);
      if (date && times) (person!.days[date] ??= []).push(...times.map((t) => t.padStart(5, '0')));
    });
  }
  if (people.length === 0) throw new Error('No one is in the report: it has no "User ID" blocks.');
  return { from, to, people };
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

export interface DayResult { status: AttendanceStatus; otMinutes: number; nightMinutes: number; nightOtMinutes: number; lateMinutes: number; undertimeMinutes: number; flags: string[] }

/** One day from its punches (the first is the time in, the last the time out), by BIOMETRIC_RULES. */
export function dayFromPunches(punches: string[], date: string, holiday: { name: string } | undefined): DayResult {
  const r = BIOMETRIC_RULES;
  const rest = new Date(`${date}T00:00:00Z`).getUTCDay() === r.restWeekday;
  const none = { otMinutes: 0, nightMinutes: 0, nightOtMinutes: 0, lateMinutes: 0, undertimeMinutes: 0 };
  const times = [...punches].sort();
  if (times.length === 0) return { status: holiday ? 'holiday_off' : rest ? 'rest_day' : 'absent', ...none, flags: [] };
  const status: AttendanceStatus = holiday ? 'holiday_worked' : rest ? 'rest_day_worked' : 'present';
  if (times.length === 1) {
    const t = minutes(times[0]!);
    const missing = t < 13 * 60 ? `no time out (in at ${times[0]})` : `no time in (out at ${times[0]})`;
    return { status, ...none, flags: [`Only one punch: ${missing}. Check why.`] };
  }
  const [inAt, outAt] = [minutes(times[0]!), minutes(times.at(-1)!)];
  const early = overlap(inAt, outAt, 0, r.earlyNightUntil); // real night work before 6:00 am
  const late = overlap(inAt, outAt, r.overtimeFrom, 24 * 60);
  const night = Math.min(480, early + overlap(inAt, outAt, r.nightFrom, 24 * 60));
  const ot = Math.min(960, early + late);
  const flags: string[] = [];
  if (times.length > 2) flags.push(`${times.length} punches (${times.join(', ')}): the first is the time in, the last the time out.`);
  if (early > 0) flags.push(`Worked before 6:00 am from ${times[0]}: counted as overtime and night work.`);
  const lateMinutes = holiday || rest ? 0 : Math.max(0, inAt - r.shiftStart);
  const undertimeMinutes = holiday || rest ? 0 : Math.max(0, r.shiftEnd - outAt);
  return { status, otMinutes: ot, nightMinutes: night, nightOtMinutes: Math.min(night, ot), lateMinutes, undertimeMinutes, flags };
}

/** The employee each biometric user is linked to now (latest row; null when unlinked). */
export function biometricLinks(db: Db): Map<string, string | null> {
  const rows = db.prepare(`SELECT biometric_user_id AS id, employee_id AS employeeId FROM emp_biometric_links l
    WHERE seq = (SELECT MAX(seq) FROM emp_biometric_links x WHERE x.biometric_user_id = l.biometric_user_id)`).all() as { id: string; employeeId: string | null }[];
  return new Map(rows.map((r) => [r.id, r.employeeId]));
}

/** Links (or unlinks, with null) a biometric user to an employee; audited by the caller. */
export function linkBiometricUser(db: Db, v: { userId: string; employeeId: string | null; deviceName?: string | undefined }, who: { userId: string; at: string }) {
  const seq = ((db.prepare('SELECT MAX(seq) FROM emp_biometric_links WHERE biometric_user_id = ?').pluck().get(v.userId) as number | null) ?? 0) + 1;
  db.prepare('INSERT INTO emp_biometric_links (biometric_user_id, seq, employee_id, device_name, at, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.userId, seq, v.employeeId, v.deviceName ?? null, who.at, who.userId);
}

type Emp = { id: string; fullName: string; code: string; hireDate: string; separatedOn: string | null };
/** The employee whose name has the device's short name as a whole word ("mike" → "Mike Ruiz"), when only one does. */
function suggest(name: string, employees: Emp[]): string | null {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return null;
  const hits = employees.filter((e) => e.fullName.toLowerCase().split(/[\s.,-]+/).includes(n));
  return hits.length === 1 ? hits[0]!.id : null;
}

/** new / changed (an earlier import's day): saved when ticked; same: nothing to do; kept: typed by hand, saved only if ticked;
 * locked: a recorded payroll paid it; outside: before the hire date or after the separation; not_linked: no employee yet. */
export type DayAction = 'new' | 'changed' | 'same' | 'kept' | 'locked' | 'outside' | 'not_linked';
export interface PreviewDay extends DayResult { date: string; punches: string[]; action: DayAction; existing: { status: AttendanceStatus; otMinutes: number; nightMinutes: number; note: string | null } | null; lockedBy?: string }
export interface PreviewPerson { userId: string; name: string; department: string; employeeId: string | null; suggestedEmployeeId: string | null; days: PreviewDay[] }

/** The review of a report: each person and day, worked out and set against what attendance holds now. */
export function previewBiometric(db: Db, file: Buffer, employees: Emp[]): { from: string; to: string; people: PreviewPerson[] } {
  let grid: string[][];
  try { grid = readXls(file); } catch (e) { throw new Error(`The file could not be read: ${(e as Error).message}`); }
  const report = parseReport(grid);
  const links = biometricLinks(db);
  const holidays = new Map(holidaysBetween(db, report.from, report.to).map((h) => [h.date, h]));
  const now = new Map(attendanceBetween(db, report.from, report.to).map((d) => [`${d.employeeId}|${d.date}`, d]));
  const paid = paidDaysBetween(db, report.from, report.to);
  const dates: string[] = [];
  for (let d = report.from; d <= report.to; d = addDays(d, 1)) dates.push(d);
  return {
    from: report.from,
    to: report.to,
    people: report.people.map((p) => {
      const employeeId = links.get(p.userId) ?? null;
      const emp = employees.find((e) => e.id === employeeId);
      return {
        userId: p.userId, name: p.name, department: p.department, employeeId,
        suggestedEmployeeId: employeeId ? null : suggest(p.name, employees),
        days: dates.map((date): PreviewDay => {
          const punches = p.days[date] ?? [];
          const worked = dayFromPunches(punches, date, holidays.get(date));
          const had = employeeId ? now.get(`${employeeId}|${date}`) : undefined;
          const existing = had ? { status: had.status, otMinutes: had.otMinutes, nightMinutes: had.nightMinutes, note: had.note } : null;
          const lockedBy = employeeId ? paid.find((x) => x.employeeId === employeeId && x.from <= date && date <= x.to)?.number : undefined;
          const same = !!had && had.status === worked.status && had.otMinutes === worked.otMinutes && had.nightMinutes === worked.nightMinutes && had.nightOtMinutes === worked.nightOtMinutes;
          const outside = !!emp && (date < emp.hireDate || (!!emp.separatedOn && date > emp.separatedOn));
          const action: DayAction = !employeeId ? 'not_linked' : outside ? 'outside' : lockedBy ? 'locked' : same ? 'same' : !had ? 'new'
            : had.note?.startsWith(BIOMETRIC_NOTE) ? 'changed' : 'kept';
          return { date, punches, ...worked, action, existing, ...(lockedBy ? { lockedBy } : {}) };
        }),
      };
    }),
  };
}
