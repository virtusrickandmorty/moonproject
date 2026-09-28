import { describe, expect, it } from 'vitest';
import { fieldsOf, humanize, toInput, toValues } from './fields.ts';

const int = { type: 'integer' };
// The shape GET /api/doc-types returns for cash.transfer.
const fields = fieldsOf({
  properties: { fromCashPlaceId: int, toCashPlaceId: int, amountSentCents: int, amountReceivedCents: int, note: { type: 'string', maxLength: 500 } },
  required: ['fromCashPlaceId', 'toCashPlaceId', 'amountSentCents', 'amountReceivedCents'],
});

describe('generic form fields', () => {
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
