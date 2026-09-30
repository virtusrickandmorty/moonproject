/**
 * What a count values supplies at (ACC-13 DEFAULT: the latest purchase cost on the count date): the newest posted supplier
 * bill that tells a unit cost, else the newest posted purchase order line, else the last purchase cost on the catalogue.
 */
import { divRoundHalfAway } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { latestPurchaseCost, type LatestPurchaseCost, type PurchaseCostSource } from '../AP/public.ts';
import { activeSuppliesOf, type CountableSupply, type SupplyUnit } from '../PUR/public.ts';

export const CATEGORIES = ['materials', 'ready_made'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = { materials: 'materials and supplies', ready_made: 'ready-made merchandise' };
/** The inventory account of each category (PLAN D2: 1301, 1302). */
export const INVENTORY_ROLE: Record<Category, string> = { materials: 'INV_MATERIALS', ready_made: 'INV_MERCH' };

/** Fabric and anything weighed is counted in milli-units (1 yard = 1000), pieces and rolls whole (PLAN C5). */
export const MILLI_UNITS: ReadonlySet<SupplyUnit> = new Set(['yard', 'meter', 'kg']);
export const qtyScale = (unit: SupplyUnit) => (MILLI_UNITS.has(unit) ? 1000 : 1);

/** Quantity × cost per unit, rounded to the centavo per line. */
export const lineValue = (qty: number, unitCostCents: number, unit: SupplyUnit) => divRoundHalfAway(qty * unitCostCents, qtyScale(unit));

export type CostSource = PurchaseCostSource;
export type DefaultCost = LatestPurchaseCost;

export const defaultCost = (db: Db, s: CountableSupply, asOf: string): DefaultCost => latestPurchaseCost(db, s, asOf);

/** "2026-02-14" -> "2026-02-28". */
export function monthEndOf(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** The last month end before a date: "2026-09-14" -> "2026-08-31". */
export function previousMonthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** One row of the count sheet: an active supply of the category with its unit and default cost on the count date. */
export interface SheetRow {
  supplyId: string; name: string; unit: SupplyUnit; milliUnits: boolean; defaultCostCents: number; costSource: CostSource; costSourceNumber: string | null;
  costSourceDate: string | null;
}

export const countSheet = (db: Db, category: Category, asOf: string): SheetRow[] =>
  activeSuppliesOf(db, category).map((s) => {
    const d = defaultCost(db, s, asOf);
    return { supplyId: s.id, name: s.name, unit: s.unit, milliUnits: MILLI_UNITS.has(s.unit), defaultCostCents: d.unitCostCents, costSource: d.source, costSourceNumber: d.sourceNumber, costSourceDate: d.sourceDate };
  });
