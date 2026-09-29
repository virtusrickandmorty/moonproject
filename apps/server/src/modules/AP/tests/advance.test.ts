/**
 * Supplier advances (PLAN D5 SUP-ADV): goldens (a goods advance with no EWT applied to one bill; a service advance with
 * EWT applied over two bills with no double EWT, counted in the advance's month; a partial return), the refusals, the
 * D6 cancel order, and a property test over advances, bills, payments, returns and cancels.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { advanceDoc, type AdvanceInput } from '../doctypes/advance.ts';
import { advanceReturnDoc, type AdvanceReturnInput } from '../doctypes/advance-return.ts';
import { billDoc, type BillInput } from '../doctypes/bill.ts';
import { paymentDoc } from '../doctypes/payment.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number, GCASH: number;
let fabric: string, printer: string, tailor: string, cloth: string;

const newSupplier = async (s: { name: string; tin?: string; isVatRegistered?: boolean; ewtClass?: string; paymentTermsDays?: number }) =>
  (await accountant.post('/api/pur/suppliers', { registeredName: `${s.name} Inc.`, isVatRegistered: false, ...s })).json().id as string;

async function setUp(at?: string) {
  env = await createTestEnv(at);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  GCASH = cashPlaceId(env.db, '1121');
  fabric = await newSupplier({ name: 'Sample Fabric Trading', tin: '111-222-333-000', isVatRegistered: true, ewtClass: 'goods_1', paymentTermsDays: 30 });
  printer = await newSupplier({ name: 'Sample Print Shop', tin: '333-444-555-000', isVatRegistered: true, ewtClass: 'contractor_2' });
  tailor = await newSupplier({ name: 'Sample Tailoring Shop', tin: '222-333-444-000', ewtClass: 'contractor_2' });
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
}

const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
const advance = (c: Client, input: AdvanceInput) => c.post('/api/docs/ap.advance/post', { input, expectedTotalCents: input.amountCents }, idem());
const bill = (c: Client, input: BillInput) => c.post('/api/docs/ap.bill/post', { input, expectedTotalCents: sum(input.lines) }, idem());
const giveBack = (c: Client, input: AdvanceReturnInput) => c.post('/api/docs/ap.advance_return/post', { input, expectedTotalCents: sum(input.tenders) }, idem());
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake today' }, idem());
const codes = (r: { json(): { details?: { code: string }[] } }) => (r.json().details ?? []).map((i) => i.code);
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const subcontract = (supplierId: string, no: string, amountCents: number, over: Partial<BillInput> = {}): BillInput =>
  ({ supplierId, supplierInvoiceNo: no, supplierInvoiceDate: '2026-09-28', lines: [{ purchase: 'subcontract', amountCents }], ...over });

describe('goods advance with no EWT, applied to one bill (PLAN D5 SUP-ADV)', () => {
  beforeEach(() => setUp());

  it('₱5,000 down on a purchase order; the ₱11,200 fabric bill takes it, ₱6,200 is left to pay', async () => {
    const po = await encoder.post('/api/docs/pur.po/post', { input: { supplierId: fabric, lines: [{ supplyId: cloth, qty: 50, unitCostCents: 22_400 }] }, expectedTotalCents: 1_120_000 }, idem());
    const input: AdvanceInput = { supplierId: fabric, purchaseOrderId: po.json().id, amountCents: 500_000, tenders: [{ cashPlaceId: BDO, amountCents: 500_000, reference: 'CHK-2001' }] };
    const a = await advance(encoder, input);
    expect(a.json()).toMatchObject({
      number: 'SADV-000001', totalCents: 500_000, warnings: [],
      summary: 'This will record an advance of ₱5,000.00 to Sample Fabric Trading on PO-000001: ₱5,000.00 from Cash in bank – BDO.',
    });
    const advId = a.json().id as string;
    expect(journalOf(advId)).toEqual([['1230', fabric, advId, 500_000, 0], ['1111', null, null, 0, 500_000]]);

    const pre = await encoder.post('/api/docs/ap.bill/preview', { input: { supplierId: fabric, supplierInvoiceNo: 'SI-7788', supplierInvoiceDate: '2026-09-25', lines: [{ supplyId: cloth, amountCents: 1_120_000 }] } });
    expect(pre.json().summary).toBe('This will record ₱11,200.00 billed by Sample Fabric Trading on invoice no. SI-7788 of 2026-09-25 with ₱1,200.00 input VAT; ₱5,000.00 of SADV-000001 is applied, so ₱6,200.00 is still owed, due 2026-10-25.');
    expect(pre.json().doc).toMatchObject({ advances: [{ advanceId: advId, advanceNumber: 'SADV-000001', amountCents: 500_000, coveredBaseCents: 0 }], advanceCents: 500_000, owedCents: 620_000, ewtCents: 0 });
    const b = await bill(encoder, { supplierId: fabric, supplierInvoiceNo: 'SI-7788', supplierInvoiceDate: '2026-09-25', lines: [{ supplyId: cloth, amountCents: 1_120_000 }] });
    const billId = b.json().id as string;
    expect(journalOf(billId)).toEqual([
      ['5101', null, null, 1_000_000, 0],
      ['1401', fabric, null, 120_000, 0],
      ['2101', fabric, billId, 0, 1_120_000],
      ['2101', fabric, billId, 500_000, 0],
      ['1230', fabric, advId, 0, 500_000],
    ]);
    expect(balances(env.db)).toEqual({ '5101': 1_000_000, '1401': 120_000, '2101': -620_000, '1111': -500_000 });
    expect((await encoder.get(`/api/docs/ap.bill/${billId}`)).json().input.advances).toEqual([{ advanceId: advId, amountCents: 500_000 }]);

    const ap = (await encoder.get(`/api/ap/suppliers/${fabric}`)).json();
    expect(ap).toMatchObject({ balanceCents: 620_000, advancesCents: 0 });
    expect(ap.bills).toMatchObject([{ number: 'BILL-000001', payableCents: 1_120_000, advanceCents: 500_000, paidCents: 0, owedCents: 620_000, advances: [{ advanceNumber: 'SADV-000001', amountCents: 500_000 }] }]);
    expect(ap.advances).toMatchObject([{ number: 'SADV-000001', purchaseOrderNumber: 'PO-000001', amountCents: 500_000, appliedCents: 500_000, returnedCents: 0, openCents: 0, bills: [{ billNumber: 'BILL-000001', amountCents: 500_000 }] }]);

    // A payment pays what is left, never the advance again.
    const over = await encoder.post('/api/docs/ap.payment/post', { input: { supplierId: fabric, bills: [{ billId, amountCents: 620_001 }], tenders: [{ cashPlaceId: BDO, amountCents: 620_001 }] }, expectedTotalCents: 620_001 }, idem());
    expect(codes(over)).toEqual(['MORE_THAN_OWED']);
    await encoder.post('/api/docs/ap.payment/post', { input: { supplierId: fabric, bills: [{ billId, amountCents: 620_000 }], tenders: [{ cashPlaceId: BDO, amountCents: 620_000 }] }, expectedTotalCents: 620_000 }, idem());
    expect((await encoder.get(`/api/ap/suppliers/${fabric}`)).json().bills).toMatchObject([{ advanceCents: 500_000, paidCents: 620_000, owedCents: 0 }]);
    expect((await encoder.get('/api/ap/suppliers')).json()).toEqual([]);
    noBrokenInvariants();
  });

  it('an advance still open shows on AP by supplier; a bill may leave it for later', async () => {
    const advId = (await advance(encoder, { supplierId: fabric, amountCents: 300_000, tenders: [{ cashPlaceId: GCASH, amountCents: 300_000 }] })).json().id as string;
    expect((await encoder.get('/api/ap/suppliers')).json()).toEqual([{ supplierId: fabric, supplierName: 'Sample Fabric Trading', balanceCents: 0, advancesCents: 300_000, netCents: -300_000 }]);
    const b = await bill(encoder, { supplierId: fabric, supplierInvoiceNo: 'SI-1', supplierInvoiceDate: '2026-09-28', lines: [{ supplyId: cloth, amountCents: 112_000 }], advances: [] });
    expect((journalOf(b.json().id) as unknown[][]).map((l) => l[0])).toEqual(['5101', '1401', '2101']);
    expect((await encoder.get('/api/ap/suppliers')).json()).toEqual([{ supplierId: fabric, supplierName: 'Sample Fabric Trading', balanceCents: 112_000, advancesCents: 300_000, netCents: -188_000 }]);
    // Named: part of it, the rest stays open for the next bill.
    const part = await bill(encoder, { supplierId: fabric, supplierInvoiceNo: 'SI-2', supplierInvoiceDate: '2026-09-28', lines: [{ supplyId: cloth, amountCents: 224_000 }], advances: [{ advanceId: advId, amountCents: 100_000 }] });
    expect(part.json().summary).toContain('₱1,000.00 of SADV-000001 is applied, so ₱1,240.00 is still owed');
    expect((await encoder.get(`/api/ap/suppliers/${fabric}`)).json()).toMatchObject({ balanceCents: 236_000, advancesCents: 200_000, advances: [{ openCents: 200_000 }] });
    noBrokenInvariants();
  });
});

describe('service advance with EWT applied over two bills (EWT on payment or accrual, whichever first)', () => {
  beforeEach(() => setUp('2026-08-20T02:00:00Z'));

  it('₱11,200 to a VAT printer withholds 2% on ₱10,000 in August; its two bills leave that base out, so EWT is never withheld twice', async () => {
    const a = await advance(encoder, { supplierId: printer, amountCents: 1_120_000, tenders: [{ cashPlaceId: BDO, amountCents: 1_000_000 }, { cashPlaceId: GCASH, amountCents: 100_000 }] });
    expect(a.json()).toMatchObject({
      number: 'SADV-000001', businessDate: '2026-08-20',
      summary: 'This will record an advance of ₱11,200.00 to Sample Print Shop; ₱200.00 is withheld now (EWT 2%), so ₱11,000.00 is paid out: ₱10,000.00 from Cash in bank – BDO and ₱1,000.00 from E-wallet – GCash.',
    });
    const advId = a.json().id as string;
    expect(journalOf(advId)).toEqual([['1230', printer, advId, 1_120_000, 0], ['2311', printer, null, 0, 20_000], ['1111', null, null, 0, 1_000_000], ['1121', null, null, 0, 100_000]]);
    expect(codes(await advance(encoder, { supplierId: printer, amountCents: 1_120_000, tenders: [{ cashPlaceId: BDO, amountCents: 1_120_000 }] }))).toEqual(['TENDERS']);

    env.clock.set('2026-09-28T02:00:00Z');
    encoder = await env.as('encoder');
    accountant = await env.as('accountant');
    // Bill 1, ₱6,720 (net ₱6,000): the advance covers all of it, so no EWT and nothing owed.
    const one = await bill(encoder, subcontract(printer, 'P-101', 672_000));
    const oneId = one.json().id as string;
    expect(journalOf(oneId)).toEqual([
      ['5301', null, null, 600_000, 0],
      ['1401', printer, null, 72_000, 0],
      ['2101', printer, oneId, 0, 672_000],
      ['2101', printer, oneId, 672_000, 0],
      ['1230', printer, advId, 0, 672_000],
    ]);
    // Bill 2, ₱8,960 (net ₱8,000): ₱4,480 of the advance is left (base ₱4,000 already withheld on); EWT on ₱4,000 more.
    const two = await bill(encoder, subcontract(printer, 'P-102', 896_000));
    expect(two.json().summary).toBe('This will record ₱8,960.00 billed by Sample Print Shop on invoice no. P-102 of 2026-09-28 with ₱960.00 input VAT; ₱80.00 is withheld (EWT 2%), so ₱8,880.00 is owed; ₱4,480.00 of SADV-000001 is applied, so ₱4,400.00 is still owed, due 2026-09-28.');
    const twoId = two.json().id as string;
    expect(journalOf(twoId)).toEqual([
      ['5301', null, null, 800_000, 0],
      ['1401', printer, null, 96_000, 0],
      ['2311', printer, null, 0, 8_000],
      ['2101', printer, twoId, 0, 888_000],
      ['2101', printer, twoId, 448_000, 0],
      ['1230', printer, advId, 0, 448_000],
    ]);
    // 2% of the ₱14,000 net billed, once: ₱200 with the advance and ₱80 with the second bill.
    expect(balances(env.db)).toEqual({ '5301': 1_400_000, '1401': 168_000, '2311': -28_000, '2101': -440_000, '1111': -1_000_000, '1121': -100_000 });

    const ewt = (await accountant.get('/api/tax/registers/ewt?from=2026-08-01&to=2026-09-30')).json();
    expect(ewt.rows.map((r: Record<string, unknown>) => [r.date, r.documentNumber, r.docType, r.ewtClass, r.baseCents, r.rateBp, r.ewtCents])).toEqual([
      ['2026-08-20', 'SADV-000001', 'ap.advance', 'contractor_2', 1_000_000, 200, 20_000],
      ['2026-09-28', 'BILL-000002', 'ap.bill', 'contractor_2', 400_000, 200, 8_000],
    ]);
    expect(ewt).toMatchObject({ totals: { baseCents: 1_400_000, ewtCents: 28_000 }, glEwtCents: 28_000 });
    const certs = (await accountant.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json();
    expect(certs.lines).toMatchObject([{
      supplierId: printer, ewtClass: 'contractor_2', rateBp: 200, baseCents: 1_400_000, ewtCents: 28_000,
      months: [{ month: '2026-07', ewtCents: 0 }, { month: '2026-08', baseCents: 1_000_000, ewtCents: 20_000 }, { month: '2026-09', baseCents: 400_000, ewtCents: 8_000 }],
    }]);
    expect((await accountant.get('/api/tax/0619e?month=2026-08')).json()).toMatchObject({ totals: { ewtCents: 20_000 }, dueCents: 20_000 });
    expect((await accountant.get('/api/tax/1601eq?year=2026&quarter=3')).json()).toMatchObject({ totals: { ewtCents: 28_000 }, dueCents: 28_000, qap: [{ supplierId: printer, baseCents: 1_400_000, ewtCents: 28_000 }] });
    noBrokenInvariants();
  });
});

describe('the supplier gives an unused advance back', () => {
  beforeEach(() => setUp());

  it('partial return: cash back against 1230, the EWT withheld stays and a warning says so', async () => {
    const advId = (await advance(encoder, { supplierId: tailor, amountCents: 1_000_000, tenders: [{ cashPlaceId: BDO, amountCents: 980_000 }] })).json().id as string;
    expect(journalOf(advId)).toEqual([['1230', tailor, advId, 1_000_000, 0], ['2311', tailor, null, 0, 20_000], ['1111', null, null, 0, 980_000]]);
    const billId = (await bill(encoder, subcontract(tailor, '0042', 600_000))).json().id as string;
    expect(journalOf(billId)).toEqual([['5301', null, null, 600_000, 0], ['2101', tailor, billId, 0, 600_000], ['2101', tailor, billId, 600_000, 0], ['1230', tailor, advId, 0, 600_000]]);

    const r = await giveBack(encoder, { advanceId: advId, tenders: [{ cashPlaceId: GCASH, amountCents: 300_000, reference: 'GC-5521' }] });
    expect(r.json()).toMatchObject({
      number: 'SADR-000001',
      summary: 'This will record Sample Tailoring Shop giving back ₱3,000.00 of SADV-000001: ₱3,000.00 into E-wallet – GCash. The ₱200.00 EWT the advance withheld stays.',
    });
    expect(r.json().warnings).toEqual([{
      field: 'advanceId', code: 'EWT_STAYS', level: 'warning',
      message: 'SADV-000001 withheld ₱200.00 EWT. That stays in the EWT register and on the 2307s to issue; if the 2307 was never issued, ask the accountant to correct it with a journal voucher.',
    }]);
    expect(journalOf(r.json().id)).toEqual([['1121', null, null, 300_000, 0], ['1230', tailor, advId, 0, 300_000]]);
    expect(balances(env.db)).toEqual({ '1230': 100_000, '2311': -20_000, '5301': 600_000, '1111': -980_000, '1121': 300_000 });
    expect((await encoder.get(`/api/ap/suppliers/${tailor}`)).json().advances).toMatchObject([{ appliedCents: 600_000, returnedCents: 300_000, openCents: 100_000, returns: [{ number: 'SADR-000001', amountCents: 300_000 }] }]);

    const more = await giveBack(encoder, { advanceId: advId, tenders: [{ cashPlaceId: GCASH, amountCents: 100_001 }] });
    expect(more.json()).toMatchObject({ code: 'VALIDATION', message: 'Only ₱1,000.00 is still open on SADV-000001.' });
    // The advance cancels only after its bill and its return (D6); each cancel mirrors.
    expect((await cancel(accountant, 'ap.advance', advId)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: BILL-000001, SADR-000001.' });
    expect((await cancel(accountant, 'ap.advance_return', r.json().id)).statusCode).toBe(200);
    expect(journalOf(r.json().id, 'reversal')).toEqual([['1121', null, null, 0, 300_000], ['1230', tailor, advId, 300_000, 0]]);
    noBrokenInvariants();
  });
});

describe('refusals and the cancel order (PLAN D6)', () => {
  beforeEach(() => setUp());

  it('refuses more than is open, another supplier’s advance, the same advance twice and more than the bill owes', async () => {
    const advId = (await advance(encoder, { supplierId: tailor, amountCents: 1_000_000, tenders: [{ cashPlaceId: BDO, amountCents: 980_000 }] })).json().id as string;
    const more = await bill(encoder, subcontract(tailor, 'T-1', 2_000_000, { advances: [{ advanceId: advId, amountCents: 1_000_001 }] }));
    expect(more.json()).toMatchObject({ code: 'VALIDATION', message: 'Only ₱10,000.00 is still open on SADV-000001.' });
    expect(codes(await bill(encoder, subcontract(printer, 'T-2', 2_000_000, { advances: [{ advanceId: advId, amountCents: 100 }] })))).toEqual(['ADVANCE_SUPPLIER']);
    expect(codes(await bill(encoder, subcontract(tailor, 'T-3', 2_000_000, { advances: [{ advanceId: advId, amountCents: 100 }, { advanceId: advId, amountCents: 100 }] })))).toEqual(['ADVANCE_TWICE']);
    expect(codes(await bill(encoder, subcontract(tailor, 'T-4', 2_000_000, { advances: [{ advanceId: 'no-such-advance', amountCents: 100 }] })))).toEqual(['ADVANCE']);
    // A ₱5,000 bill with no EWT class left (accountant): ₱5,000 is owed, so ₱5,000.01 of the advance is too much.
    const small = await bill(accountant, subcontract(tailor, 'T-5', 500_000, { ewtClass: 'none', advances: [{ advanceId: advId, amountCents: 500_001 }] }));
    expect(codes(small)).toContain('ADVANCES_MORE_THAN_BILL');
    expect(codes(await bill(encoder, subcontract(tailor, 'T-6', 2_000_000, { advances: [{ advanceId: fabric, amountCents: 100 }] })))).toEqual(['ADVANCE']);
    // Another supplier's purchase order, and money paid out that is not the advance less its EWT.
    const po = await encoder.post('/api/docs/pur.po/post', { input: { supplierId: fabric, lines: [{ supplyId: cloth, qty: 1, unitCostCents: 100 }] }, expectedTotalCents: 100 }, idem());
    expect(codes(await advance(encoder, { supplierId: tailor, purchaseOrderId: po.json().id, amountCents: 100_000, tenders: [{ cashPlaceId: BDO, amountCents: 98_000 }] }))).toEqual(['PO_SUPPLIER']);
    expect((await advance(encoder, { supplierId: tailor, amountCents: 100_000, tenders: [{ cashPlaceId: BDO, amountCents: 100_000 }] })).json().message)
      .toBe('The money paid out (₱1,000.00) must be ₱980.00 (the advance of ₱1,000.00 less ₱20.00 EWT).');
    // Only the accountant withholds at another class than the supplier's usual one.
    expect(codes(await advance(encoder, { supplierId: tailor, amountCents: 100_000, ewtClass: 'none', tenders: [{ cashPlaceId: BDO, amountCents: 100_000 }] }))).toEqual(['EWT_ACCOUNTANT', 'EWT_DIFFERENT']);
    noBrokenInvariants();
  });

  it('a bill with applied advances is cancelled before the advance; an edited bill applies the same advance again', async () => {
    const advId = (await advance(encoder, { supplierId: tailor, amountCents: 1_000_000, tenders: [{ cashPlaceId: BDO, amountCents: 980_000 }] })).json().id as string;
    const billId = (await bill(encoder, subcontract(tailor, '0042', 1_500_000))).json().id as string;
    // ₱15,000 bill: ₱10,000 covered by the advance, EWT 2% on ₱5,000 = ₱100; owed ₱14,900 − ₱10,000.
    expect(journalOf(billId)).toEqual([['5301', null, null, 1_500_000, 0], ['2311', tailor, null, 0, 10_000], ['2101', tailor, billId, 0, 1_490_000], ['2101', tailor, billId, 1_000_000, 0], ['1230', tailor, advId, 0, 1_000_000]]);
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    const blocked = await cancel(accountant, 'ap.advance', advId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: BILL-000001.' });
    expect((await accountant.post(`/api/docs/ap.advance/${advId}/reissue`, { input: { supplierId: tailor, amountCents: 1_000_000, tenders: [{ cashPlaceId: BDO, amountCents: 980_000 }] }, expectedTotalCents: 1_000_000, reason: 'Wrong bank account used' }, idem())).json().code).toBe('HAS_DEPENDENTS');

    const input = (await accountant.get(`/api/docs/ap.bill/${billId}`)).json().input as BillInput;
    expect(input.advances).toEqual([{ advanceId: advId, amountCents: 1_000_000 }]);
    const re = await accountant.post(`/api/docs/ap.bill/${billId}/reissue`, { input: { ...input, supplierInvoiceNo: '0042-A' }, expectedTotalCents: 1_500_000, reason: 'Supplier reprinted the invoice' }, idem());
    expect(re.json()).toMatchObject({ number: 'BILL-000002' });
    expect(journalOf(billId, 'reversal')).toEqual([['5301', null, null, 0, 1_500_000], ['2311', tailor, null, 10_000, 0], ['2101', tailor, billId, 1_490_000, 0], ['2101', tailor, billId, 0, 1_000_000], ['1230', tailor, advId, 1_000_000, 0]]);
    expect(balances(env.db)).toEqual({ '5301': 1_500_000, '2311': -30_000, '2101': -490_000, '1111': -980_000 });

    expect((await cancel(accountant, 'ap.bill', re.json().id)).statusCode).toBe(200);
    expect((await accountant.get(`/api/ap/suppliers/${tailor}`)).json()).toMatchObject({ advancesCents: 1_000_000, advances: [{ openCents: 1_000_000 }] });
    expect((await cancel(accountant, 'ap.advance', advId)).statusCode).toBe(200);
    expect(journalOf(advId, 'reversal')).toEqual([['1230', tailor, advId, 0, 1_000_000], ['2311', tailor, null, 20_000, 0], ['1111', null, null, 980_000, 0]]);
    expect(balances(env.db)).toEqual({});
    expect(codes(await bill(accountant, subcontract(tailor, '0043', 100_000, { advances: [{ advanceId: advId, amountCents: 100 }] })))).toEqual(['ADVANCE_CANCELLED']);
    expect(codes(await giveBack(accountant, { advanceId: advId, tenders: [{ cashPlaceId: BDO, amountCents: 100 }] }))).toEqual(['ADVANCE_CANCELLED']);
    // With the advance cancelled, a new bill of the supplier takes nothing by itself.
    expect((await bill(accountant, subcontract(tailor, '0044', 100_000))).json().summary).not.toContain('applied');
    noBrokenInvariants();
  });
});

describe('property tests (PLAN I1.3)', () => {
  beforeEach(() => setUp());

  it('1230 per supplier = the open advances; what a bill owes never goes below zero; everything cancels to a clean ledger', async () => {
    const perms = ['ap.bill.create', 'ap.bill.post', 'ap.bill.cancel', 'ap.bill.ewt', 'ap.pay.create', 'ap.pay.post', 'ap.pay.cancel', 'ap.adv.create', 'ap.adv.post', 'ap.adv.cancel'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    let n = 0; // numbered when posted: a shrunk run replays generated values, so a number made in the generator repeats
    const bills = billDoc.arbitrary(env.db);
    const tryPost = (f: () => unknown, allowed: string[]) => {
      try {
        f();
      } catch (x) {
        const errors = (x as AppError & { details: { code: string; level: string }[] }).details.filter((i) => i.level === 'error');
        for (const i of errors) expect(allowed).toContain(i.code);
      }
    };
    for (const input of fc.sample(advanceDoc.arbitrary(env.db), { numRuns: 4, seed: 7 })) postDocument(e, advanceDoc, actor, { input, expectedTotalCents: input.amountCents });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(advanceDoc.arbitrary(env.db), bills, paymentDoc.arbitrary(env.db), advanceReturnDoc.arbitrary(env.db), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 5 }),
        (ops) => {
          for (const [ai, bi, pi, ri, cancelBill, cancelAdvance] of ops) {
            const a = postDocument(e, advanceDoc, actor, { input: ai, expectedTotalCents: ai.amountCents });
            const b = postDocument(e, billDoc, actor, { input: { ...bi, supplierInvoiceNo: `SI-P${++n}` }, expectedTotalCents: sum(bi.lines) });
            tryPost(() => postDocument(e, paymentDoc, actor, { input: pi, expectedTotalCents: sum(pi.tenders) }), ['MORE_THAN_OWED', 'BILL_CANCELLED', 'SUPPLIER', 'BILL']);
            tryPost(() => postDocument(e, advanceReturnDoc, actor, { input: ri, expectedTotalCents: sum(ri.tenders) }), ['MORE_THAN_OPEN', 'ADVANCE_CANCELLED', 'ADVANCE']);
            if (cancelBill) tryPost(() => cancelDocument(e, billDoc, actor, b.id, 'Recorded twice by mistake'), []);
            if (cancelAdvance) {
              try {
                cancelDocument(e, advanceDoc, actor, a.id, 'Paid to the wrong supplier');
              } catch (x) {
                expect((x as AppError).code).toBe('HAS_DEPENDENTS');
              }
            }
          }
          // 1230 per supplier = Σ open advances, each = the advance − what posted bills applied − what posted returns gave back.
          const open = env.db
            .prepare(
              `SELECT a.supplier_id AS supplierId, SUM(a.amount_cents
                 - COALESCE((SELECT SUM(x.amount_cents) FROM ap_bill_advances x JOIN documents bd ON bd.id = x.document_id WHERE x.advance_id = a.document_id AND bd.status = 'posted'), 0)
                 - COALESCE((SELECT SUM(rd.total_cents) FROM ap_advance_returns r JOIN documents rd ON rd.id = r.document_id WHERE r.advance_id = a.document_id AND rd.status = 'posted'), 0)) AS openCents,
                 MIN(a.amount_cents
                 - COALESCE((SELECT SUM(x.amount_cents) FROM ap_bill_advances x JOIN documents bd ON bd.id = x.document_id WHERE x.advance_id = a.document_id AND bd.status = 'posted'), 0)
                 - COALESCE((SELECT SUM(rd.total_cents) FROM ap_advance_returns r JOIN documents rd ON rd.id = r.document_id WHERE r.advance_id = a.document_id AND rd.status = 'posted'), 0)) AS leastCents
               FROM ap_advances a JOIN documents d ON d.id = a.document_id WHERE d.status = 'posted' GROUP BY a.supplier_id`,
            )
            .all() as { supplierId: string; openCents: number; leastCents: number }[];
          const ledger = env.db
            .prepare(`SELECT l.party_id AS supplierId, SUM(l.debit_cents - l.credit_cents) AS cents FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1230' GROUP BY l.party_id HAVING cents <> 0`)
            .all() as { supplierId: string; cents: number }[];
          expect(Object.fromEntries(ledger.map((r) => [r.supplierId, r.cents]))).toEqual(Object.fromEntries(open.filter((r) => r.openCents !== 0).map((r) => [r.supplierId, r.openCents])));
          for (const r of open) expect(r.leastCents).toBeGreaterThanOrEqual(0);
          // What each bill owes = payable − advances applied − payments, never below zero, and 2101 = their sum.
          const owed = env.db
            .prepare(
              `SELECT b.payable_cents - COALESCE((SELECT SUM(x.amount_cents) FROM ap_bill_advances x WHERE x.document_id = b.document_id), 0)
                 - COALESCE((SELECT SUM(p.amount_cents) FROM ap_payment_bills p JOIN documents pd ON pd.id = p.document_id WHERE p.bill_id = b.document_id AND pd.status = 'posted'), 0) AS owed
               FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE d.status = 'posted'`,
            )
            .pluck()
            .all() as number[];
          for (const o of owed) expect(o).toBeGreaterThanOrEqual(0);
          expect(0 - (balances(env.db)['2101'] ?? 0)).toBe(owed.reduce((s, o) => s + o, 0));
          noBrokenInvariants();
        },
      ),
      { numRuns: 25 },
    );
  });
});
