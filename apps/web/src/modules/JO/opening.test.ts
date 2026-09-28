import { describe, expect, it } from 'vitest';
import { FORMS, VIEWS } from '../screens.ts';
import { emptyOpening, emptyOpeningLine, openingInput, openingValues, type OpeningValues } from './opening.ts';

const typed = (over: Partial<OpeningValues> = {}): OpeningValues => ({
  ...emptyOpening(),
  customerId: 'c-school',
  oldNumber: ' JO 1203 ',
  dueDate: '2026-10-05',
  paymentTerms: 'dp50',
  lines: [{ ...emptyOpeningLine(), description: 'Team jersey set', qty: '10', price: '1,500.00' }, emptyOpeningLine()],
  deposits: '5,000.00',
  receivable: '8,000.00',
  oldInvoices: '0520',
  ...over,
});

describe('opening job order form (PLAN D8 step 2)', () => {
  it('turns what was typed into the input; blank rows and fields are left out', () => {
    const { input, linesCents, errors } = openingInput(typed());
    expect(errors).toEqual([]);
    expect(input).toEqual({
      customerId: 'c-school',
      oldNumber: 'JO 1203',
      dueDate: '2026-10-05',
      priority: 'normal',
      paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 10, unitPriceCents: 150_000, discountCents: 0, roster: [] }],
      depositsCents: 500_000,
      receivableCents: 800_000,
      oldInvoices: '0520',
    });
    expect(linesCents).toBe(1_500_000);
    expect(openingInput(openingValues(input)).input).toEqual(input); // an edit starts from what was recorded
  });

  it('allows nothing left to release when something is still unpaid, and says what is missing', () => {
    expect(openingInput(typed({ lines: [emptyOpeningLine()], deposits: '' })).errors).toEqual([]);
    expect(openingInput(typed({ lines: [emptyOpeningLine()], receivable: '', oldInvoices: '' })).errors).toEqual([
      'Add the lines still to make or release, or the amount invoiced and not yet paid.',
    ]);
    expect(openingInput(typed({ oldInvoices: ' ' })).errors).toEqual(['Type the old invoice numbers of the amount not yet paid.']);
    expect(openingInput({ ...emptyOpening(), receivable: 'abc' }).errors).toEqual([
      'Pick the customer.',
      'Type the job order number in the old records.',
      'Pick the due date.',
      'Pick the payment terms.',
      'Invoiced and not yet paid: type an amount like 15,000.00',
      'Add the lines still to make or release, or the amount invoiced and not yet paid.',
    ]);
    expect(openingInput(typed({ lines: [{ ...emptyOpeningLine(), description: '', qty: '0', price: 'x' }] })).errors).toEqual([
      'Line 1: say what is still to make or release.',
      'Line 1: the quantity must be a whole number like 1 or 20.',
      'Line 1: type amounts like 280.00',
    ]);
  });

  it('keeps a roster read back for an edit', () => {
    const roster = [{ name: 'One-off Wearer', sizeMode: 'preset', size: 'M', qty: 1 }];
    const back = openingValues({ ...openingInput(typed()).input, lines: [{ kind: 'service', description: 'Hemming', qty: 1, unitPriceCents: 5_000, discountCents: 1_000, roster }] });
    expect(back.lines).toEqual([{ kind: 'service', description: 'Hemming', qty: '1', price: '50.00', discount: '10.00', roster }]);
    expect(openingInput(back).input.lines).toEqual([{ kind: 'service', description: 'Hemming', qty: 1, unitPriceCents: 5_000, discountCents: 1_000, roster }]);
  });

  it('is the form and view of jo.opening', () => {
    expect(FORMS['jo.opening']).toBeDefined();
    expect(VIEWS['jo.opening']?.extra).toBeDefined();
  });
});
