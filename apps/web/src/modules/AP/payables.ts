/**
 * Rules of the money-out screens (supplier bills, opening supplier bills, payments, advances and their returns; expense vouchers share the EWT
 * words): typed rows -> server input. Pure, so they are tested without a browser. The server works out VAT, EWT and
 * every total, and checks everything again.
 */
import { formatPesos, isBusinessDate, type Issue } from '@moonproject/shared';
import type { ApLedger, OpeningStatus, Preview, Setting } from '../../api.ts';
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
  if (!cls || cls === 'none') return 'No tax withheld (EWT)';
  const rate = ratesBp?.[cls];
  return `${EWT_WORDS[cls] ?? cls}${rate === undefined ? '' : ` ${rate / 100}%`}`;
}

/** The EWT picker: '' leaves it to the usual class (named), then no EWT, then each class. */
export const ewtChoices = (usual: string | null, ratesBp: Record<string, number> | null): [string, string][] => [
  ['', `Usual: ${ewtLabel(usual, ratesBp)}`],
  ['none', 'No tax withheld (EWT)'],
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
  [d.appliedEwtClass ? `Tax withheld from supplier (EWT) (${ewtLabel(d.appliedEwtClass, { [d.appliedEwtClass]: d.ewtRateBp })})` : 'Tax withheld from supplier (EWT)', d.ewtCents];

/** With advances applied (PLAN D5 SUP-ADV), what they took off and what is still owed after them. */
export const billFigures = (d: { inputVatCents: number; appliedEwtClass: string | null; ewtRateBp: number; ewtCents: number; payableCents: number; dueDate: string; advanceCents?: number; owedCents?: number }): [string, number][] => [
  ['Input VAT', d.inputVatCents], ewtFigure(d), [`Owed to the supplier, due ${d.dueDate}`, d.payableCents],
  ...(d.advanceCents ? [['Advances applied', d.advanceCents], ['Still owed after the advances', d.owedCents ?? d.payableCents - d.advanceCents]] as [string, number][] : []),
];

export const advanceFigures = (d: { appliedEwtClass: string | null; ewtRateBp: number; ewtCents: number; cashCents: number }): [string, number][] =>
  [ewtFigure(d), ['Paid out', d.cashCents]];

export const voucherFigures = (d: { expenseCents: number; inputVatCents: number; appliedEwtClass: string | null; ewtRateBp: number; ewtCents: number; cashCents: number }): [string, number][] =>
  [['Expense', d.expenseCents], ['Input VAT', d.inputVatCents], ewtFigure(d), ['Paid out', d.cashCents]];

/**
 * An opening supplier bill (OBAP-, PLAN D8 step 3): a bill of the old books still unpaid on the cut-over date, with what
 * was still owed on it then. No lines, VAT or EWT: those were in the old books.
 */
export interface OpeningBillInput { supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string; dueDate: string; owedCents: number; note?: string }
export interface OpeningBillValues { supplierId: string; invoiceNo: string; invoiceDate: string; dueDate: string; owed: string; note: string }

export function openingBillInput(v: OpeningBillValues): { input: OpeningBillInput; errors: string[] } {
  const owed = cents(v.owed);
  const errors = [
    ...(v.supplierId ? [] : ['Pick the supplier.']),
    ...(v.invoiceNo.trim() ? [] : ['Type the number on the supplier’s invoice.']),
    ...(isBusinessDate(v.invoiceDate) ? [] : ['Pick the date on the supplier’s invoice.']),
    ...(isBusinessDate(v.dueDate) ? [] : ['Pick the due date.']),
    ...(owed !== undefined && owed > 0 ? [] : ['Type what was still owed on the cut-over date, like 1,250.00']),
  ];
  const input = {
    supplierId: v.supplierId, supplierInvoiceNo: v.invoiceNo.trim(), supplierInvoiceDate: v.invoiceDate, dueDate: v.dueDate, owedCents: owed ?? 0,
    ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { input, errors };
}

export const openingBillValues = (i: OpeningBillInput): OpeningBillValues => ({
  supplierId: i.supplierId, invoiceNo: i.supplierInvoiceNo, invoiceDate: i.supplierInvoiceDate, dueDate: i.dueDate, owed: formatPesos(i.owedCents), note: i.note ?? '',
});

/** Why no opening document can be recorded now, or null: the date is loading, not set yet, or the opening is closed. */
export function openingDateProblem(o: OpeningStatus | undefined): string | null {
  if (!o) return 'Loading the cut-over date…';
  if (o.closed) return `The opening was closed on ${o.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.`;
  return o.cutoverDate ? null : 'Set the cut-over date on the opening balances screen first.';
}

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
 * owed" or "more than open" where `fits` shows the amount is within what was owed or open before the original.
 */
export function forReplacement(p: Preview, originalNumber: string, fits: (field: string) => boolean = () => false): Preview {
  const stale = (i: Issue) =>
    i.level === 'error' && ((/^DUPLICATE_(INVOICE|RECEIPT)$/.test(i.code) && i.message.endsWith(` on ${originalNumber}.`)) || (/^(MORE_THAN_OWED|ADVANCE_MORE_THAN_OPEN|MORE_THAN_OPEN)$/.test(i.code) && fits(i.field ?? '')));
  return { ...p, issues: p.issues.filter((i) => !stale(i)) };
}

/**
 * A supplier advance (SADV-, PLAN D5 SUP-ADV): the whole advance, where the money came from and the EWT. The server
 * works out the EWT; `cashCents` is what it last said leaves the cash places, so one tender typed without an amount
 * pays that (the advance itself until the server has answered).
 */
export interface AdvanceInput { supplierId: string; purchaseOrderId?: string; amountCents: number; tenders: TenderInput[]; ewtClass?: string; note?: string }
export interface AdvanceValues { supplierId: string; purchaseOrderId: string; amount: string; ewt: string; tenders: TenderRow[]; note: string }

export function advanceInput(v: AdvanceValues, cashCents?: number): { input: AdvanceInput; errors: string[] } {
  const amount = cents(v.amount);
  const errors = [...(v.supplierId ? [] : ['Pick the supplier.']), ...(amount !== undefined && amount > 0 ? [] : ['Type the advance, like 5,000.00'])];
  const [one] = v.tenders;
  const out = cashCents ?? amount ?? 0;
  const rows = v.tenders.length === 1 && one!.cashPlaceId && !one!.amount.trim() && out > 0 ? [{ ...one!, amount: formatPesos(out) }] : v.tenders;
  const pay = tendersToInput(rows, 'pick where the money came from');
  const input = {
    supplierId: v.supplierId, ...(v.purchaseOrderId ? { purchaseOrderId: v.purchaseOrderId } : {}), amountCents: amount ?? 0, tenders: pay.tenders,
    ...(v.ewt ? { ewtClass: v.ewt } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  return { input, errors: [...errors, ...pay.errors] };
}

/** An advance still open that a bill can take or the supplier can give back; `openCents` counts back what the document being edited took. */
export interface OpenAdvance { id: string; label: string; openCents: number }

/** The supplier's recorded advances with something still open, oldest first (the order a bill takes them in). */
export function openAdvances(ledger: ApLedger, takenBefore: { advanceId: string; amountCents: number }[] = []): OpenAdvance[] {
  const back = (id: string) => takenBefore.filter((t) => t.advanceId === id).reduce((s, t) => s + t.amountCents, 0);
  return ledger.advances
    .filter((a) => a.status === 'posted')
    .map((a) => ({ ...a, openCents: a.openCents + back(a.id) }))
    .filter((a) => a.openCents > 0)
    .map((a) => ({ id: a.id, label: `${a.number} of ${a.date}${a.purchaseOrderNumber ? ` on ${a.purchaseOrderNumber}` : ''}`, openCents: a.openCents }));
}

/**
 * The advances a bill applies: left to the server (its open advances, oldest first, up to what the bill owes) unless
 * the user types them; a typed blank or zero takes nothing from that advance.
 */
export function billAdvancesInput(auto: boolean, open: OpenAdvance[], typed: Record<string, string>): { advances?: { advanceId: string; amountCents: number }[]; errors: string[] } {
  if (auto) return { errors: [] };
  const errors: string[] = [];
  const advances = open.flatMap((a) => {
    const amount = cents(typed[a.id] ?? '');
    if (amount === undefined || amount < 0) errors.push(`${a.label}: type an amount like 1,250.00`);
    else if (amount > a.openCents) errors.push(`${a.label}: only ${formatPesos(a.openCents)} is still open.`);
    return amount ? [{ advanceId: a.id, amountCents: amount }] : [];
  });
  return { advances, errors };
}

/** The supplier gives an advance back (SADR-): one tender typed without an amount takes back all that is still open. */
export interface AdvanceReturnInput { advanceId: string; tenders: TenderInput[]; note?: string }

export function advanceReturnInput(v: { advance: OpenAdvance | undefined; tenders: TenderRow[]; note: string }): { input: AdvanceReturnInput; errors: string[] } {
  const [one] = v.tenders;
  const open = v.advance?.openCents ?? 0;
  const rows = v.tenders.length === 1 && one!.cashPlaceId && !one!.amount.trim() && open > 0 ? [{ ...one!, amount: formatPesos(open) }] : v.tenders;
  const back = tendersToInput(rows, 'pick where the money went');
  const input = { advanceId: v.advance?.id ?? '', tenders: back.tenders, ...(v.note.trim() ? { note: v.note.trim() } : {}) };
  return { input, errors: [...(v.advance ? [] : ['Pick the advance the supplier gave back.']), ...back.errors] };
}
