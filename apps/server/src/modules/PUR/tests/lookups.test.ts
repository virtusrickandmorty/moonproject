import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, idem, type TestEnv } from '../../../../test/helpers.ts';

describe('PUR read-only lookups for the screens', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(async () => {
    env.db.close();
    await env.app.close();
  });

  async function seed() {
    const accountant = await env.as('accountant');
    const supplierId = (await accountant.post('/api/pur/suppliers', { name: 'Tela Trading', registeredName: 'Tela Trading Inc.', isVatRegistered: false })).json().id as string;
    const otherId = (await accountant.post('/api/pur/suppliers', { name: 'Hilo Supply', registeredName: 'Hilo Supply Co.', isVatRegistered: false })).json().id as string;
    const cotton = (await accountant.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' })).json().id as string;
    const thread = (await accountant.post('/api/pur/supplies', { name: 'Poly thread', unit: 'roll', category: 'materials' })).json().id as string;
    return { accountant, supplierId, otherId, cotton, thread };
  }

  it('lists inactive and all suppliers and supplies with ?status=, active by default', async () => {
    const { accountant, supplierId, otherId, cotton } = await seed();
    const sup = (await accountant.get(`/api/pur/suppliers/${otherId}`)).json();
    expect((await accountant.post(`/api/pur/suppliers/${otherId}/deactivate`, undefined, { 'if-match': String(sup.version) })).statusCode).toBe(200);
    const supply = (await accountant.get('/api/pur/supplies')).json().find((s: { id: string }) => s.id === cotton);
    await accountant.post(`/api/pur/supplies/${cotton}/deactivate`, undefined, { 'if-match': String(supply.version) });

    const ids = async (url: string) => (await accountant.get(url)).json().map((r: { id: string }) => r.id);
    expect(await ids('/api/pur/suppliers')).toEqual([supplierId]);
    expect(await ids('/api/pur/suppliers?status=active')).toEqual([supplierId]);
    expect(await ids('/api/pur/suppliers?status=inactive')).toEqual([otherId]);
    expect((await ids('/api/pur/suppliers?status=all')).sort()).toEqual([supplierId, otherId].sort());
    expect(await ids('/api/pur/supplies?status=inactive')).toEqual([cotton]);
    expect((await accountant.get('/api/pur/suppliers?status=nonsense')).statusCode).toBe(400);
  });

  it('shows what is still to receive per line, counting only posted receiving reports', async () => {
    const { accountant, supplierId, otherId, cotton, thread } = await seed();
    const enc = await env.as('encoder');
    const po = (
      await enc.post('/api/docs/pur.po/post', { input: { supplierId, lines: [{ supplyId: cotton, qty: 10, unitCostCents: 15000 }, { supplyId: thread, qty: 4, unitCostCents: 2500 }] }, expectedTotalCents: 160000 }, idem())
    ).json().id as string;
    const receive = (lines: { poLineNo: number; qty: number }[]) => enc.post('/api/docs/pur.rr/post', { input: { poDocumentId: po, lines }, expectedTotalCents: 0 }, idem());
    const rr1 = (await receive([{ poLineNo: 1, qty: 6 }])).json().id as string;
    const rr2 = (await receive([{ poLineNo: 1, qty: 2 }, { poLineNo: 2, qty: 4 }])).json().id as string;

    let open = (await enc.get('/api/pur/purchase-orders/open')).json();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: po, supplierName: 'Tela Trading', status: 'posted' });
    expect(open[0].lines).toEqual([
      { lineNo: 1, supplyId: cotton, supplyName: 'Cotton twill', unit: 'yard', orderedQty: 10, receivedQty: 8, remainingQty: 2, unitCostCents: 15000 },
      { lineNo: 2, supplyId: thread, supplyName: 'Poly thread', unit: 'roll', orderedQty: 4, receivedQty: 4, remainingQty: 0, unitCostCents: 2500 },
    ]);

    // A cancelled report receives nothing; a fully received order drops off the open list.
    expect((await accountant.post(`/api/docs/pur.rr/${rr2}/cancel`, { reason: 'counted wrong on receipt' }, idem())).statusCode).toBe(200);
    open = (await enc.get('/api/pur/purchase-orders/open')).json();
    expect(open[0].lines.map((l: { remainingQty: number }) => l.remainingQty)).toEqual([4, 4]);
    await receive([{ poLineNo: 1, qty: 4 }, { poLineNo: 2, qty: 4 }]);
    expect((await enc.get('/api/pur/purchase-orders/open')).json()).toEqual([]);

    const one = (await enc.get(`/api/pur/purchase-orders/${po}`)).json();
    expect(one).toMatchObject({ number: 'PO-000001', supplierName: 'Tela Trading', totalCents: 160000 });
    expect(one.lines.every((l: { remainingQty: number }) => l.remainingQty === 0)).toBe(true);

    const report = (await enc.get(`/api/pur/receiving-reports/${rr1}`)).json();
    expect(report).toMatchObject({ number: 'RR-000001', poId: po, poNumber: 'PO-000001', supplierName: 'Tela Trading' });
    expect(report.lines).toEqual([{ lineNo: 1, poLineNo: 1, supplyId: cotton, supplyName: 'Cotton twill', unit: 'yard', qty: 6 }]);

    const orders = (await enc.get(`/api/pur/suppliers/${supplierId}/purchase-orders`)).json();
    expect(orders).toEqual([{ id: po, number: 'PO-000001', status: 'posted', date: '2026-09-28', totalCents: 160000, expectedDate: null, fullyReceived: true }]);
    const reports = (await enc.get(`/api/pur/suppliers/${supplierId}/receiving-reports`)).json();
    expect(reports.map((r: { number: string; status: string }) => `${r.number} ${r.status}`)).toEqual(['RR-000003 posted', 'RR-000002 cancelled', 'RR-000001 posted']);
    expect((await enc.get(`/api/pur/suppliers/${otherId}/purchase-orders`)).json()).toEqual([]);
    expect((await enc.get('/api/pur/suppliers/nope/purchase-orders')).statusCode).toBe(404);
    expect((await enc.get('/api/pur/purchase-orders/nope')).statusCode).toBe(404);
    expect((await enc.get('/api/pur/receiving-reports/nope')).statusCode).toBe(404);
  });

  it('checks the permission of each route', async () => {
    const { supplierId } = await seed();
    const production = await env.as('production'); // may view supplies only
    for (const url of ['/api/pur/purchase-orders/open', '/api/pur/purchase-orders/x', '/api/pur/receiving-reports/x', `/api/pur/suppliers/${supplierId}/purchase-orders`, `/api/pur/suppliers/${supplierId}/receiving-reports`]) {
      expect((await production.get(url)).statusCode, url).toBe(403);
    }
  });
});
