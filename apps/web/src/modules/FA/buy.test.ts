/** The fixed-asset purchase form's rules: typed values to input, and what of the invoice total is still unaccounted for. */
import { describe, expect, it } from 'vitest';
import { buyInput, buyValues, emptyBuy, unassigned, type BuyValues } from './buy.ts';

const machine: BuyValues = {
  ...emptyBuy(), classCode: 'machinery', description: ' Industrial sewing machine ', location: 'Sewing room', supplierId: 'sup-1', invoiceNo: 'SI-0042', invoiceDate: '2026-09-20',
  amount: '112,000', residual: '10,000', cashPlaceId: '6', paid: '12,000', onAccount: '40,000', financed: '60,000', lender: 'Sample Leasing Corp.',
};

describe('fixed-asset purchase form', () => {
  it('counts what of the invoice total is not yet paid now, on account or financed', () => {
    expect(unassigned(machine)).toBe(0);
    expect(unassigned({ ...machine, financed: '' })).toBe(6_000_000);
    expect(unassigned({ amount: '100', paid: '150', onAccount: '', financed: '' })).toBe(-5_000);
  });

  it('turns the values into input: the cash place only with money paid now, the lender only with an amount financed', () => {
    expect(buyInput(machine)).toEqual({
      input: {
        classCode: 'machinery', description: 'Industrial sewing machine', location: 'Sewing room', supplierId: 'sup-1', supplierInvoiceNo: 'SI-0042', supplierInvoiceDate: '2026-09-20',
        amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: 6, paidCents: 1_200_000, onAccountCents: 4_000_000, financedCents: 6_000_000, lender: 'Sample Leasing Corp.',
      },
      errors: [],
    });
    const onAccount = { ...machine, invoiceNo: '', invoiceDate: '', location: '', residual: '', life: '36', paid: '', onAccount: '112,000', financed: '' };
    expect(buyInput(onAccount)).toEqual({
      input: { classCode: 'machinery', description: 'Industrial sewing machine', supplierId: 'sup-1', amountCents: 11_200_000, residualCents: 0, lifeMonths: 36, onAccountCents: 11_200_000 },
      errors: [],
    });
  });

  it('names every typing slip', () => {
    expect(buyInput({ ...emptyBuy(), description: 'PC', invoiceDate: '20/09/2026', residual: '-1', life: '0', paid: 'x' }).errors).toEqual([
      'Pick the kind of asset.',
      'Describe the asset (3 letters or more).',
      'Pick the supplier.',
      'Type the invoice date like 2026-09-15, or leave it empty.',
      'Type the invoice total (VAT included) like 85,000.00',
      'Type the residual value like 5,000.00, or leave it blank for none.',
      'Type the useful life in months (1 to 600), or leave it empty for the usual life.',
      'Type how it was paid like 25,000.00',
    ]);
    expect(buyInput({ ...machine, cashPlaceId: '', lender: ' ', financed: '50,000' }).errors).toEqual([
      'Pick where the money paid now came from.', 'Type who financed it.', '₱10,000.00 of the invoice total is not yet paid now, on account or financed.',
    ]);
    expect(buyInput({ ...machine, paid: '22,000' }).errors).toEqual(['Paid now, on account and financed are ₱10,000.00 more than the invoice total.']);
  });

  it('prefills an edit from the stored input', () => {
    const stored = buyInput(machine).input as Parameters<typeof buyValues>[0];
    expect(buyInput(buyValues({ ...stored, lifeMonths: 60 })).input).toEqual({ ...stored, lifeMonths: 60 });
  });
});
