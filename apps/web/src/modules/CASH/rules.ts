import type { CashAccount } from '../../api.ts';

export const DENOMINATIONS = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 100, 25, 5, 1] as const;
export type Quantities = Record<number, string>;

export function countLines(quantities: Quantities) {
  const errors: string[] = [];
  const lines: { denominationCents: number; qty: number }[] = [];
  for (const denominationCents of DENOMINATIONS) {
    const raw = quantities[denominationCents]?.trim() ?? '';
    if (!raw) continue;
    if (!/^\d+$/.test(raw) || Number(raw) > 100_000) errors.push(`Enter a whole quantity up to 100,000 for ₱${(denominationCents / 100).toFixed(2)}.`);
    else if (Number(raw) > 0) lines.push({ denominationCents, qty: Number(raw) });
  }
  return { lines, totalCents: lines.reduce((sum, line) => sum + line.denominationCents * line.qty, 0), errors };
}

/** Match the server's exclusive 366-day limit before requesting a cash book. */
export function bookRangeError(from: string, to: string): string | null {
  const valid = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
  };
  if (!valid(from) || !valid(to)) return 'Pick both dates.';
  if (to < from) return 'The end date is before the start date.';
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= 366) return 'Show at most one year at a time.';
  return null;
}

export const canShowBook = (place: CashAccount) => place.balanceCents !== null;
