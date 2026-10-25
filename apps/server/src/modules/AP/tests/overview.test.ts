/**
 * The purchases and expenses overview (the owner's request, 25 Oct 2026): one purchase followed from order to payment,
 * each step showing what waits at it, and this month's costs NET of VAT on bills and expense vouchers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import type { PurchasesOverview } from '../overview.ts';

let env: TestEnv;
let encoder: Client;
let fabric: string, cloth: string;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env); // 28 September 2026
  encoder = await env.as('encoder');
  const accountant = await env.as('accountant');
  fabric = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true, paymentTermsDays: 30 })).json().id;
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
});

const overview = async () => { const r = await encoder.get('/api/ap/overview'); expect(r.statusCode, r.body).toBe(200); return r.json() as PurchasesOverview; };

describe('the purchases and expenses overview', () => {
  it('follows a purchase from order to payment, and adds up the month', async () => {
    expect(await overview()).toMatchObject({ month: '2026-09', toReceive: [], toBill: [], toPay: [], advancesCents: 0, spending: [] });

    // Ordered: 50 yards at ₱224, expected the 30th; three days on it is late, and 30 are received.
    const posted = await encoder.post('/api/docs/pur.po/post', { input: { supplierId: fabric, expectedDate: '2026-09-30', lines: [{ supplyId: cloth, qty: 50, unitCostCents: 22_400 }] }, expectedTotalCents: 1_120_000 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    const po = posted.json();
    env.clock.advance(3 * 24 * 3600_000); // 1 October
    encoder = await env.as('encoder'); // signed in again after the days off
    expect((await overview()).toReceive).toEqual([expect.objectContaining({ id: po.id, supplierName: 'Sample Fabric Trading', remainingCents: 1_120_000, late: true })]);
    const rr = (await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: po.id, lines: [{ poLineNo: 1, qty: 30 }] }, expectedTotalCents: 0 }, idem())).json();
    let o = await overview();
    expect(o.toReceive).toEqual([expect.objectContaining({ id: po.id, remainingCents: 448_000 })]);
    expect(o.toBill).toEqual([expect.objectContaining({ id: rr.id, poId: po.id, poNumber: po.number, supplierName: 'Sample Fabric Trading', receivedCents: 672_000 })]);

    // Billed for that delivery: off "to bill", on "to pay", due in 30 days.
    const bill = await encoder.post('/api/docs/ap.bill/post', { input: { supplierId: fabric, supplierInvoiceNo: 'SI-1', supplierInvoiceDate: '2026-09-28', receivingReportId: rr.id, lines: [{ supplyId: cloth, amountCents: 672_000 }] }, expectedTotalCents: 672_000 }, idem());
    expect(bill.statusCode, bill.body).toBe(200);
    o = await overview();
    expect(o.toBill).toEqual([]);
    expect(o.toPay).toEqual([expect.objectContaining({ id: bill.json().id, supplierName: 'Sample Fabric Trading', dueDate: '2026-10-28', balanceCents: 672_000, overdue: false, dueThisWeek: false })]);

    // Paid on the spot: an expense voucher, next to the bill's cost NET of its VAT.
    const [catId, catName] = env.db.prepare(`SELECT c.id, a.name FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE c.default_ewt_class IS NULL AND c.is_active = 1 ORDER BY c.sort_order LIMIT 1`).raw().get() as [number, string];
    const v = await encoder.post('/api/docs/exp.voucher/post', { input: { categoryId: catId, amountCents: 50_000, description: 'Sample spend', payeeName: 'Sample Store', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 50_000 }] }, expectedTotalCents: 50_000 }, idem());
    expect(v.statusCode, v.body).toBe(200);
    expect((await overview()).spending).toEqual([
      { name: expect.any(String), billsCents: 600_000, vouchersCents: 0 },
      { name: catName, billsCents: 0, vouchersCents: 50_000 },
    ]);

    // Paid in full: nothing waits to be paid.
    const pay = await encoder.post('/api/docs/ap.payment/post', { input: { supplierId: fabric, bills: [{ billId: bill.json().id, amountCents: 672_000 }], tenders: [{ cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: 672_000 }] }, expectedTotalCents: 672_000 }, idem());
    expect(pay.statusCode, pay.body).toBe(200);
    expect((await overview()).toPay).toEqual([]);
    expect((await (await env.as('tv')).get('/api/ap/overview')).statusCode).toBe(403);
  });
});
