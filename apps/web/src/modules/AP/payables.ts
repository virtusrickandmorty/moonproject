/**
 * Rules of the money-out screens (supplier bills and payments; expense vouchers share the EWT words): typed rows ->
 * server input. Pure, so they are tested without a browser. The server works out VAT, EWT and every total, and checks
 * everything again.
 */
import { formatPesos, type Issue } from '@moonproject/shared';
import type { ApLedger, Preview, Setting } from '../../api.ts';
import { cents, tendersToInput, type TenderInput, type TenderRow } from '../COL/money.ts';

/** The EWT classes (the server's EWT_CLASSES) in words. Their rates are a dated setting, so they come from the server. */
export const EWT_WORDS: Record<string, string> = {
  rent_5: 'Rent',
  contractor_2: 'Contractors and printers',
  prof_ind_5: 'Professional fees, individual (sworn declaration)',
  prof_ind_10: 'Professional fees, individual',
  prof_firm_10: 'Professional fees, firm (lower rate)',
  prof_firm_15: 'Professional fees, firm (higher rate)',
  goods_1: 'Goods (Top Withholding Agent only)',
  services_2: 'Services (Top Withholding Agent only)',
};

/** The rates in force today (setting tax.ewt_rates_bp), or null until the settings are loaded. */
export const ewtRates = (settings: Setting[]) => (settings.find((s) => s.key === 'tax.ewt_rates_bp')?.current as Record<string, number> | undefined) ?? null;

/** "Rent 5%"; the words alone while the rates are not loaded. */
export function ewtLabel(cls: string | null | undefined, ratesBp: Record<string, number> | null): string {
  if (!cls || cls === 'none') return 'No EWT';
  const rate = ratesBp?.[cls];
  return `${EWT_WORDS[cls] ?? cls}${rate === undefined ? '' : ` ${rate / 100}%`}`;
}

/** The EWT picker: '' leaves it to the usual class (named), then no EWT, then each class. */
export const ewtChoices = (usual: string | null, ratesBp: Record<string, number> | null): [string, string][] => [
  ['', `Usual: ${ewtLabel(usual, ratesBp)}`],
  ['none', 'No EWT'],
  ...Object.keys(EWT_WORDS).map((c): [string, string] => [c, ewtLabel(c, ratesBp)]),
];

/** A bill line is for a supply on file, an expense category, subcontracted production or freight-in (`for` says which). */
export interface BillLineRow { for: string; description: string; amount: string }
export interface BillLineInput { supplyId?: string; categoryId?: number; purchase?: 'subcontract' | 'freight_in'; description?: string; amountCents: number }
export const emptyBillLine = (): BillLineRow => ({ for: '', description: '', amount: '' });

function target(v: string): Pick<BillLineInput, 'supplyId' | 'categoryId' | 'purchase'> | null {
  if (v.startsWith('supply:') && v.length > 7) return { supplyId: v.slice(7) };
  if (/^category:\d+$/.test(v)) return { categoryId: Number(v.slice(9)) };
  return v === 'subcontract' || v === 'freight_in' ? { purchase: v } : null;
}

/** Rows -> bill lines. Blank rows are left out; amounts are as on the invoice, VAT included. */
export function billLinesToInput(rows: BillLineRow[]): { lines: BillLineInput[]; errors: string[] } {
  const lines: BillLineInput[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!r.for && !r.description.trim() && !r.amount.trim()) return;
    const to = target(r.for);
    const amount = cents(r.amount);
    if (!to) errors.push(`Line ${i + 1}: pick what it is for.`);
    if (amount === undefined || amount <= 0) errors.push(`Line ${i + 1}: type the amount on the invoice, like 1,250.00`);
    else if (to) lines.push({ ...to, ...(r.description.trim() ? { description: r.description.trim() } : {}), amountCents: amount });
  });
  if (lines.length === 0 && errors.length === 0) errors.push('Add what the invoice is for.');
  return { lines, errors };
}

export const billLinesToRows = (lines: BillLineInput[]): BillLineRow[] =>
  lines.map((l) => ({ for: l.supplyId ? `supply:${l.supplyId}` : l.categoryId ? `category:${l.categoryId}` : (l.purchase ?? ''), description: l.description ?? '', amount: formatPesos(l.amountCents) }));

/** What the server worked out, for "So far": the EWT with the class and rate it used (today's, at accrual). */
const ewtFigure = (d: { appliedEwtClass: string | null; ewtRateBp: number; ewtCents: number }): [string, number] =>
  [d.appliedEwtClass ? `EWT withheld (${ewtLabel(d.appliedEwtClass, { [d.appliedEwtClass]: d.ewtRateBp })})` : 'EWT withheld', d.ewtCents];

export const billFigures = (d: { inputVatCents: number; appliedEwtClass: string | null; ewtRateBp: number; ewtCents: number; payableCents: number; dueDate: string }): [string, number][] =>
  [['Input VAT', d.inputVatCents], ewtFigure(d), [`Owed to the supplier, due ${d.dueDate}`, d.payableCents]];

export const voucherFigures = (d: { expenseCents: number; inputVatCents: number; appliedEwtClass: string | null; ewtRateBp: number; ewtCents: number; cashCents: number }): [string, number][] =>
  [['Expense', d.expenseCents], ['Input VAT', d.inputVatCents], ewtFigure(d), ['Paid out', d.cashCents]];

/** A bill that can be paid; `owedCents` counts back what the payment being edited paid on it (it is cancelled first). */
export interface OpenBill { id: string; label: string; owedCents: number }

/** The supplier's recorded bills with something owed, oldest due first. */
export function openBills(ledger: ApLedger, paidBefore: { billId: string; amountCents: number }[] = []): OpenBill[] {
  const back = (id: string) => paidBefore.filter((p) => p.billId === id).reduce((s, p) => s + p.amountCents, 0);
  return ledger.bills
    .filter((b) => b.status === 'posted')
    .map((b) => ({ ...b, owedCents: b.owedCents + back(b.id) }))
    .filter((b) => b.owedCents > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number))
    .map((b) => ({ id: b.id, label: `${b.number} · invoice no. ${b.supplierInvoiceNo} · due ${b.dueDate}`, owedCents: b.owedCents }));
}

export interface PaymentInput { supplierId: string; bills: { billId: string; amountCents: number }[]; tenders: TenderInput[]; feeCents?: number; note?: string }

/** Typed "pay now" per bill, tenders and the bank fee -> input. One tender typed without an amount pays the bills and the fee. */
export function paymentInput(v: { supplierId: string; bills: OpenBill[]; pay: Record<string, string>; tenders: TenderRow[]; fee: string; note: string }): { input: PaymentInput; errors: string[] } {
  const errors: string[] = [];
  const bills = v.bills.flatMap((b) => {
    const amount = cents(v.pay[b.id] ?? '');
    if (amount === undefined || amount < 0) errors.push(`${b.label}: type an amount like 1,250.00`);
    return amount ? [{ billId: b.id, amountCents: amount }] : [];
  });
  const fee = cents(v.fee);
  if (fee === undefined || fee < 0) errors.push('Type the bank fee like 15.00, or leave it empty.');
  const out = bills.reduce((s, b) => s + b.amountCents, 0) + (fee ?? 0);
  const [one] = v.tenders;
  const rows = v.tenders.length === 1 && one!.cashPlaceId && !one!.amount.trim() && out > 0 ? [{ ...one!, amount: formatPesos(out) }] : v.tenders;
  const pay = tendersToInput(rows, 'pick where the money came from');
  if (!v.supplierId) errors.unshift('Pick the supplier.');
  else if (bills.length === 0 && errors.length === 0) errors.push('Type what is paid on at least one bill.');
  const input = { supplierId: v.supplierId, bills, tenders: pay.tenders, ...(fee ? { feeCents: fee } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) };
  return { input, errors: [...errors, ...pay.errors] };
}

/**
 * An edit's preview runs while the original is still recorded, so the server finds the original's own invoice or
 * receipt number, or what it paid, in the way. Recording cancels the original first and the server checks again, so
 * those errors are left out of the replacement's preview: a duplicate that is the original itself, and "more than
 * owed" where `fits` shows the amount is within what was owed before the original.
 */
export function forReplacement(p: Preview, originalNumber: string, fits: (field: string) => boolean = () => false): Preview {
  const stale = (i: Issue) =>
    i.level === 'error' && ((/^DUPLICATE_(INVOICE|RECEIPT)$/.test(i.code) && i.message.endsWith(` on ${originalNumber}.`)) || (i.code === 'MORE_THAN_OWED' && fits(i.field ?? '')));
  return { ...p, issues: p.issues.filter((i) => !stale(i)) };
}
