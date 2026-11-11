/**
 * The items of one order that came on different days (the owner's request, Nov 2026): each day's goods are their own
 * receiving report, dated the day they came (today or earlier, as the delivery receipt says), never after today.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { manilaDate } from '@moonproject/shared';
import { grantRole, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;

beforeEach(async () => {
  env = await createTestEnv(); grantRole(env, 'encoder', 'pur.po.without_request');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
});

const dayBefore = (d: string, days: number) => manilaDate(new Date(Date.parse(`${d}T00:00:00+08:00`) - days * 86_400_000));

describe('receiving the rest of an order on another day', () => {
  it('a second report for the lines still to come, dated the day they came; never a day after today', async () => {
    const supplierId = (await accountant.post('/api/pur/suppliers', { name: 'Sample Notions Shop', registeredName: 'Sample Notions Shop', isVatRegistered: false })).json().id as string;
    const pliers = (await accountant.post('/api/pur/supplies', { name: 'Sample snap plier', unit: 'pc', category: 'materials' })).json().id as string;
    const buttons = (await accountant.post('/api/pur/supplies', { name: 'Sample buttons 14mm', unit: 'pc', category: 'materials' })).json().id as string;
    const po = await encoder.post('/api/docs/pur.po/post', { input: { supplierId, lines: [{ supplyId: pliers, qty: 1, unitCostCents: 20_000 }, { supplyId: buttons, qty: 1, unitCostCents: 30_000 }] }, expectedTotalCents: 50_000 }, idem());
    expect(po.statusCode, po.body).toBe(200);
    const poId = po.json().id as string;

    // The pliers came today.
    const first = await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: poId, lines: [{ poLineNo: 1, qty: 1 }] }, expectedTotalCents: 0 }, idem());
    expect(first.statusCode, first.body).toBe(200);
    const today = (await encoder.get(`/api/docs/pur.rr/${first.json().id}`)).json().header.businessDate as string;

    // The buttons: a day after today is refused; two days ago, the day they came, is kept.
    const tomorrow = dayBefore(today, -1);
    const late = await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: poId, lines: [{ poLineNo: 2, qty: 1 }] }, expectedTotalCents: 0, businessDate: tomorrow }, idem());
    expect(late.statusCode).toBe(400);
    expect(late.json().code).toBe('BAD_DATE');

    const came = dayBefore(today, 2);
    const second = await encoder.post('/api/docs/pur.rr/post', { input: { poDocumentId: poId, lines: [{ poLineNo: 2, qty: 1 }] }, expectedTotalCents: 0, businessDate: came }, idem());
    expect(second.statusCode, second.body).toBe(200);
    expect((await encoder.get(`/api/docs/pur.rr/${second.json().id}`)).json().header.businessDate).toBe(came);

    // The order is all in, from two reports with their own days.
    const status = (await encoder.get(`/api/pur/purchase-orders/${poId}`)).json();
    expect(status.lines.map((l: { remainingQty: number }) => l.remainingQty)).toEqual([0, 0]);
    expect(status.deliveries.map((r: { date: string }) => r.date).sort()).toEqual([came, today]);
  });
});
