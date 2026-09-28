/** The opening balances screens' rules: OB- lines, their date, 3900 in words, what stops the close, and the "New ..." links. */
import { describe, expect, it } from 'vitest';
import type { DocTypeInfo, OpeningState } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { closeBlockers, cutoverError, emptyOpeningRow, equityLineWords, equityWords, openingDate, openingForms, openingInput, openingRows, openingSides, type OpeningRow } from './opening.ts';

const accounts: OpeningState['accounts'] = [
  { id: 11, code: '1111', name: 'Cash in bank - BDO', isCashPlace: true, needsStockholder: false },
  { id: 31, code: '3101', name: 'Capital stock', isCashPlace: false, needsStockholder: true },
  { id: 33, code: '3301', name: 'Retained earnings', isCashPlace: false, needsStockholder: false },
];
const row = (patch: Partial<OpeningRow>): OpeningRow => ({ ...emptyOpeningRow(), ...patch });
const state = (patch: Partial<OpeningState> = {}): OpeningState => ({
  cutoverDate: '2026-06-30', openingEquityCents: 0, trialBalance: { asOf: '2026-06-30', totalDebitCents: 500_000, totalCreditCents: 500_000, balanced: true },
  documents: [], checks: [{ code: '1201', name: 'Accounts receivable - trade', partyType: 'customer', controlCents: 0, partiesCents: 0, ok: true }], accounts, closed: null, ...patch,
});

describe('OB- form rules', () => {
  it('turns typed lines into input: blank rows left out, one side per line, the stockholder only where the account asks for one', () => {
    const rows = [
      row({ accountId: '11', debit: '250,000.00', memo: ' per bank statement ' }),
      emptyOpeningRow(),
      row({ accountId: '31', stockholderId: 'p1', credit: '100,000' }),
      row({ accountId: '33', stockholderId: 'left over', credit: '50,000.50' }),
    ];
    expect(openingInput(rows, accounts)).toEqual({
      input: { lines: [
        { accountId: 11, debitCents: 25_000_000, memo: 'per bank statement' },
        { accountId: 31, stockholderId: 'p1', creditCents: 10_000_000 },
        { accountId: 33, creditCents: 5_000_050 },
      ] },
      errors: [],
    });
    expect(openingSides(rows)).toEqual({ debits: 25_000_000, credits: 15_000_050 });
    expect(openingRows(openingInput(rows, accounts).input.lines).map((r) => openingInput([r], accounts).input.lines[0])).toEqual(openingInput(rows, accounts).input.lines);
  });

  it('names what is missing, line by line', () => {
    expect(openingInput([emptyOpeningRow()], accounts).errors).toEqual(['Enter at least one line.']);
    expect(openingInput([row({ debit: '5' }), row({ accountId: '31', credit: '10' }), row({ accountId: '33', debit: '1', credit: '1' }), row({ accountId: '11', debit: 'abc' })], accounts).errors).toEqual([
      'Line 1: pick an account.',
      'Line 2: pick the stockholder for Capital stock.',
      'Line 3: type a debit or a credit, not both and not neither.',
      'Line 4: type the debit like 1,250.00',
    ]);
    expect(openingSides([row({ debit: 'abc', credit: '-5' })])).toEqual({ debits: 0, credits: 0 });
  });

  it('dates it the cut-over date: nothing sent on today, the date on an earlier day, refused on a later one or without one', () => {
    expect(openingDate('2026-06-30', '2026-09-28')).toEqual({ businessDate: '2026-06-30' });
    expect(openingDate('2026-09-28', '2026-09-28')).toEqual({});
    expect(openingDate('2026-06-30', '')).toEqual({});
    expect(openingDate('2026-10-31', '2026-09-28').error).toBe('The cut-over date, 2026-10-31, is after today. Opening balances are recorded on it or after it.');
    expect(openingDate(null, '2026-09-28').error).toBe('Set the cut-over date on the Opening balances page first.');
  });

  it('shows the 3900 line of the preview on the side that balances the journal', () => {
    expect(equityLineWords({ equityDebitCents: 0, equityCreditCents: 25_000_000 })).toBe('Credit ₱250,000.00 to opening balance equity (3900)');
    expect(equityLineWords({ equityDebitCents: 15_000_050, equityCreditCents: 0 })).toBe('Debit ₱150,000.50 to opening balance equity (3900)');
    expect(equityLineWords({ equityDebitCents: 0, equityCreditCents: 0 })).toBe('The lines balance by themselves: nothing goes to opening balance equity (3900).');
  });
});

describe('opening page rules', () => {
  it('says 3900 in words and checks the typed cut-over date', () => {
    expect([0, -12_345, 100].map(equityWords)).toEqual(['Zero', 'Credit balance of ₱123.45', 'Debit balance of ₱1.00']);
    expect(cutoverError('', null)).toBe('Pick the cut-over date.');
    expect(cutoverError('2026-02-30', null)).toBe('Pick the cut-over date.');
    expect(cutoverError('2026-06-30', '2026-06-30')).toBe('The cut-over date is already 2026-06-30.');
    expect(cutoverError('2026-06-30', null)).toBeNull();
    expect(cutoverError('2026-05-31', '2026-06-30')).toBeNull();
  });

  it('lets the close go only when 3900 is zero, the trial balance balances and every check is tied', () => {
    expect(closeBlockers(state())).toEqual([]);
    expect(closeBlockers(state({ cutoverDate: null, trialBalance: null }))).toEqual(['Set the cut-over date first.']);
    expect(closeBlockers(state({ closed: { cutoverDate: '2026-06-30', closedAt: '2026-07-05T10:00:00+08:00', closedBy: 'u1', closedByName: 'Ana', totalDebitCents: 1, totalCreditCents: 1 } })))
      .toEqual(['The opening is closed.']);
    expect(closeBlockers(state({
      openingEquityCents: -40_000_000,
      trialBalance: { asOf: '2026-06-30', totalDebitCents: 500_000, totalCreditCents: 400_000, balanced: false },
      checks: [
        { code: '1201', name: 'Accounts receivable - trade', partyType: 'customer', controlCents: 10_000, partiesCents: 0, ok: false },
        { code: '2101', name: 'Accounts payable', partyType: 'supplier', controlCents: -5, partiesCents: -5, ok: true },
        { code: '2201', name: 'Customer deposits', partyType: 'customer', controlCents: -1, partiesCents: 0, ok: false },
      ],
    }))).toEqual([
      'Opening balance equity (3900) is not zero: credit balance of ₱400,000.00. Record the equity breakdown until it is zero.',
      'The trial balance on 2026-06-30 does not balance.',
      'The balance by customer, supplier or person does not add up to the account total for 1201 Accounts receivable - trade, 2201 Customer deposits.',
    ]);
  });

  it('offers "New ..." for each opening type with its own form that the user may create, and the page in Admin', () => {
    const dt = (key: string, title: string, canCreate = true) => ({ key, title, canCreate }) as DocTypeInfo;
    const types = [dt('acc.opening', 'Opening Balances'), dt('ap.opening', 'Opening Supplier Bill'), dt('loan.opening', 'Opening Loan', false), dt('acc.jv', 'Journal Voucher')];
    expect(openingForms(types, ['acc.opening', 'acc.jv', 'loan.opening'])).toEqual([{ key: 'acc.opening', label: 'New Opening Balances', path: '/docs/acc.opening/new' }]);
    expect(openingForms(types, ['acc.opening', 'ap.opening']).map((l) => l.label)).toEqual(['New Opening Balances', 'New Opening Supplier Bill']);
    const admin = (perms: string[]) => buildMenu([], new Set(perms)).find((g) => g.group === 'Admin')?.items.map((i) => i.label);
    expect(admin(['acc.opening.view'])).toContain('Opening balances');
    expect(admin([])).not.toContain('Opening balances');
  });
});
