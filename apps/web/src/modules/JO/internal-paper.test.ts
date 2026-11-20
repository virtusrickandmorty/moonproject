/** Internal receipts and invoices on the forms (the owner's request, Nov 2026): IN- or PR- and the number. */
import { describe, expect, it } from 'vitest';
import { bookletTyping, internalTyping, paperNumberProblem, switchBooklet } from '@moonproject/shared';
import { emptyRelease, invoiceInput, paperNumberError, releaseInput } from './forms.ts';

describe('a booklet number and its paper', () => {
  it('the internal box keeps its letters and takes digits only', () => {
    expect(internalTyping('invoice', '')).toBe('IN-');
    expect(internalTyping('invoice', 'IN-5')).toBe('IN-5');
    expect(internalTyping('invoice', 'IN5')).toBe('IN-5'); // the dash rubbed out: put back
    expect(internalTyping('invoice', 'I509')).toBe('IN-509'); // a letter rubbed out: put back
    expect(internalTyping('invoice', 'IN-50a9')).toBe('IN-509');
    expect(internalTyping('CR', '0001')).toBe('PR-1'); // leading zeros dropped: PR-0001 and PR-1 are the same paper
    expect(internalTyping('CR', 'IN-12')).toBe('PR-12'); // an invoice's number pasted on a receipt
    expect(internalTyping('CR', '1234567890123')).toBe('PR-123456789012');
    expect(bookletTyping('bir', 'CR', '0125')).toBe('0125');
    expect(bookletTyping(undefined, 'invoice', '0125')).toBe('0125');
    expect(bookletTyping('internal', 'invoice', 'IN-0125')).toBe('IN-125');
  });

  it('picking a booklet keeps the digits, with or without the letters', () => {
    expect(switchBooklet('internal', 'CR', '125')).toBe('PR-125');
    expect(switchBooklet('internal', 'invoice', '')).toBe('IN-');
    expect(switchBooklet('bir', 'CR', 'PR-125')).toBe('125');
    expect(switchBooklet('bir', 'invoice', 'IN-')).toBe('');
  });

  it('BIR numbers stay digits only; internal ones are IN- or PR- and a number', () => {
    expect(paperNumberError('bir', ' 0125 ', 'bir words', 'internal words')).toBeNull();
    expect(paperNumberError(undefined, 'IN-125', 'bir words', 'internal words')).toBe('bir words');
    expect(paperNumberError('internal', 'IN-125', 'bir words', 'internal words')).toBeNull();
    expect(paperNumberError('internal', 'PR-1', 'bir words', 'internal words')).toBeNull();
    expect(paperNumberError('internal', 'IN-', 'bir words', 'internal words')).toBe('internal words');
    expect(paperNumberError('internal', 'A-0125', 'bir words', 'internal words')).toBe('internal words');
    expect(paperNumberProblem('internal', 'IN-125', 'CR')).toContain('like PR-125');
    expect(paperNumberProblem('internal', 'PR-125', 'invoice')).toContain('like IN-125');
    expect(paperNumberProblem('internal', 'IN-125', 'invoice')).toBeNull();
  });

  it('the invoice record sends the internal paper with its number', () => {
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: ' IN-901 ', paper: 'internal', note: '' })).toEqual({ input: { releaseId: 'r1', invoiceNumber: 'IN-901', paper: 'internal' }, errors: [] });
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: 'IN-901', note: '' }).errors).toEqual(['Type the invoice number from the booklet (digits only).']);
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: 'IN-', paper: 'internal', note: '' }).errors).toEqual(['Type the internal invoice number after IN- (digits only).']);
    expect(invoiceInput({ releaseId: 'r1', invoiceNumber: '0901', note: '' }).input).not.toHaveProperty('paper');
  });

  it('the release slip sends its invoice on the internal paper', () => {
    const v = { ...emptyRelease('jo1'), claimedBy: 'Sample Coach', idSeen: 'school_id' as const, qtys: { 1: '1' }, invoiceNumber: 'IN-12', invoicePaper: 'internal' as const };
    const left = [{ lineNo: 1, description: 'Sample shirt', qty: 1, releasedQty: 0, unitPriceCents: 10_000, discountCents: 0 }] as never;
    const r = releaseInput(v, left);
    expect(r.invoice).toEqual({ invoiceNumber: 'IN-12', paper: 'internal' });
    expect(r.errors.filter((e) => e.includes('invoice'))).toEqual([]);
    expect(releaseInput({ ...v, invoicePaper: 'bir' }, left).errors).toContain('Type the invoice number from the booklet (digits only), or tick "Invoice to follow".');
  });
});
