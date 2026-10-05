/** The opening cash advance screen's rules (OBCA-, PLAN D8 step 3). */
import { describe, expect, it } from 'vitest';
import { FORMS } from '../screens.ts';
import { OpeningForm } from './OpeningForm.tsx';
import { emptyOpening, openingInput, openingValues } from './opening.ts';

const typed = { employeeId: 'e1', owed: '2,000.00', installment: '1,000.00', note: ' Old CA-0098, CA-0102 from the prior book ' };

describe('opening cash advance screen rules', () => {
  it('is the form of ca.opening', () => {
    expect(FORMS['ca.opening']).toBe(OpeningForm);
  });

  it('typed fields -> input, the typing slips, and back for an edit', () => {
    const { input, errors } = openingInput(typed);
    expect(errors).toEqual([]);
    expect(input).toEqual({ employeeId: 'e1', owedCents: 200_000, installmentCents: 100_000, note: 'Old CA-0098, CA-0102 from the prior book' });
    expect(openingValues(input as never)).toEqual({ ...typed, note: 'Old CA-0098, CA-0102 from the prior book' });
    expect(openingInput(emptyOpening()).errors).toEqual([
      'Pick the employee.', 'Type what is still owed, like 2,000.00', 'Type the deduction per payroll, like 500.00', 'Type the old cash advance numbers this replaces.',
    ]);
    expect(openingInput({ ...typed, installment: '2,000.01' }).errors).toEqual(['The deduction per payroll cannot be more than what is owed.']);
  });
});
