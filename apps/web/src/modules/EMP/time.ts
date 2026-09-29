/**
 * The attendance grid's rules (PLAN E11): the pay period shown by default, the days in it, which statuses a day takes,
 * overtime typed in hours, and the cells that changed. Pure, so it is tested without a browser; the server checks again.
 */
import type { AttendanceDay, AttendanceSave, AttendanceStatus, PaidDays } from '../../api.ts';

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

export interface Cell { status: AttendanceStatus | ''; ot: string }
export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;
export function cellsOf(days: AttendanceDay[]): Record<string, Cell> {
  return Object.fromEntries(days.map((d) => [cellKey(d.employeeId, d.date), { status: d.status, ot: otText(d.otMinutes) }]));
}

/** The cells that differ from what the server has, as the save input, with plain errors for cells that cannot be saved. */
export function changedCells(saved: AttendanceDay[], cells: Record<string, Cell>, names: Record<string, string>): { days: AttendanceSave[]; errors: string[] } {
  const was = cellsOf(saved);
  const days: AttendanceSave[] = [];
  const errors: string[] = [];
  for (const [key, c] of Object.entries(cells)) {
    const before = was[key];
    if ((before?.status ?? '') === c.status && (before?.ot ?? '') === c.ot.trim()) continue;
    const [employeeId, date] = key.split('|') as [string, string];
    const at = `${names[employeeId] ?? 'Someone'} on ${date}`;
    if (!c.status) {
      if (before) errors.push(`${at}: pick a status (a typed day cannot be left blank).`);
      else if (c.ot.trim()) errors.push(`${at}: pick a status for the overtime.`);
      continue;
    }
    const ot = otMinutes(c.ot);
    if (ot === undefined) errors.push(`${at}: type overtime in hours, like 1.5 or 1:30.`);
    else if (ot > 0 && !WITH_OT.has(c.status)) errors.push(`${at}: overtime goes only with a worked day.`);
    else days.push({ employeeId, date, status: c.status, ...(ot ? { otMinutes: ot } : {}) });
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));
  return { days, errors };
}

/** The recorded payroll run that paid an employee's day (the cell is locked until it is cancelled), if any. */
export const paidBy = (paid: PaidDays[], employeeId: string, date: string): string | undefined =>
  paid.find((p) => p.employeeId === employeeId && p.from <= date && date <= p.to)?.number;
