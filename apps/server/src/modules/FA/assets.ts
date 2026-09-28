/**
 * Asset classes and the asset register (PLAN E10). An asset is its FA- document: that id is its party id on 15x0 and
 * 15x1. Accumulated depreciation comes from the ledger (NR-2); the status comes from the documents, never stored.
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

/** `disposal` is the number of the recorded (not cancelled) disposal, if any. */
export interface Asset {
  id: string; number: string; docStatus: 'posted' | 'cancelled'; classCode: string; description: string; location: string | null; acquiredOn: string;
  costCents: number; residualCents: number; lifeMonths: number; disposal: string | null;
}

const ASSET_SELECT = `SELECT a.document_id AS id, d.number, d.status AS docStatus, a.class_code AS classCode, a.description, a.location,
  a.acquired_on AS acquiredOn, a.cost_cents AS costCents, a.residual_cents AS residualCents, a.life_months AS lifeMonths,
  (SELECT dd.number FROM fa_disposals x JOIN documents dd ON dd.id = x.document_id WHERE x.asset_id = a.document_id AND dd.status = 'posted') AS disposal
  FROM fa_assets a JOIN documents d ON d.id = a.document_id`;

export function asset(db: Db, id: string): Asset | undefined {
  return db.prepare(`${ASSET_SELECT} WHERE a.document_id = ?`).get(id) as Asset | undefined;
}

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
    return { ...a, className: classes.get(a.classCode)?.name ?? '?', status, monthlyChargeCents: straightLine(a, 1), accumulatedCents: acc, bookValueCents };
  });
}
