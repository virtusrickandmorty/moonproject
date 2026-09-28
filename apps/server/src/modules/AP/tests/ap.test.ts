/**
 * Payables: golden G-15 (bill and part payment), EWT at accrual, each cancel, the AP rules, AP by supplier and property tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { AppError } from '@moonproject/shared';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { billDoc, type BillInput } from '../doctypes/bill.ts';
import { paymentDoc, type PaymentInput } from '../doctypes/payment.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let BDO: number, GCASH: number;
let fabric: string, cloth: string;

const newSupplier = async (s: { name: string; tin?: string; isVatRegistered?: boolean; ewtClass?: string; paymentTermsDays?: number }) => (await accountant.post('/api/pur/suppliers', { registeredName: `${s.name} Inc.`, isVatRegistered: false, ...s })).json().id as string;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  BDO = cashPlaceId(env.db, '1111');
  GCASH = cashPlaceId(env.db, '1121');
  fabric = await newSupplier({ name: 'Sample Fabric Trading', tin: '111-222-333-000', isVatRegistered: true, ewtClass: 'goods_1', paymentTermsDays: 30 });
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
});

const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
const bill = (c: Client, input: BillInput) => c.post('/api/docs/ap.bill/post', { input, expectedTotalCents: sum(input.lines) }, idem());
const pay = (c: Client, input: PaymentInput) => c.post('/api/docs/ap.payment/post', { input, expectedTotalCents: sum(input.tenders) }, idem());
const cancel = (c: Client, type: string, id: string) => c.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake today' }, idem());
const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const codes = (r: { json(): { details?: { code: string }[] } }) => (r.json().details ?? []).map((i) => i.code);
/** A journal of a document: [code, party id, ref, debit, credit] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const g15 = (over: Partial<BillInput> = {}): BillInput => ({ supplierId: fabric, supplierInvoiceNo: 'SI-7788', supplierInvoiceDate: '2026-09-25', lines: [{ supplyId: cloth, amountCents: 1_120_000 }], ...over });
const payOn = (billId: string, amountCents: number, supplierId = fabric): PaymentInput => ({ supplierId, bills: [{ billId, amountCents }], tenders: [{ cashPlaceId: BDO, amountCents }] });

describe('Supplier bill and payment golden (PLAN I2 G-15)', () => {
  it('fabric ₱11,200 from a VAT supplier (Virtus not a TWA), ₱5,000 paid, ₱6,200 still owed', async () => {
    const pre = await encoder.post('/api/docs/ap.bill/preview', { input: g15() });
    expect(pre.json().summary).toBe('This will record ₱11,200.00 billed by Sample Fabric Trading on invoice no. SI-7788 of 2026-09-25 with ₱1,200.00 input VAT, due 2026-10-25.');
    const b = await bill(encoder, g15());
    expect(b.json()).toMatchObject({ number: 'BILL-000001', totalCents: 1_120_000, warnings: [] });
    const billId = b.json().id as string;
    expect(journalOf(billId)).toEqual([
      ['5101', null, null, 1_000_000, 0],
      ['1401', fabric, null, 120_000, 0],
      ['2101', fabric, billId, 0, 1_120_000],
    ]);
    const p = await pay(encoder, payOn(billId, 500_000));
    expect(p.json()).toMatchObject({ number: 'SPAY-000001', summary: 'This will record paying Sample Fabric Trading ₱5,000.00 on BILL-000001: ₱5,000.00 from Cash in bank – BDO.' });
    expect(journalOf(p.json().id)).toEqual([['2101', fabric, billId, 500_000, 0], ['1111', null, null, 0, 500_000]]);
    expect(balances(env.db)).toEqual({ '5101': 1_000_000, '1401': 120_000, '2101': -620_000, '1111': -500_000 });

    const ap = (await encoder.get(`/api/ap/suppliers/${fabric}`)).json();
    expect(ap).toMatchObject({ supplierName: 'Sample Fabric Trading', balanceCents: 620_000 });
    expect(ap.bills).toMatchObject([{ number: 'BILL-000001', supplierInvoiceNo: 'SI-7788', dueDate: '2026-10-25', payableCents: 1_120_000, paidCents: 500_000, owedCents: 620_000 }]);
    expect(ap.payments).toMatchObject([{ number: 'SPAY-000001', totalCents: 500_000, bills: [{ billNumber: 'BILL-000001', amountCents: 500_000 }] }]);
    expect((await encoder.get('/api/ap/suppliers')).json()).toEqual([{ supplierId: fabric, supplierName: 'Sample Fabric Trading', balanceCents: 620_000 }]);
    expect((await (await env.as('tv')).get('/api/ap/suppliers')).statusCode).toBe(403);
    noBrokenInvariants();
  });
});

describe('cancel and edit (NR-4)', () => {
  it('a bill with payments cancels only after them; each cancel mirrors its posting, dated today', async () => {
    const billId = (await bill(encoder, g15())).json().id as string;
    const payId = (await pay(encoder, payOn(billId, 500_000))).json().id as string;
    env.clock.advance(24 * 3600_000);
    accountant = await env.as('accountant');
    const blocked = await cancel(accountant, 'ap.bill', billId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: SPAY-000001.' });

    expect((await cancel(accountant, 'ap.payment', payId)).statusCode).toBe(200);
    expect(journalOf(payId, 'reversal')).toEqual([['2101', fabric, billId, 0, 500_000], ['1111', null, null, 500_000, 0]]);
    expect(balances(env.db)).toEqual({ '5101': 1_000_000, '1401': 120_000, '2101': -1_120_000 });

    expect((await cancel(accountant, 'ap.bill', billId)).statusCode).toBe(200);
    expect(journalOf(billId, 'reversal')).toEqual([['5101', null, null, 0, 1_000_000], ['1401', fabric, null, 0, 120_000], ['2101', fabric, billId, 1_120_000, 0]]);
    expect(env.db.prepare(`SELECT DISTINCT business_date FROM journals WHERE posting_kind = 'reversal'`).pluck().all()).toEqual(['2026-09-29']);
    expect(balances(env.db)).toEqual({});
    expect((await accountant.get(`/api/ap/suppliers/${fabric}`)).json()).toMatchObject({ balanceCents: 0, bills: [{ status: 'cancelled', owedCents: 0 }] });
    expect(codes(await pay(accountant, payOn(billId, 100)))).toEqual(['BILL_CANCELLED']);
    noBrokenInvariants();
  });

  it('edit = cancel + a new number; the replacement may carry the same supplier invoice number', async () => {
    const first = (await bill(encoder, g15())).json().id as string;
    expect((await cancel(encoder, 'ap.bill', first)).statusCode).toBe(403);
    const input = g15({ lines: [{ supplyId: cloth, amountCents: 1_176_000 }] });
    const r = await accountant.post(`/api/docs/ap.bill/${first}/reissue`, { input, expectedTotalCents: 1_176_000, reason: 'Supplier corrected the invoice' }, idem());
    expect(r.json()).toMatchObject({ number: 'BILL-000002' });
    expect(balances(env.db)).toEqual({ '5101': 1_050_000, '1401': 126_000, '2101': -1_176_000 });
    expect((await accountant.get(`/api/docs/ap.bill/${r.json().id}`)).json().input).toEqual({ ...input, dueDate: '2026-10-25', ewtClass: 'none' });
    noBrokenInvariants();
  });
});

describe('AP rules (PLAN E9, D4)', () => {
  it('a payment never exceeds what is still owed; split tenders and a bank fee', async () => {
    const one = (await bill(encoder, g15())).json().id as string;
    const two = (await bill(encoder, g15({ supplierInvoiceNo: 'SI-7789', lines: [{ supplyId: cloth, amountCents: 560_000 }] }))).json().id as string;
    await pay(encoder, payOn(one, 500_000));
    const over = await pay(encoder, payOn(one, 620_001));
    expect(over.statusCode).toBe(422);
    expect(over.json().message).toBe('Only ₱6,200.00 is still owed on BILL-000001.');
    const both: PaymentInput = {
      supplierId: fabric,
      bills: [{ billId: one, amountCents: 620_000 }, { billId: two, amountCents: 560_000 }],
      tenders: [{ cashPlaceId: BDO, amountCents: 1_000_000, reference: 'CHK-1001' }, { cashPlaceId: GCASH, amountCents: 182_500 }],
      feeCents: 2_500,
    };
    expect(codes(await pay(encoder, { ...both, feeCents: undefined }))).toEqual(['TENDERS']);
    expect(codes(await pay(encoder, { ...both, bills: [both.bills[0]!, both.bills[0]!] }))).toContain('BILL_TWICE');
    const p = await pay(encoder, both);
    expect(journalOf(p.json().id)).toEqual([
      ['2101', fabric, one, 620_000, 0],
      ['2101', fabric, two, 560_000, 0],
      ['6230', null, null, 2_500, 0],
      ['1111', null, null, 0, 1_000_000],
      ['1121', null, null, 0, 182_500],
    ]);
    expect((await encoder.get(`/api/ap/suppliers/${fabric}`)).json()).toMatchObject({ balanceCents: 0, bills: [{ owedCents: 0 }, { owedCents: 0 }] });
    expect((await pay(encoder, payOn(two, 1))).json().message).toBe('BILL-000002 is fully paid.');
    const other = await newSupplier({ name: 'Sample Thread Supply', tin: '555-666-777-000' });
    expect(codes(await pay(encoder, payOn(one, 1, other)))).toEqual(['BILL']);
    noBrokenInvariants();
  });

  it('blocks a duplicate supplier invoice number of the same supplier', async () => {
    await bill(encoder, g15());
    const dup = await bill(encoder, g15({ lines: [{ supplyId: cloth, amountCents: 100 }] }));
    expect(dup.json()).toMatchObject({ code: 'VALIDATION', message: 'Invoice no. SI-7788 of this supplier is already on BILL-000001.' });
    const other = await newSupplier({ name: 'Sample Thread Supply', tin: '555-666-777-000' });
    expect((await bill(encoder, g15({ supplierId: other }))).statusCode).toBe(200);
  });

  it('EWT is credited when the bill is recorded, not at payment: rent ₱40,000', async () => {
    const lessor = await newSupplier({ name: 'Sample Lessor', tin: '123-456-789-000', isVatRegistered: true, ewtClass: 'rent_5' });
    const b = await bill(encoder, { supplierId: lessor, supplierInvoiceNo: 'SI-0101', supplierInvoiceDate: '2026-09-28', dueDate: '2026-10-05', lines: [{ categoryId: cat('6110'), amountCents: 4_000_000, description: 'October rent' }] });
    expect(b.json().summary).toBe('This will record ₱40,000.00 billed by Sample Lessor on invoice no. SI-0101 of 2026-09-28 with ₱4,285.71 input VAT; ₱1,785.71 is withheld (EWT 5%), so ₱38,214.29 is owed, due 2026-10-05.');
    const billId = b.json().id as string;
    expect(journalOf(billId)).toEqual([
      ['6110', null, null, 3_571_429, 0],
      ['1401', lessor, null, 428_571, 0],
      ['2311', lessor, null, 0, 178_571],
      ['2101', lessor, billId, 0, 3_821_429],
    ]);
    expect(codes(await pay(encoder, payOn(billId, 4_000_000, lessor)))).toEqual(['MORE_THAN_OWED']);
    const p = await pay(encoder, payOn(billId, 3_821_429, lessor));
    expect(journalOf(p.json().id)).toEqual([['2101', lessor, billId, 3_821_429, 0], ['1111', null, null, 0, 3_821_429]]);
    expect(balances(env.db)).toEqual({ '6110': 3_571_429, '1401': 428_571, '2311': -178_571, '1111': -3_821_429 });
    noBrokenInvariants();
  });

  it('only the accountant changes the EWT from the supplier’s usual class', async () => {
    const lessor = await newSupplier({ name: 'Sample Lessor', tin: '123-456-789-000', isVatRegistered: true, ewtClass: 'rent_5' });
    const rent = (over: Partial<BillInput>): BillInput => ({ supplierId: lessor, supplierInvoiceNo: 'SI-0101', supplierInvoiceDate: '2026-09-28', lines: [{ categoryId: cat('6110'), amountCents: 4_000_000 }], ...over });
    expect(codes(await bill(encoder, rent({ ewtClass: 'none' })))).toEqual(['EWT_ACCOUNTANT', 'EWT_DIFFERENT']);
    expect(codes(await bill(encoder, rent({ ewtClass: 'rent_5' })))).toEqual([]);
    const byAccountant = await bill(accountant, rent({ supplierInvoiceNo: 'SI-0102', ewtClass: 'none' }));
    expect(byAccountant.json().warnings.map((w: { message: string }) => w.message)).toEqual(['The usual EWT for this supplier is 5% (rent_5). Please check.']);
    expect(codes(await bill(accountant, rent({ supplierInvoiceNo: 'SI-0103', ewtClass: 'goods_1' })))).toContain('NOT_TWA');
    const noTin = await newSupplier({ name: 'Sample Embroidery', ewtClass: 'contractor_2' });
    expect(codes(await bill(encoder, rent({ supplierId: noTin, lines: [{ purchase: 'subcontract', amountCents: 100_000 }] })))).toEqual(['TIN_REQUIRED']);
  });

  it('non-VAT supplier: the gross goes to the cost and EWT is on G; VAT-registered without a TIN: no input VAT', async () => {
    const tailor = await newSupplier({ name: 'Sample Tailoring Shop', tin: '222-333-444-000', ewtClass: 'contractor_2' });
    const t = await bill(encoder, { supplierId: tailor, supplierInvoiceNo: '0042', supplierInvoiceDate: '2026-09-27', lines: [{ purchase: 'subcontract', amountCents: 1_000_000 }] });
    expect(journalOf(t.json().id)).toEqual([['5301', null, null, 1_000_000, 0], ['2311', tailor, null, 0, 20_000], ['2101', tailor, t.json().id, 0, 980_000]]);
    const buttons = await newSupplier({ name: 'Sample Buttons', isVatRegistered: true });
    const b = await bill(encoder, { supplierId: buttons, supplierInvoiceNo: '77', supplierInvoiceDate: '2026-09-27', lines: [{ supplyId: cloth, amountCents: 112_000 }] });
    expect(b.json().warnings.map((w: { code: string }) => w.code)).toEqual(['NO_INPUT_VAT']);
    expect(journalOf(b.json().id)).toEqual([['5101', null, null, 112_000, 0], ['2101', buttons, b.json().id, 0, 112_000]]);
    noBrokenInvariants();
  });

  it('VAT at the rate on the supplier’s invoice date, spread over the lines by largest remainder', async () => {
    env.db
      .prepare('INSERT INTO settings (key, effective_from, value_json, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run('tax.vat_rate_bp', '2026-09-26', '1000', 'Test setting version', '2026-09-28T10:00:00.000+08:00', accountant.userId);
    const lines = [{ supplyId: cloth, amountCents: 99_900 }, { categoryId: cat('6160'), amountCents: 35_000 }, { purchase: 'freight_in' as const, amountCents: 100 }];
    const old = await bill(encoder, g15({ lines }));
    expect(journalOf(old.json().id)).toEqual([
      ['5101', null, null, 89_197, 0],
      ['6160', null, null, 31_250, 0],
      ['5103', null, null, 89, 0],
      ['1401', fabric, null, 14_464, 0],
      ['2101', fabric, old.json().id, 0, 135_000],
    ]);
    const now = await bill(encoder, g15({ supplierInvoiceNo: 'SI-7790', supplierInvoiceDate: '2026-09-26', lines: [{ supplyId: cloth, amountCents: 110_000 }] }));
    expect(journalOf(now.json().id)).toEqual([['5101', null, null, 100_000, 0], ['1401', fabric, null, 10_000, 0], ['2101', fabric, now.json().id, 0, 110_000]]);
    expect(codes(await bill(encoder, g15({ supplierInvoiceNo: 'X', lines: [{ supplyId: cloth, categoryId: cat('6160'), amountCents: 1 }] })))).toEqual(['LINE']);
    expect(codes(await bill(encoder, g15({ supplierInvoiceNo: 'Y', supplierInvoiceDate: '2026-09-29' })))).toEqual(['INVOICE_DATE']);
    expect(codes(await bill(encoder, g15({ supplierInvoiceNo: 'Z', dueDate: '2026-09-24' })))).toEqual(['DUE_DATE']);
    noBrokenInvariants();
  });

  it('a bill may point at a receiving report of the same supplier', async () => {
    const po = await encoder.post('/api/docs/pur.po/post', { input: { supplierId: fabric, lines: [{ supplyId: cloth, qty: 50, unitCostCents: 22_400 }] }, expectedTotalCents: 1_120_000 }, idem());
    const rr = (await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: po.json().id, lines: [{ poLineNo: 1, qty: 50 }] }, expectedTotalCents: 0 }, idem())).json();
    expect((await bill(encoder, g15({ receivingReportId: rr.id }))).json().warnings).toEqual([]);
    const again = await bill(encoder, g15({ supplierInvoiceNo: 'SI-7789', receivingReportId: rr.id }));
    expect(again.json().warnings.map((w: { message: string }) => w.message)).toEqual([`${rr.number} is already on BILL-000001. Check that this is another invoice for it.`]);
    const other = await newSupplier({ name: 'Sample Thread Supply', tin: '555-666-777-000' });
    expect(codes(await bill(encoder, g15({ supplierId: other, receivingReportId: rr.id })))).toEqual(['RR_SUPPLIER']);
    expect(codes(await bill(encoder, g15({ supplierInvoiceNo: 'SI-7790', receivingReportId: po.json().id })))).toEqual(['RECEIVING_REPORT']);
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random bills and payments post balanced, cancel to zero, never overpay a bill, and keep numbers gapless', async () => {
    await newSupplier({ name: 'Sample Lessor', tin: '123-456-789-000', isVatRegistered: true, ewtClass: 'rent_5' });
    await newSupplier({ name: 'Sample Tailoring Shop', tin: '222-333-444-000', ewtClass: 'contractor_2' });
    const perms = ['ap.bill.create', 'ap.bill.post', 'ap.bill.cancel', 'ap.bill.ewt', 'ap.pay.create', 'ap.pay.post', 'ap.pay.cancel'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    let n = 0; // fast-check likes small numbers, so the generated invoice numbers repeat: number them instead (duplicates are tested above)
    const bills = billDoc.arbitrary(env.db).map((b) => ({ ...b, supplierInvoiceNo: `SI-P${++n}` }));
    for (const input of fc.sample(bills, { numRuns: 4, seed: 42 })) postDocument(e, billDoc, actor, { input, expectedTotalCents: sum(input.lines) });
    fc.assert(
      fc.property(fc.array(fc.tuple(bills, paymentDoc.arbitrary(env.db), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 6 }), (ops) => {
        for (const [bi, pi, cancelBill, cancelPay] of ops) {
          const b = postDocument(e, billDoc, actor, { input: bi, expectedTotalCents: sum(bi.lines) });
          if (cancelBill) cancelDocument(e, billDoc, actor, b.id, 'Recorded twice by mistake');
          try {
            const p = postDocument(e, paymentDoc, actor, { input: pi, expectedTotalCents: sum(pi.tenders) });
            if (cancelPay) cancelDocument(e, paymentDoc, actor, p.id, 'Paid from the wrong bank');
          } catch (x) {
            expect((x as AppError & { details: { code: string }[] }).details.map((i) => i.code)).toEqual(['MORE_THAN_OWED']);
          }
        }
        const owed = env.db
          .prepare(
            `SELECT b.document_id AS id, b.payable_cents - COALESCE((SELECT SUM(p.amount_cents) FROM ap_payment_bills p JOIN documents pd ON pd.id = p.document_id
               WHERE p.bill_id = b.document_id AND pd.status = 'posted'), 0) AS owed FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE d.status = 'posted'`,
          )
          .all() as { id: string; owed: number }[];
        for (const o of owed) expect(o.owed).toBeGreaterThanOrEqual(0);
        expect(-(balances(env.db)['2101'] ?? 0)).toBe(sum(owed.map((o) => ({ amountCents: o.owed }))));
        noBrokenInvariants();
      }),
      { numRuns: 30 },
    );
  });
});
