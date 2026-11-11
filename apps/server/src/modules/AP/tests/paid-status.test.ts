/**
 * Whether a purchase order and its bills are paid (the owner's request, Nov 2026): on the order list, the order's page,
 * the receiving report list and the bill list, from the ledger: what is still owed and whether it is overdue. Made-up names.
 */
import { beforeEach, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, grantRole, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv, encoder: Client, fabric: string, cloth: string;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env); grantRole(env, 'encoder', 'pur.po.without_request');
  encoder = await env.as('encoder');
  const accountant = await env.as('accountant');
  fabric = (await accountant.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true, paymentTermsDays: 30 })).json().id;
  cloth = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
});

it('shows each bill and order as still to pay, then overdue, then paid', async () => {
  const po = (await encoder.post('/api/docs/pur.po/post', { input: { supplierId: fabric, expectedDate: '2026-09-30', lines: [{ supplyId: cloth, qty: 10, unitCostCents: 20_000 }] }, expectedTotalCents: 200_000 }, idem())).json();
  const poRow = async () => ((await encoder.get('/api/pur/list/po')).json() as { id: string; payment: unknown }[]).find((r) => r.id === po.id)!.payment;
  expect(await poRow()).toEqual({ bills: 0, owedCents: 0, overdue: false, nextDue: null }); // nothing billed yet

  const rr = (await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: po.id, lines: [{ poLineNo: 1, qty: 10 }] }, expectedTotalCents: 0 }, idem())).json();
  const bill = (await encoder.post('/api/docs/ap.bill/post', { input: { supplierId: fabric, supplierInvoiceNo: 'SI-9', supplierInvoiceDate: '2026-09-28', receivingReportId: rr.id, lines: [{ supplyId: cloth, amountCents: 200_000 }] }, expectedTotalCents: 200_000 }, idem())).json();
  const owed = async () => (await encoder.get(`/api/ap/bills/owed?ids=${bill.id},not-a-bill`)).json();
  expect(await owed()).toEqual([{ id: bill.id, owedCents: 200_000, payableCents: 200_000, dueDate: '2026-10-28' }]);
  expect(await poRow()).toEqual({ bills: 1, owedCents: 200_000, overdue: false, nextDue: '2026-10-28' });
  const page = async () => (await encoder.get(`/api/pur/purchase-orders/${po.id}`)).json().deliveries[0].bill;
  expect(await page()).toEqual({ id: bill.id, number: bill.number, dueDate: '2026-10-28', owedCents: 200_000 });

  // Part paid, then past its due date.
  const pay = (cents: number) => encoder.post('/api/docs/ap.payment/post', { input: { supplierId: fabric, bills: [{ billId: bill.id, amountCents: cents }], tenders: [{ cashPlaceId: cashPlaceId(env.db, '1111'), amountCents: cents }] }, expectedTotalCents: cents }, idem());
  expect((await pay(50_000)).statusCode).toBe(200);
  expect((await owed())[0].owedCents).toBe(150_000);
  env.clock.advance(40 * 24 * 3600_000);
  encoder = await env.as('encoder');
  expect(await poRow()).toEqual({ bills: 1, owedCents: 150_000, overdue: true, nextDue: '2026-10-28' });

  // Paid in full.
  expect((await pay(150_000)).statusCode).toBe(200);
  expect(await poRow()).toEqual({ bills: 1, owedCents: 0, overdue: false, nextDue: null });
  expect((await owed())[0].owedCents).toBe(0);
  const rrRow = ((await encoder.get('/api/pur/list/rr')).json() as { id: string; bill: unknown }[]).find((r) => r.id === rr.id)!;
  expect(rrRow.bill).toMatchObject({ id: bill.id, owedCents: 0 });
  expect((await (await env.as('production')).get(`/api/ap/bills/owed?ids=${bill.id}`)).statusCode).toBe(403);
});
