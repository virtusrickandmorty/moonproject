/**
 * One supplier invoice is recorded once, on a bill or an expense voucher (B1-01): the number is compared loosely, across
 * both, for the same supplier (TIN, else the supplier on file). Someone who may backdate records it again with a reason.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { normalizeInvoiceNo } from '../invoices.ts';
import type { BillInput } from '../doctypes/bill.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let fabric: string, cloth: string, CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  CASH = cashPlaceId(env.db, '1101');
  fabric = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: false })).json().id;
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
});

const cat = (code: string) => env.db.prepare('SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = ?').pluck().get(code) as number;
const codes = (r: { json(): { details?: { code: string; level?: string }[] } }) => (r.json().details ?? []).filter((i) => i.level !== 'warning').map((i) => i.code);
const billInput = (supplierInvoiceNo: string, over: Partial<BillInput> = {}): BillInput =>
  ({ supplierId: fabric, supplierInvoiceNo, supplierInvoiceDate: '2026-09-25', lines: [{ supplyId: cloth, amountCents: 100_000 }], ...over });
const bill = (c: Client, input: BillInput) => c.post('/api/docs/ap.bill/post', { input, expectedTotalCents: 100_000 }, idem());
const voucher = (c: Client, over: object) =>
  c.post('/api/docs/exp.voucher/post', {
    input: { categoryId: cat('6160'), amountCents: 50_000, tenders: [{ cashPlaceId: CASH, amountCents: 50_000 }], description: 'Thread and needles', supplierInvoiceDate: '2026-09-25', ...over },
    expectedTotalCents: 50_000,
  }, idem());

describe('duplicate supplier invoices (B1-01)', () => {
  it('normalizes the number: case, spaces, dashes, dots, slashes, "#" and leading zeros', () => {
    for (const no of ['SI-0042', 'si-0042', 'SI 0042', 'SI-42', 'S.I. #42', 'si/00042']) expect(normalizeInvoiceNo(no)).toBe('SI42');
    expect(normalizeInvoiceNo('SI-0042-007')).toBe('SI42007');
    expect(normalizeInvoiceNo('0')).toBe('0');
    expect(normalizeInvoiceNo('SI-0043')).not.toBe('SI42');
  });

  it('refuses the same invoice typed another way on a second bill', async () => {
    expect((await bill(encoder, billInput('SI-0042'))).statusCode).toBe(200);
    for (const no of ['si-0042', 'SI 0042', 'SI42', 'S.I. #00042']) {
      const r = await bill(encoder, billInput(no));
      expect(r.statusCode).toBe(422);
      expect(codes(r)).toEqual(['DUPLICATE_INVOICE']);
      expect(r.json().message).toContain('BILL-000001');
    }
    expect((await bill(encoder, billInput('SI-0043'))).statusCode).toBe(200);
  });

  it('refuses a voucher for an invoice already on a bill, matched by TIN or by the supplier on file', async () => {
    expect((await bill(encoder, billInput('SI-0042'))).statusCode).toBe(200);
    const byTin = await voucher(encoder, { payeeName: 'Sample Fabric (walk-in)', payeeTin: '111-222-333-00000', supplierInvoiceNo: 'si 42' });
    expect(codes(byTin)).toEqual(['DUPLICATE_INVOICE']);
    expect(byTin.json().message).toContain('BILL-000001');
    expect(codes(await voucher(encoder, { supplierId: fabric, supplierInvoiceNo: 'SI-042' }))).toEqual(['DUPLICATE_INVOICE']);
    // Another supplier's invoice with the same number is another invoice.
    expect((await voucher(encoder, { payeeName: 'Sample Hardware', payeeTin: '999-888-777-000', supplierInvoiceNo: 'SI-0042' })).statusCode).toBe(200);
  });

  it('refuses a bill for an invoice already on a voucher', async () => {
    expect((await voucher(encoder, { supplierId: fabric, supplierInvoiceNo: 'OR-100' })).statusCode).toBe(200);
    const r = await bill(encoder, billInput('or 0100'));
    expect(codes(r)).toEqual(['DUPLICATE_INVOICE']);
    expect(r.json().message).toContain('EXP-000001');
  });

  it('records it again only for someone who may backdate, with the reason stored', async () => {
    expect((await bill(encoder, billInput('SI-0042'))).statusCode).toBe(200);
    const reason = 'Supplier reissued the same number for a second delivery';
    expect(codes(await bill(encoder, billInput('SI 42', { duplicateReason: reason })))).toEqual(['DUPLICATE_INVOICE']);
    const r = await bill(accountant, billInput('SI 42', { duplicateReason: reason }));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().warnings.map((i: { code: string }) => i.code)).toContain('DUPLICATE_INVOICE');
    expect(env.db.prepare('SELECT duplicate_reason FROM ap_bills WHERE document_id = ?').pluck().get(r.json().id)).toBe(reason);
    expect((await accountant.get(`/api/docs/ap.bill/${r.json().id}`)).json().input.duplicateReason).toBe(reason);

    const v = await voucher(accountant, { supplierId: fabric, supplierInvoiceNo: 'SI-0042', duplicateReason: reason });
    expect(v.statusCode, v.body).toBe(200);
    expect(env.db.prepare('SELECT duplicate_reason FROM exp_vouchers WHERE document_id = ?').pluck().get(v.json().id)).toBe(reason);
    expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);
  });
});
