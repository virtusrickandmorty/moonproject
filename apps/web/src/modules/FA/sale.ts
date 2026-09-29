/**
 * The "Sold" disposal's rules (PLAN D5 FA-DISP with INV-REC): the booklet invoice number, what the buyer paid (VAT
 * included), where the money went, and the buyer (a customer picked, or a name, address and TIN typed). Pure, so they
 * are tested without a browser; the server works out the VAT, book value and gain or loss, and checks everything again.
 */
import { formatPeso } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

export interface SaleValues {
  invoiceNumber: string; amount: string; cashPlaceId: string;
  customer: { id: string; name: string } | null; buyerName: string; buyerAddress: string; buyerTin: string;
}
export const emptySale = (): SaleValues => ({ invoiceNumber: '', amount: '', cashPlaceId: '', customer: null, buyerName: '', buyerAddress: '', buyerTin: '' });

const TIN = /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/;

/** The dialog's values -> a sale's input, with plain errors. A picked customer's name and TIN come from the customer record. */
export function saleInput(assetId: string, reason: string, v: SaleValues): { input: Record<string, unknown>; errors: string[] } {
  const amount = cents(v.amount);
  const [name, address, tin] = [v.buyerName.trim(), v.buyerAddress.trim(), v.buyerTin.trim()];
  const errors = [
    ...(reason.trim().length >= 5 ? [] : ['Say why it is being taken off the books (at least 5 characters).']),
    ...(/^0*[1-9]\d{0,11}$/.test(v.invoiceNumber.trim()) ? [] : ['Type the invoice number from the booklet (digits only).']),
    ...(amount !== undefined && amount >= 100 ? [] : ['Type what the buyer paid, VAT included, like 33,600.00']),
    ...(v.cashPlaceId ? [] : ['Pick where the buyer’s money went.']),
    ...(v.customer || name ? [] : ['Pick the customer who bought it, or type the buyer’s name.']),
    ...(!v.customer && tin && !TIN.test(tin) ? ['Type the buyer’s TIN like 123-456-789-000, or leave it empty.'] : []),
  ];
  const buyer = v.customer ? { customerId: v.customer.id } : { ...(name ? { buyerName: name } : {}), ...(tin ? { buyerTin: tin } : {}) };
  const input = {
    assetId, kind: 'sale', reason: reason.trim(), invoiceNumber: v.invoiceNumber.trim(), amountCents: amount ?? 0,
    ...(v.cashPlaceId ? { cashPlaceId: Number(v.cashPlaceId) } : {}), ...buyer, ...(address ? { buyerAddress: address } : {}),
  };
  return { input, errors };
}

/** What the server worked out for a disposal (fa.disposal's doc in the preview). */
export interface DisposalDoc {
  costCents: number; accumulatedCents: number; bookValueCents: number; proceedsCents: number; gainCents: number; lossCents: number;
  sale: { grossCents: number; vatCents: number; vatableSalesCents: number; buyerName: string } | null;
}

/** "Write these on the booklet" (D4.4) for a sale: VATable sales, VAT, total. */
export const saleBooklet = (d: DisposalDoc): [string, number, string?][] =>
  d.sale ? [['VATable sales', d.sale.vatableSalesCents], ['VAT', d.sale.vatCents], ['Total', d.sale.grossCents, 'font-semibold']] : [];

/** Book value and the gain or loss, before saving: NET received less the book value. */
export function gainOrLoss(d: DisposalDoc): { figures: [string, number, string?][]; words: string } {
  const result: [string, number, string?] = d.gainCents > 0 ? ['Gain on the sale', d.gainCents, 'font-semibold text-emerald-700'] : ['Loss on the sale', d.lossCents, 'font-semibold'];
  const words = d.gainCents > 0 ? `Sold for ${formatPeso(d.gainCents)} more than its book value.` : d.lossCents > 0 ? `Sold for ${formatPeso(d.lossCents)} less than its book value.` : 'Sold at its book value: no gain or loss.';
  return {
    figures: [['Cost', d.costCents], ['Accumulated depreciation', d.accumulatedCents], ['Book value', d.bookValueCents, 'font-semibold'], ['Received, VAT excluded', d.proceedsCents], result],
    words,
  };
}
