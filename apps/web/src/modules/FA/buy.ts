/**
 * The fixed-asset purchase form's rules (PLAN D5 FA-BUY, E10): typed values to input, and how much of the invoice total
 * is still not paid now, on account or financed. Pure, so they are tested without a browser; the server works out the
 * cost and input VAT and checks everything again.
 */
import { formatPeso, formatPesos, isBusinessDate } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

export interface BuyValues {
  classCode: string; description: string; location: string; supplierId: string; invoiceNo: string; invoiceDate: string;
  amount: string; residual: string; life: string; cashPlaceId: string; paid: string; onAccount: string; financed: string; lender: string;
}
export const emptyBuy = (): BuyValues => ({
  classCode: '', description: '', location: '', supplierId: '', invoiceNo: '', invoiceDate: '', amount: '', residual: '', life: '', cashPlaceId: '', paid: '', onAccount: '', financed: '', lender: '',
});

/** The invoice total less what is paid now, on account and financed: zero when every peso is accounted for. */
export const unassigned = (v: Pick<BuyValues, 'amount' | 'paid' | 'onAccount' | 'financed'>) =>
  (cents(v.amount) ?? 0) - (cents(v.paid) ?? 0) - (cents(v.onAccount) ?? 0) - (cents(v.financed) ?? 0);

/** The form's values -> purchase input, with plain errors. The cash place goes only with an amount paid now, the lender only with an amount financed. */
export function buyInput(v: BuyValues): { input: Record<string, unknown>; errors: string[] } {
  const [amount, residual, paid, onAccount, financed] = [v.amount, v.residual, v.paid, v.onAccount, v.financed].map(cents);
  const life = v.life.trim();
  const left = unassigned(v);
  const errors = [
    ...(v.classCode ? [] : ['Pick the kind of asset.']),
    ...(v.description.trim().length >= 3 ? [] : ['Describe the asset (3 letters or more).']),
    ...(v.supplierId ? [] : ['Pick the supplier.']),
    ...(v.invoiceDate && !isBusinessDate(v.invoiceDate) ? ['Type the invoice date like 2026-09-15, or leave it empty.'] : []),
    ...(amount && amount > 0 ? [] : ['Type the invoice total (VAT included) like 85,000.00']),
    ...(residual === undefined || residual < 0 ? ['Type the residual value like 5,000.00, or leave it blank for none.'] : []),
    ...(!life || (/^\d+$/.test(life) && Number(life) >= 1 && Number(life) <= 600) ? [] : ['Type the useful life in months (1 to 600), or leave it empty for the usual life.']),
    ...([paid, onAccount, financed].some((x) => x === undefined || x < 0) ? ['Type how it was paid like 25,000.00'] : []),
    ...(paid && !v.cashPlaceId ? ['Pick where the money paid now came from.'] : []),
    ...(financed && v.lender.trim().length < 2 ? ['Type who financed it.'] : []),
    ...(amount && left !== 0 ? [left > 0 ? `${formatPeso(left)} of the invoice total is not yet paid now, on account or financed.` : `Paid now, on account and financed are ${formatPeso(-left)} more than the invoice total.`] : []),
  ];
  const input = {
    classCode: v.classCode, description: v.description.trim(), ...(v.location.trim() ? { location: v.location.trim() } : {}), supplierId: v.supplierId,
    ...(v.invoiceNo.trim() ? { supplierInvoiceNo: v.invoiceNo.trim() } : {}), ...(v.invoiceDate ? { supplierInvoiceDate: v.invoiceDate } : {}),
    amountCents: amount ?? 0, residualCents: residual ?? 0, ...(life ? { lifeMonths: Number(life) } : {}),
    ...(paid ? { cashPlaceId: Number(v.cashPlaceId), paidCents: paid } : {}), ...(onAccount ? { onAccountCents: onAccount } : {}),
    ...(financed ? { financedCents: financed, lender: v.lender.trim() } : {}),
  };
  return { input, errors };
}

type Stored = {
  classCode: string; description: string; location?: string; supplierId: string; supplierInvoiceNo?: string; supplierInvoiceDate?: string; amountCents: number; residualCents: number;
  lifeMonths?: number; cashPlaceId?: number; paidCents?: number; onAccountCents?: number; financedCents?: number; lender?: string;
};
const money = (c?: number) => (c ? formatPesos(c) : '');
/** Stored input -> the form's values, to prefill an edit. */
export const buyValues = (s: Stored): BuyValues => ({
  classCode: s.classCode, description: s.description, location: s.location ?? '', supplierId: s.supplierId, invoiceNo: s.supplierInvoiceNo ?? '', invoiceDate: s.supplierInvoiceDate ?? '',
  amount: money(s.amountCents), residual: money(s.residualCents), life: s.lifeMonths ? String(s.lifeMonths) : '', cashPlaceId: s.cashPlaceId ? String(s.cashPlaceId) : '',
  paid: money(s.paidCents), onAccount: money(s.onAccountCents), financed: money(s.financedCents), lender: s.lender ?? '',
});
