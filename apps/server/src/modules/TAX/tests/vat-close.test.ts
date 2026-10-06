/**
 * Quarterly VAT close (VATC-, research §3.8 R46): output VAT less input VAT, VAT withheld with its 2307 in hand and the
 * carry-over, into VAT payable or a new carry-over; per customer and supplier; quarters close in order; the registers
 * leave the close out; an item dated in a closed quarter is swept into the next one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
/** Debit-positive balance of an account, all parties. */
const balance = (code: string) =>
  env.db.prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE j.sealed = 1 AND l.account_id = ?').pluck().get(account(code)) as number;

const quickSale = (customerId: string, invoiceNumber: string, crNumber: string, cents: number, vatWithheldCents: number, certificate: 'pending' | 'received') =>
  encoder.post('/api/qs/sales', {
    sale: { customerId, invoiceNumber, lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: cents, discountCents: 0 }] },
    payment: {
      crNumber, tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: cents - cents / 112 - vatWithheldCents }],
      withholding: { atc: 'WC158', certificate, cwtCents: cents / 112, vatWithheldCents }, // 1% CWT of the amount before VAT
    },
    expectedTotalCents: cents,
  }, idem());

const jv = (memo: string, lines: unknown[], cents: number, businessDate?: string) =>
  accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines, ...(businessDate ? { lateReason: 'Recorded after the fact for the VAT close test' } : {}) },
    expectedTotalCents: cents, ...(businessDate ? { businessDate } : {}),
  }, idem());

const close = async (year: number, quarter: number) => {
  const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year, quarter } })).json();
  const res = await accountant.post('/api/docs/tax.vat_close/post', { input: { year, quarter }, expectedTotalCents: pre.totalCents }, idem());
  return { pre, res };
};
const cancel = (id: string) => accountant.post(`/api/docs/tax.vat_close/${id}/cancel`, { reason: 'Closed with the wrong figures' }, idem());

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env); // 2026-09-28
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  // Q3: two government sales, VAT ₱1,200.00 (₱500.00 withheld, 2307 pending) and ₱600.00 (₱250.00 withheld, 2307 in hand).
  const first = await quickSale(c.school, '0701', '0901', 1_120_000, 50_000, 'pending');
  expect(first.statusCode, first.body).toBe(200);
  expect((await quickSale(c.other, '0702', '0902', 560_000, 25_000, 'received')).statusCode).toBe(200);
  // Q3: ₱400.00 input VAT from a supplier; Q2: ₱300.00 input VAT carried over (an opening balance).
  expect((await jv('Input VAT on thread and buttons', [
    { accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-1' }, debitCents: 40_000 },
    { accountId: account('1101'), creditCents: 40_000 },
  ], 40_000)).statusCode).toBe(200);
  expect((await jv('Input VAT carried over from Q2', [{ accountId: account('1402'), debitCents: 30_000 }, { accountId: account('3900'), creditCents: 30_000 }], 30_000, '2026-06-30')).statusCode).toBe(200);
});

const nextMonth = async () => {
  env.clock.set('2026-10-05T02:00:00Z');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
};

describe('quarterly VAT close', () => {
  it('closes Q3 into VAT payable, per customer and supplier, leaving the pending 2307 in 1404', async () => {
    // Not before the quarter ends.
    expect((await close(2026, 3)).res.json().details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'QUARTER_OPEN', level: 'error' })]));
    await nextMonth();

    const { pre, res } = await close(2026, 3);
    expect(pre.summary).toBe('This will close the VAT of Q3 2026: output ₱1,800.00, less input ₱400.00, VAT withheld ₱250.00, carry-over ₱300.00: ₱850.00 VAT payable with the 2550Q, due 2026-10-26.');
    expect(pre.issues).toEqual([expect.objectContaining({ code: 'PENDING_2307', level: 'warning' })]);
    expect(res.statusCode).toBe(200);
    const lines = env.db
      .prepare(`SELECT a.code, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                JOIN journals j ON j.id = l.journal_id WHERE j.source_id = ? ORDER BY l.line_no`)
      .raw().all(res.json().id);
    expect(lines).toEqual(expect.arrayContaining([
      ['2301', c.school, 120_000, 0], ['2301', c.other, 60_000, 0], ['1401', 'SUP-TEST-1', 0, 40_000],
      ['1404', c.other, 0, 25_000], ['1402', null, 0, 30_000], ['2302', null, 0, 85_000],
    ]));
    expect(lines).toHaveLength(6);
    expect([balance('2301'), balance('1401'), balance('1402'), balance('1404'), balance('2302')]).toEqual([0, 0, 0, 50_000, -85_000]);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);

    // The quarter's figures stay as they were, now with the close; the registers leave the close out.
    expect((await accountant.get('/api/tax/vat-summary?year=2026&quarter=3')).json()).toMatchObject({
      outputVatCents: 180_000, inputVatCents: 40_000, vatWithheldCents: 25_000, vatWithheldPendingCents: 50_000, carryOverCents: 30_000,
      payableCents: 85_000, close: { documentId: res.json().id },
    });
    const sales = (await accountant.get('/api/tax/registers/sales?from=2026-07-01&to=2026-12-31')).json();
    expect([sales.rows.length, sales.totals.vatCents, sales.glVatCents]).toEqual([2, 180_000, 180_000]);
    // Q4 starts empty; the pending 2307 waits there.
    expect((await accountant.get('/api/tax/vat-summary?year=2026&quarter=4')).json()).toMatchObject({ outputVatCents: 0, vatWithheldCents: 0, vatWithheldPendingCents: 50_000, carryOverCents: 0 });

    // One close per quarter, in order.
    expect((await close(2026, 3)).res.json().details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CLOSED_ALREADY' })]));
    expect((await close(2026, 2)).res.json().details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LATER_CLOSED' })]));
  });

  it('closes quarters in order: Q2 carries its excess input VAT forward, and Q2 cannot be cancelled under Q3', async () => {
    await nextMonth();
    const q2 = await close(2026, 2);
    expect(q2.pre.summary).toBe('This will close the VAT of Q2 2026: output ₱0.00, less input ₱0.00, carry-over ₱300.00: ₱300.00 carried over to the next quarter.');
    expect(q2.res.statusCode).toBe(200);
    expect(balance('1402')).toBe(30_000);

    const q3 = await close(2026, 3);
    expect(q3.res.statusCode).toBe(200);
    expect(q3.pre.summary).toContain('carry-over ₱300.00: ₱850.00 VAT payable');
    expect([balance('1402'), balance('2302')]).toEqual([0, -85_000]);

    const blocked = await cancel(q2.res.json().id);
    expect([blocked.statusCode, blocked.json().code]).toEqual([409, 'HAS_DEPENDENTS']);
    expect((await cancel(q3.res.json().id)).statusCode).toBe(200);
    expect([balance('2301'), balance('1402'), balance('2302')]).toEqual([-180_000, 30_000, 0]);
    expect((await cancel(q2.res.json().id)).statusCode).toBe(200);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });

  it('sweeps an item dated in a closed quarter into the next close, with a warning', async () => {
    await nextMonth();
    expect((await close(2026, 3)).res.statusCode).toBe(200);
    // A supplier's VAT invoice for September found after the close.
    expect((await jv('Late input VAT for September', [
      { accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-2' }, debitCents: 10_000 },
      { accountId: account('1101'), creditCents: 10_000 },
    ], 10_000, '2026-09-30')).statusCode).toBe(200);
    expect((await accountant.get('/api/tax/vat-summary?year=2026&quarter=4')).json()).toMatchObject({ inputVatCents: 10_000, earlierInputVatCents: 10_000, carryForwardCents: 10_000 });
    const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 4 } })).json();
    expect(pre.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['QUARTER_OPEN', 'EARLIER_ITEMS']));
  });

  it('is posted and cancelled by the accountant only', async () => {
    await nextMonth();
    const owner = await env.as('owner');
    expect((await owner.post('/api/docs/tax.vat_close/post', { input: { year: 2026, quarter: 3 }, expectedTotalCents: 180_000 }, idem())).statusCode).toBe(403);
    expect((await encoder.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 3 } })).statusCode).toBe(403);
  });
});
