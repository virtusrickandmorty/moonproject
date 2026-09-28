/**
 * 2550Q worksheet (research vat-cwt-ewt §3.8): the items of the quarterly VAT return from the sales and purchases
 * registers and the VAT position the close posts, so the worksheet agrees with the close; the checks before filing;
 * a late item after the close; the CSV; and who may see it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;

const quickSale = (customerId: string, invoiceNumber: string, crNumber: string, cents: number, vatWithheldCents: number, certificate: 'pending' | 'received') =>
  encoder.post('/api/qs/sales', {
    sale: { customerId, invoiceNumber, lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: cents, discountCents: 0 }] },
    payment: {
      crNumber, tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: cents - cents / 112 - vatWithheldCents }],
      withholding: { atc: 'WC158', certificate, cwtCents: cents / 112, vatWithheldCents },
    },
    expectedTotalCents: cents,
  }, idem());

const jv = (memo: string, lines: unknown[], cents: number, businessDate?: string) =>
  accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines, ...(businessDate ? { lateReason: 'Recorded after the fact for the 2550Q test' } : {}) },
    expectedTotalCents: cents, ...(businessDate ? { businessDate } : {}),
  }, idem());

const worksheet = (year: number, quarter: number, who = accountant) => who.get(`/api/tax/2550q?year=${year}&quarter=${quarter}`);
type Line = { key: string; amountCents: number | null; taxCents: number };
const items = (w: { lines: Line[] }) => Object.fromEntries(w.lines.map((l) => [l.key, [l.amountCents, l.taxCents]]));
const codes = (w: { checks: { code: string }[] }) => w.checks.map((x) => x.code);

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  // Q3 sales: VAT ₱1,200.00 (₱500.00 withheld, 2307 pending) and ₱600.00 (₱250.00 withheld, 2307 in hand).
  expect((await quickSale(c.school, '0701', '0901', 1_120_000, 50_000, 'pending')).statusCode).toBe(200);
  expect((await quickSale(c.other, '0702', '0902', 560_000, 25_000, 'received')).statusCode).toBe(200);
  // Q3 purchases: office supplies ₱1,120.00 (goods, VAT ₱120.00) and ₱400.00 input VAT on a journal voucher (to classify).
  expect((await accountant.post('/api/docs/exp.voucher/post', {
    input: { cashPlaceId: cashPlaceId(env.db, '1111'), categoryId: cat('6160'), amountCents: 112_000, description: 'Bond paper', payeeName: 'Sample Office Depot Inc.',
      payeeVatRegistered: true, payeeTin: '444-555-666-000', supplierInvoiceNo: 'OR-0101', supplierInvoiceDate: '2026-09-28' },
    expectedTotalCents: 112_000,
  }, idem())).statusCode).toBe(200);
  expect((await jv('Input VAT on thread and buttons', [
    { accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-1' }, debitCents: 40_000 },
    { accountId: account('1101'), creditCents: 40_000 },
  ], 40_000)).statusCode).toBe(200);
  // ₱300.00 input VAT carried over from Q2 (an opening balance).
  expect((await jv('Input VAT carried over from Q2', [{ accountId: account('1402'), debitCents: 30_000 }, { accountId: account('3900'), creditCents: 30_000 }], 30_000, '2026-06-30')).statusCode).toBe(200);
});

const nextMonth = async () => {
  env.clock.set('2026-10-05T02:00:00Z');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
};

describe('2550Q worksheet', () => {
  it('gives each item of the return from the registers, agreeing with the VAT of the quarter', async () => {
    const w = (await worksheet(2026, 3)).json();
    expect([w.from, w.to, w.returnDue, w.close]).toEqual(['2026-07-01', '2026-09-30', '2026-10-26', null]);
    expect(items(w)).toEqual({
      vatable_sales: [1_500_000, 180_000], zero_rated_sales: [0, 0], exempt_sales: [0, 0], output_tax: [1_500_000, 180_000],
      input_carried_over: [null, 30_000], capital_goods: [0, 0], goods: [100_000, 12_000], services: [0, 0], to_classify: [0, 40_000],
      input_tax: [100_000, 82_000], net_vat: [null, 98_000], vat_withheld: [null, 25_000], payable: [null, 73_000], carry_forward: [null, 0],
    });
    const summary = (await accountant.get('/api/tax/vat-summary?year=2026&quarter=3')).json();
    expect([summary.outputVatCents, summary.inputVatCents + summary.carryOverCents, summary.payableCents]).toEqual([180_000, 82_000, 73_000]);
    expect(codes(w)).toEqual(['TO_CLASSIFY', 'PENDING_2307', 'QUARTER_OPEN']);
  });

  it('asks for the close once the quarter ends; a late item after the close is flagged, then swept into the next quarter', async () => {
    await nextMonth();
    expect(codes((await worksheet(2026, 3)).json())).toEqual(['TO_CLASSIFY', 'PENDING_2307', 'NOT_CLOSED']);

    const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 3 } })).json();
    expect((await accountant.post('/api/docs/tax.vat_close/post', { input: { year: 2026, quarter: 3 }, expectedTotalCents: pre.totalCents }, idem())).statusCode).toBe(200);
    let w = (await worksheet(2026, 3)).json();
    expect([w.close?.number.startsWith('VATC-'), codes(w)]).toEqual([true, ['TO_CLASSIFY', 'PENDING_2307']]);

    // ₱100.00 input VAT dated 30 September, recorded after the close.
    expect((await jv('Late input VAT on needles', [
      { accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-2' }, debitCents: 10_000 },
      { accountId: account('1101'), creditCents: 10_000 },
    ], 10_000, '2026-09-30')).statusCode).toBe(200);
    w = (await worksheet(2026, 3)).json();
    expect(codes(w)).toContain('CHANGED_AFTER_CLOSE');
    expect(items(w).payable).toEqual([null, 63_000]);

    const q4 = (await worksheet(2026, 4)).json();
    expect(items(q4)).toMatchObject({ vatable_sales: [0, 0], late_input: [null, 10_000], input_tax: [0, 10_000], carry_forward: [null, 10_000] });
    expect(codes(q4)).toEqual(['LATE_ITEMS', 'PENDING_2307', 'QUARTER_OPEN']); // the Q3 2307 still pending carries on
  });

  it('exports the CSV; the accountant and owners only; a bad quarter is refused', async () => {
    const csv = await accountant.get('/api/tax/2550q?year=2026&quarter=3&format=csv');
    expect(csv.headers['content-disposition']).toContain('2550Q-worksheet-2026-Q3.csv');
    expect(csv.body).toContain('"VATable sales","15000.00","1800.00"');
    expect(csv.body).toContain('"Tax still payable","","730.00"');
    expect((await worksheet(2026, 3, encoder)).statusCode).toBe(403);
    expect((await accountant.get('/api/tax/2550q?year=2026&quarter=5')).json().code).toBe('BAD_QUARTER');
    expect((await accountant.get('/api/tax/2550q')).json().quarter).toBe(3);
  });
});
