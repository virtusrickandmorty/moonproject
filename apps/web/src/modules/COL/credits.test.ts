/** The credit forms' rules (2307 received, deposit forfeit, credit memo, bad debt write-off) and where they are registered. */
import { describe, expect, it } from 'vitest';
import { buildMenu } from '../../shell/menu.ts';
import { FORMS, VIEWS } from '../screens.ts';
import { creditMemoInput, cwtOnlyInput, emptyCreditMemo, emptyCwtOnly, emptyForfeit, emptyWriteOff, forfeitInput, writeOffInput } from './credits.ts';

describe('credit form rules', () => {
  it('2307 received: amount, ATC and the quarter typed as 2026-Q3', () => {
    expect(cwtOnlyInput({ invoiceId: 'i1', amount: '500', atc: 'WC158', period: ' 2026-q3 ', note: '' })).toEqual({
      input: { invoiceId: 'i1', cwtCents: 50_000, atc: 'WC158', periodYear: 2026, periodQuarter: 3 }, errors: [],
    });
    expect(cwtOnlyInput(emptyCwtOnly()).errors).toEqual([
      'Pick the invoice the tax was withheld on.', 'Type the amount like 250.00', 'Pick the ATC printed on the 2307.', 'Type the quarter on the 2307 like 2026-Q3.',
    ]);
  });

  it('forfeit: job order, amount and a reason', () => {
    expect(forfeitInput({ jobOrderId: 'j1', amount: '28,000', reason: ' Customer never came back ' })).toEqual({
      input: { jobOrderId: 'j1', amountCents: 2_800_000, reason: 'Customer never came back' }, errors: [],
    });
    expect(forfeitInput(emptyForfeit()).errors).toEqual(['Pick the job order the customer abandoned.', 'Type the amount like 5,000.00', 'Say why the deposit is kept (at least 10 characters).']);
  });

  it('credit memo: kind, amount, an optional form number in digits, and a reason', () => {
    expect(creditMemoInput({ invoiceId: 'i1', kind: 'allowance', amount: '5,600.00', formNumber: ' 0012 ', reason: 'Wrong print on two sets' })).toEqual({
      input: { invoiceId: 'i1', kind: 'allowance', amountCents: 560_000, formNumber: '0012', reason: 'Wrong print on two sets' }, errors: [],
    });
    expect(creditMemoInput({ ...emptyCreditMemo(), formNumber: 'CM-12' }).errors).toEqual([
      'Pick the invoice this credit memo is for.', 'Pick return or allowance.', 'Type the amount like 1,120.00',
      'Type the credit memo form number in digits only, or leave it blank.', 'Say why the customer gets this credit (at least 10 characters).',
    ]);
  });

  it('write-off: the invoice and a reason (the amount is all it owes)', () => {
    expect(writeOffInput({ invoiceId: 'i1', reason: 'Customer closed shop' })).toEqual({ input: { invoiceId: 'i1', reason: 'Customer closed shop' }, errors: [] });
    expect(writeOffInput(emptyWriteOff()).errors).toEqual(['Pick the invoice to write off.', 'Say why it is written off (at least 10 characters).']);
  });

  it('forms and views are registered, and the documents are listed under Sales', () => {
    const keys = ['col.cwt_only', 'col.forfeit', 'col.credit_memo', 'col.write_off'];
    expect(keys.every((k) => FORMS[k] && VIEWS[k])).toBe(true);
    const types = [
      { key: 'col.cwt_only', module: 'COL', title: '2307 Received' }, { key: 'col.forfeit', module: 'COL', title: 'Deposit Forfeit' },
      { key: 'col.credit_memo', module: 'COL', title: 'Credit Memo' }, { key: 'col.write_off', module: 'COL', title: 'Bad Debt Write-off' },
    ] as never[];
    expect(buildMenu(types, new Set()).find((g) => g.group === 'Sales')?.items.map((i) => i.label)).toEqual(['2307s Received', 'Deposit Forfeits', 'Credit Memos', 'Bad Debt Write-offs']);
  });
});
