/**
 * Read-only views for the fixed-asset screens (PLAN E10, H2): one asset's page, and the months with no depreciation run.
 * Nothing here posts or changes anything; the figures are the register's (assets.ts) and the posted runs' lines.
 */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { assetRegister, assetsInService, scheduledCents, type Asset, type RegisterRow } from './assets.ts';

/** "2026-09" + 1 -> "2026-10". */
export function addMonth(month: string, by: number): string {
  const idx = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Whether `month` adds to the asset's accumulated depreciation, so a run should have charged it. */
const chargedIn = (a: Asset, month: string) => scheduledCents(a, month) > scheduledCents(a, addMonth(month, -1));

/** Months of the asset (in service) before `thisMonth` that add depreciation but have no line in a recorded run. */
function missingFor(db: Db, a: Asset, thisMonth: string): string[] {
  const done = new Set(
    (db.prepare(`SELECT l.month FROM fa_all_depreciation_lines l JOIN documents d ON d.id = l.document_id WHERE l.asset_id = ? AND d.status = 'posted'`).all(a.id) as { month: string }[]).map((r) => r.month),
  );
  const out: string[] = [];
  for (let m = a.acquiredOn.slice(0, 7); m < thisMonth; m = addMonth(m, 1)) if (chargedIn(a, m) && !done.has(m)) out.push(m);
  return out;
}

/** Every month before `thisMonth` in which an asset in service should have been charged and was not, oldest first. */
export function depreciationGaps(db: Db, thisMonth: string): string[] {
  return [...new Set(assetsInService(db).flatMap((a) => missingFor(db, a, thisMonth)))].sort();
}

/** The month of the latest recorded depreciation run (runs go month by month), or null before the first. */
export const lastRunMonth = (db: Db): string | null =>
  (db.prepare(`SELECT MAX(r.month) FROM fa_depreciation_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted'`).pluck().get() as string | null) ?? null;

export interface AssetDocument { docType: string; id: string; number: string; date: string; status: 'posted' | 'cancelled' }

export interface AssetPage extends RegisterRow {
  /** Charges from recorded runs, oldest month first; `accumulatedCents` is the total after that charge. */
  depreciation: { month: string; documentId: string; documentNumber: string; chargeCents: number; accumulatedCents: number }[];
  /** Months before this one with no charge, for an asset still in service. */
  missingMonths: string[];
  /** The purchase (or opening), the recorded runs that charged it and its disposals. */
  documents: AssetDocument[];
}

/** One asset with its depreciation month by month, its documents and its months with no run. */
export function assetPage(db: Db, id: string, thisMonth: string): AssetPage {
  const row = assetRegister(db).find((r) => r.id === id);
  if (!row) throw notFound('The asset');
  const depreciation = db
    .prepare(
      `SELECT l.month, l.document_id AS documentId, d.number AS documentNumber, l.charge_cents AS chargeCents, l.accumulated_cents AS accumulatedCents
       FROM fa_all_depreciation_lines l JOIN documents d ON d.id = l.document_id WHERE l.asset_id = ? AND d.status = 'posted' ORDER BY l.month, d.number`,
    )
    .all(id) as AssetPage['depreciation'];
  const doc = (docType: string, sql: string) => (db.prepare(sql).all({ id }) as Omit<AssetDocument, 'docType'>[]).map((r) => ({ docType, ...r }));
  const head = 'SELECT d.id, d.number, d.business_date AS date, d.status FROM documents d';
  const opening = db.prepare('SELECT 1 FROM fa_opening_assets WHERE document_id = ?').get(id) !== undefined;
  const documents = [
    ...doc(opening ? 'fa.opening' : 'fa.buy', `${head} WHERE d.id = @id`),
    ...doc('fa.depreciation', `${head} WHERE d.status = 'posted' AND d.id IN (SELECT document_id FROM fa_all_depreciation_lines WHERE asset_id = @id) ORDER BY d.number`),
    ...doc('fa.disposal', `${head} WHERE d.id IN (SELECT document_id FROM fa_all_disposals WHERE asset_id = @id) ORDER BY d.number`),
  ];
  const a = assetsInService(db).find((x) => x.id === id);
  return { ...row, depreciation, documents, missingMonths: a ? missingFor(db, a, thisMonth) : [] };
}
