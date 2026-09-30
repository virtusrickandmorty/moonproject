/**
 * 2550Q gaps, part 1 (PLAN E12, research vat-cwt-ewt §3.8 and §3.9): a quarter with purchases with no input VAT of each
 * class (an asset from a supplier that is not VAT-registered, a bill of goods and a subcontracted service from one, an
 * expense of a VAT-registered payee without a VAT receipt, a repair from a payee with no TIN), a business permit that
 * buys nothing, and a zero-rated and an exempt sale classed on the SLSP. The register, the 2550Q worksheet and the SLSP
 * agree to the centavo, a cancel is a negative row, and the VAT of the quarter (what the VAT close posts) does not move.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let tailor: string, usedMachines: string;

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const posted = (res: { statusCode: number; body: string; json(): { id: string } }) => (expect(res.statusCode, res.body).toBe(200), res.json().id);
const post = async (type: string, input: object, cents: number, who = accountant) => posted(await who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: cents }, idem()));
const voucher = (categoryId: number, amountCents: number, payee: object, receipt?: string) =>
  post('exp.voucher', { cashPlaceId: cashPlaceId(env.db, '1101'), categoryId, amountCents, description: 'Test purchase', ...payee,
    ...(receipt ? { supplierInvoiceNo: receipt, supplierInvoiceDate: '2026-09-28' } : {}) }, amountCents);
const jvSale = async (memo: string, code: string, cents: number, customerId: string) => {
  const id = await post('acc.jv', { memo, lines: [
    { accountId: account('1101'), debitCents: cents }, { accountId: account(code), party: { type: 'customer', id: customerId }, creditCents: cents },
  ] }, cents);
  return env.db.prepare(`SELECT id FROM journals WHERE source_id = ? AND posting_kind = 'original'`).pluck().get(id) as string;
};
const get = (path: string) => accountant.get(`/api/tax/${path}?year=2026&quarter=3`);
const items = (w: { lines: { key: string; amountCents: number | null; taxCents: number }[] }) => Object.fromEntries(w.lines.map((l) => [l.key, [l.amountCents, l.taxCents]]));
const vatOfQuarter = async () => {
  const s = (await accountant.get('/api/tax/vat-summary?year=2026&quarter=3')).json();
  const close = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year: 2026, quarter: 3 } })).json();
  return [s.outputVatCents, s.inputVatCents, s.payableCents, s.carryForwardCents, close.totalCents];
};
let billId: string;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28, in Q3
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  const setTax = env.db.prepare('UPDATE cus_customers SET registered_name = ?, tin = ?, is_vat_registered = 1 WHERE id = ?');
  setTax.run('Made-up School Foundation, Inc.', '111-222-333-00000', c.school);
  setTax.run('Paper Lantern Trading Corp.', '222-333-444-00000', c.other);
  // With VAT: a ₱11,200.00 quick sale (VAT ₱1,200.00) and ₱2,240.00 of office supplies with a VAT receipt (VAT ₱240.00).
  const sale = await encoder.post('/api/qs/sales', {
    sale: { customerId: c.other, invoiceNumber: '0801', lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: 1_120_000, discountCents: 0 }] },
    payment: { crNumber: '0901', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 1_120_000 }] },
    expectedTotalCents: 1_120_000,
  }, idem());
  expect(sale.statusCode, sale.body).toBe(200);
  await voucher(cat('6160'), 224_000, { payeeName: 'Sample Office Depot Inc.', payeeVatRegistered: true, payeeTin: '444-555-666-000' }, 'OR-0101');
  tailor = (await accountant.post('/api/pur/suppliers', { name: 'Sample Tailor Supplies', registeredName: 'Sample Tailor Supplies', tin: '333-444-555-000', isVatRegistered: false })).json().id;
  usedMachines = (await accountant.post('/api/pur/suppliers', { name: 'Sample Used Machines', registeredName: 'Sample Used Machines', tin: '555-666-777-000', isVatRegistered: false })).json().id;
});

/** The purchases with no input VAT and the classed sales of the scenario. */
async function noVatQuarter() {
  const cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
  // Capital goods: a ₱50,000.00 used sewing machine from a supplier that is not VAT-registered.
  await post('fa.buy', { classCode: 'machinery', description: 'Used sewing machine', supplierId: usedMachines, supplierInvoiceNo: 'SI-3001', supplierInvoiceDate: '2026-09-28',
    amountCents: 5_000_000, residualCents: 500_000, cashPlaceId: cashPlaceId(env.db, '1111'), paidCents: 5_000_000 }, 5_000_000);
  // Goods ₱3,000.00 and a subcontracted service ₱2,000.00 on one bill of the same supplier.
  billId = await post('ap.bill', { supplierId: tailor, supplierInvoiceNo: 'SI-0077', supplierInvoiceDate: '2026-09-25', lines: [
    { supplyId: cloth, amountCents: 300_000 }, { purchase: 'subcontract', amountCents: 200_000 },
  ] }, 500_000, encoder);
  // Office supplies ₱1,120.00 from a VAT-registered payee with no receipt number: no input VAT, the full amount is the cost (goods).
  await voucher(cat('6160'), 112_000, { payeeName: 'Sample Stationers Inc.', payeeVatRegistered: true, payeeTin: '777-888-999-000' });
  // A ₱800.00 repair by a payee with no TIN (services), and a ₱1,500.00 business permit (buys nothing: left out).
  await voucher(cat('6170'), 80_000, { payeeName: 'Sample Repairman' });
  await voucher(cat('6195'), 150_000, { payeeName: 'Sample City Treasurer' });
  // Sales with no output VAT, classed by the accountant: ₱3,000.00 zero-rated, ₱2,000.00 exempt.
  const zero = await jvSale('Export sale of jerseys', '4101', 300_000, c.other);
  const exempt = await jvSale('Exempt sale to the school', '4103', 200_000, c.school);
  for (const [journalId, saleClass] of [[zero, 'zero_rated'], [exempt, 'exempt']]) {
    expect((await accountant.post('/api/tax/slsp/sale-class', { journalId, saleClass, reason: 'Per the accountant, from the papers' })).statusCode).toBe(200);
  }
}

describe('purchases with no input VAT, zero-rated and exempt sales on the 2550Q', () => {
  it('the register, the worksheet, the SLP and the SLSP agree to the centavo; the VAT of the quarter does not move', async () => {
    const before = await vatOfQuarter();
    await noVatQuarter();
    expect(await vatOfQuarter()).toEqual(before);

    const reg = (await accountant.get('/api/tax/registers/purchases-no-vat?from=2026-07-01&to=2026-09-30')).json();
    expect(reg.rows.map((r: Record<string, unknown>) => [r.docType, r.supplierName, r.tin, r.purchaseClass, r.amountCents])).toEqual([
      ['fa.buy', 'Sample Used Machines', '555-666-777-000', 'capital_goods', 5_000_000],
      ['ap.bill', 'Sample Tailor Supplies', '333-444-555-000', 'goods', 300_000],
      ['ap.bill', 'Sample Tailor Supplies', '333-444-555-000', 'services', 200_000],
      ['exp.voucher', 'Sample Stationers Inc.', '777-888-999-000', 'goods', 112_000],
      ['exp.voucher', 'Sample Repairman', null, 'services', 80_000],
    ]);
    expect([reg.totals.amountCents, reg.byClass]).toEqual([5_692_000, { capital_goods: 5_000_000, goods: 412_000, services: 280_000 }]);

    const w = (await get('2550q')).json();
    expect(items(w)).toMatchObject({
      vatable_sales: [1_000_000, 120_000], zero_rated_sales: [300_000, 0], exempt_sales: [200_000, 0], output_tax: [1_500_000, 120_000],
      capital_goods: [0, 0], goods: [200_000, 24_000], services: [0, 0],
      no_input_capital_goods: [5_000_000, 0], no_input_goods: [412_000, 0], no_input_services: [280_000, 0], no_input_tax: [5_692_000, 0],
      input_tax: [200_000, 24_000], total_purchases: [5_892_000, 0], payable: [null, 96_000],
    });
    expect(w.checks.map((x: { code: string }) => x.code)).toEqual(['QUARTER_OPEN']);

    const slp = (await get('slsp/purchases')).json();
    expect(slp.rows.map((r: Record<string, unknown>) => [r.registeredName, r.tin, r.exemptCents, r.goodsCents, r.inputTaxCents, r.grossTaxableCents])).toEqual([
      ['Sample Office Depot Inc.', '444-555-666-000', 0, 200_000, 24_000, 224_000],
      ['Sample Repairman', null, 80_000, 0, 0, 0],
      ['Sample Stationers Inc.', '777-888-999-000', 112_000, 0, 0, 0],
      ['Sample Tailor Supplies', '333-444-555-000', 500_000, 0, 0, 0],
      ['Sample Used Machines', '555-666-777-000', 5_000_000, 0, 0, 0],
    ]);
    expect([slp.totals.exemptCents, slp.totals.zeroRatedCents, slp.noVatByClass]).toEqual([5_692_000, 0, reg.byClass]);
    expect(slp.ties.every((t: { differenceCents: number }) => t.differenceCents === 0)).toBe(true);
    expect(slp.checks.map((x: { code: string }) => x.code)).toContain('NO_INPUT_VAT');

    const slsp = (await get('slsp/sales')).json();
    expect([slsp.totals.zeroRatedCents, slsp.totals.exemptCents, slsp.totals.toClassifyCents]).toEqual([300_000, 200_000, 0]);
    expect(slsp.ties.every((t: { differenceCents: number }) => t.differenceCents === 0)).toBe(true);

    const csv = (await accountant.get('/api/tax/registers/purchases-no-vat?from=2026-07-01&to=2026-09-30&format=csv')).body.split('\r\n');
    expect(csv.at(-1) || csv.at(-2)).toContain('"Total","","","","","","","","","56920.00"');
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('a cancelled bill is a negative row on the cancel date, and every list follows it', async () => {
    await noVatQuarter();
    const before = await vatOfQuarter();
    expect((await accountant.post(`/api/docs/ap.bill/${billId}/cancel`, { reason: 'Typed against the wrong supplier' }, idem())).statusCode).toBe(200);
    expect(await vatOfQuarter()).toEqual(before);
    const reg = (await accountant.get('/api/tax/registers/purchases-no-vat?from=2026-07-01&to=2026-09-30')).json();
    expect(reg.rows.filter((r: { posting: string }) => r.posting === 'reversal').map((r: Record<string, unknown>) => [r.purchaseClass, r.amountCents])).toEqual([['goods', -300_000], ['services', -200_000]]);
    expect(reg.byClass).toEqual({ capital_goods: 5_000_000, goods: 112_000, services: 80_000 });
    const w = items((await get('2550q')).json());
    expect([w.no_input_goods, w.no_input_services, w.no_input_tax]).toEqual([[112_000, 0], [80_000, 0], [5_192_000, 0]]);
    const slp = (await get('slsp/purchases')).json();
    expect(slp.rows.map((r: { registeredName: string }) => r.registeredName)).not.toContain('Sample Tailor Supplies');
    expect(slp.totals.exemptCents).toBe(5_192_000);
  });

  it('a sale with no VAT still to class is flagged on the worksheet, in neither column', async () => {
    await jvSale('Sale not classed yet', '4101', 50_000, c.other);
    const w = (await get('2550q')).json();
    expect(items(w)).toMatchObject({ zero_rated_sales: [0, 0], exempt_sales: [0, 0], output_tax: [1_000_000, 120_000] });
    expect(w.checks.map((x: { code: string }) => x.code)).toContain('SALES_TO_CLASSIFY');
  });
});
