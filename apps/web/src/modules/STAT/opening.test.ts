/** The opening statutory payable screen's rules (OBST-, PLAN D8 step 3), and that it is stat.opening's form. */
import { describe, expect, it } from 'vitest';
import { FORMS } from '../screens.ts';
import { OpeningStatForm } from './OpeningStatForm.tsx';
import { emptyRow, openingStatInput, openingStatValues, type OpeningStatRow } from './opening.ts';

const employees = [{ id: 'ana', name: 'Ana Araw' }, { id: 'ben', name: 'Ben Halo' }, { id: 'cy', name: 'Cy Buwan' }];

describe('opening statutory payable screen rules', () => {
  it('is the form of stat.opening', () => {
    expect(FORMS['stat.opening']).toBe(OpeningStatForm);
  });

  it('typed rows -> input, blank rows and blank amounts left out, and back for an edit', () => {
    const rows: Record<string, OpeningStatRow> = {
      ana: { ...emptyRow(), sss: '2,110.00', phic: '717.30', hdmf: '400' },
      ben: { ...emptyRow(), sss: '2,280.00', sssLoan: '500' },
    };
    const { input, errors, totalCents } = openingStatInput('2026-08', rows, employees);
    expect(errors).toEqual([]);
    expect(input).toEqual({
      month: '2026-08',
      employees: [
        { employeeId: 'ana', sssCents: 211_000, phicCents: 71_730, hdmfCents: 40_000 },
        { employeeId: 'ben', sssCents: 228_000, sssLoanCents: 50_000 },
      ],
    });
    expect(totalCents).toBe(211_000 + 71_730 + 40_000 + 228_000 + 50_000);
    expect(openingStatValues(input)).toEqual({
      ana: { ...emptyRow(), sss: '2,110.00', phic: '717.30', hdmf: '400.00' },
      ben: { ...emptyRow(), sss: '2,280.00', sssLoan: '500.00' },
    });
  });

  it('a bad month, a bad amount, and nothing typed at all', () => {
    expect(openingStatInput('2026-13', {}, employees).errors).toEqual(['Pick the contribution month, like 2026-08.']);
    expect(openingStatInput('2026-08', {}, employees).errors).toEqual(['Type at least one amount still to remit.']);
    expect(openingStatInput('2026-08', { ana: { ...emptyRow(), sss: '1.234' } }, employees).errors).toEqual(['Ana Araw: type an amount like 1,250.00, or leave it blank.']);
    expect(openingStatInput('2026-08', { ana: emptyRow() }, employees).errors).toEqual(['Type at least one amount still to remit.']);
  });
});
