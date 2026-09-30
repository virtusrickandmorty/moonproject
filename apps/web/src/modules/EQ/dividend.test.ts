/** The dividend payment screen's rules (DIVP-, PLAN D5 DIV). */
import { describe, expect, it } from 'vitest';
import { FORMS } from '../screens.ts';
import { DividendPaymentForm } from './forms.tsx';
import { dividendPaymentInput, emptyEq, eqValues } from './eq.ts';

describe('dividend payment screen rules', () => {
  it('is the form of eq.dividend_payment; typed values become the input and back', () => {
    expect(FORMS['eq.dividend_payment']).toBe(DividendPaymentForm);
    const typed = { ...emptyEq('dividend'), personId: 'p1', cashPlaceId: '7', amount: '112,500.00', note: ' Check 000123 ' };
    const { input, errors } = dividendPaymentInput(typed);
    expect(errors).toEqual([]);
    expect(input).toEqual({ personId: 'p1', cashPlaceId: 7, amountCents: 11_250_000, note: 'Check 000123' });
    expect(eqValues(input)).toMatchObject({ personId: 'p1', cashPlaceId: '7', amount: '112,500.00', note: 'Check 000123' });
    expect(dividendPaymentInput(emptyEq('dividend')).errors).toEqual(['Pick the stockholder.', 'Pick where the money came from.', 'Type the amount, like 5,000.00']);
  });
});
