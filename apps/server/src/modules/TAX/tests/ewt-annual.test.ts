/**
 * 1604-E data (PLAN D8 "Yearly", E12): EWT per payee and ATC for the year, from the EWT register, tied to the four
 * quarters' 1601-EQ worksheets and QAP. Made-up 2026: a lessor (rent 5%) every quarter, a printer (2%) in Q1 and Q3, a
 * one-off consultant (5%) in Q2; a bill cancelled in Q4 after its quarter; the 0619-E and 1601-EQ of Q1 paid, Q3 in part.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number;
let lessor: string, printer: string;

const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const posted = (res: { statusCode: number; body: string; json(): { id: string } }) => (expect(res.statusCode, res.body).toBe(200), res.json().id);
const goTo = async (date: string) => {
  env.clock.set(`${date}T02:00:00Z`);
  [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
};
const voucher = async (input: { amountCents: number; [k: string]: unknown }) => {
  // Paid from BDO: what leaves it is the receipt less any EWT, which the server works out (preview).
  const base = { ...input, tenders: [{ cashPlaceId: BDO, amountCents: 1 }] };
  const cash = (await accountant.post('/api/docs/exp.voucher/preview', { input: base })).json().doc.cashCents as number;
  return posted(await accountant.post('/api/docs/exp.voucher/post', { input: { ...input, tenders: [{ cashPlaceId: BDO, amountCents: cash }] }, expectedTotalCents: input.amountCents }, idem()));
};
const rent = (day: string) => voucher({ supplierId: lessor, categoryId: cat('6110'), amountCents: 4_000_000, description: `Rent ${day}`, supplierInvoiceNo: `OR-${day}`, supplierInvoiceDate: day });
const bill = async (no: string, day: string, amountCents: number) =>
  posted(await encoder.post('/api/docs/ap.bill/post', { input: { supplierId: printer, supplierInvoiceNo: no, supplierInvoiceDate: day, lines: [{ purchase: 'subcontract', amountCents }] }, expectedTotalCents: amountCents }, idem()));
const pay = async (form: string, period: string, amountCents: number) => {
  const input = { form, period, cashPlaceId: BDO, amountCents, reference: `eFPS ${period}` };
  const pre = (await accountant.post('/api/docs/tax.bir_payment/preview', { input })).json();
  posted(await accountant.post('/api/docs/tax.bir_payment/post', { input, expectedTotalCents: pre.totalCents }, idem()));
};

beforeEach(async () => {
  env = await createTestEnv('2026-01-10T02:00:00Z');
  await goTo('2026-01-10');
  BDO = cashPlaceId(env.db, '1111');
  const newSupplier = async (s: Record<string, unknown>) => (await accountant.post('/api/pur/suppliers', { isVatRegistered: true, ...s })).json().id as string;
  lessor = await newSupplier({ name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '333-444-555-000', ewtClass: 'rent_5' });
  printer = await newSupplier({ name: 'Sample Print', registeredName: 'Sample Print Shop Co.', tin: '222-333-444-000', ewtClass: 'contractor_2' });
});

describe('1604-E data', () => {
  it('EWT per payee and ATC for the year, tied to the four quarters’ 1601-EQ and QAP; CSV', async () => {
    await rent('2026-01-10'); // EWT 1,785.71
    await bill('SI-1', '2026-01-08', 560_000); // EWT 100.00 (2% of 5,000.00)
    await goTo('2026-02-12');
    await pay('0619-E', '2026-01', 178_571);
    await goTo('2026-04-15');
    await rent('2026-04-15');
    await pay('1601-EQ', '2026-Q1', 10_000);
    await voucher({ categoryId: cat('6190'), amountCents: 1_000_000, description: 'Pattern consultation', payeeName: 'Juan Sample', payeeVatRegistered: false, payeeTin: '777-888-999-000', ewtClass: 'prof_ind_5' });
    await goTo('2026-07-20');
    await rent('2026-07-20');
    const q3bill = await bill('SI-2', '2026-07-18', 1_120_000); // EWT 200.00
    await goTo('2026-10-10');
    await pay('1601-EQ', '2026-Q3', 100_000); // in part
    await rent('2026-10-10');
    // The Q3 printing bill cancelled in Q4: its EWT comes off in Q4, on the cancel date.
    expect((await accountant.post(`/api/docs/ap.bill/${q3bill}/cancel`, { reason: 'Billed to the wrong company' }, idem())).statusCode).toBe(200);

    await goTo('2027-02-15');
    const r = (await accountant.get('/api/tax/1604e?year=2026')).json();
    expect(r).toMatchObject({ year: 2026, returnDue: '2027-03-01', tied: true, totals: { ewtCents: 4 * 178_571 + 60_000 }, registerCents: 4 * 178_571 + 60_000, glCents: 4 * 178_571 + 60_000 });
    expect(r.alphalist.map((p: { registeredName: string; atc: string | null; ewtClass: string; tin: string; quarters: number[]; ewtCents: number }) =>
      [p.registeredName, p.atc ?? p.ewtClass, p.tin, p.quarters, p.ewtCents])).toEqual([
      ['Juan Sample', 'WI010', '777-888-999-000', [0, 50_000, 0, 0], 50_000],
      ['Sample Lessor Corp.', 'rent_5', '333-444-555-000', [178_571, 178_571, 178_571, 178_571], 714_284],
      ['Sample Print Shop Co.', 'contractor_2', '222-333-444-000', [10_000, 0, 20_000, -20_000], 10_000],
    ]);
    // Each quarter ties to its own 1601-EQ worksheet and QAP.
    for (const q of r.quarters as { quarter: number; qapCents: number; worksheetCents: number; registerCents: number; glCents: number; tied: boolean; leftCents: number }[]) {
      const eq = (await accountant.get(`/api/tax/1601eq?year=2026&quarter=${q.quarter}`)).json();
      const qap = eq.qap.reduce((s: number, l: { ewtCents: number }) => s + l.ewtCents, 0);
      expect([q.qapCents, q.worksheetCents, q.registerCents, q.glCents, q.tied, q.leftCents]).toEqual([qap, eq.totals.ewtCents, qap, qap, true, eq.leftCents]);
    }
    expect(r.quarters.map((q: { dueCents: number; remittedCents: number; paidCents: number; leftCents: number }) => [q.dueCents, q.remittedCents, q.paidCents, q.leftCents])).toEqual([
      [188_571, 178_571, 10_000, 0], [228_571, 0, 0, 228_571], [198_571, 0, 100_000, 98_571], [158_571, 0, 0, 158_571],
    ]);
    expect(r.checks.map((c: { level: string; code: string }) => `${c.level} ${c.code}`)).toEqual(['warning UNPAID', 'warning ATC_TO_CONFIRM']);

    const csv = (await accountant.get('/api/tax/1604e?year=2026&format=csv')).body.replace(/^﻿/, '').split('\r\n');
    expect(csv.slice(0, 3)).toEqual([
      '"Alphalist of payees"', '"TIN","Registered name","ATC","Rate","Q1 EWT","Q2 EWT","Q3 EWT","Q4 EWT","Base","EWT withheld"',
      '"777-888-999-000","Juan Sample","WI010","5%","0.00","500.00","0.00","0.00","10000.00","500.00"',
    ]);
    expect(csv).toContain('"Q3 2026","1985.71","1985.71","1985.71","1985.71","Yes","1985.71","0.00","1000.00","985.71"');
    expect(csv).toContain('"Year 2026","7742.84","","7742.84","7742.84","Yes"');
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });
});
