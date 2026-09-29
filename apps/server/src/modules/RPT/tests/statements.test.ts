/**
 * Financial statements: goldens over real documents (owner money, a quick sale, a supplier bill, an expense voucher, an
 * asset purchase and its depreciation run), earlier years and opening balance equity, CSV, 403 for the encoder, and the
 * balance check (assets = liabilities + equity) as a property over random journal vouchers across three years.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jvDoc } from '../../ACC/doctypes/jv.ts';
import { balanceSheet, incomeStatement, type StatementSection } from '../statements.ts';

let env: TestEnv;
let accountant: Client;
let encoder: Client;
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

/** A section as [header code, [account code or name, amount]..., subtotal] per group, then the section total. */
const shape = (s: StatementSection) => [s.groups.map((g) => [g.code, g.lines.map((l) => [l.code ?? l.name, l.amountCents]), g.totalCents]), s.totalCents];
const ok = async (res: Promise<{ statusCode: number; body: string; json(): unknown }>) => {
  const r = await res;
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; [k: string]: unknown };
};

describe('golden: owner money, a sale, a purchase, an expense and a depreciation run on 2026-09-28', () => {
  beforeEach(async () => {
    const BDO = cashPlaceId(env.db, '1111');
    const CASH = cashPlaceId(env.db, '1101');
    // Owner money: ₱100,000.00 for capital stock, par ₱80,000.00 (Dr 1111 / Cr 3101 80,000.00, Cr 3104 20,000.00).
    const owner = await ok(accountant.post('/api/eq/people', { name: 'Sample Owner A', isStockholder: true, isOfficer: true, position: 'President', shares: 2500 }));
    await ok(accountant.post('/api/docs/eq.owner_money/post', { input: { personId: owner.id, cashPlaceId: BDO, amountCents: 10_000_000,
      classification: 'capital_stock', parValueCents: 8_000_000 }, expectedTotalCents: 10_000_000 }, idem()));
    // Sale (G-08): alteration ₱350.00 paid in cash (Cr 4103 312.50, Cr 2301 37.50; AR cleared by the collection).
    const c = seedCustomers(env.db, encoder.userId);
    await ok(encoder.post('/api/qs/sales', { sale: { customerId: c.school, invoiceNumber: '0502',
      lines: [{ kind: 'service', description: 'Alteration: shorten sleeves', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] },
      payment: { crNumber: '0701', tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] }, expectedTotalCents: 35_000 }, idem()));
    // Purchase (G-15): fabric ₱11,200.00 on account (Dr 5101 10,000.00, Dr 1401 1,200.00 / Cr 2101).
    const supplier = async (body: object) => (await ok(accountant.post('/api/pur/suppliers', body))).id;
    const fabric = await supplier({ name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true, ewtClass: 'goods_1', paymentTermsDays: 30 });
    const cloth = (await ok(accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' }))).id;
    await ok(encoder.post('/api/docs/ap.bill/post', { input: { supplierId: fabric, supplierInvoiceNo: 'SI-7788', supplierInvoiceDate: '2026-09-25',
      lines: [{ supplyId: cloth, amountCents: 1_120_000 }] }, expectedTotalCents: 1_120_000 }, idem()));
    // Expense (G-13): rent ₱40,000.00 from BDO, EWT 5% (Dr 6110 35,714.29, Dr 1401 4,285.71 / Cr 2311 1,785.71, Cr 1111).
    const rent = env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get('6110');
    await ok(encoder.post('/api/docs/exp.voucher/post', { input: { categoryId: rent, cashPlaceId: BDO, amountCents: 4_000_000, description: 'September rent',
      payeeName: 'Sample Lessor Corp.', payeeVatRegistered: true, payeeTin: '123-456-789-000', supplierInvoiceNo: 'SI-0101', supplierInvoiceDate: '2026-09-28' },
      expectedTotalCents: 4_000_000 }, idem()));
    // Asset (G-21): heat press ₱112,000.00, ₱30,000.00 from BDO, ₱82,000.00 financed; September run Dr 5302 / Cr 1511 1,500.00.
    const machines = await supplier({ name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '444-555-666-000', isVatRegistered: true });
    await ok(accountant.post('/api/docs/fa.buy/post', { input: { classCode: 'machinery', description: 'Heat press', location: 'Production floor', supplierId: machines,
      supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: BDO, paidCents: 3_000_000,
      financedCents: 8_200_000, lender: 'Sample Equipment Finance' }, expectedTotalCents: 11_200_000 }, idem()));
    await ok(accountant.post('/api/docs/fa.depreciation/post', { input: { month: '2026-09' }, expectedTotalCents: 150_000 }, idem()));
    noBrokenInvariants();
  });

  it('income statement: sections under their headers in chart order, gross profit, income before tax, net income', async () => {
    const r = await accountant.get('/api/rpt/income-statement?from=2026-09-01&to=2026-09-30');
    expect(r.statusCode).toBe(200);
    const is = r.json() as ReturnType<typeof incomeStatement>;
    expect(is.sections.map((s) => [s.key, s.title, s.side])).toEqual([
      ['revenue', 'Revenue', 'credit'], ['costOfSales', 'Cost of sales', 'debit'], ['operatingExpenses', 'Operating expenses', 'debit'],
      ['otherIncomeAndExpenses', 'Other income and expenses', 'credit'], ['incomeTax', 'Income tax', 'debit'],
    ]);
    expect(is.sections.map(shape)).toEqual([
      [[['4100', [['4103', 31_250]], 31_250]], 31_250],
      [[['5100', [['5101', 1_000_000]], 1_000_000], ['5300', [['5302', 150_000]], 150_000]], 1_150_000],
      [[['6100', [['6110', 3_571_429]], 3_571_429]], 3_571_429],
      [[], 0],
      [[], 0],
    ]);
    expect(is.sections[1]!.groups[1]).toMatchObject({ name: 'Other production costs', lines: [{ accountId: account('5302'), name: 'Depreciation – production equipment', computed: false }] });
    expect(is).toMatchObject({ from: '2026-09-01', to: '2026-09-30', grossProfitCents: -1_118_750, incomeBeforeTaxCents: -4_690_179, netIncomeCents: -4_690_179 });
    // Nothing moved in August.
    expect((await accountant.get('/api/rpt/income-statement?from=2026-08-01&to=2026-08-31')).json()).toMatchObject({ netIncomeCents: 0, sections: [{ groups: [] }, { groups: [] }, { groups: [] }, { groups: [] }, { groups: [] }] });
  });

  it('balance sheet: each account on the side of its section, accumulated depreciation negative, 3290 computed, and it balances', async () => {
    const r = await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-28');
    expect(r.statusCode).toBe(200);
    const bs = r.json() as ReturnType<typeof balanceSheet>;
    expect(bs.sections.map((s) => [s.key, s.side])).toEqual([['assets', 'debit'], ['liabilities', 'credit'], ['equity', 'credit']]);
    const [assets, liabilities, equity] = bs.sections as [StatementSection, StatementSection, StatementSection];
    expect(shape(assets)).toEqual([[
      ['1100', [['1101', 35_000], ['1111', 3_178_571]], 3_213_571], // 100,000.00 − 38,214.29 − 30,000.00 in BDO
      ['1400', [['1401', 1_748_571]], 1_748_571], // 1,200.00 + 4,285.71 + 12,000.00; AR 1201 is cleared, so left out
      ['1500', [['1510', 10_000_000], ['1511', -150_000]], 9_850_000],
    ], 14_812_142]);
    expect(shape(liabilities)).toEqual([[
      ['2100', [['2101', 1_120_000]], 1_120_000],
      ['2300', [['2301', 3_750], ['2311', 178_571]], 182_321],
      ['2600', [['2602', 8_200_000]], 8_200_000],
    ], 9_502_321]);
    expect(shape(equity)).toEqual([[
      ['3100', [['3101', 8_000_000], ['3104', 2_000_000]], 10_000_000],
      ['3200', [['Earlier years’ earnings not yet closed to retained earnings', 0], ['3290', -4_690_179]], -4_690_179],
    ], 5_309_821]);
    expect(equity.groups[1]!.lines).toEqual([
      { accountId: null, code: null, name: 'Earlier years’ earnings not yet closed to retained earnings', amountCents: 0, computed: true },
      { accountId: account('3290'), code: '3290', name: 'Current-year earnings (computed)', amountCents: -4_690_179, computed: true },
    ]);
    expect(bs).toMatchObject({ asOf: '2026-09-28', yearStart: '2026-01-01', currentYearEarningsCents: -4_690_179, earlierYearsEarningsCents: 0,
      totalAssetsCents: 14_812_142, totalLiabilitiesCents: 9_502_321, totalEquityCents: 5_309_821, totalLiabilitiesAndEquityCents: 14_812_142,
      differenceCents: 0, balanced: true });
    // The day before: nothing yet, still balanced.
    expect((await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-27')).json()).toMatchObject({ totalAssetsCents: 0, totalLiabilitiesAndEquityCents: 0, balanced: true,
      sections: [{ groups: [] }, { groups: [] }, { groups: [{ code: '3200', totalCents: 0 }] }] });
  });

  it('exports both statements as CSV in pesos, and refuses the encoder', async () => {
    const is = await accountant.get('/api/rpt/income-statement?from=2026-09-01&to=2026-09-30&format=csv');
    expect(is.statusCode).toBe(200);
    expect(is.headers['content-type']).toContain('text/csv');
    expect(is.headers['content-disposition']).toBe('attachment; filename="income-statement-2026-09-01-2026-09-30.csv"');
    const isRows = is.body.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(isRows.slice(0, 6)).toEqual([
      '"Section","Account","Line","Amount PHP"',
      '"Revenue","","Revenue",""',
      '"Revenue","4100","Sales",""',
      '"Revenue","4103","Service income – repairs and alterations","312.50"',
      '"Revenue","","Total Sales","312.50"',
      '"Revenue","","Total revenue","312.50"',
    ]);
    expect(isRows).toContain('"Gross profit","","Gross profit","-11187.50"');
    expect(isRows).toContain('"Cost of sales","5302","Depreciation – production equipment","1500.00"');
    expect(isRows).toContain('"Income before tax","","Income before tax","-46901.79"');
    expect(isRows.at(-1)).toBe('"Net income","","Net income","-46901.79"');

    const bs = await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-28&format=csv');
    expect(bs.statusCode).toBe(200);
    expect(bs.headers['content-disposition']).toBe('attachment; filename="balance-sheet-2026-09-28.csv"');
    const bsRows = bs.body.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(bsRows).toContain('"Assets","1511","Accumulated depreciation – machinery","-1500.00"');
    expect(bsRows).toContain('"Assets","","Total assets","148121.42"');
    expect(bsRows).toContain('"Equity","3290","Current-year earnings (computed)","-46901.79"');
    expect(bsRows.slice(-2)).toEqual(['"Check","","Total liabilities and equity","148121.42"', '"Check","","Total assets less liabilities and equity","0.00"']);

    for (const path of ['income-statement?from=2026-09-01&to=2026-09-30', 'income-statement?from=2026-09-01&to=2026-09-30&format=csv',
      'balance-sheet?asOf=2026-09-28', 'balance-sheet?asOf=2026-09-28&format=csv']) {
      expect((await encoder.get(`/api/rpt/${path}`)).statusCode).toBe(403);
    }
  });
});

describe('earlier years, opening balance equity, other income and income tax', () => {
  const jv = async (date: string, lines: [debit: string, credit: string, cents: number][]) => {
    const input = { memo: `Statement test entry for ${date}`, lateReason: 'Late test entry for the financial statements',
      lines: lines.flatMap(([dr, cr, cents]) => [{ accountId: account(dr), debitCents: cents }, { accountId: account(cr), creditCents: cents }]) };
    return ok(accountant.post('/api/docs/acc.jv/post', { input, businessDate: date, expectedTotalCents: lines.reduce((s, l) => s + l[2], 0) }, idem()));
  };
  beforeEach(async () => {
    await jv('2025-06-30', [['1101', '3900', 50_000]]); // cut-over: opening cash not yet broken down into equity
    await jv('2025-12-20', [['1101', '7103', 20_000]]);
    await jv('2025-12-31', [['6230', '1101', 1_500]]);
    await jv('2026-01-01', [['1111', '7101', 10_000], ['8103', '1111', 2_000], ['7201', '1101', 3_000]]);
  });

  it('shows the year’s other income as income and other expenses as negatives, then income tax', async () => {
    const is = (await accountant.get('/api/rpt/income-statement?from=2026-01-01&to=2026-09-28')).json() as ReturnType<typeof incomeStatement>;
    expect(is.sections.map(shape)).toEqual([
      [[], 0], [[], 0], [[], 0],
      [[['7100', [['7101', 10_000]], 10_000], ['7200', [['7201', -3_000]], -3_000]], 7_000],
      [[['8100', [['8103', 2_000]], 2_000]], 2_000],
    ]);
    expect(is).toMatchObject({ grossProfitCents: 0, incomeBeforeTaxCents: 7_000, netIncomeCents: 5_000 });
    const last = (await accountant.get('/api/rpt/income-statement?from=2025-01-01&to=2025-12-31')).json() as ReturnType<typeof incomeStatement>;
    expect(last.sections.map(shape)).toEqual([[[], 0], [[], 0], [[['6200', [['6230', 1_500]], 1_500]], 1_500], [[['7100', [['7103', 20_000]], 20_000]], 20_000], [[], 0]]);
    expect(last.netIncomeCents).toBe(18_500);
  });

  it('keeps earlier years apart from this year, and shows 3900 only while it is not zero', async () => {
    const bs = (await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-28')).json() as ReturnType<typeof balanceSheet>;
    expect(bs).toMatchObject({ currentYearEarningsCents: 5_000, earlierYearsEarningsCents: 18_500, totalAssetsCents: 73_500, totalLiabilitiesCents: 0, balanced: true });
    expect(shape(bs.sections[2]!)).toEqual([[
      ['3200', [['Earlier years’ earnings not yet closed to retained earnings', 18_500], ['3290', 5_000]], 23_500],
      [null, [['3900', 50_000]], 50_000],
    ], 73_500]);
    expect(bs.sections[2]!.groups[1]).toMatchObject({ code: null, name: null, lines: [{ name: 'Opening balance equity', computed: false }] });

    const yearEnd = (await accountant.get('/api/rpt/balance-sheet?asOf=2025-12-31')).json() as ReturnType<typeof balanceSheet>;
    expect(yearEnd).toMatchObject({ yearStart: '2025-01-01', currentYearEarningsCents: 18_500, earlierYearsEarningsCents: 0, totalAssetsCents: 68_500, balanced: true });

    const before = (await accountant.get('/api/rpt/balance-sheet?asOf=2025-06-29')).json() as ReturnType<typeof balanceSheet>;
    expect(before.sections[2]!.groups.flatMap((g) => g.lines.map((l) => l.code))).toEqual([null, '3290']);

    // Breaking the opening equity down into capital clears 3900 from the statement.
    await jv('2026-09-28', [['3900', '3104', 50_000]]);
    const after = (await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-28')).json() as ReturnType<typeof balanceSheet>;
    expect(after.sections[2]!.groups.flatMap((g) => g.lines.map((l) => l.code))).toEqual(['3104', null, '3290']);
    expect(after.balanced).toBe(true);
  });

  it('keeps an account whose lines cancel out in the period, and leaves out accounts that did not move', async () => {
    const p = await jv('2026-09-28', [['6160', '1101', 1_000]]);
    expect((await accountant.post(`/api/docs/acc.jv/${p.id}/cancel`, { reason: 'Entered on the wrong account' }, idem())).statusCode).toBe(200);
    const is = (await accountant.get('/api/rpt/income-statement?from=2026-09-01&to=2026-09-30')).json() as ReturnType<typeof incomeStatement>;
    expect(is.sections.map(shape)).toEqual([[[], 0], [[], 0], [[['6100', [['6160', 0]], 0]], 0], [[], 0], [[], 0]]);
  });

  it('refuses a missing, impossible or reversed date', async () => {
    for (const path of ['income-statement?from=2026-09-30&to=2026-09-01', 'income-statement?from=2026-09-01', 'income-statement?from=2026-02-30&to=2026-03-01',
      'balance-sheet', 'balance-sheet?asOf=2026-13-01', 'balance-sheet?asOf=yesterday']) {
      expect((await accountant.get(`/api/rpt/${path}`)).statusCode, path).toBe(400);
    }
  });
});

describe('property: the balance sheet always balances', () => {
  it('random journal vouchers over three years, some cancelled: assets = liabilities + equity on any date, and 3290 is the year’s net income', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['acc.jv.create', 'acc.jv.post', 'acc.jv.cancel', 'acc.backdate']) };
    const e = { db: env.db, clock: env.clock };
    const pad = (n: number) => String(n).padStart(2, '0');
    const daysBefore = (n: number) => {
      const d = new Date(Date.UTC(2026, 8, 28 - n));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    };
    const sumLines = (s: StatementSection) => s.groups.reduce((t, g) => {
      expect(g.totalCents).toBe(g.lines.reduce((x, l) => x + l.amountCents, 0));
      return t + g.totalCents;
    }, 0);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(jvDoc.arbitrary(env.db), fc.integer({ min: 0, max: 1000 }), fc.boolean()), { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 1100 }), { minLength: 1, maxLength: 3 }),
        (entries, asOfs) => {
          for (const [input, back, cancel] of entries) {
            const total = input.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
            const p = postDocument(e, jvDoc, actor, { input: { ...input, lateReason: 'Late entry for the statements property test' }, businessDate: daysBefore(back), expectedTotalCents: total });
            if (cancel) cancelDocument(e, jvDoc, actor, p.id, 'Property test cancel');
          }
          for (const asOf of asOfs.map(daysBefore)) {
            const bs = balanceSheet(env.db, asOf);
            expect(bs.differenceCents).toBe(0);
            expect(bs.balanced).toBe(true);
            expect(bs.sections.map(sumLines)).toEqual([bs.totalAssetsCents, bs.totalLiabilitiesCents, bs.totalEquityCents]);
            expect(bs.currentYearEarningsCents).toBe(incomeStatement(env.db, bs.yearStart, asOf).netIncomeCents);
            const is = incomeStatement(env.db, '2000-01-01', asOf);
            expect(is.sections.map(sumLines)).toEqual(is.sections.map((s) => s.totalCents));
            expect(bs.currentYearEarningsCents + bs.earlierYearsEarningsCents).toBe(is.netIncomeCents);
          }
        },
      ),
      { numRuns: 40 },
    );
    noBrokenInvariants();
  });
});

describe('comparative statement columns', () => {
  const jv = async (date: string, debit: string, credit: string, cents: number) => {
    const input = { memo: `Comparative statement entry for ${date}`, lateReason: 'Earlier period used for comparative statement testing',
      lines: [{ accountId: account(debit), debitCents: cents }, { accountId: account(credit), creditCents: cents }] };
    await ok(accountant.post('/api/docs/acc.jv/post', { input, businessDate: date, expectedTotalCents: cents }, idem()));
  };

  it('matches two standalone monthly statements, including differences, percentages and one-period lines', async () => {
    await jv('2026-08-15', '1101', '7103', 20_000);
    await jv('2026-08-20', '6110', '1101', 5_000);
    await jv('2026-09-15', '1101', '7103', 30_000);
    await jv('2026-09-20', '6160', '1101', 3_000);
    const current = (await accountant.get('/api/rpt/income-statement?from=2026-09-01&to=2026-09-30')).json() as ReturnType<typeof incomeStatement>;
    const previous = (await accountant.get('/api/rpt/income-statement?from=2026-08-01&to=2026-08-31')).json() as ReturnType<typeof incomeStatement>;
    const compared = (await accountant.get('/api/rpt/income-statement?from=2026-09-01&to=2026-09-30&compare=previous_month')).json() as
      ReturnType<typeof incomeStatement> & { comparison: { from: string; to: string }; netIncome: { compareAmountCents: number; differenceCents: number; percentChange: number | null } };
    expect(compared.comparison).toMatchObject({ from: previous.from, to: previous.to });
    expect(compared.sections.map((s) => s.totalCents)).toEqual(current.sections.map((s) => s.totalCents));
    expect(compared.sections.map((s) => s.compareAmountCents)).toEqual(previous.sections.map((s) => s.totalCents));
    expect(compared.netIncome).toMatchObject({ compareAmountCents: 15_000, differenceCents: 12_000, percentChange: 80 });
    const expenses = compared.sections[2]!.groups.flatMap((g) => g.lines);
    const codes = expenses.flatMap((l) => (l.code ? [l.code] : []));
    expect(codes).toEqual([...codes].sort()); // an account only in the other month keeps its place in the chart
    expect(expenses.find((l) => l.code === '6110')).toMatchObject({ amountCents: 0, compareAmountCents: 5_000, differenceCents: -5_000, percentChange: -100 });
    expect(expenses.find((l) => l.code === '6160')).toMatchObject({ amountCents: 3_000, compareAmountCents: 0, differenceCents: 3_000, percentChange: null });
    const csv = await accountant.get('/api/rpt/income-statement?from=2026-09-01&to=2026-09-30&compare=previous_month&format=csv');
    expect(csv.body).toContain('"2026-09-01 to 2026-09-30 PHP","2026-08-01 to 2026-08-31 PHP","Difference PHP","Difference %"');
    expect(csv.body).toContain('"Operating expenses","6160","Office supplies","30.00","0.00","30.00",""');
  });

  it('matches two standalone as-of statements and balances both columns', async () => {
    await jv('2026-08-15', '1101', '3104', 20_000);
    await jv('2026-09-15', '1111', '3104', 30_000);
    const current = (await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-30')).json() as ReturnType<typeof balanceSheet>;
    const previous = (await accountant.get('/api/rpt/balance-sheet?asOf=2026-08-31')).json() as ReturnType<typeof balanceSheet>;
    const compared = (await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-30&compare=previous_month')).json() as ReturnType<typeof balanceSheet> &
      { sections: (StatementSection & { compareAmountCents: number })[]; comparison: { asOf: string }; comparisonBalanced: boolean };
    expect(compared.comparison.asOf).toBe(previous.asOf);
    expect(compared.sections.map((s) => s.totalCents)).toEqual(current.sections.map((s) => s.totalCents));
    expect(compared.sections.map((s) => s.compareAmountCents)).toEqual(previous.sections.map((s) => s.totalCents));
    expect(compared.balanced).toBe(true);
    expect(compared.comparisonBalanced).toBe(true);
    const csv = await accountant.get('/api/rpt/balance-sheet?asOf=2026-09-30&compare=previous_month&format=csv');
    expect(csv.body).toContain('"2026-09-30 PHP","2026-08-31 PHP","Difference PHP","Difference %"');
    noBrokenInvariants();
  });
});
