/** The opening officer balance screen's rules (OBOF-, PLAN D8 step 3). */
import { describe, expect, it } from 'vitest';
import { FORMS } from '../screens.ts';
import { OpeningForm } from './OpeningForm.tsx';
import { emptyOpening, openingInput, openingValues } from './opening.ts';

const typed = { personId: 'p1', direction: 'owes_shop' as const, amount: '2,500.00', note: ' Old officer ledger balance from the prior book ' };

describe('opening officer balance screen rules', () => {
  it('is the form of eq.opening', () => {
    expect(FORMS['eq.opening']).toBe(OpeningForm);
  });

  it('typed fields -> input, the typing slips, and back for an edit', () => {
    const { input, errors } = openingInput(typed);
    expect(errors).toEqual([]);
    expect(input).toEqual({ personId: 'p1', direction: 'owes_shop', amountCents: 250_000, note: 'Old officer ledger balance from the prior book' });
    expect(openingValues(input as never)).toEqual({ ...typed, note: 'Old officer ledger balance from the prior book' });
    expect(openingInput(emptyOpening()).errors).toEqual(['Pick the officer from the register.', 'Pick which way the balance goes.', 'Type the amount, like 2,500.00', 'Type a note.']);
  });
});
