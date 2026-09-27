import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, idem, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import fc from 'fast-check';
import { purchaseOrderDoc, type PurchaseOrderInput } from '../doctypes/purchaseOrder.ts';
import { receivingReportDoc, type ReceivingReportInput } from '../doctypes/receiving.ts';
import { stamp } from '../../../platform/clock.ts';

describe('PUR PO and RR', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    env.db.close();
    await env.app.close();
  });

  const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

  async function seedMasters() {
    const accountant = await env.as('accountant');
    const supplier = await accountant.post('/api/pur/suppliers', {
      name: 'Test Supplier', registeredName: 'Test Supplier Inc.', isVatRegistered: false,
    });
    const supply = await accountant.post('/api/pur/supplies', {
      name: 'Test Fabric', unit: 'yard', category: 'materials',
    });
    expect(supplier.statusCode).toBe(200);
    expect(supply.statusCode).toBe(200);
    return { accountant, supplierId: supplier.json().id as string, supplyId: supply.json().id as string };
  }

  it('creates a PO, receives against it, and cancels', async () => {
    const enc = await env.as('encoder');

    const { accountant, supplierId, supplyId } = await seedMasters();

    const poInput: PurchaseOrderInput = {
      supplierId,
      expectedDate: '2026-10-15',
      lines: [
        { supplyId, qty: 10, unitCostCents: 15000 }
      ]
    };

    const poRes = await enc.post('/api/docs/pur.po/post', { input: poInput, expectedTotalCents: 150000 }, idem());
    expect(poRes.statusCode).toBe(200);
    const poId = poRes.json().id;

    const poDoc = await enc.get(`/api/docs/pur.po/${poId}`);
    expect(poDoc.statusCode).toBe(200);
    const po = poDoc.json().doc;
    expect(po.totalCents).toBe(150000);
    expect(po.lines[0].lineTotalCents).toBe(150000);

    const poLineNo = po.lines[0].lineNo;

    const rrInput: ReceivingReportInput = {
      poDocumentId: poId,
      lines: [
        { poLineNo, qty: 5 }
      ]
    };

    const rrRes = await enc.post('/api/docs/pur.rr/post', { input: rrInput, expectedTotalCents: 0 }, idem());
    expect(rrRes.statusCode).toBe(200);
    const rrId = rrRes.json().id;

    const rrCancel = await accountant.post(`/api/docs/pur.rr/${rrId}/cancel`, { reason: 'wrong qty recorded' }, idem());
    expect(rrCancel.statusCode).toBe(200);

    const poCancel = await accountant.post(`/api/docs/pur.po/${poId}/cancel`, { reason: 'wrong price' }, idem());
    expect(poCancel.statusCode).toBe(200);

    noBrokenInvariants();
  });

  it('property test: valid POs can be posted', async () => {
    const enc = await env.as('encoder');
    const { accountant } = await seedMasters();
    const arb = purchaseOrderDoc.arbitrary(env.db);
    const ctx = { db: env.db, businessDate: '2026-09-28', at: stamp(env.clock), userId: enc.userId, can: () => true };

    await fc.assert(fc.asyncProperty(fc.array(arb, { minLength: 3, maxLength: 5 }), async (inputs) => {
      for (const [index, input] of inputs.entries()) {
        const computed = purchaseOrderDoc.compute(input, ctx);
        const posted = await enc.post('/api/docs/pur.po/post', { input, expectedTotalCents: computed.totalCents }, idem());
        expect(posted.statusCode, posted.body).toBe(200);
        const id = posted.json().id as string;
        const loaded = purchaseOrderDoc.load(env.db, id);
        expect(loaded).toEqual(computed);
        expect(purchaseOrderDoc.compute(purchaseOrderDoc.toInput(loaded), ctx)).toEqual(loaded);

        if (index % 3 === 1) {
          const cancelled = await accountant.post(`/api/docs/pur.po/${id}/cancel`, { reason: 'Duplicate test order' }, idem());
          expect(cancelled.statusCode, cancelled.body).toBe(200);
          expect((await enc.get(`/api/docs/pur.po/${id}`)).json().header.status).toBe('cancelled');
        } else if (index % 3 === 2) {
          const form = (await enc.get(`/api/docs/pur.po/${id}`)).json().input as PurchaseOrderInput;
          const reissued = await accountant.post(`/api/docs/pur.po/${id}/reissue`, {
            input: form, expectedTotalCents: computed.totalCents, reason: 'Corrected test order',
          }, idem());
          expect(reissued.statusCode, reissued.body).toBe(200);
          expect(purchaseOrderDoc.load(env.db, reissued.json().id)).toEqual(computed);
          expect((await enc.get(`/api/docs/pur.po/${id}`)).json().header).toMatchObject({
            status: 'cancelled', replacedById: reissued.json().id,
          });
        }
      }
    }), { numRuns: 8 });
    noBrokenInvariants();
  });

  it('property test: valid RRs can be posted', async () => {
    const enc = await env.as('encoder');
    const { accountant, supplierId, supplyId } = await seedMasters();
    const poInput: PurchaseOrderInput = {
      supplierId,
      lines: [{ supplyId, qty: 1_000_000, unitCostCents: 1 }],
    };
    const poRes = await enc.post('/api/docs/pur.po/post', { input: poInput, expectedTotalCents: 1_000_000 }, idem());
    expect(poRes.statusCode, poRes.body).toBe(200);

    const arb = receivingReportDoc.arbitrary(env.db);
    const ctx = { db: env.db, businessDate: '2026-09-28', at: stamp(env.clock), userId: enc.userId, can: () => true };
    await fc.assert(fc.asyncProperty(fc.array(arb, { minLength: 3, maxLength: 5 }), async (inputs) => {
      for (const [index, input] of inputs.entries()) {
        const computed = receivingReportDoc.compute(input, ctx);
        const posted = await enc.post('/api/docs/pur.rr/post', { input, expectedTotalCents: 0 }, idem());
        expect(posted.statusCode, posted.body).toBe(200);
        const id = posted.json().id as string;
        const loaded = receivingReportDoc.load(env.db, id);
        expect(loaded).toEqual(computed);
        expect(receivingReportDoc.compute(receivingReportDoc.toInput(loaded), ctx)).toEqual(loaded);

        if (index % 3 === 1) {
          const cancelled = await accountant.post(`/api/docs/pur.rr/${id}/cancel`, { reason: 'Duplicate test receipt' }, idem());
          expect(cancelled.statusCode, cancelled.body).toBe(200);
          expect((await enc.get(`/api/docs/pur.rr/${id}`)).json().header.status).toBe('cancelled');
        } else if (index % 3 === 2) {
          const form = (await enc.get(`/api/docs/pur.rr/${id}`)).json().input as ReceivingReportInput;
          const reissued = await accountant.post(`/api/docs/pur.rr/${id}/reissue`, {
            input: form, expectedTotalCents: 0, reason: 'Corrected test receipt',
          }, idem());
          expect(reissued.statusCode, reissued.body).toBe(200);
          expect(receivingReportDoc.load(env.db, reissued.json().id)).toEqual(computed);
          expect((await enc.get(`/api/docs/pur.rr/${id}`)).json().header).toMatchObject({
            status: 'cancelled', replacedById: reissued.json().id,
          });
        }
      }
    }), { numRuns: 8 });
    noBrokenInvariants();
  });

  it('blocks PO cancellation while a receiving report is live', async () => {
    const enc = await env.as('encoder');
    const { accountant, supplierId, supplyId } = await seedMasters();
    const po = await enc.post('/api/docs/pur.po/post', {
      input: { supplierId, lines: [{ supplyId, qty: 10, unitCostCents: 1000 }] }, expectedTotalCents: 10000,
    }, idem());
    expect(po.statusCode).toBe(200);
    const rr = await enc.post('/api/docs/pur.rr/post', {
      input: { poDocumentId: po.json().id, lines: [{ poLineNo: 1, qty: 5 }] }, expectedTotalCents: 0,
    }, idem());
    expect(rr.statusCode).toBe(200);
    const blocked = await accountant.post(`/api/docs/pur.po/${po.json().id}/cancel`, { reason: 'Cancel the test order' }, idem());
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('HAS_DEPENDENTS');
    expect((await enc.get(`/api/docs/pur.po/${po.json().id}`)).json().header.status).toBe('posted');
    noBrokenInvariants();
  });

  it('rejects duplicate PO lines and warns when receiving too much', async () => {
    const enc = await env.as('encoder');
    const { supplierId, supplyId } = await seedMasters();
    const po = await enc.post('/api/docs/pur.po/post', {
      input: { supplierId, lines: [{ supplyId, qty: 10, unitCostCents: 1000 }] }, expectedTotalCents: 10000,
    }, idem());
    expect(po.statusCode).toBe(200);
    const poDocumentId = po.json().id;
    const duplicate = await enc.post('/api/docs/pur.rr/post', {
      input: { poDocumentId, lines: [{ poLineNo: 1, qty: 2 }, { poLineNo: 1, qty: 3 }] }, expectedTotalCents: 0,
    }, idem());
    expect(duplicate.statusCode).toBe(422);
    const over = await enc.post('/api/docs/pur.rr/post', {
      input: { poDocumentId, lines: [{ poLineNo: 1, qty: 11 }] }, expectedTotalCents: 0,
    }, idem());
    expect(over.statusCode, over.body).toBe(200);
    expect(over.json().warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OVER_RECEIVE', level: 'warning' })]));
    noBrokenInvariants();
  });

  it('refuses UPDATE on all four PUR document tables', async () => {
    const enc = await env.as('encoder');
    const { supplierId, supplyId } = await seedMasters();
    const po = await enc.post('/api/docs/pur.po/post', {
      input: { supplierId, lines: [{ supplyId, qty: 10, unitCostCents: 1000 }] }, expectedTotalCents: 10000,
    }, idem());
    expect(po.statusCode).toBe(200);
    const rr = await enc.post('/api/docs/pur.rr/post', {
      input: { poDocumentId: po.json().id, lines: [{ poLineNo: 1, qty: 5 }] }, expectedTotalCents: 0,
    }, idem());
    expect(rr.statusCode).toBe(200);
    for (const [table, column, id] of [
      ['pur_purchase_orders', 'supplier_id', po.json().id],
      ['pur_po_lines', 'qty', po.json().id],
      ['pur_receiving_reports', 'po_document_id', rr.json().id],
      ['pur_rr_lines', 'qty', rr.json().id],
    ]) {
      expect(() => env.db.prepare(`UPDATE ${table} SET ${column} = ${column} WHERE document_id = ?`).run(id), table).toThrow(/IMMUTABLE/);
    }
    noBrokenInvariants();
  });

  it('rejects PO and RR routes for production and signed-out users', async () => {
    const prod = await env.as('production');
    for (const type of ['pur.po', 'pur.rr']) {
      expect((await prod.get(`/api/docs/${type}`)).statusCode).toBe(403);
      expect((await prod.post(`/api/docs/${type}/post`, { input: {}, expectedTotalCents: 0 }, idem())).statusCode).toBe(403);
      expect((await env.app.inject({ method: 'GET', url: `/api/docs/${type}` })).statusCode).toBe(401);
      expect((await env.app.inject({ method: 'POST', url: `/api/docs/${type}/post`, payload: { input: {}, expectedTotalCents: 0 } })).statusCode).toBe(401);
    }
  });
});
