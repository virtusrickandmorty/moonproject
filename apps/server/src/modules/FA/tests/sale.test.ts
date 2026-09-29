/**
 * Selling a fixed asset (PLAN D5 FA-DISP with INV-REC's VAT, D6 cancel, D7 booklet): the golden worked by hand, its
 * cancel, the tax registers and the booklet, a sale at a gain to a customer, the checks, and a property test.
 *
 * Golden, by hand. A sewing machine is bought on 2026-01-15 for ₱112,000.00 VAT included from a VAT-registered supplier
 * with its invoice, paid from BDO; residual ₱10,000.00, 60 months (machinery's usual life).
 *   cost = 112,000.00 − VAT 12,000.00 (112,000 × 12/112) = 100,000.00
 *   monthly charge = (100,000.00 − 10,000.00) ÷ 60 = 1,500.00; runs January to August = 8 × 1,500.00 = 12,000.00
 *   book value on 2026-09-30 = 100,000.00 − 12,000.00 = 88,000.00 (September is not run: a warning)
 * Sold on 2026-09-30 for ₱33,600.00 VAT included, cash into the cash drawer (1101), invoice no. 0501 to a buyer typed on
 * the sale (Sample Buyer Corp., its address and TIN):
 *   VAT = 33,600.00 × 12/112 = 3,600.00 ; NET = 33,600.00 − 3,600.00 = 30,000.00
 *   loss = book value − NET = 88,000.00 − 30,000.00 = 58,000.00
 *   Dr 1101 cash drawer            33,600.00
 *   Dr 1511 accumulated depr.      12,000.00   (party: the asset)
 *      Cr 1510 machinery                        100,000.00   (party: the asset)
 *      Cr 2301 output VAT                         3,600.00   (party: the buyer, here the sale itself)
 *   Dr 7202 loss on disposal       58,000.00
 *   = 103,600.00 each side.
 * Cancelled on 2026-10-02: the same lines reversed, dated 2026-10-02; the machine is in service again at 88,000.00.
 * The sales register: +30,000.00 / 3,600.00 / 33,600.00 in September, the same negative in October; the booklet shows
 * 0501 used by FAD-000001, cancelled (all copies kept), and the number cannot be used again by any invoice.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import { salesRegister } from '../../TAX/registers.ts';
import { assetRegister, assetsInService } from '../assets.ts';
import { buyDoc } from '../doctypes/buy.ts';
import { depreciationDoc } from '../doctypes/depreciation.ts';
import { disposalDoc, type DisposalInput } from '../doctypes/disposal.ts';

let env: TestEnv;
let acc: Client;
let BDO: number, DRAWER: number, supplierId: string;

const newEnv = async (at: string) => {
  env = await createTestEnv(at);
  acc = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  DRAWER = cashPlaceId(env.db, '1101');
  supplierId = (await acc.post('/api/pur/suppliers', { name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id;
};

const post = (type: string, input: object, expectedTotalCents: number) => acc.post(`/api/docs/fa.${type}/post`, { input, expectedTotalCents }, idem());
const run = async (month: string) => post('depreciation', { month }, (await acc.post('/api/docs/fa.depreciation/preview', { input: { month } })).json().totalCents);
const cancel = (id: string) => acc.post(`/api/docs/fa.disposal/${id}/cancel`, { reason: 'Sale fell through, buyer returned it' }, idem());
const goTo = async (iso: string) => (env.clock.set(iso), (acc = await env.as('accountant')));
/** A journal of a document: [code, party type, party id, debit, credit, date] per line. */
const journalOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db.prepare(`SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`).raw().all(documentId, kind);
const codes = (r: { json(): { details?: { code: string; level: string }[] } }) => (r.json().details ?? []).filter((i) => i.level === 'error').map((i) => i.code);
const registerRow = async (id: string) => ((await acc.get('/api/fa/assets')).json() as { id: string }[]).find((a) => a.id === id);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const registerInvoiceBooklet = async () => {
  await acc.post('/api/auth/step-up', { password: PASSWORD });
  return (await acc.post('/api/tax/booklets', { kind: 'SALES_INVOICE', atpNo: 'OCN 0AU0001234567', serialFrom: 501, serialTo: 550, receivedOn: '2026-01-02' })).json().id as string;
};

const typedBuyer = { buyerName: 'Sample Buyer Corp.', buyerAddress: '123 Sample St., Example City', buyerTin: '555-666-777-000' };
const sale = (assetId: string, extra: Partial<DisposalInput> = {}): DisposalInput => ({
  assetId, kind: 'sale', reason: 'Sold, replaced by a newer machine', ...typedBuyer, invoiceNumber: '0501', priceCents: 3_360_000, cashPlaceId: DRAWER, ...extra,
});

describe('golden: a machine bought in January, depreciated through August, sold on 2026-09-30 for ₱33,600 cash', () => {
  it('posts the sale line by line, shows it in the registers and the booklet, and its cancel mirrors it on the cancel day', async () => {
    await newEnv('2026-01-15T02:00:00Z');
    const booklet = await registerInvoiceBooklet();
    const machine = (await post('buy', {
      classCode: 'machinery', description: 'Industrial sewing machine', supplierId, supplierInvoiceNo: 'SI-1001', supplierInvoiceDate: '2026-01-15',
      amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: BDO, paidCents: 11_200_000,
    }, 11_200_000)).json();
    for (let m = 1; m <= 8; m++) {
      await goTo(`2026-0${m}-25T02:00:00Z`);
      expect((await run(`2026-0${m}`)).json().totalCents).toBe(150_000);
    }
    await goTo('2026-09-30T02:00:00Z');

    const preview = (await acc.post('/api/docs/fa.disposal/preview', { input: sale(machine.id) })).json();
    expect(preview.doc).toMatchObject({
      costCents: 10_000_000, accumulatedCents: 1_200_000, bookValueCents: 8_800_000, proceedsCents: 3_000_000, gainCents: 0, lossCents: 5_800_000, totalCents: 3_360_000,
      sale: { vatRateBp: 1200, grossCents: 3_360_000, vatableSalesCents: 3_000_000, vatCents: 360_000, buyerName: 'Sample Buyer Corp.', buyerTin: '555-666-777-000', cashPlaceName: 'Cash on hand (main cash box)' },
    });
    const fad = await post('disposal', sale(machine.id), 3_360_000);
    expect(fad.statusCode, fad.body).toBe(200);
    const { id } = fad.json();
    expect(fad.json()).toMatchObject({
      number: 'FAD-000001',
      summary: 'This will record invoice no. 0501 selling FA-000001 Industrial sewing machine to Sample Buyer Corp. for ₱33,600.00 (VATable sales ₱30,000.00, VAT ₱3,600.00), '
        + 'paid into Cash on hand (main cash box). Its book value is ₱88,000.00 (cost ₱100,000.00 less ₱12,000.00 accumulated depreciation), so the sale makes a loss of ₱58,000.00.',
    });
    expect(fad.json().warnings.map((w: { code: string }) => w.code)).toEqual(['DEPRECIATION_NOT_RUN']); // September is not run: kept from the retirement
    expect(journalOf(id)).toEqual([
      ['1101', null, null, 3_360_000, 0, '2026-09-30'],
      ['1511', 'asset', machine.id, 1_200_000, 0, '2026-09-30'],
      ['1510', 'asset', machine.id, 0, 10_000_000, '2026-09-30'],
      ['2301', 'customer', id, 0, 360_000, '2026-09-30'],
      ['7202', null, null, 5_800_000, 0, '2026-09-30'],
    ]);
    expect(env.db.prepare('SELECT external_number, total_cents FROM documents WHERE id = ?').raw().get(id)).toEqual(['0501', 3_360_000]);
    expect(await registerRow(machine.id)).toMatchObject({ status: 'disposed', disposal: 'FAD-000001', bookValueCents: 0 });
    expect((await acc.get(`/api/docs/fa.disposal/${id}`)).json().input).toEqual(sale(machine.id));

    // The VAT sales register, the BIR sales book and the SLSP (its own row by TIN, and the tie to revenue).
    const september = (await acc.get('/api/tax/registers/sales?from=2026-09-01&to=2026-09-30')).json();
    expect(september.rows).toEqual([expect.objectContaining({
      docType: 'fa.disposal', documentId: id, documentNumber: 'FAD-000001', formNumber: '0501', posting: 'original', customerId: null,
      customerName: 'Sample Buyer Corp.', tin: '555-666-777-000', netCents: 3_000_000, vatCents: 360_000, totalCents: 3_360_000,
    })]);
    expect([september.totals.vatCents, september.glVatCents]).toEqual([360_000, 360_000]);
    const book = (await acc.get('/api/rpt/bir-books/sales?from=2026-09-01&to=2026-09-30')).json();
    expect(book.pages.flatMap((p: { rows: unknown[] }) => p.rows)).toEqual([expect.objectContaining({
      invoiceNumber: '0501', documentNumber: 'FAD-000001', customer: 'Sample Buyer Corp.', tin: '555-666-777-000', vatableCents: 3_000_000, vatCents: 360_000, totalCents: 3_360_000,
    })]);
    const slsp = (await acc.get('/api/tax/slsp/sales?year=2026&quarter=3')).json();
    expect(slsp.rows).toEqual([expect.objectContaining({ tin: '555-666-777-000', registeredName: 'Sample Buyer Corp.', vatableCents: 3_000_000, outputTaxCents: 360_000 })]);
    expect(slsp.ties.filter((t: { differenceCents: number }) => t.differenceCents !== 0)).toEqual([]);
    noBrokenInvariants();

    // Cancel (D6): a mirror dated the cancel day; the machine is in service again; the number stays used, as cancelled.
    await goTo('2026-10-02T02:00:00Z');
    expect((await cancel(id)).statusCode).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      ['1101', null, null, 0, 3_360_000, '2026-10-02'],
      ['1511', 'asset', machine.id, 0, 1_200_000, '2026-10-02'],
      ['1510', 'asset', machine.id, 10_000_000, 0, '2026-10-02'],
      ['2301', 'customer', id, 360_000, 0, '2026-10-02'],
      ['7202', null, null, 0, 5_800_000, '2026-10-02'],
    ]);
    expect(await registerRow(machine.id)).toMatchObject({ status: 'in service', disposal: null, accumulatedCents: 1_200_000, bookValueCents: 8_800_000 });
    expect(balances(env.db)).toEqual({ '1111': -11_200_000, '1401': 1_200_000, '1510': 10_000_000, '1511': -1_200_000, '5302': 1_200_000 });
    const october = (await acc.get('/api/tax/registers/sales?from=2026-10-01&to=2026-10-31')).json();
    expect(october.rows).toEqual([expect.objectContaining({ documentId: id, posting: 'reversal', documentStatus: 'cancelled', formNumber: '0501', netCents: -3_000_000, vatCents: -360_000, totalCents: -3_360_000 })]);
    expect((await acc.get(`/api/tax/booklets/${booklet}`)).json()).toMatchObject({
      usedCount: 1, cancelledCount: 1, lastUsed: 501, used: [{ n: 501, number: 'FAD-000001', status: 'cancelled', documentId: id, docType: 'fa.disposal' }],
    });
    const again = await post('disposal', sale(machine.id, { invoiceNumber: '501' }), 3_360_000);
    expect(codes(again)).toEqual(['INVOICE_USED']);
    expect(again.json().message).toBe('Invoice no. 501 is already used on FAD-000001 (cancelled). Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.');
    const quick = await acc.post('/api/docs/qs.sale/preview', { input: { customerId: '00000000-0000-4000-8000-000000000001', invoiceNumber: '0501', lines: [{ kind: 'service', description: 'Hem', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] } });
    expect(quick.json().issues.map((i: { code: string }) => i.code)).toContain('INVOICE_USED'); // the quick sale sees the asset sale's number too
    noBrokenInvariants();
  });
});

describe('a sale at a gain, to a customer', () => {
  beforeEach(() => newEnv('2026-09-28T02:00:00Z'));

  it('heat press (G-21 figures) sold for ₱112,000 into BDO: gain 1,500.00 to 7102, output VAT under the customer', async () => {
    // cost 100,000.00, one run of 1,500.00, book value 98,500.00; NET of 112,000.00 = 100,000.00, so a gain of 1,500.00.
    const press = (await post('buy', { classCode: 'machinery', description: 'Heat press', supplierId, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: BDO, paidCents: 11_200_000 }, 11_200_000)).json();
    await run('2026-09');
    const customerId = (await acc.post('/api/cus/customers', { kind: 'organization', displayName: 'Example Garments', registeredName: 'Example Garments Inc.', tin: '111-222-333-000', isVatRegistered: true })).json().id as string;
    const input: DisposalInput = { assetId: press.id, kind: 'sale', reason: 'Sold to another shop', customerId, invoiceNumber: '0777', priceCents: 11_200_000, cashPlaceId: BDO };
    const fad = await post('disposal', input, 11_200_000);
    expect(fad.statusCode, fad.body).toBe(200);
    expect(fad.json().warnings).toEqual([]);
    expect(fad.json().summary).toMatch(/to Example Garments Inc\. for ₱112,000\.00 \(VATable sales ₱100,000\.00, VAT ₱12,000\.00\), paid into .*so the sale makes a gain of ₱1,500\.00\.$/);
    expect(journalOf(fad.json().id)).toEqual([
      ['1111', null, null, 11_200_000, 0, '2026-09-28'],
      ['1511', 'asset', press.id, 150_000, 0, '2026-09-28'],
      ['1510', 'asset', press.id, 0, 10_000_000, '2026-09-28'],
      ['2301', 'customer', customerId, 0, 1_200_000, '2026-09-28'],
      ['7102', null, null, 0, 150_000, '2026-09-28'],
    ]);
    const september = (await acc.get('/api/tax/registers/sales?from=2026-09-01&to=2026-09-30')).json();
    expect(september.rows).toEqual([expect.objectContaining({ customerId, customerName: 'Example Garments Inc.', tin: '111-222-333-000', netCents: 10_000_000, vatCents: 1_200_000 })]);
    const slsp = (await acc.get('/api/tax/slsp/sales?year=2026&quarter=3')).json();
    expect(slsp.ties.filter((t: { differenceCents: number }) => t.differenceCents !== 0)).toEqual([]);
    expect((await acc.get(`/api/docs/fa.disposal/${fad.json().id}`)).json().input).toEqual(input);
    noBrokenInvariants();
  });

  it('checks the buyer, the invoice number, the price and the cash place; a retirement takes none of them', async () => {
    const press = (await post('buy', { classCode: 'machinery', description: 'Heat press', supplierId, amountCents: 11_200_000, residualCents: 0, cashPlaceId: BDO, paidCents: 11_200_000 }, 11_200_000)).json();
    const preview = async (input: DisposalInput) => (await acc.post('/api/docs/fa.disposal/preview', { input })).json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
    expect(await preview(sale(press.id, { customerId: '00000000-0000-4000-8000-000000000001' }))).toEqual(['BUYER']);
    expect(await preview(sale(press.id, { buyerTin: undefined }))).toEqual(['BUYER']);
    expect(await preview(sale(press.id, { cashPlaceId: 999_999 }))).toEqual(['CASH_PLACE']);
    expect(await preview({ assetId: press.id, kind: 'retirement', reason: 'Scrapped', priceCents: 100 })).toEqual(['SALE_ONLY']);
    await registerInvoiceBooklet();
    expect(await preview(sale(press.id, { invoiceNumber: '9001' }))).toEqual(['BOOKLET_UNKNOWN']);
    expect(await preview(sale(press.id))).toEqual([]);
    expect((await acc.post('/api/docs/fa.disposal/preview', { input: { ...sale(press.id), buyerTin: '555' } })).statusCode).toBe(400); // the schema's TIN shape
  });
});

describe('property test (PLAN I1.3)', () => {
  it('every sale journal balances, gain less loss = NET less book value, and cancels put the books back', async () => {
    await newEnv('2026-09-28T02:00:00Z');
    const actor = { userId: acc.userId, permissions: new Set(['buy', 'depr', 'disp'].flatMap((d) => ['create', 'post', 'cancel'].map((a) => `fa.${d}.${a}`))) };
    const e = { db: env.db, clock: env.clock };
    const vat = (g: number) => Math.floor((g * 12 + 56) / 112); // D4.1 at 12%, G > 0
    let month = 2026 * 12 + 9, invoice = 0, sales = 0;
    const step = fc.record({ buy: buyDoc.arbitrary(env.db), run: fc.boolean(), seed: fc.integer(), cancel: fc.boolean() });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 4 }), (steps) => {
        for (const s of steps) {
          month += 1;
          const ym = `${Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, '0')}`;
          env.clock.set(`${ym}-25T02:00:00Z`);
          const bought = s.buy.supplierInvoiceNo ? { ...s.buy, supplierInvoiceNo: `SI-P${month}` } : s.buy;
          postDocument(e, buyDoc, actor, { input: bought, expectedTotalCents: bought.amountCents });
          if (s.run) {
            try {
              postDocument(e, depreciationDoc, actor, { input: { month: ym }, expectedTotalCents: previewDocument(e, depreciationDoc, actor, { month: ym }).totalCents });
            } catch (err) {
              if (!(err instanceof AppError && err.code === 'VALIDATION')) throw err;
            }
          }
          const drawn = fc.sample(disposalDoc.arbitrary(env.db), { numRuns: 1, seed: s.seed })[0]!;
          const input = drawn.kind === 'sale' ? { ...drawn, invoiceNumber: String(++invoice + 1000) } : drawn;
          const a = assetsInService(env.db).find((x) => x.id === input.assetId)!;
          const bookValue = a.costCents - assetRegister(env.db).find((r) => r.id === a.id)!.accumulatedCents;
          const expected = previewDocument(e, disposalDoc, actor, input).totalCents;
          const { id } = postDocument(e, disposalDoc, actor, { input, expectedTotalCents: expected });
          const lines = env.db.prepare(`SELECT a.role_key AS role, l.debit_cents AS dr, l.credit_cents AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id
            JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original'`).all(id) as { role: string | null; dr: number; cr: number }[];
          const sum = (f: (l: (typeof lines)[number]) => number, role?: string) => lines.filter((l) => role === undefined || l.role === role).reduce((n, l) => n + f(l), 0);
          expect(sum((l) => l.dr)).toBe(sum((l) => l.cr));
          const net = input.kind === 'sale' ? input.priceCents! - vat(input.priceCents!) : 0;
          expect(sum((l) => l.cr - l.dr, 'GAIN_ON_DISPOSAL') - sum((l) => l.dr - l.cr, 'LOSS_ON_DISPOSAL')).toBe(net - bookValue);
          if (input.kind === 'sale') {
            sales++;
            expect(sum((l) => l.cr, 'OUTPUT_VAT')).toBe(vat(input.priceCents!));
            expect(expected).toBe(input.priceCents);
          }
          if (s.cancel) cancelDocument(e, disposalDoc, actor, id, 'Recorded in error, undone');
        }
        for (const r of assetRegister(env.db)) {
          if (r.status === 'disposed') expect(r.accumulatedCents + 0).toBe(0); // sold or retired: 15x1 is cleared
          else expect(r.accumulatedCents).toBeLessThanOrEqual(r.costCents - r.residualCents);
        }
        const reg = salesRegister(env.db, '2026-01-01', '2099-12-31');
        expect(reg.totals.vatCents).toBe(reg.glVatCents);
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 20 },
    );
    expect(sales).toBeGreaterThan(0);
  });
});
