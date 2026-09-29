/**
 * The fixed-asset register screens' rules (PLAN E10, H2): the depreciation warning, an asset's months, filters and totals
 * of the register, and the disposal's input. Pure, so they are tested without a browser; the server checks everything again.
 */
import type { AssetPage, AssetRow, AssetStatus, DepreciationGaps } from '../../api.ts';
import { monthLabel } from '../TAX/bir.ts';
import { cents } from '../COL/money.ts';

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

const REASON_ERROR = 'Say why it is being taken off the books (at least 5 characters).';

/** The disposal dialog's reason -> the input of a retirement (nothing received for the asset). */
export function disposalInput(assetId: string, reason: string) {
  const errors = reason.trim().length >= 5 ? [] : [REASON_ERROR];
  return { input: { assetId, kind: 'retirement', reason: reason.trim() }, errors };
}

/** A sale as typed (PLAN D5 FA-DISP): the buyer picked or typed, the booklet invoice, the price VAT included, where it was paid. */
export interface SaleValues {
  reason: string; buyer: 'customer' | 'typed'; customer: { id: string; name: string } | null; buyerName: string; buyerAddress: string; buyerTin: string;
  invoiceNumber: string; price: string; cashPlaceId: string;
}
export const emptySale = (): SaleValues => ({ reason: '', buyer: 'customer', customer: null, buyerName: '', buyerAddress: '', buyerTin: '', invoiceNumber: '', price: '', cashPlaceId: '' });

/** The sale's values -> input, and every slip to fix before the server is asked. The server checks everything again. */
export function saleInput(assetId: string, v: SaleValues) {
  const errors: string[] = [];
  if (v.reason.trim().length < 5) errors.push(REASON_ERROR);
  const typed = { buyerName: v.buyerName.trim(), buyerAddress: v.buyerAddress.trim(), buyerTin: v.buyerTin.trim() };
  const buyer = v.buyer === 'customer' ? (v.customer ? { customerId: v.customer.id } : null) : typed;
  if (!buyer) errors.push('Pick the buyer from the customers.');
  else if (v.buyer === 'typed') {
    if (typed.buyerName.length < 2) errors.push('Type the buyer’s name as it goes on the invoice.');
    if (typed.buyerAddress.length < 5) errors.push('Type the buyer’s address.');
    if (!/^\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?$/.test(typed.buyerTin)) errors.push('Type the buyer’s TIN like 123-456-789-000.');
  }
  const invoiceNumber = v.invoiceNumber.trim();
  if (!/^0*[1-9]\d{0,11}$/.test(invoiceNumber)) errors.push('Type the invoice number from the booklet (digits only).');
  const price = cents(v.price);
  if (!price || price < 0) errors.push('Type the price the buyer paid, VAT included, like 33,600.00');
  if (!v.cashPlaceId) errors.push('Pick where the buyer paid.');
  const input = { assetId, kind: 'sale', reason: v.reason.trim(), ...buyer, invoiceNumber, ...(price && price > 0 ? { priceCents: price } : {}), ...(v.cashPlaceId ? { cashPlaceId: Number(v.cashPlaceId) } : {}) };
  return { input, errors };
}

/** What the server worked out for a disposal (its preview's doc), as the dialog shows it before saving. */
export interface DisposalFigures {
  bookValueCents: number; gainCents: number; lossCents: number;
  sale: { grossCents: number; vatCents: number; vatableSalesCents: number } | null;
}

/** Book value and the gain or loss; for a sale, "write these on the booklet" (VATable sales, VAT, total) like the quick sale form. */
export function disposalFigures(d: DisposalFigures) {
  const result: [string, number][] = d.gainCents > 0 ? [['Gain on the sale', d.gainCents]] : d.lossCents > 0 ? [[d.sale ? 'Loss on the sale' : 'Loss (the book value)', d.lossCents]] : [];
  return {
    result: [['Book value today', d.bookValueCents] as [string, number], ...result],
    booklet: d.sale ? ([['VATable sales', d.sale.vatableSalesCents], ['VAT', d.sale.vatCents], ['Total', d.sale.grossCents]] as [string, number][]) : null,
  };
}

/** Whether a disposal or a run may still be recorded for this asset. */
export const canDispose = (a: Pick<AssetPage, 'status'>) => a.status === 'in service' || a.status === 'fully depreciated';
