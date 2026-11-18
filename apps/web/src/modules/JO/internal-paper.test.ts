/** Internal receipts and invoices on the forms (the owner's request, Nov 2026): letters only on internal booklet numbers. */
import { describe, expect, it } from 'vitest';
import { emptyRelease, invoiceInput, paperNumberError, releaseInput } from './forms.ts';

describe('a booklet number and its paper', () => {
  it('BIR numbers stay digits only; internal ones take letters and say which paper they are', () => {
    expect(paperNumberError('bir', ' 0125 ', 'bir words', 'internal words')).toBeNull();
    expect(paperNumberError(undefined, 'A-0125', 'bir words', 'internal words')).toBe('bir words');
    expect(paperNumberError('internal', 'A-0125', 'bir words', 'internal words')).toBeNull();
    expect(paperNumberError('internal', 'SI 0125', 'bir words', 'internal words')).toBeNull();
    expect(paperNumberError('internal', '-A', 'bir words', 'internal words')).toBe('internal words');
    expect(paperNumberError('internal', 'A'.repeat(21), 'bir words', 'internal words')).toBe('internal words');
  });

  it('the invoice record sends the internal paper with its number', () => {
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: ' A-0901 ', paper: 'internal', note: '' })).toEqual({ input: { releaseId: 'r1', invoiceNumber: 'A-0901', paper: 'internal' }, errors: [] });
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: 'A-0901', note: '' }).errors).toEqual(['Type the invoice number from the booklet (digits only).']);
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: '0901', note: '' }).input).not.toHaveProperty('paper');
  });

  it('the release slip sends its invoice on the internal paper', () => {
    const v = { ...emptyRelease('jo1'), claimedBy: 'Sample Coach', idSeen: 'school_id' as const, qtys: { 1: '1' }, invoiceNumber: 'B-12', invoicePaper: 'internal' as const };
    const left = [{ lineNo: 1, description: 'Sample shirt', qty: 1, releasedQty: 0, unitPriceCents: 10_000, discountCents: 0 }] as never;
    const r = releaseInput(v, left);
    expect(r.invoice).toEqual({ invoiceNumber: 'B-12', paper: 'internal' });
    expect(r.errors.filter((e) => e.includes('invoice'))).toEqual([]);
    expect(releaseInput({ ...v, invoicePaper: 'bir' }, left).errors).toContain('Type the invoice number from the booklet (digits only), or tick "Invoice to follow".');
  });
});
