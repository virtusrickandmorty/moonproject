/**
 * Quantities with decimals (the owner's request, Oct 27, 2026): 12.5 yards of fabric is asked for, ordered and received
 * in two deliveries (7.25 and 5.25), adding up exactly; each line's money is rounded once to the centavo; a third
 * decimal is refused; and what is still to come and what came are priced the same way everywhere.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';

let env: TestEnv;
let owner: Client;
let supplierId: string, twill: string;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  supplierId = (await owner.post('/api/pur/suppliers', { name: 'Tela Trading', registeredName: 'Tela Trading Inc.', isVatRegistered: false })).json().id;
  twill = (await owner.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
});
afterEach(async () => { env.db.close(); await env.app.close(); });

const post = async (type: string, input: object, total: number) => {
  const r = await owner.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
};

describe('decimal quantities', () => {
  it('ask, order and receive 12.5 yards in two deliveries, priced once to the centavo', async () => {
    // 12.5 × ₱150.33 = ₱1,879.125 → ₱1,879.13 (half away from zero, once per line).
    const request = await post('pur.request', { purpose: 'Twill for the polo shirts', lines: [{ supplyId: twill, description: 'Cotton twill', qty: 12.5, unitCostCents: 15_033 }] }, 187_913);
    expect((await owner.get(`/api/pur/requests/${request.id}`)).json().lines[0].qty).toBe(12.5);
    expect((await owner.post(`/api/pur/requests/${request.id}/decide`, { decision: 'approved' })).statusCode).toBe(200);

    const po = await post('pur.po', { supplierId, requestId: request.id, lines: [{ supplyId: twill, qty: 12.5, unitCostCents: 15_033 }] }, 187_913);
    const doc = (await owner.get(`/api/docs/pur.po/${po.id}`)).json();
    expect(doc.input.lines[0].qty).toBe(12.5);
    expect(env.db.prepare('SELECT qty_hundredths FROM pur_po_lines WHERE document_id = ?').pluck().get(po.id)).toBe(1250);

    const first = await post('pur.rr', { poDocumentId: po.id, lines: [{ poLineNo: 1, qty: 7.25 }] }, 0);
    expect((await owner.get(`/api/pur/purchase-orders/${po.id}`)).json().lines[0]).toMatchObject({ orderedQty: 12.5, receivedQty: 7.25, remainingQty: 5.25 });
    // What is still to come: 5.25 × ₱150.33 = ₱789.2325 → ₱789.23.
    expect((await owner.get('/api/pur/list/po')).json()[0]).toMatchObject({ orderedQty: 12.5, receivedQty: 7.25, toReceiveCents: 78_923 });
    // What came: 7.25 × ₱150.33 = ₱1,089.8925 → ₱1,089.89.
    expect((await owner.get('/api/pur/list/rr')).json()[0]).toMatchObject({ number: first.number, qty: 7.25, valueCents: 108_989 });

    // A tenth more than is left is received with a warning; exactly what is left is not.
    const over = (await owner.post('/api/docs/pur.rr/preview', { input: { poDocumentId: po.id, lines: [{ poLineNo: 1, qty: 5.35 }] } })).json();
    expect(over.issues.map((i: { code: string }) => i.code)).toContain('OVER_RECEIVE');
    expect(over.issues.find((i: { code: string }) => i.code === 'OVER_RECEIVE').message).toContain('12.6');
    await post('pur.rr', { poDocumentId: po.id, lines: [{ poLineNo: 1, qty: 5.25 }] }, 0);
    expect((await owner.get(`/api/pur/purchase-orders/${po.id}`)).json().lines[0]).toMatchObject({ receivedQty: 12.5, remainingQty: 0 });
    expect((await owner.get('/api/pur/purchase-orders/open')).json()).toEqual([]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('refuses more than two decimal places, and zero', async () => {
    for (const qty of [1.005, 0, -1]) {
      const r = await owner.post('/api/docs/pur.po/preview', { input: { supplierId, lines: [{ supplyId: twill, qty, unitCostCents: 100 }] } });
      expect(r.statusCode, String(qty)).toBe(400);
    }
    expect((await owner.post('/api/docs/pur.po/preview', { input: { supplierId, lines: [{ supplyId: twill, qty: 0.01, unitCostCents: 100 }] } })).json().totalCents).toBe(1);
  });
});
