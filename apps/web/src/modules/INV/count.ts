/**
 * Inventory count screen rules (PLAN E9): quantities typed as on the count sheet (yards, meters and kilos with up to three
 * decimals, sent as milli-units per PLAN C5; rolls and pieces whole), a changed cost needs a reason, and the live total
 * is worked out here the way the server does it (quantity × cost, rounded per line). The server's preview has the final word.
 */
import { divRoundHalfAway, parsePesos } from '@moonproject/shared';
import type { SheetSupply } from '../../api.ts';

export type Category = 'materials' | 'ready_made';
export const CATEGORY_LABEL: Record<Category, string> = { materials: 'Materials and supplies', ready_made: 'Ready-made merchandise' };
const MAX_QTY = 10_000_000; // as the server

/** What was typed on one row of the sheet. */
export interface Typed { qty: string; cost: string; reason: string }
export const emptyRow: Typed = { qty: '', cost: '', reason: '' };

/** "12.5" yards -> 12500 milli-units; "12" pieces -> 12. Undefined when it is not a quantity. */
export function parseQty(text: string, milliUnits: boolean): number | undefined {
  const m = (milliUnits ? /^(\d+)(?:\.(\d{1,3}))?$/ : /^(\d+)$/).exec(text.trim().replaceAll(',', ''));
  if (!m) return undefined;
  const qty = milliUnits ? Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0')) : Number(m[1]);
  return Number.isSafeInteger(qty) && qty <= MAX_QTY ? qty : undefined;
}

/** 12500 milli-units -> "12.5"; 12 pieces -> "12". */
export function formatQty(qty: number, milliUnits: boolean): string {
  if (!milliUnits) return String(qty);
  const rest = String(qty % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${Math.floor(qty / 1000)}${rest ? `.${rest}` : ''}`;
}

export const lineValue = (qty: number, unitCostCents: number, milliUnits: boolean) => divRoundHalfAway(qty * unitCostCents, milliUnits ? 1000 : 1);

/** "120.50" -> 12050; undefined when it is not a cost. */
export function parseCost(text: string): number | undefined {
  try {
    const c = parsePesos(text);
    return c >= 0 && c <= 100_000_000 ? c : undefined;
  } catch {
    return undefined;
  }
}

/** A cost typed that is not the latest purchase cost: it needs a reason. */
export const costChanged = (t: Typed, s: SheetSupply) => t.cost.trim() !== '' && parseCost(t.cost) !== undefined && parseCost(t.cost) !== s.defaultCostCents;

export interface CountLineInput { supplyId: string; qty: number; unitCostCents?: number; costReason?: string }

/** The lines to send (rows left empty are not on hand), the counted value, and what to fix first. */
export function countLines(sheet: SheetSupply[], typed: Record<string, Typed>) {
  const errors: string[] = [];
  const lines: CountLineInput[] = [];
  let totalCents = 0;
  for (const s of sheet) {
    const t = typed[s.supplyId] ?? emptyRow;
    if (!t.qty.trim()) continue;
    const qty = parseQty(t.qty, s.milliUnits);
    const cost = t.cost.trim() ? parseCost(t.cost) : s.defaultCostCents;
    if (qty === undefined) errors.push(`${s.name}: type the quantity in ${s.unit} like ${s.milliUnits ? '12.5' : '12'}.`);
    if (cost === undefined) errors.push(`${s.name}: type the cost per ${s.unit} like 120.00, or leave it empty for ${(s.defaultCostCents / 100).toFixed(2)}.`);
    if (qty === undefined || cost === undefined) continue;
    const changed = cost !== s.defaultCostCents;
    if (changed && t.reason.trim().length < 5) errors.push(`${s.name}: say why the cost is not the latest purchase cost.`);
    lines.push({ supplyId: s.supplyId, qty, ...(changed ? { unitCostCents: cost, costReason: t.reason.trim() } : {}) });
    totalCents += lineValue(qty, cost, s.milliUnits);
  }
  return { lines, totalCents, errors };
}

/** "2026-02-14" -> "2026-02-28". */
export function monthEndOf(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** The count date to offer: today on a month end, else the last month end. */
export function defaultCountDate(today: string): string {
  if (monthEndOf(today) === today) return today;
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The count sheet to print: a CSV of the category's supplies with an empty quantity column. */
export const countSheetCsvUrl = (category: Category, date: string) => `/api/inv/count-sheet?${new URLSearchParams({ category, date })}`;
