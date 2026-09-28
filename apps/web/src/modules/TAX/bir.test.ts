/** The BIR payment form's and the EWT worksheets' rules: periods, input, the amount left from the worksheet, and the links. */
import { describe, expect, it } from 'vitest';
import type { EwtMonthWorksheet, VatWorksheet } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import {
  amountText, birPaymentInput, birPaymentPath, defaultPeriod, ewtMonthChoices, ewtMonthDefault, leftToPay, monthFromQuery, monthLabel, periodOf, periodParts, quarterFromQuery,
  worksheetPath, type BirValues,
} from './bir.ts';

const values = (patch: Partial<BirValues> = {}): BirValues => ({ form: '0619-E', year: '2026', part: '8', cashPlaceId: '3', amount: '4,500.00', penalty: '', reference: 'eFPS 123456', note: '', ...patch });

describe('BIR payment rules', () => {
  it('builds the period each return pays: a month for a 0619-E (never a third month), a quarter for the others', () => {
    expect(periodOf('0619-E', '2026', '8')).toBe('2026-08');
    expect(periodOf('0619-E', '2026', '1')).toBe('2026-01');
    expect(['3', '6', '9', '12', '13', ''].map((m) => periodOf('0619-E', '2026', m))).toEqual([null, null, null, null, null, null]);
    expect(periodOf('2550Q', '2026', '3')).toBe('2026-Q3');
    expect(periodOf('1601-EQ', '2026', '4')).toBe('2026-Q4');
    expect([periodOf('1601-EQ', '2026', '5'), periodOf('2550Q', '', '3'), periodOf('2550Q', '2026', '')]).toEqual([null, null, null]);
    expect(periodParts('2026-Q3')).toEqual({ year: '2026', part: '3' });
    expect(periodParts('2026-07')).toEqual({ year: '2026', part: '7' });
    expect([periodParts('2026-Q5'), periodParts('2026-13'), periodParts('')]).toEqual([null, null, null]);
    expect(ewtMonthChoices.map((m) => m.label)).toEqual(['January', 'February', 'April', 'May', 'July', 'August', 'October', 'November']);
    expect(monthLabel('2026-08')).toBe('August 2026');
  });

  it('opens on the period whose return is due now', () => {
    expect(ewtMonthDefault('2026-09-28')).toBe('2026-08');
    expect(ewtMonthDefault('2026-08-05')).toBe('2026-07');
    expect(ewtMonthDefault('2026-10-05')).toBe('2026-08'); // September is on the 1601-EQ
    expect(ewtMonthDefault('2027-01-15')).toBe('2026-11');
    expect(ewtMonthDefault('2026-02-10')).toBe('2026-01');
    expect(defaultPeriod('0619-E', '2026-09-28')).toBe('2026-08');
    expect(defaultPeriod('2550Q', '2026-10-05')).toBe('2026-Q3');
    expect(defaultPeriod('1601-EQ', '2027-01-20')).toBe('2026-Q4');
  });

  it('turns the typed values into input, with plain errors', () => {
    expect(birPaymentInput(values({ penalty: '1,250.00', note: ' late ' }))).toEqual({
      input: { form: '0619-E', period: '2026-08', cashPlaceId: 3, amountCents: 450_000, penaltyCents: 125_000, reference: 'eFPS 123456', note: 'late' },
      errors: [],
    });
    expect(birPaymentInput(values({ form: '2550Q', part: '3' })).input).toEqual({ form: '2550Q', period: '2026-Q3', cashPlaceId: 3, amountCents: 450_000, reference: 'eFPS 123456' });
    expect(birPaymentInput(values({ form: '', cashPlaceId: '', amount: '', penalty: 'x', reference: 'ab' })).errors).toEqual([
      'Pick the return paid.', 'Pick where the money came from.', 'Type the amount paid, like 12,500.00', 'Type the penalty like 250.00, or leave it blank.', 'Type the eFPS, eBIRForms or bank reference.',
    ]);
    expect(birPaymentInput(values({ part: '9' })).errors).toEqual(['Pick the month: a 0619-E pays the first or second month of a quarter.']);
    expect(birPaymentInput(values({ form: '1601-EQ', part: '' })).errors).toEqual(['Pick the year and quarter.']);
  });

  it('fills the amount with what the worksheet leaves to pay, blank when nothing is', () => {
    expect(leftToPay('0619-E', { leftCents: 123_456 } as EwtMonthWorksheet)).toBe(123_456);
    expect(leftToPay('1601-EQ', { leftCents: -500 } as EwtMonthWorksheet)).toBe(0);
    const vat = (taxCents: number) => ({ lines: [{ key: 'output_tax', label: 'Output tax', amountCents: null, taxCents: 900_000 }, { key: 'payable', label: 'Tax still payable', amountCents: null, taxCents }] }) as VatWorksheet;
    expect(leftToPay('2550Q', vat(750_000))).toBe(750_000);
    expect(leftToPay('2550Q', { lines: [] } as unknown as VatWorksheet)).toBe(0);
    expect([amountText(750_000), amountText(0), amountText(-1)]).toEqual(['7,500.00', '', '']);
  });

  it('links the worksheets and the form both ways, and lists the worksheets under Accounting & Tax', () => {
    expect(birPaymentPath('0619-E', '2026-08')).toBe('/docs/tax.bir_payment/new?form=0619-E&period=2026-08');
    expect(birPaymentPath('1601-EQ', '2026-Q3')).toBe('/docs/tax.bir_payment/new?form=1601-EQ&period=2026-Q3');
    expect(worksheetPath('0619-E', '2026-08')).toBe('/tax/0619e?month=2026-08');
    expect(worksheetPath('1601-EQ', '2026-Q3')).toBe('/tax/1601eq?year=2026&quarter=3');
    expect(worksheetPath('2550Q', '2026-Q3')).toBeNull();
    expect([monthFromQuery('?month=2026-08'), monthFromQuery('?month=2026-09'), monthFromQuery('?month=2026-Q3'), monthFromQuery('')]).toEqual(['2026-08', null, null, null]);
    expect([quarterFromQuery('?year=2026&quarter=3'), quarterFromQuery('?year=2026&quarter=5'), quarterFromQuery('')]).toEqual([{ year: 2026, quarter: 3 }, null, null]);
    const tax = buildMenu([], new Set(['tax.registers.view'])).find((g) => g.group === 'Accounting & Tax')?.items.map((i) => i.label);
    expect(tax).toEqual(expect.arrayContaining(['0619-E (monthly EWT)', '1601-EQ (quarterly EWT)']));
  });
});
