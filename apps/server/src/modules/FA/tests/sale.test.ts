/**
 * Selling a fixed asset (PLAN D5 FA-DISP with INV-REC, D6, D7): the golden worked by hand, its cancel mirror, the VAT
 * sales register row, the booklet and the BIR sales book; a sale at a gain to a customer picked; the booklet number
 * used once, ever, across the IR- series; retirements unchanged; and a property test over random sales.
 *
 * Golden, worked by hand. A machine bought 2026-01-15 for ₱112,000.00 VAT included from a VAT-registered supplier:
 *   VAT 112,000 × 12/112 = 12,000.00, so the cost is ₱100,000.00; no residual; 60 months.
 *   A month's charge is 100,000 ÷ 60 = 1,666.666…; after n months the accumulated depreciation is 100,000 × n ÷ 60,
 *   rounded to the centavo. Depreciation run for January to August (8 months): 100,000 × 8 ÷ 60 = ₱13,333.33.
 *   Book value on 2026-09-30 (September not run): 100,000.00 − 13,333.33 = ₱86,666.67.
 * Sold 2026-09-30 for ₱33,600.00 cash into the cash drawer (1101), invoice no. 0521 to a buyer typed on the form:
 *   VAT = 33,600 × 12/112 = ₱3,600.00; NET = 33,600.00 − 3,600.00 = ₱30,000.00.
 *   NET less book value = 30,000.00 − 86,666.67 = −56,666.67: a loss of ₱56,666.67.
 *     Dr 1101 Cash on hand            33,600.00
 *     Dr 1511 Accum. depr. machinery  13,333.33
 *     Dr 7202 Loss on disposal        56,666.67
 *        Cr 1510 Machinery                        100,000.00
 *        Cr 2301 Output VAT                         3,600.00
 *   Debits 103,600.00 = credits 103,600.00. September's ₱1,666.67 is not charged: the sale warns.
 * Cancel on 2026-10-05: the mirror of those five lines dated 2026-10-05; the machine is in service again at 13,333.33
 * accumulated; invoice no. 0521 stays used, shown as cancelled in the booklet, and no sale may take it again.
 * Sales register: 2026-09-30 VATable 30,000.00, VAT 3,600.00, total 33,600.00; 2026-10-05 the same, negative.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError, vatFromGross } from '@moonproject/shared';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { slspSales } from '../../TAX/slsp.ts';
import { accumulatedCents, assetsInService } from '../assets.ts';
import { buyDoc } from '../doctypes/buy.ts';
import { depreciationDoc } from '../doctypes/depreciation.ts';
import { disposalDoc, type DisposalInput } from '../doctypes/disposal.ts';

let env: TestEnv;
let acc: Client;
let CASH: number, BDO: number, supplierId: string;

beforeEach(async () => {
  env = await createTestEnv('2026-01-15T02:00:00Z');
  acc = await env.as('accountant');
  CASH = cashPlaceId(env.db, '1101');
  BDO = cashPlaceId(env.db, '1111');
  supplierId = (await acc.post('/api/pur/suppliers', { name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id;
});

const post = (type: string, input: object, expectedTotalCents: number) => acc.post(`/api/docs/fa.${type}/post`, { input, expectedTotalCents }, idem());
const run = async (month: string) => post('depreciation', { month }, (await acc.post('/api/docs/fa.depreciation/preview', { input: { month } })).json().totalCents);
const cancel = (type: string, id: string) => acc.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake, redo' }, idem());
/** Moves the clock; yesterday's session has timed out. */
const goTo = async (iso: string) => (env.clock.set(iso), (acc = await env.as('accountant')));
const journalOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db.prepare(`SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`).raw().all(documentId, kind);
const dateOf = (documentId: string, kind: 'original' | 'reversal') =>
  env.db.prepare('SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = ?').pluck().get(documentId, kind);
const codes = (r: { json(): { details?: { code: string; level: string }[] } }, level = 'error') => (r.json().details ?? []).filter((i) => i.level === level).map((i) => i.code);
const errorCodes = (r: { json(): { details?: { code: string; level: string }[] } }) => codes(r);
const registerRow = async (id: string) => ((await acc.get('/api/fa/assets')).json() as { id: string }[]).find((a) => a.id === id);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

/** The golden machine, bought 2026-01-15, depreciated January to August (each run in its month). */
async function machine() {
  const res = await post('buy', {
    classCode: 'machinery', description: 'Industrial sewing machine', supplierId, supplierInvoiceNo: 'SI-0115', supplierInvoiceDate: '2026-01-15',
    amountCents: 11_200_000, residualCents: 0, cashPlaceId: BDO, paidCents: 11_200_000,
  }, 11_200_000);
  expect(res.statusCode, res.body).toBe(200);
  for (let m = 1; m <= 8; m++) {
    const month = `2026-${String(m).padStart(2, '0')}`;
    await goTo(`${month}-25T02:00:00Z`);
    expect((await run(month)).statusCode).toBe(200);
  }
  return res.json().id as string;
}
/** The shop's sales invoice booklet, 501 to 550 (the accountant, with a fresh password). */
async function booklet() {
  await acc.post('/api/auth/step-up', { password: PASSWORD });
  const b = await acc.post('/api/tax/booklets', { kind: 'SALES_INVOICE', atpNo: 'OCN 0AU0001234567', serialFrom: 501, serialTo: 550, receivedOn: '2026-08-01' });
  expect(b.statusCode, b.body).toBe(200);
  return b.json().id as string;
}
const typedBuyer = { buyerName: 'Sample Tailoring Shop', buyerAddress: '12 Sample Street, Made-up City', buyerTin: '987-654-321-000' };
const sale = (assetId: string, more: object = {}) => ({
  assetId, kind: 'sale', reason: 'Sold to another shop', invoiceNumber: '0521', amountCents: 3_360_000, cashPlaceId: CASH, ...typedBuyer, ...more,
});

describe('golden: a machine sold at a loss, worked by hand (see the top of this file)', () => {
  it('posts the journal line by line, warns September is not run, then shows in the register, the booklet and the sales book', async () => {
    const id = await machine();
    expect(await registerRow(id)).toMatchObject({ costCents: 10_000_000, accumulatedCents: 1_333_333, bookValueCents: 8_666_667 });
    await goTo('2026-09-30T02:00:00Z');
    const bookletId = await booklet();

    const pre = (await acc.post('/api/docs/fa.disposal/preview', { input: sale(id) })).json();
    expect(pre.doc).toMatchObject({
      costCents: 10_000_000, accumulatedCents: 1_333_333, bookValueCents: 8_666_667, proceedsCents: 3_000_000, gainCents: 0, lossCents: 5_666_667, totalCents: 3_360_000,
      sale: { grossCents: 3_360_000, vatRateBp: 1200, vatCents: 360_000, vatableSalesCents: 3_000_000, buyerName: 'Sample Tailoring Shop', buyerTin: '987-654-321-000', cashPlaceName: 'Cash on hand (main cash box)' },
    });
    expect(pre.summary).toBe('This will record invoice no. 0521 to Sample Tailoring Shop for FA-000001 Industrial sewing machine: ₱33,600.00 into Cash on hand (main cash box) '
      + '(VATable sales ₱30,000.00, VAT ₱3,600.00). Its book value is ₱86,666.67 (cost ₱100,000.00 less ₱13,333.33 accumulated depreciation), so a loss of ₱56,666.67.');

    const res = await post('disposal', sale(id), 3_360_000);
    expect(res.statusCode, res.body).toBe(200);
    const fad = res.json();
    expect(fad.number).toBe('FAD-000001');
    expect(fad.warnings).toEqual([expect.objectContaining({
      code: 'DEPRECIATION_NOT_RUN', message: 'Depreciation of FA-000001 up to September 2026 is not all recorded (₱1,666.67 still to charge). Run it first, so the book value is up to date.',
    })]);
    expect(journalOf(fad.id)).toEqual([
      ['1101', null, null, 3_360_000, 0],
      ['1511', 'asset', id, 1_333_333, 0],
      ['7202', null, null, 5_666_667, 0],
      ['1510', 'asset', id, 0, 10_000_000],
      ['2301', 'customer', fad.id, 0, 360_000], // a typed buyer: 2301 names the sale
    ]);
    expect(dateOf(fad.id, 'original')).toBe('2026-09-30');
    expect(env.db.prepare('SELECT external_number FROM documents WHERE id = ?').pluck().get(fad.id)).toBe('0521');
    expect(await registerRow(id)).toMatchObject({ status: 'disposed', disposal: 'FAD-000001', bookValueCents: 0 });
    expect((await acc.get(`/api/docs/fa.disposal/${fad.id}`)).json().input).toEqual(sale(id));
    expect(errorCodes(await run('2026-09'))).toEqual(['NOTHING_TO_CHARGE']); // the machine is off the books

    const register = (await acc.get('/api/tax/registers/sales?from=2026-09-01&to=2026-09-30')).json();
    expect(register.rows).toEqual([expect.objectContaining({
      date: '2026-09-30', posting: 'original', docType: 'fa.disposal', documentId: fad.id, documentNumber: 'FAD-000001', formNumber: '0521',
      customerName: 'Sample Tailoring Shop', tin: '987-654-321-000', netCents: 3_000_000, vatCents: 360_000, totalCents: 3_360_000,
    })]);
    expect(register.glVatCents).toBe(360_000);
    const book = (await acc.get('/api/rpt/bir-books/sales?from=2026-09-01&to=2026-09-30')).json();
    expect(book.pages[0].rows).toEqual([expect.objectContaining({ invoiceNumber: '0521', documentNumber: 'FAD-000001', customer: 'Sample Tailoring Shop', tin: '987-654-321-000', vatableCents: 3_000_000, vatCents: 360_000, totalCents: 3_360_000 })]);
    // The SLSP gives the typed buyer its own row by TIN, and still ties to the books (only the loss is off revenue).
    const slsp = slspSales(env.db, 2026, 3, '2026-10-20');
    expect(slsp.rows).toEqual([expect.objectContaining({ tin: '987-654-321-000', registeredName: 'Sample Tailoring Shop', vatableCents: 3_000_000, outputTaxCents: 360_000 })]);
    expect(slsp.ties.filter((t) => t.differenceCents !== 0)).toEqual([]);
    expect((await acc.get(`/api/tax/booklets/${bookletId}`)).json()).toMatchObject({
      usedCount: 1, cancelledCount: 0, lastUsed: 521, skippedCount: 20,
      used: [{ n: 521, number: 'FAD-000001', status: 'posted', documentId: fad.id, docType: 'fa.disposal' }],
    });
    noBrokenInvariants();

    // Cancel on 2026-10-05 (D6): the mirror dated today, the machine in service again, the number kept as cancelled.
    await goTo('2026-10-05T02:00:00Z');
    expect((await cancel('fa.disposal', fad.id)).statusCode).toBe(200);
    expect(dateOf(fad.id, 'reversal')).toBe('2026-10-05');
    expect(journalOf(fad.id, 'reversal')).toEqual([
      ['1101', null, null, 0, 3_360_000],
      ['1511', 'asset', id, 0, 1_333_333],
      ['7202', null, null, 0, 5_666_667],
      ['1510', 'asset', id, 10_000_000, 0],
      ['2301', 'customer', fad.id, 360_000, 0],
    ]);
    expect(await registerRow(id)).toMatchObject({ status: 'in service', accumulatedCents: 1_333_333, bookValueCents: 8_666_667, disposal: null });
    expect(balances(env.db)).toMatchObject({ '1510': 10_000_000, '1511': -1_333_333 });
    const both = (await acc.get('/api/tax/registers/sales?from=2026-09-01&to=2026-10-31')).json();
    expect(both.rows.map((r: { date: string; posting: string; netCents: number; vatCents: number; totalCents: number; documentStatus: string }) =>
      [r.date, r.posting, r.documentStatus, r.netCents, r.vatCents, r.totalCents])).toEqual([
      ['2026-09-30', 'original', 'cancelled', 3_000_000, 360_000, 3_360_000],
      ['2026-10-05', 'reversal', 'cancelled', -3_000_000, -360_000, -3_360_000],
    ]);
    expect(both.totals).toEqual({ netCents: 0, vatCents: 0, totalCents: 0 });
    expect((await acc.get(`/api/tax/booklets/${bookletId}`)).json()).toMatchObject({ usedCount: 1, cancelledCount: 1, used: [{ n: 521, number: 'FAD-000001', status: 'cancelled' }] });
    // Invoice no. 0521 is used once, ever: not by a new sale of the machine, nor by a quick sale (the shared IR- series).
    const again = await post('disposal', sale(id), 3_360_000);
    expect(codes(again)).toEqual(['INVOICE_USED']);
    expect(again.json().details.find((i: { code: string }) => i.code === 'INVOICE_USED').message).toBe('Invoice no. 0521 is already used on FAD-000001 (cancelled). Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.');
    noBrokenInvariants();
  });
});
describe('a sale at a gain, and the checks', () => {
  it('a customer picked: Cr 7102 the gain, 2301 names the customer; the booklet number is shared with quick sales', async () => {
    const id = await machine();
    await goTo('2026-08-31T02:00:00Z');
    const c = seedCustomers(env.db, acc.userId);
    env.db.prepare(`UPDATE cus_customers SET registered_name = 'Made-up School Foundation, Inc.', tin = '111-222-333-00000' WHERE id = ?`).run(c.school);
    await booklet();
    // ₱100,800.00 by bank transfer: VAT 10,800.00, NET 90,000.00; book value 86,666.67; gain 3,333.33.
    const res = await post('disposal', { assetId: id, kind: 'sale', reason: 'Sold to the school workshop', invoiceNumber: '522', amountCents: 10_080_000, cashPlaceId: BDO, customerId: c.school }, 10_080_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().warnings).toEqual([]); // August is run
    expect(journalOf(res.json().id)).toEqual([
      ['1111', null, null, 10_080_000, 0],
      ['1511', 'asset', id, 1_333_333, 0],
      ['1510', 'asset', id, 0, 10_000_000],
      ['2301', 'customer', c.school, 0, 1_080_000],
      ['7102', null, null, 0, 333_333],
    ]);
    expect(res.json().summary).toMatch(/to Made-up School Foundation, Inc\. .* so a gain of ₱3,333\.33\.$/);
    const row = (await acc.get('/api/tax/registers/sales?from=2026-08-01&to=2026-08-31')).json().rows[0];
    expect(row).toMatchObject({ customerId: c.school, customerName: 'Made-up School Foundation, Inc.', tin: '111-222-333-00000', netCents: 9_000_000, vatCents: 1_080_000, totalCents: 10_080_000 });
    expect(slspSales(env.db, 2026, 3, '2026-10-20').ties.filter((t) => t.differenceCents !== 0)).toEqual([]);
    // A quick sale may not take invoice no. 522 (JO invoiceNumberUsedBy reads asset sales).
    const quick = await acc.post('/api/qs/sales', {
      sale: { customerId: c.school, invoiceNumber: '0522', lines: [{ kind: 'service', description: 'Hemming', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] },
      payment: { crNumber: '0701', tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] }, expectedTotalCents: 35_000,
    }, idem());
    expect(JSON.stringify(quick.json())).toContain('Invoice no. 0522 is already used on FAD-000001');
    // The purchase waits for the sale, the sale's cancel puts it back.
    expect((await cancel('fa.buy', id)).json().message).toMatch(/FAD-000001/);
    noBrokenInvariants();
  });

  it('refuses a sale with missing or wrong details, a number outside the booklet, and a retirement with sale details', async () => {
    const id = await machine();
    await goTo('2026-08-31T02:00:00Z');
    await booklet();
    const bad = async (more: object) => codes(await post('disposal', { ...sale(id), ...more }, 3_360_000));
    expect(await bad({ invoiceNumber: '0600' })).toEqual(['BOOKLET_UNKNOWN']);
    expect(await bad({ cashPlaceId: undefined })).toEqual(['CASH_PLACE']);
    expect(await bad({ buyerName: undefined, buyerTin: undefined })).toEqual(['BUYER']);
    expect(await bad({ customerId: '00000000-0000-4000-8000-000000000000' })).toEqual(['CUSTOMER', 'BUYER']);
    expect((await post('disposal', { ...sale(id), buyerTin: '12345' }, 3_360_000)).statusCode).toBe(400);
    expect(codes(await post('disposal', { ...sale(id), kind: 'retirement' }, 10_000_000))).toEqual(['NOT_A_SALE']);
    const noTin = await post('disposal', { ...sale(id), buyerTin: undefined }, 3_360_000);
    expect(noTin.statusCode, noTin.body).toBe(200);
    expect(noTin.json().warnings.map((w: { code: string }) => w.code)).toEqual(['NO_TIN']);
  });

  it('a retirement is unchanged: book value to 7202, no invoice, not in the sales register or the sales book', async () => {
    const id = await machine();
    await goTo('2026-08-31T02:00:00Z');
    const res = await post('disposal', { assetId: id, kind: 'retirement', reason: 'Motor burned out, scrapped' }, 10_000_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ totalCents: 10_000_000, warnings: [], summary: 'This will retire FA-000001 Industrial sewing machine: cost ₱100,000.00 less ₱13,333.33 accumulated depreciation, a loss of ₱86,666.67 (its book value).' });
    expect(journalOf(res.json().id)).toEqual([['1511', 'asset', id, 1_333_333, 0], ['7202', null, null, 8_666_667, 0], ['1510', 'asset', id, 0, 10_000_000]]);
    expect(env.db.prepare('SELECT kind, proceeds_cents FROM fa_disposals WHERE document_id = ?').raw().get(res.json().id)).toEqual(['retirement', 0]);
    expect(env.db.prepare('SELECT external_number FROM documents WHERE id = ?').pluck().get(res.json().id)).toBeNull();
    expect((await acc.get('/api/tax/registers/sales?from=2026-01-01&to=2026-12-31')).json().rows).toEqual([]);
    expect((await acc.get('/api/rpt/bir-books/sales?from=2026-01-01&to=2026-12-31')).json().pages[0].rows).toEqual([]);
    // A retirement in a month not yet run warns too.
    await goTo('2026-09-10T02:00:00Z');
    expect((await cancel('fa.disposal', res.json().id)).statusCode).toBe(200);
    const late = await post('disposal', { assetId: id, kind: 'retirement', reason: 'Motor burned out, scrapped' }, 10_000_000);
    expect(codes(late, 'warning')).toEqual([]); // warnings come back on success, not as details
    expect(late.json().warnings.map((w: { code: string }) => w.code)).toEqual(['DEPRECIATION_NOT_RUN']);
    noBrokenInvariants();
  });
});

describe('property test (PLAN I1.3)', () => {
  it('every random sale balances, and gain less loss equals NET less book value; cancels undo it', () => {
    const actor = { userId: acc.userId, permissions: new Set(['buy', 'depr', 'disp'].flatMap((d) => ['create', 'post', 'cancel'].map((a) => `fa.${d}.${a}`))) };
    const e = { db: env.db, clock: env.clock };
    let month = 2026 * 12 + 1; // months since year 0; the clock only moves forward, a month per case
    let invoice = 0;
    let supplierInvoice = 0;
    const journal = (id: string) => env.db.prepare(`SELECT a.role_key AS role, a.is_cash_place AS cash, l.debit_cents AS dr, l.credit_cents AS cr FROM journal_lines l
      JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original'`).all(id) as { role: string | null; cash: number; dr: number; cr: number }[];
    const step = fc.record({
      buys: fc.array(buyDoc.arbitrary(env.db), { minLength: 1, maxLength: 2 }), run: fc.boolean(), pick: fc.nat(),
      amountCents: fc.integer({ min: 100, max: 5_000_000_00 }), tin: fc.boolean(), undo: fc.boolean(),
    });
    fc.assert(
      fc.property(step, ({ buys, run, pick, amountCents, tin, undo }) => {
        month += 1;
        const ym = `${Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, '0')}`;
        env.clock.set(`${ym}-25T02:00:00Z`);
        for (const b of buys) {
          const input = b.supplierInvoiceNo ? { ...b, supplierInvoiceNo: `SI-P${++supplierInvoice}` } : b;
          postDocument(e, buyDoc, actor, { input, expectedTotalCents: input.amountCents });
        }
        if (run) {
          try {
            postDocument(e, depreciationDoc, actor, { input: { month: ym }, expectedTotalCents: previewDocument(e, depreciationDoc, actor, { month: ym }).totalCents });
          } catch (err) {
            if (!(err instanceof AppError && err.code === 'VALIDATION')) throw err;
          }
        }
        const inService = assetsInService(env.db);
        const a = inService[pick % inService.length]!;
        const bookValueCents = a.costCents - accumulatedCents(env.db, a); // from the ledger, before the sale
        const s: DisposalInput = {
          assetId: a.id, kind: 'sale', reason: 'Sold to another shop', invoiceNumber: String(++invoice), amountCents, cashPlaceId: BDO,
          buyerName: 'Sample Buyer Trading', ...(tin ? { buyerTin: '123-456-789-000' } : {}),
        };
        const pre = previewDocument(e, disposalDoc, actor, s);
        const posted = postDocument(e, disposalDoc, actor, { input: s, expectedTotalCents: pre.totalCents });
        const lines = journal(posted.id);
        const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((n, l) => n + f(l), 0);
        expect(sum((l) => l.dr)).toBe(sum((l) => l.cr));
        const gain = sum((l) => (l.role === 'GAIN_ON_DISPOSAL' ? l.cr - l.dr : 0));
        const loss = sum((l) => (l.role === 'LOSS_ON_DISPOSAL' ? l.dr - l.cr : 0));
        const vat = sum((l) => (l.role === 'OUTPUT_VAT' ? l.cr - l.dr : 0));
        expect(sum((l) => (l.cash ? l.dr - l.cr : 0))).toBe(amountCents);
        expect(vat).toBe(vatFromGross(amountCents, 1200).vatCents);
        expect(gain - loss).toBe(amountCents - vat - bookValueCents);
        expect(gain === 0 || loss === 0).toBe(true);
        expect(assetsInService(env.db).some((x) => x.id === a.id)).toBe(false);
        if (undo) {
          cancelDocument(e, disposalDoc, actor, posted.id, 'Recorded in error, undone');
          expect(assetsInService(env.db).some((x) => x.id === a.id)).toBe(true);
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 30 },
    );
    // The arbitrary sells or retires what is in service, and a used number is refused, never posted twice.
    const s = fc.sample(disposalDoc.arbitrary(env.db), 5);
    for (const input of s) {
      const again = input.kind === 'sale' ? { ...input, invoiceNumber: '1' } : input;
      try {
        postDocument(e, disposalDoc, actor, { input: again, expectedTotalCents: previewDocument(e, disposalDoc, actor, again).totalCents });
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'VALIDATION')) throw err;
      }
    }
    expect(env.db.prepare('SELECT COUNT(*) FROM fa_asset_sales WHERE CAST(invoice_number AS INTEGER) = 1').pluck().get()).toBe(1);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
