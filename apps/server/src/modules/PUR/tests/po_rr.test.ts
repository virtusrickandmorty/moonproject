import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { newId } from '@moonproject/shared';
import fc from 'fast-check';
import { purchaseOrderDoc, type PurchaseOrderInput } from '../doctypes/purchaseOrder.ts';
import { receivingReportDoc, type ReceivingReportInput } from '../doctypes/receiving.ts';
import { idem } from '../../../../test/helpers.ts';

describe('PUR PO and RR', () => {
  let env: any;
  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    env.db.close();
    await env.app.close();
  });

  const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

  it('creates a PO, receives against it, and cancels', async () => {
    const enc = await env.as('encoder');

    // Seed supplier and supply
    const supplierId = 'sup-1';
    env.db.prepare(`INSERT INTO pur_suppliers (id, name, registered_name, ewt_class, created_at, updated_at) VALUES (?, 'S1', 'S1', 'rent_5', '2026', '2026')`).run(supplierId);

    const supplyId = 'supy-1';
    env.db.prepare(`INSERT INTO pur_supplies (id, name, unit, category, created_at, updated_at) VALUES (?, 'M1', 'pc', 'materials', '2026', '2026')`).run(supplyId);

    const poInput: PurchaseOrderInput = {
      supplierId,
      expectedDate: '2026-10-15',
      lines: [
        { supplyId, qty: 10, unitCostCents: 15000 }
      ]
    };

    const poRes = await enc.post('/api/docs/pur.po/post', { input: poInput, expectedTotalCents: 150000 }, idem());
    if (poRes.statusCode !== 200) console.log('POST PO failed:', poRes.body);
    expect(poRes.statusCode).toBe(200);
    const poId = poRes.json().id;

    const poDoc = await enc.get(`/api/docs/pur.po/${poId}`);
    expect(poDoc.statusCode).toBe(200);
    const po = poDoc.json().doc;
    expect(po.totalCents).toBe(150000);
    expect(po.lines[0].lineTotalCents).toBe(150000);

    const poLineId = po.lines[0].id;

    const rrInput: ReceivingReportInput = {
      poDocumentId: poId,
      lines: [
        { poLineId, qty: 5 }
      ]
    };

    const rrRes = await enc.post('/api/docs/pur.rr/post', { input: rrInput, expectedTotalCents: 0 }, idem());
    expect(rrRes.statusCode).toBe(200);
    const rrId = rrRes.json().id;

    const acc = await env.as('accountant');

    const rrCancel = await acc.post(`/api/docs/pur.rr/${rrId}/cancel`, { reason: 'wrong qty recorded' }, idem());
    if (rrCancel.statusCode !== 200) console.log('RR CANCEL failed:', rrCancel.body);
    expect(rrCancel.statusCode).toBe(200);

    const poCancel = await acc.post(`/api/docs/pur.po/${poId}/cancel`, { reason: 'wrong price' }, idem());
    if (poCancel.statusCode !== 200) console.log('PO CANCEL failed:', poCancel.body);
    expect(poCancel.statusCode).toBe(200);

    noBrokenInvariants();
  });

  it('property test: valid POs can be posted', async () => {
    const enc = await env.as('encoder');
    env.db.prepare(`INSERT INTO pur_suppliers (id, name, registered_name, ewt_class, created_at, updated_at) VALUES ('prop-sup', 'S1', 'S1', 'rent_5', '2026', '2026')`).run();
    env.db.prepare(`INSERT INTO pur_supplies (id, name, unit, category, created_at, updated_at) VALUES ('prop-supply', 'M1', 'pc', 'materials', '2026', '2026')`).run();

    const arb = purchaseOrderDoc.arbitrary(env.db);
    await fc.assert(
      fc.asyncProperty(arb, async (input) => {
        const ctx = { db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00', userId: enc.userId, can: () => true };
        const doc = purchaseOrderDoc.compute(input, ctx);
        const issues = purchaseOrderDoc.validate(doc, ctx);
        expect(issues).toEqual([]);
      })
    );
  });

  it('property test: valid RRs can be posted', async () => {
    const enc = await env.as('encoder');
    const supplierId = 'rr-sup-1';
    env.db.prepare(`INSERT INTO pur_suppliers (id, name, registered_name, ewt_class, created_at, updated_at) VALUES (?, 'S1', 'S1', 'rent_5', '2026', '2026')`).run(supplierId);
    const supplyId = 'rr-supy-1';
    env.db.prepare(`INSERT INTO pur_supplies (id, name, unit, category, created_at, updated_at) VALUES (?, 'M1', 'pc', 'materials', '2026', '2026')`).run(supplyId);

    const poInput: PurchaseOrderInput = {
      supplierId,
      lines: [
        { supplyId, qty: 10, unitCostCents: 1000 }
      ]
    };

    const poRes = await enc.post('/api/docs/pur.po/post', { input: poInput, expectedTotalCents: 10000 }, idem());
    expect(poRes.statusCode).toBe(200);

    const arb = receivingReportDoc.arbitrary(env.db);
    await fc.assert(
      fc.asyncProperty(arb, async (input) => {
        const ctx = { db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00', userId: enc.userId, can: () => true };
        const doc = receivingReportDoc.compute(input, ctx);
        const issues = receivingReportDoc.validate(doc, ctx);
        expect(issues).toEqual([]);
      })
    );
  });

  it('rejects POST from production when unpermitted', async () => {
    const prod = await env.as('production');
    const poRes = await prod.post('/api/docs/pur.po/post', { input: {}, expectedTotalCents: 0 }, idem());
    expect(poRes.statusCode).toBe(403);
  });

  it('rejects unauthenticated user', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/docs/pur.po/post', payload: { input: {}, expectedTotalCents: 0 } });
    expect(res.statusCode).toBe(401);
  });
});
