/** The journal voucher form's rules: accounts offered, typed lines to input, the running difference and the entry date. */
import { describe, expect, it } from 'vitest';
import type { Account } from '../../api.ts';
import { balanceWords, emptyRow, entryDate, jvInput, postable, rowsFromInput, totals, type JvRow } from './jv.ts';

const acct = (id: number, code: string, name: string, more: Partial<Account> = {}): Account => ({
  id, code, name, type: 'asset', partyType: null, isHeader: false, isCashPlace: false, isReserved: false, isActive: true, ...more,
});
const ACCOUNTS = [
  acct(1, '1000', 'Assets', { isHeader: true }),
  acct(10, '1201', 'Accounts receivable – trade', { partyType: 'customer' }),
  acct(20, '4101', 'Sales – made-to-order garments', { type: 'revenue', partyType: 'customer' }),
  acct(30, '1290', 'Other receivables', { partyType: 'free' }),
  acct(40, '6230', 'Bank charges', { type: 'expense' }),
  acct(50, '1190', 'Cash in transit', { isReserved: true }),
  acct(60, '6999', 'Old expense', { type: 'expense', isActive: false }),
];
const row = (patch: Partial<JvRow>): JvRow => ({ ...emptyRow(), ...patch });

describe('journal voucher form', () => {
  it('offers active accounts that are not headings, reserved ones included (the accountant enables them)', () => {
    expect(postable(ACCOUNTS).map((a) => a.code)).toEqual(['1201', '4101', '1290', '6230', '1190']);
  });

  it('keeps a running debits − credits that must be zero', () => {
    const rows = [row({ debit: '1,000.50' }), row({ credit: '1,000' }), row({ credit: 'ten' })];
    expect(totals(rows)).toEqual({ debits: 100_050, credits: 100_000, difference: 50 });
    expect(balanceWords(50)).toBe('Debits are ₱0.50 more than credits');
    expect(balanceWords(-125_000)).toBe('Credits are ₱1,250.00 more than debits');
    expect(balanceWords(0)).toBe('Balanced');
  });

  it('turns typed lines into input: the party only where the account asks, a free party only when typed, blank lines left out', () => {
    const rows = [
      row({ accountId: '10', party: 'cus-1', debit: '11,200' }),
      row({ accountId: '20', party: 'cus-1', credit: '10,000', memo: ' Booklet 0142 ' }),
      row({ accountId: '30', party: '', credit: '700' }),
      row({ accountId: '40', party: 'left from another account', credit: '500' }),
      emptyRow(),
    ];
    expect(jvInput(' Sale recorded late ', rows, ACCOUNTS)).toEqual({
      input: {
        memo: 'Sale recorded late',
        lines: [
          { accountId: 10, party: { type: 'customer', id: 'cus-1' }, debitCents: 1_120_000 },
          { accountId: 20, party: { type: 'customer', id: 'cus-1' }, creditCents: 1_000_000, memo: 'Booklet 0142' },
          { accountId: 30, creditCents: 70_000 },
          { accountId: 40, creditCents: 50_000 },
        ],
      },
      errors: [],
    });
    const free = jvInput('Refundable deposit', [row({ accountId: '30', party: 'Landlord', debit: '5' }), row({ accountId: '40', credit: '5' })], ACCOUNTS, 'Found in the June file');
    expect(free.input).toEqual({ memo: 'Refundable deposit', lateReason: 'Found in the June file', lines: [{ accountId: 30, party: { type: 'free', id: 'Landlord' }, debitCents: 500 }, { accountId: 40, creditCents: 500 }] });
  });

  it('names every typing slip in plain words', () => {
    const rows = [row({ accountId: '10', debit: '100' }), row({ credit: '50' }), row({ accountId: '40', debit: '10', credit: '10' }), row({ accountId: '40', debit: 'lots' })];
    expect(jvInput('JV', rows, ACCOUNTS).errors).toEqual([
      'Say what the entry is for (5 letters or more).',
      'Line 1: pick the customer for Accounts receivable – trade.',
      'Line 2: pick an account.',
      'Line 3: type a debit or a credit, not both and not neither.',
      'Line 4: type the debit like 1,250.00',
      'Debits and credits must be equal. Debits are ₱50.00 more than credits.',
    ]);
    expect(jvInput('Accrual of rent', [row({ accountId: '40', debit: '1' })], ACCOUNTS).errors).toEqual(['Enter at least two lines.', 'Debits and credits must be equal. Debits are ₱1.00 more than credits.']);
  });

  it('prefills an edit from the stored lines', () => {
    const lines = [{ accountId: 10, party: { type: 'customer' as const, id: 'cus-1' }, debitCents: 1_120_000 }, { accountId: 40, creditCents: 1_120_000, memo: 'Moved' }];
    const rows = rowsFromInput(lines);
    expect(rows[0]).toEqual({ accountId: '10', party: 'cus-1', partyName: '', debit: '11,200.00', credit: '', memo: '' });
    expect(jvInput('Reclassify it', rows, ACCOUNTS).input.lines).toEqual(lines);
  });

  it('dates the entry: empty or today sends nothing; an earlier day is late and needs a reason', () => {
    expect(entryDate('', '2026-09-28', '')).toEqual({ late: false });
    expect(entryDate('2026-09-28', '2026-09-28', '')).toEqual({ late: false });
    expect(entryDate('2026-06-15', '2026-09-28', 'Found in the June booklet')).toEqual({ businessDate: '2026-06-15', late: true });
    expect(entryDate('2026-06-15', '2026-09-28', 'late')).toEqual({ businessDate: '2026-06-15', late: true, error: 'Say why the entry is recorded late (10 letters or more).' });
    expect(entryDate('2026-10-01', '2026-09-28', '').error).toBe('The date cannot be after today.');
    expect(entryDate('15/06/2026', '2026-09-28', '').error).toBe('Type the date like 2026-09-15, or leave it empty for today.');
  });
});
