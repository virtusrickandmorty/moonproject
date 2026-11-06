/**
 * What a price list upload will change (the owner's request, Nov 2026: uploading a sheet again updates the rates and prices of
 * the items it names). Each row is compared with what the item has now, so the check before an import and the import itself
 * agree, and a sheet that is older than a change made on the screen shows as rates going down instead of passing unseen.
 * - An item is found by its name, or by the name it had before a rename.
 * - When a sheet says two things for one item, step and part (or one price tier), its last row counts, and the plan says so.
 * - A rate of 0 never replaces a rate: a cell left at 0 is no reason to stop paying for a step.
 */
import type { Db } from '../../platform/db/driver.ts';
import { findPriceListItem, latestPrice } from '../CAT/public.ts';
import { listSteps } from '../PRD/public.ts';
import { rateAt } from '../RATE/public.ts';
import { priceListRow } from './csv.ts';

export interface PlanRow { id: string; rowNumber: number; raw: Record<string, string> }
export interface PlannedChange { item: string; what: string; row: number; fromCents: number | null; toCents: number }
export interface PricePlan {
  newItems: string[];
  rates: PlannedChange[];
  prices: PlannedChange[];
  /** Rows with nothing to change. */
  unchanged: number;
  /** A rate of 0 in the sheet, left as it is. */
  zeroKept: { item: string; what: string; row: number; keptCents: number }[];
  /** One thing said twice with different figures: the last row is used. */
  clashes: { item: string; what: string; rows: number[]; usedRow: number }[];
}
export type RowPlan = { rate: boolean; price: boolean; newItem: boolean };

type Steps = ReturnType<typeof listSteps>;
/** The production step a row's Operation names; none for a row with only a price. */
export function stepNamed(steps: Steps, operation: string) {
  const op = operation.toLowerCase();
  return op ? steps.find((s) => s.code.toLowerCase() === op || s.name.toLowerCase() === op || s.name.toLowerCase().startsWith(op)) : undefined;
}

const partWords = (part: string) => (part === 'whole' ? '' : ` (${part})`);

export function planPriceList(db: Db, rows: PlanRow[], today: string): { plan: PricePlan; byRow: Map<string, RowPlan> } {
  const steps = listSteps(db);
  const byRow = new Map<string, RowPlan>(rows.map((r) => [r.id, { rate: false, price: false, newItem: false }]));
  type Said = { row: PlanRow; value: number; item: string; what: string; garmentType: string | null; itemId: string | null; stepCode?: string; part?: 'whole' | 'upper' | 'lower'; minQty?: number };
  const rates = new Map<string, Said[]>();
  const prices = new Map<string, Said[]>();
  const newItems = new Map<string, string>();
  const say = (map: Map<string, Said[]>, key: string, said: Said) => map.set(key, [...(map.get(key) ?? []), said]);
  for (const row of rows) {
    const p = priceListRow(row.raw);
    const found = findPriceListItem(db, p.item);
    const itemKey = found?.id ?? `new:${p.item.toLowerCase()}`;
    if (!found) { newItems.set(itemKey, p.item); byRow.get(row.id)!.newItem = true; }
    const common = { row, item: p.item, garmentType: found?.garmentType ?? null, itemId: found?.id ?? null };
    const step = stepNamed(steps, p.operation);
    if (step && p.rateCents !== undefined) say(rates, `${itemKey}|${step.code}|${p.part}`, { ...common, value: p.rateCents, what: `${step.name}${partWords(p.part)}`, stepCode: step.code, part: p.part });
    if (p.priceCents !== undefined) say(prices, `${itemKey}|${p.minQty}`, { ...common, value: p.priceCents, what: p.minQty > 1 ? `Price from ${p.minQty} pieces` : 'Price', minQty: p.minQty });
  }
  const plan: PricePlan = { newItems: [...newItems.values()], rates: [], prices: [], unchanged: 0, zeroKept: [], clashes: [] };
  const lastOf = (said: Said[]) => {
    const last = said.at(-1)!;
    if (new Set(said.map((s) => s.value)).size > 1) plan.clashes.push({ item: last.item, what: last.what, rows: said.map((s) => s.row.rowNumber), usedRow: last.row.rowNumber });
    return last;
  };
  for (const said of rates.values()) {
    const last = lastOf(said);
    const now = last.garmentType === null ? undefined : rateAt(db, last.garmentType, last.stepCode!, 'standard', today, last.part)?.rateCents;
    if (last.value === 0 && (now ?? 0) > 0) { plan.zeroKept.push({ item: last.item, what: last.what, row: last.row.rowNumber, keptCents: now! }); continue; }
    if (now === last.value) continue;
    plan.rates.push({ item: last.item, what: last.what, row: last.row.rowNumber, fromCents: now ?? null, toCents: last.value });
    byRow.get(last.row.id)!.rate = true;
  }
  for (const said of prices.values()) {
    const last = lastOf(said);
    const now = last.itemId === null ? undefined : latestPrice(db, last.itemId, last.minQty!);
    if (now === last.value) continue;
    plan.prices.push({ item: last.item, what: last.what, row: last.row.rowNumber, fromCents: now ?? null, toCents: last.value });
    byRow.get(last.row.id)!.price = true;
  }
  plan.unchanged = [...byRow.values()].filter((r) => !r.rate && !r.price && !r.newItem).length;
  return { plan, byRow };
}
