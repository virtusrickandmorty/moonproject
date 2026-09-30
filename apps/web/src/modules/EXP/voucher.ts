/** Expense voucher as typed -> server input (PLAN E9 EXP-), and back for an edit. Pure, so it is tested without a browser. */
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import { cents, emptyTender, tendersToInput, tendersToRows, type TenderInput, type TenderRow } from '../COL/money.ts';

/** A voucher is paid from one to four cash places (server: MAX_TENDERS). */
export const MAX_TENDERS = 4;

/** `payee`: a supplier on file, or someone else typed in (a one-off payee, with their VAT status and TIN for the receipt). */
export interface VoucherValues {
  categoryId: string; description: string; payee: 'supplier' | 'other'; supplierId: string; payeeName: string; payeeVatRegistered: boolean; payeeTin: string;
  amount: string; receiptNo: string; receiptDate: string; ewtClass: string; tenders: TenderRow[];
}
export interface VoucherInput {
  categoryId: number; tenders: TenderInput[]; amountCents: number; description: string; supplierId?: string; payeeName?: string; payeeVatRegistered?: boolean; payeeTin?: string;
  supplierInvoiceNo?: string; supplierInvoiceDate?: string; ewtClass?: string;
}

export const emptyVoucher = (): VoucherValues => ({
  categoryId: '', description: '', payee: 'other', supplierId: '', payeeName: '', payeeVatRegistered: false, payeeTin: '', amount: '', receiptNo: '', receiptDate: '', ewtClass: '', tenders: [emptyTender()],
});

const TIN = /^\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?$/;

/**
 * The server re-checks everything; this only catches typing slips. The receipt fields are needed only to claim input VAT.
 * `cashCents` is what the server last said leaves the cash places (the receipt less the EWT it worked out), so one
 * tender typed without an amount pays that (the receipt itself until the server has answered).
 */
export function voucherInput(v: VoucherValues, cashCents?: number): { input: VoucherInput; errors: string[] } {
  const amount = cents(v.amount);
  const [one] = v.tenders;
  const out = cashCents ?? amount ?? 0;
  const rows = v.tenders.length === 1 && one!.cashPlaceId && !one!.amount.trim() && out > 0 ? [{ ...one!, amount: formatPesos(out) }] : v.tenders;
  const pay = tendersToInput(rows, 'pick where the money came from');
  const tin = v.payeeTin.trim();
  const errors = [
    ...(v.categoryId ? [] : ['Pick what the money was spent on.']),
    ...(v.description.trim().length >= 3 ? [] : ['Say what it was for.']),
    ...(v.payee === 'supplier' ? (v.supplierId ? [] : ['Pick the supplier.']) : v.payeeName.trim().length >= 2 ? [] : ['Type who was paid.']),
    ...(v.payee === 'other' && tin && !TIN.test(tin) ? ['Type the TIN like 123-456-789-000.'] : []),
    ...(amount === undefined || amount <= 0 ? ['Type the amount on the receipt, like 1,250.00'] : []),
    ...(v.receiptDate && !isBusinessDate(v.receiptDate) ? ['Pick the date on the receipt.'] : []),
    ...pay.errors,
  ];
  const payee = v.payee === 'supplier' ? { supplierId: v.supplierId } : { payeeName: v.payeeName.trim(), payeeVatRegistered: v.payeeVatRegistered, ...(tin ? { payeeTin: tin } : {}) };
  const input = {
    categoryId: Number(v.categoryId), tenders: pay.tenders, amountCents: amount ?? 0, description: v.description.trim(), ...payee,
    ...(v.receiptNo.trim() ? { supplierInvoiceNo: v.receiptNo.trim() } : {}),
    ...(v.receiptDate ? { supplierInvoiceDate: v.receiptDate } : {}),
    ...(v.ewtClass ? { ewtClass: v.ewtClass } : {}),
  };
  return { input, errors };
}

export const voucherValues = (i: VoucherInput): VoucherValues => ({
  categoryId: String(i.categoryId), description: i.description, payee: i.supplierId ? 'supplier' : 'other', supplierId: i.supplierId ?? '', payeeName: i.payeeName ?? '',
  payeeVatRegistered: i.payeeVatRegistered === true, payeeTin: i.payeeTin ?? '', amount: formatPesos(i.amountCents), receiptNo: i.supplierInvoiceNo ?? '',
  receiptDate: i.supplierInvoiceDate ?? '', ewtClass: i.ewtClass ?? '', tenders: tendersToRows(i.tenders),
});
