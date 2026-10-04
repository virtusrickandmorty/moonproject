import { describe, expect, it } from 'vitest';
import { choiceLabel, fieldsOf, humanize, toInput, toValues } from './fields.ts';

const int = { type: 'integer' };
// The shape GET /api/doc-types returns for cash.transfer.
const fields = fieldsOf({
  properties: { fromCashPlaceId: int, toCashPlaceId: int, amountSentCents: int, amountReceivedCents: int, note: { type: 'string', maxLength: 500 } },
  required: ['fromCashPlaceId', 'toCashPlaceId', 'amountSentCents', 'amountReceivedCents'],
});

describe('generic form fields', () => {
  it('uses shop labels and readable choices without changing stored names or input values', () => {
    const fields = fieldsOf({ properties: { atc: { type: 'string', title: 'ATC' }, costCentre: { enum: ['production', 'office'] }, eeCents: int, erCents: int, caCents: int, ewtCents: int, paymentTerms: { enum: ['full', 'dp50'] }, priority: { enum: ['normal', 'rush'] } } });
    expect(fields.slice(0, 6).map((f) => [f.name, f.label])).toEqual([
      ['atc', 'Tax code (ATC)'], ['costCentre', 'Pay cost group'], ['eeCents', 'Employee share'], ['erCents', 'Company share'], ['caCents', 'Cash advance'], ['ewtCents', 'Tax withheld from supplier (EWT)'],
    ]);
    expect(choiceLabel('paymentTerms', 'full')).toBe('Full payment');
    expect(choiceLabel('priority', 'normal')).toBe('Normal');
    expect(choiceLabel('costCentre', 'office')).toBe('Office and sales');
    expect(choiceLabel('other', 'full')).toBe('full');
    expect(choiceLabel('paymentTerms', 'future_terms')).toBe('future_terms');
    expect(toInput(fields.slice(6), { paymentTerms: 'full', priority: 'normal' })).toEqual({ input: { paymentTerms: 'full', priority: 'normal' }, errors: {} });
    expect(toValues(fields.slice(6), { paymentTerms: 'full', priority: 'normal' })).toEqual({ paymentTerms: 'full', priority: 'normal' });
  });

  it('reads kinds and labels from the schema, asking money questions instead of accounts (PLAN H2)', () => {
    expect(fields.map((f) => `${f.label} | ${f.kind} | ${f.required}`)).toEqual([
      'Where did the money come from? | cashPlace | true',
      'Where did the money go? | cashPlace | true',
      'Amount sent | money | true',
      'Amount received | money | true',
      'Note | longText | false',
    ]);
    expect(humanize('customerGroupId')).toBe('Customer group');
    expect(fieldsOf({ properties: { kind: { enum: ['a', 'b'], title: 'Kind of thing' } } })[0]).toMatchObject({ label: 'Kind of thing', kind: 'choice', options: ['a', 'b'] });
    // A lone cashPlaceId (a loan's proceeds, a loan payment) is a cash place too, not a number to type.
    expect(fieldsOf({ properties: { cashPlaceId: int, instalmentNo: int } }).map((f) => `${f.label} | ${f.kind}`)).toEqual(['Which cash place? | cashPlace', 'Instalment no | integer']);
    // A date (a dividend's record date) is picked from a calendar and sent as typed, YYYY-MM-DD.
    const [d] = fieldsOf({ properties: { recordDate: { type: 'string', format: 'date' } }, required: ['recordDate'] });
    expect(d).toMatchObject({ label: 'Record date', kind: 'date' });
    expect(toInput([d!], { recordDate: '2026-09-30' })).toEqual({ input: { recordDate: '2026-09-30' }, errors: {} });
  });

  it('reads a union of literals as a choice and keeps numbers as numbers (the VAT close quarter)', () => {
    const quarter = { anyOf: [1, 2, 3, 4].map((q) => ({ type: 'number', const: q })) };
    const [f] = fieldsOf({ properties: { quarter }, required: ['quarter'] });
    expect(f).toMatchObject({ label: 'Quarter', kind: 'choice', options: ['1', '2', '3', '4'], numeric: true });
    expect(toInput([f!], { quarter: '2' })).toEqual({ input: { quarter: 2 }, errors: {} });
    expect(toValues([f!], { quarter: 2 })).toEqual({ quarter: '2' });
    expect(fieldsOf({ properties: { mixed: { anyOf: [{ const: 1 }, { type: 'string' }] } } })[0]!.kind).toBe('unsupported');
  });

  it('turns typed pesos into integer centavos, flags typing slips, and prefills an edit', () => {
    const typed = { fromCashPlaceId: '5', toCashPlaceId: '6', amountSentCents: '₱1,234,567.89', amountReceivedCents: '0.05', note: 'Deposit' };
    const input = { fromCashPlaceId: 5, toCashPlaceId: 6, amountSentCents: 123_456_789, amountReceivedCents: 5, note: 'Deposit' };
    expect(toInput(fields, typed)).toEqual({ input, errors: {} });
    expect(toValues(fields, input)).toEqual({ ...typed, amountSentCents: '1,234,567.89' });
    const slips = { fromCashPlaceId: 'Pick one.', toCashPlaceId: 'Pick one.', amountSentCents: 'Type an amount like 1,250.00', amountReceivedCents: 'Type an amount like 1,250.00' };
    expect(toInput(fields, { amountSentCents: '12.345', amountReceivedCents: 'ten', note: ' ' })).toEqual({ input: {}, errors: slips });
  });
});
