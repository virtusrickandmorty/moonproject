import { describe, expect, it } from 'vitest';
import { createTestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { catalogItemRef, lookupCatalogPrice, logCatalogPriceOverride, requireCatalogDiscountReason } from '../public.ts';

const example = {
  code: 'DEMO-SET', name: 'Sample two-piece kit', class: 'made_to_order_garment',
  garmentType: 'Sample kit', unit: 'set', setComponents: 2,
};

describe('CAT catalog and pricing', () => {
  it('shares item class and unit without changing catalog data', async () => {
    const env = await createTestEnv();
    try {
      const owner = await env.as('owner');
      const row = (await owner.post('/api/cat/items', example)).json();
      expect(catalogItemRef(env.db, row.id)).toEqual({ code: 'DEMO-SET', name: 'Sample two-piece kit',
        class: 'made_to_order_garment', unit: 'set', isActive: true });
      expect(catalogItemRef(env.db, 'missing')).toBeUndefined();
      await owner.post(`/api/cat/items/${row.id}/deactivate`, {}, { 'if-match': '1' });
      expect(catalogItemRef(env.db, row.id)?.isActive).toBe(false);
    } finally { await env.app.close(); env.db.close(); }
  });
  it('requires permissions, versions, and known IDs for item changes', async () => {
    const env = await createTestEnv();
    try {
      const owner = await env.as('owner');
      const production = await env.as('production');
      const denied = await production.post('/api/cat/items', example);
      expect(denied.statusCode).toBe(403);

      const created = await owner.post('/api/cat/items', example);
      expect(created.statusCode).toBe(200);
      const { id } = created.json();
      expect(created.json().revenue_role).toBe('SALES_MTO');
      expect((await owner.get(`/api/cat/items/${id}`)).json().version).toBe(1);
      expect((await owner.get('/api/cat/items/missing')).statusCode).toBe(404);
      expect((await owner.put('/api/cat/items/missing', { name: 'New name' }, { 'if-match': '1' })).statusCode).toBe(404);
      expect((await owner.put(`/api/cat/items/${id}`, { name: 'New name' })).statusCode).toBe(428);
      const changed = await owner.put(`/api/cat/items/${id}`, { name: 'New name' }, { 'if-match': '1' });
      expect(changed.statusCode).toBe(200);
      expect(changed.json().version).toBe(2);
      expect((await owner.put(`/api/cat/items/${id}`, { name: 'Old edit' }, { 'if-match': '1' })).statusCode).toBe(409);
      expect((await owner.post(`/api/cat/items/${id}/deactivate`, {}, { 'if-match': '2' })).statusCode).toBe(200);
      expect((await owner.get(`/api/cat/items/${id}`)).json().is_active).toBe(0);
      expect(verifyAuditChain(env.db)).toBeNull();
    } finally {
      await env.app.close(); env.db.close();
    }
  });

  it('chooses the latest effective date and eligible quantity tier without rewriting prices', async () => {
    const env = await createTestEnv();
    try {
      const owner = await env.as('owner');
      const created = await owner.post('/api/cat/items', example);
      const id = created.json().id as string;
      let version = 1;
      const add = async (effectiveFrom: string, minQty: number, unitPriceCents: number) => {
        const res = await owner.post(`/api/cat/items/${id}/prices`,
          { effectiveFrom, minQty, unitPriceCents }, { 'if-match': String(version) });
        expect(res.statusCode, res.body).toBe(200);
        version++;
        return res.json().id as string;
      };
      const firstId = await add('2026-09-28', 1, 12000);
      await add('2026-09-28', 10, 10000);
      await add('2026-10-01', 1, 11000);
      expect(lookupCatalogPrice(env.db, id, 12, '2026-09-30')?.unitPriceCents).toBe(10000);
      expect(lookupCatalogPrice(env.db, id, 12, '2026-10-01')?.unitPriceCents).toBe(11000);
      expect(lookupCatalogPrice(env.db, id, 1, '2026-09-27')).toBeNull();
      expect((await owner.get(`/api/cat/items/${id}/price?qty=12&onDate=2026-09-30`)).json().priceId).not.toBe(firstId);
      expect((await owner.post(`/api/cat/items/${id}/prices`,
        { effectiveFrom: '2026-10-02', minQty: 1, unitPriceCents: 9000 }, { 'if-match': '1' })).statusCode).toBe(409);
      expect((await owner.put(`/api/cat/items/${id}`, { unit: 'pc', setComponents: 1 },
        { 'if-match': String(version) })).statusCode).toBe(409);
      expect(() => env.db.prepare('UPDATE cat_prices SET unit_price_cents = 1 WHERE id = ?').run(firstId)).toThrow();
      expect(verifyAuditChain(env.db)).toBeNull();
    } finally {
      await env.app.close(); env.db.close();
    }
  });

  it('logs a price override in the caller transaction', async () => {
    const env = await createTestEnv();
    try {
      const owner = await env.as('owner');
      const id = (await owner.post('/api/cat/items', example)).json().id as string;
      const before = (env.db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n;
      const input = { at: '2026-09-28T10:00:00.000+08:00', userId: owner.userId,
        sourceType: 'quo_line', sourceId: 'made-up-line', itemId: id, qty: 2,
        listUnitPriceCents: 12000, overrideUnitPriceCents: 11000, reason: 'Promotional price' };
      expect(() => env.db.transaction(() => {
        logCatalogPriceOverride(env.db, input);
        throw new Error('line write failed');
      }).immediate()).toThrow();
      expect((env.db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n).toBe(before);
      env.db.transaction(() => logCatalogPriceOverride(env.db, input)).immediate();
      const audit = env.db.prepare("SELECT data FROM audit_log WHERE action = 'cat.price.override'").get() as { data: string };
      expect(JSON.parse(audit.data).overrideUnitPriceCents).toBe(11000);
      expect(verifyAuditChain(env.db)).toBeNull();
    } finally {
      await env.app.close(); env.db.close();
    }
  });

  it('requires a reason above the versioned discount threshold', async () => {
    const env = await createTestEnv();
    try {
      const owner = await env.as('owner');
      expect(() => requireCatalogDiscountReason(env.db, 10000, 1000, null, '2026-09-28')).not.toThrow();
      expect(() => requireCatalogDiscountReason(env.db, 10000, 1001, null, '2026-09-28')).toThrow();
      const changed = await owner.put('/api/cat/discount-policy', { thresholdBasisPoints: 500 }, { 'if-match': '1' });
      expect(changed.statusCode).toBe(200);
      expect(changed.json().version).toBe(2);
      expect((await owner.put('/api/cat/discount-policy',
        { thresholdBasisPoints: 200 }, { 'if-match': '1' })).statusCode).toBe(409);
      expect(() => requireCatalogDiscountReason(env.db, 10000, 600, null, '2026-09-28')).toThrow();
      expect(() => requireCatalogDiscountReason(env.db, 10000, 600, null, '2026-09-27')).not.toThrow();
      expect(() => requireCatalogDiscountReason(env.db, 10000, 600, 'Special order', '2026-09-28')).not.toThrow();
      expect(verifyAuditChain(env.db)).toBeNull();
    } finally {
      await env.app.close(); env.db.close();
    }
  });
});
