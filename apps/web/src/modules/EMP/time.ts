/**
 * The attendance grid's rules (PLAN E11): the pay period shown by default, the days in it, which statuses a day takes,
 * overtime, night hours and night overtime typed in hours, holidays filled in from the calendar, and the cells that changed. Pure, so it is tested without a browser; the server checks again.
 */
import type { AttendanceDay, AttendanceGrid, AttendanceSave, AttendanceStatus, PaidDays } from '../../api.ts';

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present', half_day: 'Half day', absent: 'Absent', rest_day: 'Rest day', leave: 'Leave (SIL)', unpaid_leave: 'Unpaid leave',
  holiday_off: 'Holiday off', holiday_worked: 'Holiday worked', rest_day_worked: 'Rest day worked',
};
/** Short marks for the grid cells. */
export const STATUS_MARK: Record<AttendanceStatus, string> = {
  present: 'P', half_day: '½', absent: 'A', rest_day: 'R', leave: 'L', unpaid_leave: 'UL', holiday_off: 'H', holiday_worked: 'HW', rest_day_worked: 'RW',
};
const ON_HOLIDAY: AttendanceStatus[] = ['holiday_off', 'holiday_worked', 'rest_day', 'rest_day_worked'];
const OFF_HOLIDAY: AttendanceStatus[] = ['present', 'half_day', 'absent', 'rest_day', 'leave', 'unpaid_leave', 'rest_day_worked'];
const WITH_OT = new Set<AttendanceStatus>(['present', 'holiday_worked', 'rest_day_worked']);
/** Night hours (worked between 10 PM and 6 AM, paid the night differential) go with any worked day, at most 8. */
export const WITH_NIGHT = new Set<AttendanceStatus>(['present', 'half_day', 'holiday_worked', 'rest_day_worked']);
const MAX_NIGHT_MINUTES = 480;
export const statusesFor = (holiday: boolean) => (holiday ? ON_HOLIDAY : OFF_HOLIDAY);

const pad = (n: number) => String(n).padStart(2, '0');
/** Calendar arithmetic on YYYY-MM-DD (dates the server already gave in Manila time; no clock involved). */
export function plusDays(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, day! + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 62; d = plusDays(d, 1)) out.push(d);
  return out;
}
export const weekday = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T00:00:00Z`).getUTCDay()]!;

/** The half-month a day falls in (1–15 or 16–end), the semi-monthly pay periods of F2. */
export function halfMonthOf(d: string): { from: string; to: string } {
  const [y, m, day] = d.split('-').map(Number);
  const ym = `${y}-${pad(m!)}`;
  if (day! <= 15) return { from: `${ym}-01`, to: `${ym}-15` };
  return { from: `${ym}-16`, to: `${ym}-${pad(new Date(Date.UTC(y!, m!, 0)).getUTCDate())}` };
}

/** Overtime typed in hours ("1.5" or "1:30") -> minutes; blank is 0; undefined when it cannot be read. */
export function otMinutes(text: string): number | undefined {
  const s = text.trim();
  if (!s) return 0;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 60);
}
export const otText = (minutes: number) => (minutes ? (minutes % 60 ? `${Math.floor(minutes / 60)}:${pad(minutes % 60)}` : String(minutes / 60)) : '');

/**
 * `nightOt`: of the night hours, those that were also overtime (paid 10% of the overtime rate), at most `ot` and `night`.
 * `timeIn`, `timeOut`: HH:MM, recorded and shown only; pay comes from the status and the hours.
 */
export interface Cell { status: AttendanceStatus | ''; ot: string; night: string; nightOt: string; timeIn?: string; timeOut?: string }
/** The time out falls on the next day: earlier than the time in, as when work runs past midnight. */
export const nextDayOut = (c: Pick<Cell, 'timeIn' | 'timeOut'>) => !!c.timeIn && !!c.timeOut && c.timeOut < c.timeIn;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;
export function cellsOf(days: AttendanceDay[]): Record<string, Cell> {
  return Object.fromEntries(days.map((d) => [cellKey(d.employeeId, d.date), { status: d.status, ot: otText(d.otMinutes), night: otText(d.nightMinutes), nightOt: otText(d.nightOtMinutes), ...(d.timeIn ? { timeIn: d.timeIn } : {}), ...(d.timeOut ? { timeOut: d.timeOut } : {}) }]));
}

/**
 * The grid's cells as saved, with "Holiday off" filled in from the holiday calendar for everyone in service on a holiday
 * with nothing typed yet (not a future day, not a day a payroll paid). Filled cells are changes like any other: the
 * encoder changes those who worked to "Holiday worked" and saves. `filled` counts them.
 */
export function startCells(grid: AttendanceGrid): { cells: Record<string, Cell>; filled: number } {
  const cells = cellsOf(grid.days);
  let filled = 0;
  for (const h of grid.holidays) {
    if (h.date < grid.from || h.date > grid.to || h.date > grid.today) continue;
    for (const e of grid.employees) {
      const key = cellKey(e.id, h.date);
      if (cells[key] || h.date < e.hireDate || (e.separatedOn !== null && h.date > e.separatedOn) || paidBy(grid.paid, e.id, h.date)) continue;
      cells[key] = { status: 'holiday_off', ot: '', night: '', nightOt: '' };
      filled++;
    }
  }
  return { cells, filled };
}

/** The cells that differ from what the server has, as the save input, with plain errors for cells that cannot be saved. */
export function changedCells(saved: AttendanceDay[], cells: Record<string, Cell>, names: Record<string, string>): { days: AttendanceSave[]; errors: string[] } {
  const was = cellsOf(saved);
  const days: AttendanceSave[] = [];
  const errors: string[] = [];
  for (const [key, c] of Object.entries(cells)) {
    const before = was[key];
    // Times go only with a worked day: a day changed to Absent, say, drops them.
    const timed = !!c.status && WITH_NIGHT.has(c.status);
    const timeIn = timed ? c.timeIn?.trim() ?? '' : '';
    const timeOut = timed ? c.timeOut?.trim() ?? '' : '';
    if ((before?.status ?? '') === c.status && (before?.ot ?? '') === c.ot.trim() && (before?.night ?? '') === c.night.trim() && (before?.nightOt ?? '') === c.nightOt.trim()
      && (before?.timeIn ?? '') === timeIn && (before?.timeOut ?? '') === timeOut) continue;
    const [employeeId, date] = key.split('|') as [string, string];
    const at = `${names[employeeId] ?? 'Someone'} on ${date}`;
    if (!c.status) {
      if (before) errors.push(`${at}: pick a status (a typed day cannot be left blank).`);
      else if (c.ot.trim() || c.night.trim() || c.nightOt.trim()) errors.push(`${at}: pick a status for the overtime or night hours.`);
      continue;
    }
    const ot = otMinutes(c.ot);
    const night = otMinutes(c.night);
    const nightOt = otMinutes(c.nightOt);
    if (ot === undefined) errors.push(`${at}: type overtime in hours, like 1.5 or 1:30.`);
    else if (ot > 0 && !WITH_OT.has(c.status)) errors.push(`${at}: overtime goes only with a worked day.`);
    else if (night === undefined) errors.push(`${at}: type night hours in hours, like 1.5 or 1:30.`);
    else if (night > 0 && !WITH_NIGHT.has(c.status)) errors.push(`${at}: night hours go only with a worked day.`);
    else if (night > MAX_NIGHT_MINUTES) errors.push(`${at}: night hours are at most 8 (10 PM to 6 AM).`);
    else if (nightOt === undefined) errors.push(`${at}: type night overtime in hours, like 1.5 or 1:30.`);
    else if (nightOt > Math.min(ot, night)) errors.push(`${at}: night overtime is at most the overtime and the night hours of the day.`);
    else if ((timeIn && !CLOCK.test(timeIn)) || (timeOut && !CLOCK.test(timeOut))) errors.push(`${at}: type a time like 08:30 or 17:45.`);
    else days.push({ employeeId, date, status: c.status, ...(timeIn ? { timeIn } : {}), ...(timeOut ? { timeOut } : {}), ...(ot ? { otMinutes: ot } : {}), ...(night ? { nightMinutes: night } : {}), ...(nightOt ? { nightOtMinutes: nightOt } : {}) });
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));
  return { days, errors };
}

/** The recorded payroll run that paid an employee's day (the cell is locked until it is cancelled), if any. */
export const paidBy = (paid: PaidDays[], employeeId: string, date: string): string | undefined =>
  paid.find((p) => p.employeeId === employeeId && p.from <= date && date <= p.to)?.number;
