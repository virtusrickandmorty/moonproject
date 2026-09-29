/**
 * Asset classes and the asset register (PLAN E10). An asset is its FA- purchase or its OBFA- opening document (an asset
 * owned before the cut-over date): that id is its party id on 15x0 and 15x1. Accumulated depreciation comes from the
 * ledger (NR-2); the status comes from the documents, never stored.
 */
import { divRoundHalfAway } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

export interface AssetClass { code: string; name: string; costRole: string; accumRole: string; expenseRole: string; defaultLifeMonths: number | null }

const CLASS_SELECT = `SELECT code, name, cost_role AS costRole, accum_role AS accumRole, expense_role AS expenseRole,
  default_life_months AS defaultLifeMonths FROM fa_classes`;

export function listClasses(db: Db): AssetClass[] {
  return db.prepare(`${CLASS_SELECT} ORDER BY sort_order`).all() as AssetClass[];
}

export function assetClass(db: Db, code: string): AssetClass | undefined {
  return db.prepare(`${CLASS_SELECT} WHERE code = ?`).get(code) as AssetClass | undefined;
}

export const assetParty = (id: string) => ({ type: 'asset', id });

/**
 * `disposal` is the number of the recorded (not cancelled) disposal, if any. `openedOn` is the cut-over date of an
 * opening asset (OBFA-) and `openingAccumulatedCents` the old books' accumulated depreciation on it; both null for a purchase.
 */
export interface Asset {
  id: string; number: string; docStatus: 'posted' | 'cancelled'; classCode: string; description: string; location: string | null; acquiredOn: string;
  costCents: number; residualCents: number; lifeMonths: number; disposal: string | null; openedOn: string | null; openingAccumulatedCents: number | null;
}

/** Purchases and opening assets alike (the fa_all_* views of migration 0002). */
const ASSET_SELECT = `SELECT a.document_id AS id, d.number, d.status AS docStatus, a.class_code AS classCode, a.description, a.location,
  a.acquired_on AS acquiredOn, a.cost_cents AS costCents, a.residual_cents AS residualCents, a.life_months AS lifeMonths,
  (SELECT dd.number FROM fa_all_disposals x JOIN documents dd ON dd.id = x.document_id WHERE x.asset_id = a.document_id AND dd.status = 'posted') AS disposal,
  CASE WHEN a.opening_accumulated_cents IS NULL THEN NULL ELSE d.business_date END AS openedOn, a.opening_accumulated_cents AS openingAccumulatedCents
  FROM fa_all_assets a JOIN documents d ON d.id = a.document_id`;

export function asset(db: Db, id: string): Asset | undefined {
  return db.prepare(`${ASSET_SELECT} WHERE a.document_id = ?`).get(id) as Asset | undefined;
}

/** An OBFA- opening asset (its run lines and disposal go to the fa_opening_* tables), not an FA- purchase. */
export const isOpeningAsset = (db: Db, id: string) => db.prepare('SELECT 1 FROM fa_opening_assets WHERE document_id = ?').get(id) !== undefined;

/** Recorded assets not disposed of, oldest first: the ones a depreciation run looks at. */
export function assetsInService(db: Db): Asset[] {
  return (db.prepare(`${ASSET_SELECT} WHERE d.status = 'posted' ORDER BY a.acquired_on, d.number`).all() as Asset[]).filter((a) => !a.disposal);
}

/** Accumulated depreciation of one asset, from the ledger (15x1 is a credit balance; returned positive). */
export function accumulatedCents(db: Db, a: Asset): number {
  const cls = assetClass(db, a.classCode)!;
  return -accountBalance(db, resolveAccount(db, { role: cls.accumRole }).id, { party: assetParty(a.id) });
}

/** Months from the acquisition month to `month` (YYYY-MM), both counted: bought in September, September is month 1. */
export function monthsInService(acquiredOn: string, month: string): number {
  const n = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7));
  return n(month) - n(acquiredOn) + 1;
}

/**
 * Straight-line accumulated depreciation after `months` months: (cost − residual) × months ÷ life, rounded half away
 * from zero, never past the life. A month's charge is the step between two months, so the charges add up to exactly
 * cost − residual and the asset stops at its residual value.
 */
export function straightLine(a: Pick<Asset, 'costCents' | 'residualCents' | 'lifeMonths'>, months: number): number {
  return divRoundHalfAway((a.costCents - a.residualCents) * Math.max(0, Math.min(months, a.lifeMonths)), a.lifeMonths);
}

type Life = Pick<Asset, 'acquiredOn' | 'costCents' | 'residualCents' | 'lifeMonths'>;

/**
 * The last month the old books charged for an opening asset. They charge at each month's end, so an opening dated the
 * 1st (the usual cut-over) carries the old books up to the month before, and that month's own charge is still owed; an
 * opening dated any other day is taken to carry the cut-over month too.
 */
export function lastMonthCharged(cutoverDate: string): string {
  const y = Number(cutoverDate.slice(0, 4)), m = Number(cutoverDate.slice(5, 7));
  if (cutoverDate.slice(8, 10) !== '01') return cutoverDate.slice(0, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * An asset owned before the cut-over (fa.opening), on the cut-over date: its months in service up to the last month the
 * old books charged (counted like a purchase's; those months are not depreciated again), the straight-line figure for
 * them, what is left to depreciate, and the months of its life left after that month (at least one: what is left of an
 * asset whose life ran out before the cut-over comes off in the first run after it).
 */
export function atCutover(a: Life, cutoverDate: string, accumulatedCents: number) {
  const months = monthsInService(a.acquiredOn, lastMonthCharged(cutoverDate));
  const straightLineCents = straightLine(a, months);
  return {
    months, straightLineCents, onStraightLine: accumulatedCents === straightLineCents,
    leftCents: a.costCents - a.residualCents - accumulatedCents, monthsLeft: Math.max(a.lifeMonths - months, 1),
  };
}

/**
 * The accumulated depreciation an asset should have at the end of `month` (YYYY-MM); a run charges the step up to it.
 * A purchase follows the straight line. An opening asset keeps the old books' figure through the last month they charged;
 * after it, it follows the straight line when the old books were on it, else what was left at the cut-over is spread evenly
 * over the months of life left. Either way the charges add up to exactly cost − residual and stop there.
 */
export function scheduledCents(a: Life & Pick<Asset, 'openedOn' | 'openingAccumulatedCents'>, month: string): number {
  const months = monthsInService(a.acquiredOn, month);
  if (a.openedOn === null || a.openingAccumulatedCents === null) return straightLine(a, months);
  const c = atCutover(a, a.openedOn, a.openingAccumulatedCents);
  if (months <= c.months) return a.openingAccumulatedCents;
  if (c.onStraightLine) return straightLine(a, months);
  return a.openingAccumulatedCents + divRoundHalfAway(c.leftCents * Math.min(months - c.months, c.monthsLeft), c.monthsLeft);
}

/** A month's charge: the straight line's, or for an opening asset off it, what was left at the cut-over over the months left. */
export function monthlyChargeCents(a: Life & Pick<Asset, 'openedOn' | 'openingAccumulatedCents'>): number {
  if (a.openedOn === null || a.openingAccumulatedCents === null) return straightLine(a, 1);
  const c = atCutover(a, a.openedOn, a.openingAccumulatedCents);
  return c.onStraightLine ? straightLine(a, 1) : divRoundHalfAway(c.leftCents, c.monthsLeft);
}

export type AssetStatus = 'in service' | 'fully depreciated' | 'disposed' | 'cancelled';

export interface RegisterRow extends Omit<Asset, 'docStatus'> { className: string; status: AssetStatus; monthlyChargeCents: number; accumulatedCents: number; bookValueCents: number }

/** The fixed-asset register: every asset with its status, accumulated depreciation and book value. */
export function assetRegister(db: Db): RegisterRow[] {
  const classes = new Map(listClasses(db).map((c) => [c.code, c]));
  const rows = db.prepare(`${ASSET_SELECT} ORDER BY d.number`).all() as Asset[];
  return rows.map(({ docStatus, ...a }) => {
    const acc = accumulatedCents(db, { docStatus, ...a });
    const status: AssetStatus =
      docStatus === 'cancelled' ? 'cancelled' : a.disposal ? 'disposed' : acc >= a.costCents - a.residualCents ? 'fully depreciated' : 'in service';
    const bookValueCents = status === 'disposed' || status === 'cancelled' ? 0 : a.costCents - acc;
    return { ...a, className: classes.get(a.classCode)?.name ?? '?', status, monthlyChargeCents: monthlyChargeCents(a), accumulatedCents: acc, bookValueCents };
  });
}
