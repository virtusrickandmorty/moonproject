/**
 * The purchasing lists (the owner's request, 26 Oct 2026): each row says where it stands (a request's approval, an
 * order's goods received and deliveries billed, a delivery's worth and bill), the figures above each list add up, the
 * search reads the supplier and what is bought, and each list is only for those who may see its documents.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
let fabric: string, cloth: string, thread: string;
const DAY = 24 * 3600_000;

beforeEach(async () => {
  env = await createTestEnv(); // 28 September 2026
  owner = await env.as('owner');
  fabric = (await owner.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', isVatRegistered: false, paymentTermsDays: 30 })).json().id;
  cloth = (await owner.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id;
  thread = (await owner.post('/api/pur/supplies', { name: 'Polyester thread', unit: 'roll', category: 'materials' })).json().id;
});

const post = async (type: string, input: object, total: number) => {
  const r = await owner.post(`/api/docs/${type}/post`, { input, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
};
const ask = (purpose: string, cents = 10_000) => post('pur.request', { purpose, supplierId: fabric, neededBy: '2026-09-30', lines: [{ supplyId: cloth, description: 'Cotton twill', qty: 1, unitCostCents: cents }] }, cents);

describe('the purchasing lists', () => {
  it('say where each request, order and delivery stands, with the figures above them', async () => {
    const waiting = await ask('Twill for the school uniforms');
    const approved = await ask('Twill for the samples', 20_000);
    const used = await ask('Twill for JO-000123', 30_000);
    for (const id of [approved.id, used.id]) expect((await owner.post(`/api/pur/requests/${id}/decide`, { decision: 'approved' })).statusCode).toBe(200);

    const po = await post('pur.po', { supplierId: fabric, expectedDate: '2026-10-01', requestId: used.id, lines: [{ supplyId: cloth, qty: 40, unitCostCents: 22_400 }, { supplyId: thread, qty: 10, unitCostCents: 5_000 }] }, 946_000);
    const rr = await post('pur.rr', { poDocumentId: po.id, lines: [{ poLineNo: 1, qty: 25 }, { poLineNo: 2, qty: 10 }] }, 0);

    // Requests: the state on each row, waiting late once its needed-by date passed (it is the 28th: not yet).
    const requests = (await owner.get('/api/pur/list/request')).json() as { number: string; state: string; purpose: string; lineCount: number; late: boolean; usedBy: { number: string } | null }[];
    expect(requests.map((r) => [r.number, r.state])).toEqual([[used.number, 'used'], [approved.number, 'approved'], [waiting.number, 'waiting']]);
    expect(requests[0]).toMatchObject({ purpose: 'Twill for JO-000123', lineCount: 1, usedBy: { number: po.number } });
    expect((await owner.get('/api/pur/list/request/summary')).json()).toEqual({
      waiting: { count: 1, cents: 10_000 }, approved: { count: 1, cents: 20_000 }, rejected: { count: 0, cents: 0 }, used: { count: 1, cents: 30_000 },
    });

    // Orders: 35 of 50 pieces received, one delivery not billed, 15 yards of twill (₱3,360) still to come.
    const orders = (await owner.get('/api/pur/list/po')).json() as Record<string, unknown>[];
    expect(orders).toEqual([expect.objectContaining({ number: po.number, supplierName: 'Sample Fabric Trading', requestNumber: used.number, orderedQty: 50, receivedQty: 35, toReceiveCents: 336_000, deliveries: 1, billed: 0, late: false })]);
    expect((await owner.get('/api/pur/list/po/summary')).json()).toEqual({ open: 1, toReceiveCents: 336_000, late: 0, toBill: 1, monthCents: 946_000 });

    // Deliveries: what came and its worth at the order's costs.
    expect((await owner.get('/api/pur/list/rr')).json()).toEqual([expect.objectContaining({ number: rr.number, poNumber: po.number, lines: 2, qty: 35, valueCents: 610_000, bill: null })]);
    expect((await owner.get('/api/pur/list/rr/summary')).json()).toEqual({ month: 1, monthCents: 610_000, toBill: 1, toBillCents: 610_000, ordersWaiting: 1 });

    // Four days on (2 October): the order is late, and so is the request still waiting past its needed-by date.
    env.clock.advance(4 * DAY);
    owner = await env.as('owner');
    expect((await owner.get('/api/pur/list/po')).json()[0].late).toBe(true);
    expect((await owner.get('/api/pur/list/po/summary')).json().late).toBe(1);
    expect(((await owner.get('/api/pur/list/request')).json() as { number: string; late: boolean }[]).find((r) => r.number === waiting.number)?.late).toBe(true);

    // The search reads the supplier and what is bought; the counts follow it.
    expect(((await owner.get('/api/pur/list/po?q=thread')).json() as unknown[]).length).toBe(1);
    expect(((await owner.get('/api/pur/list/rr?q=nothing-like-it')).json() as unknown[]).length).toBe(0);
    expect((await owner.get('/api/pur/list/request/counts?q=samples')).json()).toEqual({ all: 1, posted: 1, cancelled: 0 });
  });

  it('is only for those who may see the documents', async () => {
    const production = await env.as('production');
    expect((await production.get('/api/pur/list/request')).statusCode).toBe(200); // production may view requests
    expect((await production.get('/api/pur/list/po')).statusCode).toBe(403);
    expect((await production.get('/api/pur/list/rr/summary')).statusCode).toBe(403);
  });
});
