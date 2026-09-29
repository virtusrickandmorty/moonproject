/** The month-end checklist's wording and rules (PLAN D8), kept apart from the page so they can be tested. */
import type { MonthEndChecklist, MonthEndItem, MonthEndState } from '../../api.ts';

export const STATE_LABEL: Record<MonthEndState, string> = { done: 'Done', not_done: 'Not done', not_needed: 'Not needed' };
export const STATE_CLASS: Record<MonthEndState, string> = {
  done: 'bg-emerald-100 text-emerald-800', not_done: 'bg-red-100 text-red-800', not_needed: 'bg-slate-100 text-slate-600',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-08" -> "August 2026". */
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/** The month before a date's month: "2026-09-28" -> "2026-08"; the month the accountant is most likely closing. */
export function lastMonthOf(date: string): string {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The months to pick from, newest first: the date's own month (to watch it fill in) back `count - 1` months. */
export function monthChoices(date: string, count = 18): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let y = Number(date.slice(0, 4));
  let m = Number(date.slice(5, 7));
  for (let i = 0; i < count; i++) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ value, label: monthName(value) });
    if (--m === 0) [y, m] = [y - 1, 12];
  }
  return out;
}

/** How many items are in each state. */
export function tally(items: Pick<MonthEndItem, 'state'>[]): Record<MonthEndState, number> {
  return { done: items.filter((i) => i.state === 'done').length, not_done: items.filter((i) => i.state === 'not_done').length, not_needed: items.filter((i) => i.state === 'not_needed').length };
}

/** The line above the items: what is left, in words. */
export function summaryLine(items: Pick<MonthEndItem, 'state'>[]): string {
  const t = tally(items);
  if (t.not_done === 0) return `Every item is done or not needed (${t.done} done, ${t.not_needed} not needed).`;
  return `${t.not_done} ${t.not_done === 1 ? 'item is' : 'items are'} not done, ${t.done} done, ${t.not_needed} not needed.`;
}

/** The sign-off note's rule, as the server has it (5 to 500 characters); null when it will do. */
export function noteError(note: string): string | null {
  const n = note.trim().length;
  if (n < 5) return 'Write a note of at least 5 characters, for example what is still open and why.';
  if (n > 500) return 'Keep the note under 500 characters.';
  return null;
}

/** What the sign-off box says: who signed and when, and whether anything changed since. */
export function signoffLine(c: Pick<MonthEndChecklist, 'signoff' | 'changedAfterSignoff'>): { text: string; changed: boolean } | null {
  if (!c.signoff) return null;
  const when = `${c.signoff.signedAt.slice(0, 10)} ${c.signoff.signedAt.slice(11, 16)}`;
  const count = c.changedAfterSignoff?.count ?? 0;
  return {
    text: `Signed off by ${c.signoff.signedByName} on ${when}.`,
    changed: count > 0,
  };
}

/** The button: signing a month again after a change says so. */
export function signoffButton(c: Pick<MonthEndChecklist, 'signoff' | 'changedAfterSignoff'>): string {
  if (!c.signoff) return 'Sign off the month';
  return (c.changedAfterSignoff?.count ?? 0) > 0 ? 'Sign the month off again' : 'Sign off again';
}
