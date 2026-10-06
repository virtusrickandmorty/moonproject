/**
 * Tax registers (PLAN E12, L6): the sales register and the 2307s received, read from the ledger, so their totals
 * always equal the GL movement of 2301, 1410 and 1404; the booklet number each document carries (external number);
 * a cancel as its own negative row on the cancel date; the CSV; and who may see them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
  env.db.prepare(`UPDATE cus_customers SET registered_name = 'Made-up School Foundation, Inc.', tin = '111-222-333-00000' WHERE id = ?`).run(c.school);
});

const line = (cents: number) => ({ kind: 'service', description: 'Alteration: shorten sleeves', qty: 1, unitPriceCents: cents, discountCents: 0 });
/** A walk-in quick sale paid at once; `withholding` is the buyer's 2307. */
const quickSale = (invoiceNumber: string, crNumber: string, cents: number, withholding?: { cwtCents: number; vatWithheldCents?: number }) => {
  const held = (withholding?.cwtCents ?? 0) + (withholding?.vatWithheldCents ?? 0);
  return encoder.post('/api/qs/sales', {
    sale: { customerId: c.school, invoiceNumber, lines: [line(cents)] },
    payment: { crNumber, tenders: [{ cashPlaceId: CASH, amountCents: cents - held }], ...(withholding ? { withholding: { atc: 'WC158', certificate: 'pending', ...withholding } } : {}) },
    expectedTotalCents: cents,
  }, idem());
};
const sales = (from: string, to: string, who = accountant) => who.get(`/api/tax/registers/sales?from=${from}&to=${to}`);
const received = (from: string, to: string) => accountant.get(`/api/tax/registers/withholding-received?from=${from}&to=${to}`);
const nextDay = async () => {
  env.clock.advance(24 * 3600_000);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
};

describe('booklet numbers on documents (external number)', () => {
  it('a quick sale keeps its invoice number and its collection its CR number', async () => {
    const s = (await quickSale('0502', '0701', 35_000)).json();
    const numbers = env.db.prepare(`SELECT doc_type, external_number FROM documents ORDER BY doc_type`).raw().all();
    expect(numbers).toEqual([['col.collection', '0701'], ['qs.sale', '0502']]);
    expect((await accountant.get(`/api/docs/qs.sale/${s.sale.id}`)).json().header.externalNumber).toBe('0502');
  });
});

describe('sales register', () => {
  it('lists each invoice with VATable sales, VAT and the buyer TIN; a cancel is a negative row on its day; totals tie to 2301', async () => {
    await quickSale('0502', '0701', 35_000);
    const big = (await quickSale('0503', '0702', 1_120_000)).json();
    let r = (await sales('2026-09-01', '2026-09-30')).json();
    expect(r.rows.map((x: Record<string, unknown>) => [x.formNumber, x.docTitle, x.customerName, x.tin, x.netCents, x.vatCents, x.totalCents])).toEqual([
      ['0502', 'Invoice Record', 'Made-up School Foundation, Inc.', '111-222-333-00000', 31_250, 3_750, 35_000],
      ['0503', 'Invoice Record', 'Made-up School Foundation, Inc.', '111-222-333-00000', 1_000_000, 120_000, 1_120_000],
    ]);
    expect(r.totals).toEqual({ netCents: 1_031_250, vatCents: 123_750, totalCents: 1_155_000 });
    expect(r.glVatCents).toBe(123_750);

    await nextDay(); // 2026-09-29
    expect((await accountant.post(`/api/qs/sales/${big.sale.id}/cancel`, { reason: 'Wrong customer on the invoice' }, idem())).statusCode).toBe(200);
    r = (await sales('2026-09-29', '2026-09-29')).json();
    expect(r.rows).toEqual([expect.objectContaining({ date: '2026-09-29', posting: 'reversal', formNumber: '0503', documentStatus: 'cancelled', netCents: -1_000_000, vatCents: -120_000 })]);
    r = (await sales('2026-09-01', '2026-09-30')).json();
    expect([r.rows.length, r.totals.vatCents, r.glVatCents]).toEqual([3, 3_750, 3_750]);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });

  it('exports CSV for Excel and is for the accountant and owner only', async () => {
    await quickSale('0502', '0701', 35_000);
    const res = await sales('2026-09-28', '2026-09-28', accountant);
    expect(res.statusCode).toBe(200);
    const csv = (await accountant.get('/api/tax/registers/sales?from=2026-09-28&to=2026-09-28&format=csv')).body;
    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      '﻿"Date","Journal","Cancel","Document","Number","Form no.","Customer","TIN","VATable sales","VAT","Total"',
      expect.stringMatching(/^"2026-09-28","JE-2026-\d{6}","","Invoice Record","IR-000001","0502","Made-up School Foundation, Inc.","111-222-333-00000","312.50","37.50","350.00"$/),
      '"Total","","","","","","","","312.50","37.50","350.00"',
    ]);
    expect((await sales('2026-09-28', '2026-09-28', encoder)).statusCode).toBe(403);
    expect((await accountant.get('/api/tax/registers/sales?from=2026-09-30&to=2026-09-01')).json().code).toBe('BAD_RANGE');
    expect((await accountant.get('/api/tax/registers/sales?from=yesterday&to=2026-09-01')).json().code).toBe('BAD_DATE');
  });
});

describe('2307s received (CWT and VAT withheld)', () => {
  it('lists each 2307 with its ATC and whether it is in hand, and ties to 1410 and 1404', async () => {
    // A government buyer: ₱11,200.00 paid as ₱10,600.00 cash, 1% CWT ₱100.00 and 5% VAT withheld ₱500.00.
    const s = (await quickSale('0504', '0703', 1_120_000, { cwtCents: 10_000, vatWithheldCents: 50_000 })).json();
    let r = (await received('2026-09-01', '2026-09-30')).json();
    expect(r.rows).toEqual([expect.objectContaining({ formNumber: '0703', docTitle: 'Collection Receipt', atc: 'WC158', certificate: 'pending', cwtCents: 10_000, vatWithheldCents: 50_000 })]);
    expect(r).toMatchObject({ totals: { cwtCents: 10_000, vatWithheldCents: 50_000 }, glCwtCents: 10_000, glVatWithheldCents: 50_000, pendingCount: 1 });

    await nextDay();
    expect((await accountant.post(`/api/qs/sales/${s.sale.id}/cancel`, { reason: 'Recorded against the wrong buyer' }, idem())).statusCode).toBe(200);
    r = (await received('2026-09-01', '2026-09-30')).json();
    expect(r.rows.map((x: Record<string, unknown>) => [x.date, x.posting, x.cwtCents, x.vatWithheldCents])).toEqual([['2026-09-28', 'original', 10_000, 50_000], ['2026-09-29', 'reversal', -10_000, -50_000]]);
    expect(r).toMatchObject({ totals: { cwtCents: 0, vatWithheldCents: 0 }, glCwtCents: 0, glVatWithheldCents: 0, pendingCount: 0 });
  });
});
