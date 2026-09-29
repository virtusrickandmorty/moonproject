/**
 * The fixed-asset register screens' rules (PLAN E10, H2): the depreciation warning, an asset's months, filters and totals
 * of the register, and the disposal's input. Pure, so they are tested without a browser; the server checks everything again.
 */
import type { AssetPage, AssetRow, AssetStatus, DepreciationGaps } from '../../api.ts';
import { monthLabel } from '../TAX/bir.ts';

export const STATUS_WORDS: Record<AssetStatus, string> = { 'in service': 'In service', 'fully depreciated': 'Fully depreciated', disposed: 'Disposed of', cancelled: 'Cancelled' };
export const STATUSES = Object.keys(STATUS_WORDS) as AssetStatus[];

/** "" when every month before this one is charged; else the warning naming the months. */
export function gapWarning(months: string[]): string {
  if (months.length === 0) return '';
  return `No depreciation was recorded for ${months.map(monthLabel).join(', ')}. Run the months from the oldest, so each month's charge falls in its own books.`;
}

/** The month a depreciation run should offer first: the first gap after the latest run (runs go month by month), else this month. */
export const defaultRunMonth = (g: DepreciationGaps) => g.months.find((m) => !g.lastRunMonth || m > g.lastRunMonth) ?? g.thisMonth;

/** "2026-02" -> "2026-02-28". */
export const lastDayOf = (month: string) => `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** A run for an earlier month is dated that month's last day (the accountant may backdate it); this month's is dated today, so no date is sent. */
export const runDate = (month: string, thisMonth: string) => (month < thisMonth ? lastDayOf(month) : undefined);

/** An asset's months, oldest first: each recorded charge, and each month with no charge as a row without a run. */
export function monthRows(a: Pick<AssetPage, 'depreciation' | 'missingMonths'>) {
  const rows = [...a.depreciation.map((d) => ({ month: d.month, run: d })), ...a.missingMonths.map((month) => ({ month, run: null }))];
  return rows.sort((x, y) => x.month.localeCompare(y.month));
}

export function filterAssets(rows: AssetRow[], search: string, status: AssetStatus | 'all'): AssetRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => (status === 'all' || r.status === status) && (!q || [r.number, r.description, r.className, r.location ?? ''].some((t) => t.toLowerCase().includes(q))));
}

/** Cost, accumulated depreciation and book value of the assets still on the books (not disposed of or cancelled). */
export function onTheBooks(rows: AssetRow[]) {
  const live = rows.filter((r) => r.status === 'in service' || r.status === 'fully depreciated');
  const sum = (k: 'costCents' | 'accumulatedCents' | 'bookValueCents') => live.reduce((s, r) => s + (r[k] ?? 0), 0);
  return { count: live.length, costCents: sum('costCents'), accumulatedCents: sum('accumulatedCents'), bookValueCents: sum('bookValueCents') };
}

/** A retirement's reason -> input (a sale's input is saleInput in sale.ts). */
export function disposalInput(assetId: string, reason: string) {
  const errors = reason.trim().length >= 5 ? [] : ['Say why it is being taken off the books (at least 5 characters).'];
  return { input: { assetId, kind: 'retirement', reason: reason.trim() }, errors };
}

/** Whether a disposal or a run may still be recorded for this asset. */
export const canDispose = (a: Pick<AssetPage, 'status'>) => a.status === 'in service' || a.status === 'fully depreciated';
