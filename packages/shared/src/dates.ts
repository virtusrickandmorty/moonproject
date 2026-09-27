/**
 * Business dates are YYYY-MM-DD in Asia/Manila (PLAN C5, NR-7).
 * Never cut a date out of the UTC ISO string: that gives the UTC date, not the Manila date.
 */
export type BusinessDate = string;

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function manilaDate(at: Date): BusinessDate {
  return fmt.format(at); // en-CA formats as YYYY-MM-DD
}

/** ISO-8601 timestamp with the +08:00 offset, e.g. 2026-09-27T13:45:10.123+08:00. */
export function manilaTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + 8 * 3600_000);
  return shifted.toISOString().replace('Z', '+08:00');
}

export function isBusinessDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function yearOf(d: BusinessDate): number {
  return Number(d.slice(0, 4));
}
