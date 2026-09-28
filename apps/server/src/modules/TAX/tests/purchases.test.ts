/**
 * Purchases and EWT registers (PLAN E12) and the 2307s to issue: read from the ledger, so their totals always equal
 * the GL movement of 1401 and 2311; the class of each purchase for the 2550Q and the SLP; the ATC of each EWT class;
 * a cancel as its own negative row on the cancel date; the CSV; and who may see them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { ewtAtc, purchaseClass } from '../purchases.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number;
let machines: string, fabric: string, printer: string, lessor: string, auditor: string;
let cloth: string;

const newSupplier = async (s: { name: string; registeredName: string; tin: string; isVatRegistered: boolean; ewtClass?: string }) =>
  (await accountant.post('/api/pur/suppliers', s)).json().id as string;
const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
const posted = (res: { statusCode: number; json(): { id: string } }) => (expect(res.statusCode).toBe(200), res.json().id);
const bill = async (supplierId: string, supplierInvoiceNo: string, supplierInvoiceDate: string, lines: { amountCents: number; [k: string]: unknown }[]) =>
  posted(await encoder.post('/api/docs/ap.bill/post', { input: { supplierId, supplierInvoiceNo, supplierInvoiceDate, lines }, expectedTotalCents: sum(lines) }, idem()));
const voucher = async (input: { amountCents: number; [k: string]: unknown }) =>
  posted(await accountant.post('/api/docs/exp.voucher/post', { input: { cashPlaceId: BDO, ...input }, expectedTotalCents: input.amountCents }, idem()));
const cancel = async (type: string, id: string) =>
  expect((await accountant.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded against the wrong supplier' }, idem())).statusCode).toBe(200);
/** Moves the clock; yesterday's sessions have timed out. */
const goTo = async (iso: string) => {
  env.clock.set(iso);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
};
const purchases = (from: string, to: string, who = accountant) => who.get(`/api/tax/registers/purchases?from=${from}&to=${to}`);
const ewt = (from: string, to: string) => accountant.get(`/api/tax/registers/ewt?from=${from}&to=${to}`);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

async function setUp(at?: string) {
  env = await createTestEnv(at);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  machines = await newSupplier({ name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true });
  fabric = await newSupplier({ name: 'Sample Fabric', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true });
  printer = await newSupplier({ name: 'Sample Print', registeredName: 'Sample Print Shop Co.', tin: '222-333-444-000', isVatRegistered: true, ewtClass: 'contractor_2' });
  lessor = await newSupplier({ name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '333-444-555-000', isVatRegistered: true, ewtClass: 'rent_5' });
  auditor = await newSupplier({ name: 'Sample Audit', registeredName: 'Sample Audit Firm', tin: '555-666-777-000', isVatRegistered: true, ewtClass: 'prof_firm_10' });
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
}

describe('the class of a purchase (2550Q and SLP)', () => {
  it('capital goods: a fixed asset bought (FA-)', () => {
    expect(purchaseClass('fa.buy')).toBe('capital_goods');
  });
  it('goods: supplies and freight-in on a bill', () => {
    expect([purchaseClass('ap.bill', 'supply'), purchaseClass('ap.bill', 'freight_in')]).toEqual(['goods', 'goods']);
  });
  it('services: subcontracting and expense categories on a bill, and every expense voucher', () => {
    expect([purchaseClass('ap.bill', 'subcontract'), purchaseClass('ap.bill', 'category'), purchaseClass('exp.voucher')]).toEqual(['services', 'services', 'services']);
  });
  it('none for anything else on 1401 (a journal voucher): the accountant classes it', () => {
    expect([purchaseClass(null), purchaseClass('acc.jv'), purchaseClass('ap.bill')]).toEqual([null, null, null]);
  });
});

describe('the ATC of an EWT class', () => {
  it('professional fees name the payee; the other classes need to know if the payee is an individual or a company', () => {
    expect([ewtAtc('prof_ind_5'), ewtAtc('prof_ind_10'), ewtAtc('prof_firm_10'), ewtAtc('prof_firm_15')].map((a) => a.atc)).toEqual(['WI010', 'WI011', 'WC010', 'WC011']);
    expect(ewtAtc('rent_5')).toEqual({ atc: null, choices: ['WI100', 'WC100'] });
    expect([ewtAtc('contractor_2', 'individual'), ewtAtc('goods_1', 'company'), ewtAtc('services_2', 'company')].map((a) => a.atc)).toEqual(['WI120', 'WC158', 'WC160']);
  });
});

describe('purchases register', () => {
  beforeEach(() => setUp());

  it('lists each purchase with the invoice number, registered name, TIN and class; a bill of two classes splits; a cancel is a negative row; totals tie to 1401', async () => {
    // A heat press, ₱112,000.00 VAT included, paid from BDO.
    const press = await posted(await accountant.post('/api/docs/fa.buy/post', {
      input: { classCode: 'machinery', description: 'Heat press', supplierId: machines, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28',
        amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: BDO, paidCents: 11_200_000 },
      expectedTotalCents: 11_200_000,
    }, idem()));
    await bill(fabric, 'SI-7788', '2026-09-25', [{ supplyId: cloth, amountCents: 1_120_000 }]);
    // Freight-in ₱1,120.00 and subcontracted sewing ₱5,600.00 on one invoice: VAT ₱720.00 split 120 / 600; EWT 2% on ₱6,000.00.
    const mixed = await bill(printer, 'SI-0042', '2026-09-26', [{ purchase: 'freight_in', amountCents: 112_000 }, { purchase: 'subcontract', amountCents: 560_000 }]);
    // Rent ₱40,000.00 to a one-off VAT-registered lessor (G-13).
    await voucher({ categoryId: cat('6110'), amountCents: 4_000_000, description: 'September rent', payeeName: 'Sample Landlord Inc.', payeeVatRegistered: true,
      payeeTin: '444-555-666-000', supplierInvoiceNo: 'OR-0101', supplierInvoiceDate: '2026-09-28' });

    let r = (await purchases('2026-09-01', '2026-09-30')).json();
    expect(r.rows.map((x: Record<string, unknown>) => [x.docTitle, x.supplierInvoiceNo, x.supplierName, x.tin, x.purchaseClass, x.netCents, x.vatCents, x.totalCents])).toEqual([
      ['Fixed Asset', 'SI-2001', 'Sample Machines Corp.', '123-456-789-000', 'capital_goods', 10_000_000, 1_200_000, 11_200_000],
      ['Supplier Bill', 'SI-7788', 'Sample Fabric Trading Inc.', '111-222-333-000', 'goods', 1_000_000, 120_000, 1_120_000],
      ['Supplier Bill', 'SI-0042', 'Sample Print Shop Co.', '222-333-444-000', 'goods', 100_000, 12_000, 112_000],
      ['Supplier Bill', 'SI-0042', 'Sample Print Shop Co.', '222-333-444-000', 'services', 500_000, 60_000, 560_000],
      ['Expense Voucher', 'OR-0101', 'Sample Landlord Inc.', '444-555-666-000', 'services', 3_571_429, 428_571, 4_000_000],
    ]);
    expect(r.rows[0]).toMatchObject({ documentId: press, documentNumber: 'FA-000001', supplierId: machines, posting: 'original', documentStatus: 'posted' });
    expect(r.rows[4].supplierId).toBe('tin:444555666000');
    expect(r.totals).toEqual({ netCents: 15_171_429, vatCents: 1_820_571, totalCents: 16_992_000 });
    expect(r.byClass).toEqual({
      capital_goods: { netCents: 10_000_000, vatCents: 1_200_000, totalCents: 11_200_000 },
      goods: { netCents: 1_100_000, vatCents: 132_000, totalCents: 1_232_000 },
      services: { netCents: 4_071_429, vatCents: 488_571, totalCents: 4_560_000 },
      unclassified: { netCents: 0, vatCents: 0, totalCents: 0 },
    });
    expect(r.glVatCents).toBe(1_820_571);

    await goTo('2026-09-29T02:00:00Z');
    await cancel('ap.bill', mixed);
    r = (await purchases('2026-09-29', '2026-09-29')).json();
    expect(r.rows.map((x: Record<string, unknown>) => [x.date, x.posting, x.documentStatus, x.supplierInvoiceNo, x.purchaseClass, x.netCents, x.vatCents])).toEqual([
      ['2026-09-29', 'reversal', 'cancelled', 'SI-0042', 'goods', -100_000, -12_000],
      ['2026-09-29', 'reversal', 'cancelled', 'SI-0042', 'services', -500_000, -60_000],
    ]);
    r = (await purchases('2026-09-01', '2026-09-30')).json();
    expect([r.rows.length, r.totals.vatCents, r.glVatCents, r.byClass.goods.vatCents]).toEqual([7, 1_748_571, 1_748_571, 120_000]);
    noBrokenInvariants();
  });

  it('exports CSV for Excel and is for the accountant and owner only', async () => {
    await bill(fabric, 'SI-7788', '2026-09-25', [{ supplyId: cloth, amountCents: 1_120_000 }]);
    const csv = (await accountant.get('/api/tax/registers/purchases?from=2026-09-28&to=2026-09-28&format=csv')).body;
    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      '﻿"Date","Journal","Cancel","Document","Number","Supplier invoice","Supplier","TIN","Class","Amount before VAT","Input VAT","Total"',
      expect.stringMatching(/^"2026-09-28","JE-2026-\d{6}","","Supplier Bill","BILL-000001","SI-7788","Sample Fabric Trading Inc.","111-222-333-000","Goods","10000.00","1200.00","11200.00"$/),
      '"Total","","","","","","","","","10000.00","1200.00","11200.00"',
    ]);
    expect((await purchases('2026-09-28', '2026-09-28', encoder)).statusCode).toBe(403);
    expect((await accountant.get('/api/tax/registers/ewt?from=2026-09-28&to=2026-09-28')).statusCode).toBe(200);
    expect((await encoder.get('/api/tax/registers/ewt?from=2026-09-28&to=2026-09-28')).statusCode).toBe(403);
    expect((await accountant.get('/api/tax/registers/purchases?from=2026-09-30&to=2026-09-01')).json().code).toBe('BAD_RANGE');
  });
});

describe('EWT register', () => {
  beforeEach(() => setUp());

  it('lists each withholding with its class, ATC (or ATC to confirm), base, rate and EWT; a cancel is a negative row; ties to 2311', async () => {
    const mixed = await bill(printer, 'SI-0042', '2026-09-26', [{ purchase: 'freight_in', amountCents: 112_000 }, { purchase: 'subcontract', amountCents: 560_000 }]);
    await voucher({ supplierId: lessor, categoryId: cat('6110'), amountCents: 4_000_000, description: 'September rent', supplierInvoiceNo: 'OR-0101', supplierInvoiceDate: '2026-09-28' });
    // A one-off consultant, not VAT-registered, ₱10,000.00: professional fee 5% on the gross.
    await voucher({ categoryId: cat('6190'), amountCents: 1_000_000, description: 'Pattern consultation', payeeName: 'Juan Sample', payeeVatRegistered: false,
      payeeTin: '777-888-999-000', ewtClass: 'prof_ind_5' });

    let r = (await ewt('2026-09-01', '2026-09-30')).json();
    expect(r.rows.map((x: Record<string, unknown>) => [x.docTitle, x.supplierName, x.tin, x.ewtClass, x.atc, x.atcChoices, x.baseCents, x.rateBp, x.ewtCents])).toEqual([
      ['Supplier Bill', 'Sample Print Shop Co.', '222-333-444-000', 'contractor_2', null, ['WI120', 'WC120'], 600_000, 200, 12_000],
      ['Expense Voucher', 'Sample Lessor Corp.', '333-444-555-000', 'rent_5', null, ['WI100', 'WC100'], 3_571_429, 500, 178_571],
      ['Expense Voucher', 'Juan Sample', '777-888-999-000', 'prof_ind_5', 'WI010', ['WI010'], 1_000_000, 500, 50_000],
    ]);
    expect(r).toMatchObject({ totals: { baseCents: 5_171_429, ewtCents: 240_571 }, glEwtCents: 240_571, atcToConfirmCount: 2 });

    await goTo('2026-09-29T02:00:00Z');
    await cancel('ap.bill', mixed);
    r = (await ewt('2026-09-01', '2026-09-30')).json();
    expect(r.rows.at(-1)).toMatchObject({ date: '2026-09-29', posting: 'reversal', documentStatus: 'cancelled', ewtClass: 'contractor_2', baseCents: -600_000, rateBp: 200, ewtCents: -12_000 });
    expect(r).toMatchObject({ totals: { baseCents: 4_571_429, ewtCents: 228_571 }, glEwtCents: 228_571 });

    const csv = (await accountant.get('/api/tax/registers/ewt?from=2026-09-28&to=2026-09-28&format=csv')).body.split('\r\n');
    expect(csv[0]).toBe('﻿"Date","Journal","Cancel","Document","Number","Supplier","TIN","EWT class","ATC","Base","Rate","EWT"');
    expect(csv[2]).toMatch(/^"2026-09-28","JE-2026-\d{6}","","Expense Voucher","EXP-000001","Sample Lessor Corp.","333-444-555-000","rent_5","ATC to confirm \(WI100 or WC100\)","35714.29","5%","1785.71"$/);
    expect(csv[4]).toBe('"Total","","","","","","","","","51714.29","","2405.71"');
    noBrokenInvariants();
  });
});

describe('2307s to issue', () => {
  beforeEach(() => setUp('2026-07-15T02:00:00Z'));

  it('one line per supplier and ATC with the base and EWT of each month of the quarter; a withholding cancelled in the quarter drops out', async () => {
    const rent = (day: string) => voucher({ supplierId: lessor, categoryId: cat('6110'), amountCents: 4_000_000, description: `Rent paid ${day}`,
      supplierInvoiceNo: `OR-${day}`, supplierInvoiceDate: day });
    await rent('2026-07-15');
    await goTo('2026-08-14T02:00:00Z');
    await rent('2026-08-14');
    const fee = await voucher({ categoryId: cat('6190'), amountCents: 1_000_000, description: 'Pattern consultation', payeeName: 'Juan Sample',
      payeeVatRegistered: false, payeeTin: '777-888-999-000', ewtClass: 'prof_ind_5' });
    await goTo('2026-09-15T02:00:00Z');
    await cancel('exp.voucher', fee);
    // Audit fee ₱11,200.00 VAT included on a bill: 10% EWT on ₱10,000.00.
    await bill(auditor, 'SI-3001', '2026-09-15', [{ categoryId: cat('6190'), amountCents: 1_120_000 }]);
    await goTo('2026-10-01T02:00:00Z');
    await rent('2026-10-01'); // the next quarter

    const r = (await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json();
    expect(r).toMatchObject({ year: 2026, quarter: 3, from: '2026-07-01', to: '2026-09-30', months: ['2026-07', '2026-08', '2026-09'] });
    expect(r.lines).toEqual([
      {
        supplierId: auditor, supplierName: 'Sample Audit Firm', tin: '555-666-777-000', ewtClass: 'prof_firm_10', atc: 'WC010', atcChoices: ['WC010'],
        months: [{ month: '2026-07', baseCents: 0, ewtCents: 0 }, { month: '2026-08', baseCents: 0, ewtCents: 0 }, { month: '2026-09', baseCents: 1_000_000, ewtCents: 100_000 }],
        baseCents: 1_000_000, ewtCents: 100_000,
      },
      {
        supplierId: lessor, supplierName: 'Sample Lessor Corp.', tin: '333-444-555-000', ewtClass: 'rent_5', atc: null, atcChoices: ['WI100', 'WC100'],
        months: [{ month: '2026-07', baseCents: 3_571_429, ewtCents: 178_571 }, { month: '2026-08', baseCents: 3_571_429, ewtCents: 178_571 }, { month: '2026-09', baseCents: 0, ewtCents: 0 }],
        baseCents: 7_142_858, ewtCents: 357_142,
      },
    ]);
    expect(r.totals).toEqual({ baseCents: 8_142_858, ewtCents: 457_142 });

    // Left out, it is today's quarter (Q4): the October rent only.
    expect((await accountant.get('/api/tax/2307-to-issue')).json().lines.map((l: { supplierName: string; ewtCents: number }) => [l.supplierName, l.ewtCents])).toEqual([['Sample Lessor Corp.', 178_571]]);
    const csv = (await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3&format=csv')).body.split('\r\n');
    expect(csv.slice(0, 4)).toEqual([
      '﻿"Supplier","TIN","EWT class","ATC","2026-07 base","2026-07 EWT","2026-08 base","2026-08 EWT","2026-09 base","2026-09 EWT","Quarter base","Quarter EWT"',
      '"Sample Audit Firm","555-666-777-000","prof_firm_10","WC010","0.00","0.00","0.00","0.00","10000.00","1000.00","10000.00","1000.00"',
      '"Sample Lessor Corp.","333-444-555-000","rent_5","ATC to confirm (WI100 or WC100)","35714.29","1785.71","35714.29","1785.71","0.00","0.00","71428.58","3571.42"',
      '"Total","","","","","","","","","","81428.58","4571.42"',
    ]);
    expect((await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=5')).json().code).toBe('BAD_QUARTER');
    expect((await encoder.get('/api/tax/2307-to-issue?year=2026&quarter=3')).statusCode).toBe(403);
    noBrokenInvariants();
  });
});
