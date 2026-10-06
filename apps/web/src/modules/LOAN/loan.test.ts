/** The loan screens' rules: the yearly rate as a percent, the loan and loan payment inputs, the fee accounts offered. */
import { describe, expect, it } from 'vitest';
import type { Account } from '../../api.ts';
import { bpToPercent, emptyLoan, emptyOpening, feeAccounts, forgivenessInput, loanInput, loanValues, openingInput, openingValues, paymentInput, percentToBp, scheduledPrincipal, type LoanValues, type OpeningValues } from './loan.ts';

const loan = (patch: Partial<LoanValues>): LoanValues => ({ ...emptyLoan(), ...patch });
const bank = loan({ lender: ' Sample Bank ', reference: 'PN-1', cashPlaceId: '6', principal: '500,000', fee: '5,000', rate: '12', term: '24', firstDueDate: '2026-10-28' });

describe('loan form', () => {
  it('reads the yearly rate as a percent with up to two decimals', () => {
    expect(['12', '10.5', '0', '12.25%', ' 7.5 % ', '100'].map(percentToBp)).toEqual([1200, 1050, 0, 1225, 750, 10_000]);
    expect(['100.01', '12.345', 'twelve', '', '-1', '1,2'].map(percentToBp)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect([1200, 1050, 1225, 0].map(bpToPercent)).toEqual(['12', '10.5', '12.25', '0']);
  });

  it('sends a generated schedule with its first due date, and the proceeds to a cash place', () => {
    expect(loanInput(bank)).toEqual({
      input: {
        lender: 'Sample Bank', kind: 'loan', cashPlaceId: 6, principalCents: 50_000_000, feeCents: 500_000, interestRateBp: 1200, termMonths: 24, schedule: 'declining',
        firstDueDate: '2026-10-28', reference: 'PN-1',
      },
      errors: [],
    });
    expect(loanInput({ ...bank, firstDueDate: '', fee: '', schedule: 'flat' }).input).not.toHaveProperty('firstDueDate');
  });

  it('sends typed rows for the lender’s table, and the financed asset purchase instead of a cash place', () => {
    const typed = loan({
      lender: 'Sample Leasing Corp.', kind: 'equipment', proceeds: 'asset', assetPurchaseId: 'fa-1', cashPlaceId: '6', principal: '60,000', rate: '10.5', term: '3', schedule: 'typed',
      rows: [{ dueDate: '2026-10-20', principal: '30,000', interest: '525' }, { dueDate: '', principal: '', interest: '' }, { dueDate: '2026-11-20', principal: '30,000', interest: '262.50' }],
    });
    expect(scheduledPrincipal(typed.rows)).toBe(6_000_000);
    expect(loanInput(typed)).toEqual({
      input: {
        lender: 'Sample Leasing Corp.', kind: 'equipment', assetPurchaseId: 'fa-1', principalCents: 6_000_000, interestRateBp: 1050, termMonths: 3, schedule: 'typed',
        rows: [{ dueDate: '2026-10-20', principalCents: 3_000_000, interestCents: 52_500 }, { dueDate: '2026-11-20', principalCents: 3_000_000, interestCents: 26_250 }],
      },
      errors: [],
    });
  });

  it('names every typing slip', () => {
    expect(loanInput(loan({ fee: 'some', rate: '12.345', term: '0', firstDueDate: '28/10/2026' })).errors).toEqual([
      'Type the lender’s name.',
      'Pick where the loan money arrived.',
      'Type the loan amount (principal) like 500,000.00',
      'Type the fees deducted like 5,000.00, or leave them blank.',
      'Type the yearly interest rate like 12 or 10.5 (0 if none).',
      'Type the term in months, from 1 to 360.',
      'Type the first due date like 2026-10-28, or leave it empty.',
    ]);
    const rows = [{ dueDate: '', principal: '100', interest: 'x' }];
    expect(loanInput({ ...bank, proceeds: 'asset', schedule: 'typed', rows }).errors).toEqual([
      'Pick the asset purchase the lender paid for.',
      'Instalment 1: pick the due date.',
      'Instalment 1: type the principal and interest like 12,500.00',
      'The instalments repay ₱100.00 of principal, not ₱500,000.00.',
    ]);
    expect(loanInput({ ...bank, schedule: 'typed', rows: [] }).errors).toEqual(['Type the instalments from the lender’s table.']);
  });

  it('prefills an edit from the stored input, generated or typed', () => {
    const generated = { lender: 'Sample Bank', kind: 'loan' as const, cashPlaceId: 6, principalCents: 50_000_000, feeCents: 500_000, feeAccountId: 77, interestRateBp: 1050, termMonths: 24, schedule: 'declining' as const, firstDueDate: '2026-10-28', note: 'Working capital' };
    expect(loanInput(loanValues(generated))).toEqual({ input: generated, errors: [] });
    const typed = { lender: 'Sample Leasing Corp.', kind: 'equipment' as const, assetPurchaseId: 'fa-1', principalCents: 6_000_000, interestRateBp: 0, termMonths: 1, schedule: 'typed' as const, rows: [{ dueDate: '2026-10-20', principalCents: 6_000_000, interestCents: 0 }], reference: 'L-9' };
    expect(loanInput(loanValues(typed))).toEqual({ input: typed, errors: [] });
  });

  it('offers expense or prepaid accounts with no subledger for the fees', () => {
    const a = (id: number, type: Account['type'], more: Partial<Account> = {}): Account => ({ id, code: String(id), name: `A${id}`, type, partyType: null, isHeader: false, isCashPlace: false, isReserved: false, isActive: true, ...more });
    const accounts = [a(1, 'expense'), a(2, 'asset', { partyType: 'free' }), a(3, 'asset', { partyType: 'supplier' }), a(4, 'asset', { isCashPlace: true }), a(5, 'expense', { isHeader: true }), a(6, 'expense', { isActive: false }), a(7, 'liability')];
    expect(feeAccounts(accounts).map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('opening loan form', () => {
  const opening = (patch: Partial<OpeningValues>): OpeningValues => ({ ...emptyOpening(), ...patch });
  const bank = opening({ lender: ' Sample Bank ', reference: 'PN 2025-014', original: '1,000,000', dateReceived: '2025-10-15', owed: '738,900', rate: '12', monthsLeft: '13', nextDueDate: '2026-10-15' });

  it('sends the loan as received, what is still owed, and the next due date of a generated schedule', () => {
    expect(openingInput(bank)).toEqual({
      input: {
        lender: 'Sample Bank', kind: 'loan', originalPrincipalCents: 100_000_000, dateReceived: '2025-10-15', principalCents: 73_890_000, interestRateBp: 1200, monthsLeft: 13,
        schedule: 'declining', nextDueDate: '2026-10-15', reference: 'PN 2025-014',
      },
      errors: [],
    });
  });

  it('sends typed rows that must repay what is still owed; names every typing slip', () => {
    const rows = [{ dueDate: '2026-10-01', principal: '40,000', interest: '1,600' }, { dueDate: '', principal: '', interest: '' }, { dueDate: '2026-11-01', principal: '40,000', interest: '1,200' }];
    const typed = opening({ lender: 'Sample Equipment Finance', kind: 'equipment', original: '240,000', dateReceived: '2026-03-01', owed: '80,000', rate: '12', monthsLeft: '2', schedule: 'typed', rows });
    expect(openingInput(typed).input).toMatchObject({ kind: 'equipment', principalCents: 8_000_000, rows: [{ dueDate: '2026-10-01', principalCents: 4_000_000, interestCents: 160_000 }, { dueDate: '2026-11-01', principalCents: 4_000_000, interestCents: 120_000 }] });
    expect(openingInput(typed).errors).toEqual([]);
    expect(openingInput({ ...typed, owed: '90,000' }).errors).toEqual(['The instalments repay ₱80,000.00 of principal, not the ₱90,000.00 still owed.']);
    expect(openingInput(opening({ original: 'x', owed: '5', rate: '12.345', monthsLeft: '0' })).errors).toEqual([
      'Type the lender’s name.',
      'Type the loan as received (principal) like 1,000,000.00',
      'Pick the date the loan was received.',
      'Type the yearly interest rate like 12 or 10.5 (0 if none).',
      'Type the months left, from 1 to 360.',
      'Pick when the next instalment falls due.',
    ]);
    expect(openingInput({ ...bank, owed: '1,000,000.01' }).errors).toEqual(['The principal still owed cannot be more than the loan as received.']);
  });

  it('prefills an edit from the stored input, generated or typed', () => {
    const generated = openingInput(bank).input as Parameters<typeof openingValues>[0];
    expect(openingInput(openingValues(generated))).toEqual({ input: generated, errors: [] });
    const typed = { lender: 'Sample Equipment Finance', kind: 'equipment' as const, originalPrincipalCents: 24_000_000, dateReceived: '2026-03-01', principalCents: 4_000_000, interestRateBp: 0, monthsLeft: 1, schedule: 'typed' as const, rows: [{ dueDate: '2026-10-01', principalCents: 4_000_000, interestCents: 0 }], note: 'Last instalment' };
    expect(openingInput(openingValues(typed))).toEqual({ input: typed, errors: [] });
  });
});

describe('loan payment form', () => {
  const base = { loanId: 'loan-1', instalmentNo: 3, cashPlaceId: '6', differs: false, principal: '', interest: '', note: '' };
  it('sends the scheduled split unless the lender applied it differently, and then with a note', () => {
    expect(paymentInput({ ...base, note: 'ignored' })).toEqual({ input: { loanId: 'loan-1', instalmentNo: 3, cashPlaceId: 6 }, errors: [] });
    expect(paymentInput({ ...base, differs: true, principal: '18,000', interest: '5,536.74', note: ' Bank applied the penalty first ' })).toEqual({
      input: { loanId: 'loan-1', instalmentNo: 3, cashPlaceId: 6, principalCents: 1_800_000, interestCents: 553_674, note: 'Bank applied the penalty first' },
      errors: [],
    });
    expect(paymentInput({ ...base, loanId: '', instalmentNo: 0, cashPlaceId: '', differs: true, principal: 'x', note: 'ok' }).errors).toEqual([
      'Pick the loan.', 'Pick where the money came from.', 'Type the principal and interest the lender applied, like 12,500.00', 'Say why the split differs from the schedule.',
    ]);
  });
});

describe('loan forgiveness form', () => {
  const base = { loanId: 'loan-1', instalmentNo: 2, reason: '', note: '' };
  it('sends the loan, the instalment, the reason and a note; never an amount', () => {
    expect(forgivenessInput({ ...base, reason: ' Bank waived the rest by letter ', note: ' Filed with the loan papers ' })).toEqual({
      input: { loanId: 'loan-1', instalmentNo: 2, reason: 'Bank waived the rest by letter', note: 'Filed with the loan papers' }, errors: [],
    });
    expect(forgivenessInput({ ...base, reason: 'Bank waived the rest' }).input).toEqual({ loanId: 'loan-1', instalmentNo: 2, reason: 'Bank waived the rest' });
    expect(forgivenessInput({ ...base, loanId: '', instalmentNo: 0, reason: 'Waived' }).errors).toEqual(['Open this from the loan’s schedule or the late list.', 'Say why the lender forgave it (at least 10 characters).']);
    expect(forgivenessInput({ ...base, reason: 'x'.repeat(201) }).errors).toEqual(['Keep the reason to 200 characters.']);
  });
});
