import type { CalItem, CalKind } from '../../api.ts';

export const KINDS: { kind: CalKind; label: string }[] = [
  { kind: 'event', label: 'Booked events' }, { kind: 'job_due', label: 'Job orders due' },
  { kind: 'release', label: 'Releases' }, { kind: 'holiday', label: 'Holidays' },
  { kind: 'tax', label: 'Tax deadlines' }, { kind: 'customer_birthday', label: 'Customer birthdays' },
  { kind: 'employee_birthday', label: 'Employee birthdays' },
];
const pad = (n: number) => String(n).padStart(2, '0');
export const dayString = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
export function monthRange(year: number, month: number) {
  return { from: dayString(year, month, 1), to: dayString(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()) };
}
export function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
/** Monday-first, including empty cells before and after the month. */
export function monthCells(year: number, month: number): (string | null)[] {
  const { to } = monthRange(year, month);
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= Number(to.slice(-2)); day++) cells.push(dayString(year, month, day));
  while (cells.length % 7) cells.push(null);
  return cells;
}
export const itemsOfKind = (items: CalItem[], kind: CalKind | 'all') => kind === 'all' ? items : items.filter((item) => item.kind === kind);
