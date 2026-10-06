/**
 * SLSP and SAWT data (PLAN E12, D8 "Quarterly", K ACC-25): a quarter with VATable sales, a walk-in sale, a credit memo,
 * a zero-rated and an exempt sale on journal vouchers (classed by the accountant), interest income, purchases of each
 * class and a journal voucher on input VAT, and 2307s in hand and pending. Each list ties to its register and the GL;
 * the CSV; the class of a sale with no VAT; and who may see and mark them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let walkIn: string, schoolPayment: string;
let fabric: string, machines: string, printer: string;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const posted = (res: { statusCode: number; body: string; json(): { id: string } }) => (expect(res.statusCode, res.body).toBe(200), res.json().id);

const quickSale = async (customerId: string, invoiceNumber: string, crNumber: string, cents: number, withholding?: { vatWithheldCents: number; certificate: 'pending' | 'received' }) => {
  const res = await encoder.post('/api/qs/sales', {
    sale: { customerId, invoiceNumber, lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: cents, discountCents: 0 }] },
    payment: withholding
      ? {
        crNumber, tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: cents - cents / 112 - withholding.vatWithheldCents }],
        withholding: { atc: 'WC158', certificate: withholding.certificate, cwtCents: cents / 112, ...(withholding.vatWithheldCents ? { vatWithheldCents: withholding.vatWithheldCents } : {}) },
      }
      : { crNumber, tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: cents }] },
    expectedTotalCents: cents,
  }, idem());
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { sale: { id: string }; payment: { id: string } };
};
/** A journal voucher: cash in, credited to `code` for `customerId` (a sale with no output VAT) or to no party. */
const jvSale = async (memo: string, code: string, cents: number, customerId?: string) =>
  posted(await accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines: [
      { accountId: account('1101'), debitCents: cents },
      { accountId: account(code), ...(customerId ? { party: { type: 'customer', id: customerId } } : {}), creditCents: cents },
    ] },
    expectedTotalCents: cents,
  }, idem()));
const newSupplier = async (s: { name: string; registeredName: string; tin: string; isVatRegistered: boolean; ewtClass?: string }) =>
  (await accountant.post('/api/pur/suppliers', s)).json().id as string;
const bill = async (supplierId: string, supplierInvoiceNo: string, lines: { amountCents: number; [k: string]: unknown }[]) =>
  posted(await encoder.post('/api/docs/ap.bill/post', {
    input: { supplierId, supplierInvoiceNo, supplierInvoiceDate: '2026-09-25', lines }, expectedTotalCents: lines.reduce((s, l) => s + l.amountCents, 0),
  }, idem()));

const get = (path: string, who = accountant, extra = '') => who.get(`/api/tax/${path}?year=2026&quarter=3${extra}`);
const codes = (r: { checks: { code: string }[] }) => r.checks.map((x) => x.code);
const noDifference = (r: { ties: { differenceCents: number }[] }) => expect(r.ties.map((t) => t.differenceCents).every((d) => d === 0)).toBe(true);
const classify = (journalId: string, saleClass: string, who = accountant) =>
  who.post('/api/tax/slsp/sale-class', { journalId, saleClass, reason: 'Per the accountant, from the export papers' });
const goTo = async (iso: string) => {
  env.clock.set(iso);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
};

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env); // 2026-09-28, in Q3
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  const setTax = env.db.prepare('UPDATE cus_customers SET registered_name = ?, tin = ?, is_vat_registered = 1 WHERE id = ?');
  setTax.run('Made-up School Foundation, Inc.', '111-222-333-00000', c.school);
  setTax.run('Paper Lantern Trading Corp.', '222-333-444-00000', c.other);
  walkIn = newId();
  env.db.prepare(`INSERT INTO cus_customers (id, code, kind, display_name, created_at, updated_at) VALUES (?, 'CUS-WALK', 'person', 'Walk-in', ?, ?)`)
    .run(walkIn, '2026-09-01T09:00:00.000+08:00', '2026-09-01T09:00:00.000+08:00');

  // VATable sales: the school ₱11,200.00 (1% CWT, 2307 pending); the club ₱5,600.00 (1% CWT and ₱250.00 VAT withheld, 2307 in hand);
  // a walk-in ₱1,120.00. A ₱1,120.00 allowance (credit memo) on the school's sale.
  const school = await quickSale(c.school, '0701', '0901', 1_120_000, { vatWithheldCents: 0, certificate: 'pending' });
  schoolPayment = school.payment.id;
  await quickSale(c.other, '0702', '0902', 560_000, { vatWithheldCents: 25_000, certificate: 'received' });
  await quickSale(walkIn, '0703', '0903', 112_000);
  posted(await accountant.post('/api/docs/col.credit_memo/post', {
    input: { invoiceId: school.sale.id, kind: 'allowance', amountCents: 112_000, reason: 'Two shirts were a size too small' }, expectedTotalCents: 112_000,
  }, idem()));
  // Sales with no output VAT, on journal vouchers: ₱3,000.00 to the club (zero-rated), ₱2,000.00 to the school (exempt); and ₱100.00 interest.
  await jvSale('Export sale of jerseys to the club', '4101', 300_000, c.other);
  await jvSale('Exempt sale to the school', '4103', 200_000, c.school);
  await jvSale('Bank interest for September', '7101', 10_000);

  // Purchases of each class, and ₱400.00 input VAT on a journal voucher (no supplier on file, so no TIN).
  machines = await newSupplier({ name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true });
  fabric = await newSupplier({ name: 'Sample Fabric', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true });
  printer = await newSupplier({ name: 'Sample Print', registeredName: 'Sample Print Shop Co.', tin: '222-333-444-000', isVatRegistered: true, ewtClass: 'contractor_2' });
  const cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
  posted(await accountant.post('/api/docs/fa.buy/post', {
    input: { classCode: 'machinery', description: 'Heat press', supplierId: machines, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28',
      amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: cashPlaceId(env.db, '1111'), paidCents: 11_200_000 },
    expectedTotalCents: 11_200_000,
  }, idem()));
  await bill(fabric, 'SI-7788', [{ supplyId: cloth, amountCents: 1_120_000 }]);
  await bill(printer, 'SI-0042', [{ purchase: 'subcontract', amountCents: 560_000 }]);
  posted(await accountant.post('/api/docs/acc.jv/post', {
    input: { memo: 'Input VAT on thread and buttons', lines: [
      { accountId: account('1401'), party: { type: 'supplier', id: 'SUP-TEST-1' }, debitCents: 40_000 }, { accountId: account('1101'), creditCents: 40_000 },
    ] },
    expectedTotalCents: 40_000,
  }, idem()));
});

describe('SLSP: sales', () => {
  it('one row per customer with a TIN and one line for walk-ins; the credit memo reduces the sale; ties to the sales register, 2301 and revenue', async () => {
    let r = (await get('slsp/sales')).json();
    expect([r.from, r.to]).toEqual(['2026-07-01', '2026-09-30']);
    expect(r.noVatSales.map((x: Record<string, unknown>) => [x.customerName, x.amountCents, x.saleClass])).toEqual([
      ['Paper Lantern Trading Corp.', 300_000, null], ['Made-up School Foundation, Inc.', 200_000, null],
    ]);
    expect(r.totals.toClassifyCents).toBe(500_000);
    expect(codes(r)).toEqual(['TO_CLASSIFY', 'WALK_IN', 'NO_ADDRESS', 'PERIOD_OPEN']);
    noDifference(r);

    const [zero, exempt] = r.noVatSales.map((x: { journalId: string }) => x.journalId);
    expect((await classify(zero, 'zero_rated')).statusCode).toBe(200);
    expect((await classify(exempt, 'exempt')).statusCode).toBe(200);
    r = (await get('slsp/sales')).json();
    const cols = (x: Record<string, unknown>) => [x.tin, x.registeredName, x.exemptCents, x.zeroRatedCents, x.vatableCents, x.outputTaxCents, x.grossTaxableCents, x.toClassifyCents, x.customers];
    expect(r.rows.map(cols)).toEqual([
      ['111-222-333-00000', 'Made-up School Foundation, Inc.', 200_000, 0, 900_000, 108_000, 1_008_000, 0, 1],
      ['222-333-444-00000', 'Paper Lantern Trading Corp.', 0, 300_000, 500_000, 60_000, 560_000, 0, 1],
      [null, 'Walk-in and other customers without a TIN', 0, 0, 100_000, 12_000, 112_000, 0, 1],
    ]);
    expect(r.totals).toEqual({ exemptCents: 200_000, zeroRatedCents: 300_000, vatableCents: 1_500_000, outputTaxCents: 180_000, grossTaxableCents: 1_680_000, toClassifyCents: 0 });
    expect(r.otherIncomeCents).toBe(10_000);
    expect(r.ties.map((t: Record<string, unknown>) => [t.key, t.listCents, t.bookCents, t.differenceCents])).toEqual([
      ['vatable', 1_500_000, 1_500_000, 0], ['output_register', 180_000, 180_000, 0], ['output_gl', 180_000, 180_000, 0], ['revenue_gl', 2_010_000, 2_010_000, 0],
    ]);
    const register = (await accountant.get('/api/tax/registers/sales?from=2026-07-01&to=2026-09-30')).json();
    expect([register.totals.netCents, register.totals.vatCents, register.glVatCents]).toEqual([1_500_000, 180_000, 180_000]);
    expect(codes(r)).toEqual(['WALK_IN', 'NO_ADDRESS', 'PERIOD_OPEN']);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });

  it('flags a VAT-registered customer with no TIN, who goes on the line without a TIN', async () => {
    env.db.prepare('UPDATE cus_customers SET tin = NULL WHERE id = ?').run(c.other);
    const r = (await get('slsp/sales')).json();
    expect(r.rows.at(-1)).toMatchObject({ customerId: null, tin: null, vatableCents: 600_000, customers: 2 });
    expect(r.checks.find((x: { code: string }) => x.code === 'NO_TIN').message).toContain('Paper Lantern Trading Corp.');
    noDifference(r);
  });

  it('a class is for the original journal of a sale with no VAT, the cancel follows it; accountant only', async () => {
    const [zero, exempt] = (await get('slsp/sales')).json().noVatSales.map((x: { journalId: string }) => x.journalId);
    expect((await classify(zero, 'zero_rated', encoder)).statusCode).toBe(403);
    expect((await classify(zero, 'zero_rated')).statusCode).toBe(200);
    expect((await classify(zero, 'zero_rated')).json().code).toBe('SAME_CLASS');
    const interest = env.db.prepare(`SELECT id FROM journals WHERE memo LIKE '%interest%'`).pluck().get() as string;
    expect((await classify(interest, 'exempt')).json().code).toBe('NOT_A_SALE_WITHOUT_VAT');
    expect((await classify('no-such-journal', 'exempt')).statusCode).toBe(404);
    expect((await accountant.post('/api/tax/slsp/sale-class', { journalId: zero, saleClass: 'vatable', reason: 'Not a class' })).statusCode).toBe(400);
    // A correction is a new row; the latest counts.
    expect((await classify(zero, 'not_a_sale')).statusCode).toBe(200);
    expect((await classify(exempt, 'exempt')).statusCode).toBe(200);
    let r = (await get('slsp/sales')).json();
    expect([r.totals.zeroRatedCents, r.totals.exemptCents, r.otherIncomeCents]).toEqual([0, 200_000, 310_000]);
    expect(env.db.prepare('SELECT COUNT(*) FROM tax_sale_classes').pluck().get()).toBe(3);

    await goTo('2026-09-29T02:00:00Z');
    const doc = env.db.prepare('SELECT source_id FROM journals WHERE id = ?').pluck().get(exempt) as string;
    expect((await accountant.post(`/api/docs/acc.jv/${doc}/cancel`, { reason: 'Recorded on the wrong customer' }, idem())).statusCode).toBe(200);
    r = (await get('slsp/sales')).json();
    const reversal = r.noVatSales.find((x: { posting: string }) => x.posting === 'reversal');
    expect(reversal).toMatchObject({ amountCents: -200_000, saleClass: 'exempt' });
    expect(r.totals.exemptCents).toBe(0);
    expect((await classify(reversal.journalId, 'zero_rated')).json().code).toBe('REVERSAL');
    noDifference(r);
  });

  it('a posted loan forgiveness (gain on debt forgiveness) is other income, not a possible sale in the revenue without VAT list', async () => {
    const BDO = cashPlaceId(env.db, '1111');
    const loanId = (await accountant.post('/api/docs/loan.loan/post', {
      input: { lender: 'Sample Bank', kind: 'loan', cashPlaceId: BDO, principalCents: 50_000_000, feeCents: 500_000, interestRateBp: 1200, termMonths: 25, schedule: 'flat' },
      expectedTotalCents: 50_000_000,
    }, idem())).json().id as string;
    posted(await encoder.post('/api/docs/loan.payment/post', {
      input: { loanId, instalmentNo: 1, cashPlaceId: BDO, principalCents: 500_000, interestCents: 500_000, note: 'Paid part only' }, expectedTotalCents: 1_000_000,
    }, idem()));
    const before = (await get('slsp/sales')).json();
    const f = await accountant.post('/api/docs/loan.forgiveness/post', {
      input: { loanId, instalmentNo: 1, reason: 'The bank waived the rest (made up)' }, expectedTotalCents: 1_500_000,
    }, idem());
    expect(f.statusCode, f.body).toBe(200);
    const r = (await get('slsp/sales')).json();
    expect(r.noVatSales.map((x: { journalId: string }) => x.journalId).sort()).toEqual(before.noVatSales.map((x: { journalId: string }) => x.journalId).sort());
    expect(r.totals.toClassifyCents).toBe(before.totals.toClassifyCents);
    expect(r.otherIncomeCents).toBe(before.otherIncomeCents + 1_500_000);
    noDifference(r);
  });

  it('exports the CSV in the BIR data-entry order, then the ERP columns, the total and the ties', async () => {
    const csv = await get('slsp/sales', accountant, '&format=csv');
    expect(csv.headers['content-disposition']).toContain('slsp-sales-2026-Q3.csv');
    const lines = csv.body.split('\r\n');
    expect(lines[0]).toBe('﻿"Taxable month","TIN","Registered name","Last name","First name","Middle name","Address 1","Address 2","Exempt sales","Zero-rated sales","Taxable sales","Output tax","Gross taxable sales","Still to classify","Customers","Flag"');
    expect(lines[1]).toBe('"09/30/2026","111-222-333-00000","Made-up School Foundation, Inc.","","","","","","0.00","0.00","9000.00","1080.00","10080.00","2000.00","1",""');
    expect(lines[3]).toBe('"09/30/2026","","Walk-in and other customers without a TIN","","","","","","0.00","0.00","1000.00","120.00","1120.00","0.00","1","No TIN"');
    expect(lines[4]).toBe('"Total","","","","","","","","0.00","0.00","15000.00","1800.00","16800.00","5000.00","",""');
    expect(lines).toContain('"Output tax = 2301 output VAT in the books","1800.00","1800.00","0.00","","","","","","","","","","","",""');
  });
});

describe('SLSP: purchases', () => {
  it('one row per supplier by class; flags the one with no TIN; ties to the purchases register and 1401; the CSV', async () => {
    const r = (await get('slsp/purchases')).json();
    const cols = (x: Record<string, unknown>) => [x.tin, x.registeredName, x.exemptCents, x.zeroRatedCents, x.servicesCents, x.capitalGoodsCents, x.goodsCents, x.inputTaxCents, x.grossTaxableCents, x.toClassifyCents];
    expect(r.rows.map(cols)).toEqual([
      [null, '?', 0, 0, 0, 0, 0, 40_000, 40_000, 0],
      ['111-222-333-000', 'Sample Fabric Trading Inc.', 0, 0, 0, 0, 1_000_000, 120_000, 1_120_000, 0],
      ['123-456-789-000', 'Sample Machines Corp.', 0, 0, 0, 10_000_000, 0, 1_200_000, 11_200_000, 0],
      ['222-333-444-000', 'Sample Print Shop Co.', 0, 0, 500_000, 0, 0, 60_000, 560_000, 0],
    ]);
    expect(r.rows.map((x: { supplierId: string }) => x.supplierId)).toEqual(['SUP-TEST-1', fabric, machines, printer]);
    expect(r.totals).toEqual({ exemptCents: 0, zeroRatedCents: 0, servicesCents: 500_000, capitalGoodsCents: 10_000_000, goodsCents: 1_000_000, toClassifyCents: 0, inputTaxCents: 1_420_000, grossTaxableCents: 12_920_000 });
    noDifference(r);
    expect(r.ties.find((t: { key: string }) => t.key === 'input_gl')).toMatchObject({ listCents: 1_420_000, bookCents: 1_420_000 });
    expect(codes(r)).toEqual(['TO_CLASSIFY', 'NO_TIN', 'NO_ADDRESS', 'PERIOD_OPEN']);

    const lines = (await accountant.get('/api/tax/slsp/purchases?year=2026&quarter=3&format=csv')).body.split('\r\n');
    expect(lines[0]).toBe('﻿"Taxable month","TIN","Registered name","Last name","First name","Middle name","Address 1","Address 2","Exempt purchases","Zero-rated purchases","Services","Capital goods","Goods other than capital goods","Input tax","Gross taxable purchases","Still to classify","Flag"');
    expect(lines[1]).toBe('"09/30/2026","","?","","","","","","0.00","0.00","0.00","0.00","0.00","400.00","400.00","0.00","No TIN"');
    expect(lines[3]).toBe('"09/30/2026","123-456-789-000","Sample Machines Corp.","","","","","","0.00","0.00","0.00","100000.00","0.00","12000.00","112000.00","0.00",""');
    expect(lines[5]).toBe('"Total","","","","","","","","0.00","0.00","5000.00","100000.00","10000.00","14200.00","129200.00","0.00",""');
  });
});

describe('SAWT', () => {
  it('one row per customer and ATC with the 2307s, pending marked; ties to the 2307s-received register, 1410 and 1404; the CSV', async () => {
    let r = (await get('sawt')).json();
    const cols = (x: Record<string, unknown>) => [x.tin, x.registeredName, x.atc, x.rateBp, x.incomePaymentCents, x.cwtCents, x.vatWithheldCents, x.certificate];
    expect(r.rows.map(cols)).toEqual([
      ['111-222-333-00000', 'Made-up School Foundation, Inc.', 'WC158', 100, 1_000_000, 10_000, 0, 'pending'],
      ['222-333-444-00000', 'Paper Lantern Trading Corp.', 'WC158', 100, 500_000, 5_000, 25_000, 'received'],
    ]);
    expect([r.totals, r.inHand, r.pending]).toEqual([
      { cwtCents: 15_000, vatWithheldCents: 25_000, incomePaymentCents: 1_500_000 }, { cwtCents: 5_000, vatWithheldCents: 25_000 }, { cwtCents: 10_000, vatWithheldCents: 0 },
    ]);
    expect(r.ties.map((t: Record<string, unknown>) => [t.key, t.listCents, t.bookCents, t.differenceCents])).toEqual([
      ['cwt_register', 15_000, 15_000, 0], ['cwt_gl', 15_000, 15_000, 0], ['vat_register', 25_000, 25_000, 0], ['vat_gl', 25_000, 25_000, 0],
    ]);
    expect(codes(r)).toEqual(['PENDING_2307', 'INCOME_WORKED_BACK', 'PERIOD_OPEN']);

    const lines = (await accountant.get('/api/tax/sawt?year=2026&quarter=3&format=csv')).body.split('\r\n');
    expect(lines[0]).toBe('﻿"Seq. no.","TIN","Registered name","Last name","First name","Middle name","ATC","Nature of income payment","Tax rate","Income payment","Tax withheld","VAT withheld","2307","Opening 2307 for","Documents","Flag"');
    expect(lines[1]).toBe('"1","111-222-333-00000","Made-up School Foundation, Inc.","","","","WC158","Goods sold to a top withholding agent","1%","10000.00","100.00","0.00","Pending","","COL-000001","2307 pending"');
    expect(lines[3]).toBe('"Total","","","","","","","","","15000.00","150.00","250.00","","","",""');

    // The school's 2307 comes: the row is in hand.
    expect((await accountant.post('/api/tax/2307s/received', { documentId: schoolPayment, lineNo: 0 })).statusCode).toBe(200);
    r = (await get('sawt')).json();
    expect(r.rows.map((x: { certificate: string }) => x.certificate)).toEqual(['received', 'received']);
    expect([r.pending, codes(r)]).toEqual([{ cwtCents: 0, vatWithheldCents: 0 }, ['INCOME_WORKED_BACK', 'PERIOD_OPEN']]);
    noDifference(r);
  });
});

describe('who may see them', () => {
  it('the accountant and owners; an encoder gets 403; a bad quarter is refused', async () => {
    for (const path of ['slsp/sales', 'slsp/purchases', 'sawt']) {
      expect((await get(path)).statusCode).toBe(200);
      expect((await get(path, await env.as('owner'))).statusCode).toBe(200);
      expect((await get(path, encoder)).statusCode).toBe(403);
      expect((await get(path, encoder, '&format=csv')).statusCode).toBe(403);
      expect((await accountant.get(`/api/tax/${path}?year=2026&quarter=5`)).json().code).toBe('BAD_QUARTER');
    }
  });
});
