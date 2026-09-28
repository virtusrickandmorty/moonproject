/** Expense voucher as typed -> server input (PLAN E9 EXP-), and back for an edit. Pure, so it is tested without a browser. */
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

/** `payee`: a supplier on file, or someone else typed in (a one-off payee, with their VAT status and TIN for the receipt). */
export interface VoucherValues {
  categoryId: string; description: string; payee: 'supplier' | 'other'; supplierId: string; payeeName: string; payeeVatRegistered: boolean; payeeTin: string;
  amount: string; receiptNo: string; receiptDate: string; ewtClass: string; cashPlaceId: string;
}
export interface VoucherInput {
  categoryId: number; cashPlaceId: number; amountCents: number; description: string; supplierId?: string; payeeName?: string; payeeVatRegistered?: boolean; payeeTin?: string;
  supplierInvoiceNo?: string; supplierInvoiceDate?: string; ewtClass?: string;
}

export const emptyVoucher = (): VoucherValues => ({
  categoryId: '', description: '', payee: 'other', supplierId: '', payeeName: '', payeeVatRegistered: false, payeeTin: '', amount: '', receiptNo: '', receiptDate: '', ewtClass: '', cashPlaceId: '',
});

const TIN = /^\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?$/;

/** The server re-checks everything; this only catches typing slips. The receipt fields are needed only to claim input VAT. */
export function voucherInput(v: VoucherValues): { input: VoucherInput; errors: string[] } {
  const amount = cents(v.amount);
  const tin = v.payeeTin.trim();
  const errors = [
    ...(v.categoryId ? [] : ['Pick what the money was spent on.']),
    ...(v.description.trim().length >= 3 ? [] : ['Say what it was for.']),
    ...(v.payee === 'supplier' ? (v.supplierId ? [] : ['Pick the supplier.']) : v.payeeName.trim().length >= 2 ? [] : ['Type who was paid.']),
    ...(v.payee === 'other' && tin && !TIN.test(tin) ? ['Type the TIN like 123-456-789-000.'] : []),
    ...(amount === undefined || amount <= 0 ? ['Type the amount on the receipt, like 1,250.00'] : []),
    ...(v.receiptDate && !isBusinessDate(v.receiptDate) ? ['Pick the date on the receipt.'] : []),
    ...(v.cashPlaceId ? [] : ['Pick where the money came from.']),
  ];
  const payee = v.payee === 'supplier' ? { supplierId: v.supplierId } : { payeeName: v.payeeName.trim(), payeeVatRegistered: v.payeeVatRegistered, ...(tin ? { payeeTin: tin } : {}) };
  const input = {
    categoryId: Number(v.categoryId), cashPlaceId: Number(v.cashPlaceId), amountCents: amount ?? 0, description: v.description.trim(), ...payee,
    ...(v.receiptNo.trim() ? { supplierInvoiceNo: v.receiptNo.trim() } : {}),
    ...(v.receiptDate ? { supplierInvoiceDate: v.receiptDate } : {}),
    ...(v.ewtClass ? { ewtClass: v.ewtClass } : {}),
  };
  return { input, errors };
}

export const voucherValues = (i: VoucherInput): VoucherValues => ({
  categoryId: String(i.categoryId), description: i.description, payee: i.supplierId ? 'supplier' : 'other', supplierId: i.supplierId ?? '', payeeName: i.payeeName ?? '',
  payeeVatRegistered: i.payeeVatRegistered === true, payeeTin: i.payeeTin ?? '', amount: formatPesos(i.amountCents), receiptNo: i.supplierInvoiceNo ?? '',
  receiptDate: i.supplierInvoiceDate ?? '', ewtClass: i.ewtClass ?? '', cashPlaceId: String(i.cashPlaceId),
});
