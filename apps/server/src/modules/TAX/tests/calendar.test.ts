/**
 * Tax calendar and VAT of a quarter (PLAN E12, E13, D8): each BIR form's due date for its period, moved past weekends
 * and the holidays in EMP's list; and output VAT less input, withheld and carried-over VAT, read from the ledger.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { nextWorkingDay } from '../calendar.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28, a Monday
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
});

const calendar = async (from: string, to: string) => {
  const res = await accountant.get(`/api/tax/calendar?from=${from}&to=${to}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as Record<string, string>[]).map((d) => `${d.form} ${d.period} ${d.statutoryDate}→${d.dueDate}`);
};

describe('tax calendar', () => {
  it('lists October 2026: a Saturday and a Sunday move to Monday', async () => {
    expect(await calendar('2026-10-01', '2026-10-31')).toEqual([
      '1601-C 2026-09 2026-10-10→2026-10-12',
      '2307 2026-Q3 2026-10-20→2026-10-20',
      '2550Q 2026-Q3 2026-10-25→2026-10-26',
    ]);
  });

  it('skips holidays too, and the month-3 0619-E; December’s 1601-C is due on 15 January', async () => {
    expect(await calendar('2026-11-01', '2026-12-31')).toEqual([
      // 31 Oct is a Saturday and a special holiday, 1 Nov a Sunday and a holiday.
      '1601-EQ 2026-Q3 2026-10-31→2026-11-02',
      '0619-E 2026-10 2026-11-10→2026-11-10',
      '1601-C 2026-10 2026-11-10→2026-11-10',
      // 29 Nov is a Sunday and 30 Nov is Bonifacio Day.
      '1702Q 2026-Q3 2026-11-29→2026-12-01',
      '0619-E 2026-11 2026-12-10→2026-12-10',
      '1601-C 2026-11 2026-12-10→2026-12-10',
    ]);
    const jan = await calendar('2027-01-01', '2027-01-31');
    expect(jan).toContain('1601-C 2026-12 2027-01-15→2027-01-15');
    expect(jan).toContain('2307 2026-Q4 2027-01-20→2027-01-20');
    expect(jan).toContain('2550Q 2026-Q4 2027-01-25→2027-01-25');
    expect(jan.some((d) => d.startsWith('0619-E 2026-12'))).toBe(false);
    // 31 Jan 2027 is a Sunday: the 2316s and the 1604-C move to 1 February, outside January.
    expect(await calendar('2027-02-01', '2027-02-01')).toEqual(['1601-EQ 2026-Q4 2027-01-31→2027-02-01', '2316 2026 2027-01-31→2027-02-01', '1604-C 2026 2027-01-31→2027-02-01']);
    expect(await calendar('2027-04-15', '2027-04-15')).toEqual(['1702-RT 2026 2027-04-15→2027-04-15']);
  });

  it('the next working day skips runs of days off', async () => {
    expect(nextWorkingDay('2026-12-24', new Set(['2026-12-24', '2026-12-25']))).toBe('2026-12-28');
    expect(nextWorkingDay('2026-12-23', new Set())).toBe('2026-12-23');
  });

  it('is for the accountant and owner, and checks the range', async () => {
    expect((await encoder.get('/api/tax/calendar?from=2026-10-01&to=2026-10-31')).statusCode).toBe(403);
    expect((await accountant.get('/api/tax/calendar?from=2026-10-31&to=2026-10-01')).json().code).toBe('BAD_RANGE');
    expect((await accountant.get('/api/tax/calendar?from=2020-01-01&to=2029-12-31')).json().code).toBe('BAD_RANGE');
    expect((await accountant.get('/api/tax/calendar?from=soon&to=2026-10-01')).json().code).toBe('BAD_DATE');
  });
});

describe('VAT of a quarter', () => {
  const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;

  it('is output VAT less VAT withheld and input VAT carried over; the 2307 still to come is shown', async () => {
    const c = seedCustomers(env.db, encoder.userId);
    // A government buyer: ₱11,200.00 (VAT ₱1,200.00), paid as ₱10,600.00 cash, 1% CWT ₱100.00 and 5% VAT withheld ₱500.00.
    const sale = await encoder.post('/api/qs/sales', {
      sale: { customerId: c.school, invoiceNumber: '0601', lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: 1_120_000, discountCents: 0 }] },
      payment: { crNumber: '0801', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 1_060_000 }], withholding: { atc: 'WC158', certificate: 'pending', cwtCents: 10_000, vatWithheldCents: 50_000 } },
      expectedTotalCents: 1_120_000,
    }, idem());
    expect(sale.statusCode).toBe(200);
    // ₱300.00 input VAT carried over from Q2 (an opening balance, dated in June).
    const carried = await accountant.post('/api/docs/acc.jv/post', {
      input: { memo: 'Input VAT carried over from Q2', lateReason: 'Opening balance entered at cut-over', lines: [{ accountId: account('1402'), debitCents: 30_000 }, { accountId: account('3900'), creditCents: 30_000 }] },
      expectedTotalCents: 30_000, businessDate: '2026-06-30',
    }, idem());
    expect(carried.statusCode).toBe(200);

    const now = (await accountant.get('/api/tax/vat-summary')).json();
    expect(now).toEqual({
      year: 2026, quarter: 3, from: '2026-07-01', to: '2026-09-30', returnDue: '2026-10-26',
      outputVatCents: 120_000, inputVatCents: 0, vatWithheldCents: 50_000, carryOverCents: 30_000, vatWithheldPendingCents: 50_000,
      payableCents: 40_000, carryForwardCents: 0,
    });
    // Q2 had no sales: the carry-over is its own input VAT, not yet brought forward.
    expect((await accountant.get('/api/tax/vat-summary?year=2026&quarter=2')).json()).toMatchObject({ outputVatCents: 0, carryOverCents: 0, payableCents: 0, carryForwardCents: 0, returnDue: '2026-07-27' });
    expect((await accountant.get('/api/tax/vat-summary?year=2026&quarter=5')).json().code).toBe('BAD_QUARTER');
    expect((await encoder.get('/api/tax/vat-summary')).statusCode).toBe(403);
  });
});
