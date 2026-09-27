/**
 * The production screens' rules (PLAN E7, H2): board columns and filters, and typed entry rows -> server input. Pure, so it
 * is tested without a browser; the server checks every piece and rate again.
 */
import type { BoardCard, PrdStep } from '../../api.ts';
import { cents } from '../COL/money.ts';

export type Column = { key: string; title: string; cards: BoardCard[] };

/** "Needs a route", a column per step in canonical order, then "Ready"; only the columns that have cards, so the board stays narrow. */
export function columns(steps: PrdStep[], cards: BoardCard[]): Column[] {
  return [
    { key: 'setup', title: 'Needs a route', cards: cards.filter((c) => c.steps === null) },
    ...steps.map((s) => ({ key: String(s.id), title: s.name, cards: cards.filter((c) => c.currentStepId === s.id) })),
    { key: 'ready', title: 'Ready', cards: cards.filter((c) => c.ready) },
  ].filter((c) => c.cards.length > 0);
}

export type Due = 'all' | 'week' | 'overdue';
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000; // both are Manila dates (YYYY-MM-DD)
/** Filters by due date (overdue, or due within 7 days of the server date) and rush priority. */
export function filterCards(cards: BoardCard[], f: { due: Due; rushOnly: boolean }, today: string): BoardCard[] {
  return cards.filter((c) => (!f.rushOnly || c.priority === 'rush') && (f.due === 'all' || (f.due === 'overdue' ? c.dueDate < today : daysBetween(today, c.dueDate) <= 7)));
}

export interface EntryRow { lineNo: string; employeeId: string; pieces: string; rework: boolean; rate: string; rateReason: string }
export const emptyRow = (lineNo = ''): EntryRow => ({ lineNo, employeeId: '', pieces: '', rework: false, rate: '', rateReason: '' });

/** Typed rows -> entry rows for the server. Blank rows are left out; a typed rate goes with its reason. */
export function rowsToInput(rows: EntryRow[]) {
  const out: { lineNo: number; employeeId: string; pieces: number; rework?: true; rateCents?: number; rateReason?: string }[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!r.employeeId && !r.pieces.trim()) return;
    const at = `Row ${i + 1}`;
    const pieces = Number(r.pieces.replace(/,/g, ''));
    const rate = r.rate.trim() ? cents(r.rate) : undefined;
    if (!r.lineNo) errors.push(`${at}: pick the line.`);
    if (!r.employeeId) errors.push(`${at}: pick the worker.`);
    if (!Number.isInteger(pieces) || pieces <= 0) errors.push(`${at}: type the pieces as a whole number like 12.`);
    if (r.rate.trim() && rate === undefined) errors.push(`${at}: type the rate like 45.00`);
    if (r.rework && !r.rate.trim()) errors.push(`${at}: type the rework (pasubra) rate.`);
    if (r.rate.trim() && !r.rateReason.trim()) errors.push(`${at}: say why this rate is typed.`);
    out.push({
      lineNo: Number(r.lineNo),
      employeeId: r.employeeId,
      pieces,
      ...(r.rework ? { rework: true as const } : {}),
      ...(rate !== undefined ? { rateCents: rate } : {}),
      ...(r.rate.trim() && r.rateReason.trim() ? { rateReason: r.rateReason.trim() } : {}),
    });
  });
  if (out.length === 0 && errors.length === 0) errors.push('Add a worker and the pieces done.');
  return { rows: out, errors };
}
