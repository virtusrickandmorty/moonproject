/**
 * The production screens' rules (PLAN E7, H2): board columns and filters, and typed entry rows -> server input. Pure, so it
 * is tested without a browser; the server checks every piece and rate again.
 */
import type { BoardCard, PrdStep } from '../../api.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cents } from '../COL/money.ts';

export type Column = { key: string; title: string; cards: BoardCard[] };

/** "Choose production steps", a column per step in canonical order, then "Ready"; only the columns that have cards, so the board stays narrow. */
export function columns(steps: PrdStep[], cards: BoardCard[]): Column[] {
  return [
    { key: 'setup', title: 'Choose production steps', cards: cards.filter((c) => c.steps === null) },
    ...steps.map((s) => ({ key: String(s.id), title: s.name, cards: cards.filter((c) => c.currentStepId === s.id) })),
    { key: 'ready', title: 'Ready', cards: cards.filter((c) => c.ready) },
  ].filter((c) => c.cards.length > 0);
}

/**
 * What a step's row on the line panel says (the owner's rule, Oct 2026): Complete only once every piece of the line is
 * done on it; how many it received from the step before; how many it has forwarded to the next step that is needed.
 */
export function stepFlow(steps: NonNullable<BoardCard['steps']>, i: number, qty: number, nameOf: (stepId: number) => string) {
  const s = steps[i]!;
  const closed = s.status === 'completed' || s.status === 'not_needed';
  const prev = steps.slice(0, i).reverse().find((x) => x.status !== 'not_needed');
  const next = steps.slice(i + 1).find((x) => x.status !== 'not_needed');
  const short = Math.max(0, qty - s.pieces);
  // A set is complete once both its parts are: say which part still needs pieces.
  const setWords = s.parts ? `Record the rest of the parts to complete ${nameOf(s.stepId)}: upper ${s.parts.upper} of ${qty}, lower ${s.parts.lower} of ${qty}.` : '';
  return {
    canComplete: !closed && short === 0,
    /** Why Complete is greyed out, for its tooltip and the line under it. */
    shortWords: closed || short === 0 ? '' : setWords || (short === qty ? `Record all ${qty} pcs to complete ${nameOf(s.stepId)}.` : `Record the other ${short} of ${qty} pcs to complete ${nameOf(s.stepId)}.`),
    received: prev && s.status !== 'not_needed' && s.receivedPieces > 0 ? { pieces: Math.min(qty, s.receivedPieces), from: nameOf(prev.stepId) } : null,
    forwarded: next && s.status !== 'not_needed' && s.pieces > 0 ? { pieces: Math.min(qty, s.pieces), to: nameOf(next.stepId) } : null,
    percent: qty > 0 ? Math.min(100, Math.round((s.pieces / qty) * 100)) : 0,
  };
}

export type Due = 'all' | 'week' | 'overdue';
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000; // both are Manila dates (YYYY-MM-DD)
/** Filters by due date (overdue, or due within 7 days of the server date) and rush priority. */
export function filterCards(cards: BoardCard[], f: { due: Due; rushOnly: boolean; search?: string }, today: string): BoardCard[] {
  const query = f.search?.trim().toLocaleLowerCase() ?? '';
  const numberQuery = query.replace(/[\s-]/g, '');
  return cards.filter((c) => (!query || c.customerName.toLocaleLowerCase().includes(query) || (!!numberQuery && c.number.toLocaleLowerCase().replace(/[\s-]/g, '').includes(numberQuery))) && (!f.rushOnly || c.priority === 'rush') && (f.due === 'all' || (!!today && (f.due === 'overdue' ? c.dueDate < today : daysBetween(today, c.dueDate) <= 7))));
}

export const REFRESH_MS = 30_000;
export const TURN_MS = 12_000;
export const TV_CARD_HEIGHT = 208;

/** Split both wide boards and tall columns into pages; every card appears once per rotation. */
export function tvPages(cols: Column[], width: number, height: number): Column[][] {
  const across = Math.max(1, Math.floor((width + 16) / 336));
  const down = Math.max(1, Math.floor((height - 100 + 12) / (TV_CARD_HEIGHT + 12)));
  const pages: Column[][] = [];
  for (let x = 0; x < cols.length; x += across) {
    const group = cols.slice(x, x + across);
    const rows = Math.max(...group.map((col) => col.cards.length));
    for (let y = 0; y < rows; y += down) pages.push(group.map((col) => ({ ...col, cards: col.cards.slice(y, y + down) })));
  }
  return pages;
}

export function updateWords(updatedAt: number | null, now: number, error: string) {
  if (updatedAt === null) return error || now >= REFRESH_MS * 2 ? 'Not updated yet. Trying again every 30 seconds.' : 'Waiting for the first update…';
  const time = new Date(updatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  return error || now - updatedAt >= REFRESH_MS * 2 ? `Not updated since ${time}. Trying again every 30 seconds.` : `Updated ${time}`;
}

/** Poll without overlapping reads or accepting results after the screen has closed. */
export function pollBoard<T>(read: () => Promise<T>, success: (next: T) => void, failed: (e: Error) => void) {
  let active = true;
  let pending: Promise<void> | null = null;
  const refresh = () => {
    if (pending) return pending;
    pending = read().then((next) => { if (active) success(next); }, (e: Error) => { if (active) failed(e); }).finally(() => { pending = null; });
    return pending;
  };
  void refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  return { refresh, stop: () => { active = false; clearInterval(timer); } };
}

/** A failed refresh keeps the last good snapshot and its timestamp. */
export function useBoardRefresh<T>(read: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(Date.now());
  const polling = useRef<ReturnType<typeof pollBoard<T>> | null>(null);
  const refresh = useCallback(() => polling.current?.refresh() ?? Promise.resolve(), []);
  useEffect(() => {
    const poll = pollBoard(read, (next) => { setData(next); setUpdatedAt(Date.now()); setError(''); }, (e) => setError(e.message));
    polling.current = poll;
    const clock = setInterval(() => setElapsed(Date.now() - started.current), 5_000);
    return () => { poll.stop(); polling.current = null; clearInterval(clock); };
  }, [read]);
  const now = started.current + elapsed;
  return { data, error, updatedAt, refresh, stale: !!error || (updatedAt === null ? elapsed >= REFRESH_MS * 2 : now - updatedAt >= REFRESH_MS * 2), words: updateWords(updatedAt, updatedAt === null ? elapsed : now, error) };
}

/** `wearers`: the line's wearers (roster rows) this row finished; its pieces are then theirs. `part`: on a set, the upper or the lower part. */
export interface EntryRow { lineNo: string; employeeId: string; pieces: string; rework: boolean; rate: string; rateReason: string; repeatReason?: string; wearers?: number[]; part?: 'upper' | 'lower' }
export const emptyRow = (lineNo = ''): EntryRow => ({ lineNo, employeeId: '', pieces: '', rework: false, rate: '', rateReason: '' });

/** Typed rows -> entry rows for the server. Blank rows are left out; a typed rate goes with its reason. */
export function rowsToInput(rows: EntryRow[]) {
  const out: { lineNo: number; employeeId: string; pieces: number; rework?: true; rateCents?: number; rateReason?: string; repeatReason?: string }[] = [];
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
    const repeat = r.rework ? '' : (r.repeatReason ?? '').trim();
    if (repeat && repeat.length < 5) errors.push(`${at}: say in at least 5 characters why this is a different sheet.`);
    out.push({
      lineNo: Number(r.lineNo),
      employeeId: r.employeeId,
      pieces,
      ...(r.rework ? { rework: true as const } : {}),
      ...(rate !== undefined ? { rateCents: rate } : {}),
      ...(r.rate.trim() && r.rateReason.trim() ? { rateReason: r.rateReason.trim() } : {}),
      ...(repeat ? { repeatReason: repeat } : {}),
      ...(!r.rework && r.wearers && r.wearers.length > 0 ? { wearers: [...r.wearers].sort((a, b) => a - b) } : {}),
      ...(r.part ? { part: r.part } : {}),
    });
  });
  if (out.length === 0 && errors.length === 0) errors.push('Add a worker and the pieces done.');
  return { rows: out, errors };
}
