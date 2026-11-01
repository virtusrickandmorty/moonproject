/** Costing (the owner's request, Nov 2026): cost sheets per price list item, the costing rules, tier prices and suggestions. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { priceFor } from '../costing.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
let polo: string;
let fabric: string;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  polo = (await owner.post('/api/cat/items', { code: 'POLO-1', name: 'Polo shirt plain', class: 'made_to_order_garment', garmentType: 'Polo shirt', unit: 'pc', setComponents: 1 })).json().id;
  expect(polo, 'item').toBeTruthy();
  let version = 1;
  for (const [minQty, unitPriceCents] of [[1, 150_000], [12, 45_000]] as const) {
    const res = await owner.post(`/api/cat/items/${polo}/prices`, { effectiveFrom: '2026-09-28', minQty, unitPriceCents }, { 'if-match': String(version++) });
    expect(res.statusCode, res.body).toBe(200);
  }
  fabric = (await owner.post('/api/pur/supplies', { name: 'Honeycomb fabric', unit: 'yard', category: 'materials' })).json().id;
  setFabricCost(12_000); // ₱120 a yard, as if from the last purchase
});

const setFabricCost = (cents: number) => env.db.prepare('UPDATE pur_supplies SET last_purchase_cost_cents = ? WHERE id = ?').run(cents, fabric);
const sheet = (o: object = {}) => ({
  itemId: polo, garmentType: 'Polo shirt', complexity: 'standard', isSet: false, setupCents: 50_000, reason: 'First cost sheet',
  lines: [
    { kind: 'materials', supplyId: fabric, description: 'Honeycomb fabric', qtyMilli: 1_250 },
    { kind: 'sublimation', description: 'Paper and ink', qtyMilli: 1_000, typedCostCents: 2_500 },
  ], ...o,
});

describe('cost sheets', () => {
  it('costs a piece from the supplies, the piece rates, overhead and setup, and prices each tier', async () => {
    const res = await owner.post('/api/est/sheets', sheet());
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json();
    // 1.25 yd × ₱120 = ₱150; paper and ink ₱25; labour: sewing ₱60 + cutting ₱12 (starter rates) = ₱72.
    expect([c.materialsCents, c.sublimationCents, c.labourCents, c.directCents, c.overheadCents]).toEqual([15_000, 2_500, 7_200, 24_700, 2_470]);
    expect(c.labour.map((l: { stepCode: string }) => l.stepCode).sort()).toEqual(['CUTTING', 'SEWING']);
    // Setup ₱500 spread over each tier's fewest pieces; margins 45% / 35% / 25%; up to the next ₱5.
    expect(c.tiers.map((t: { fromQty: number; costCents: number; priceCents: number }) => [t.fromQty, t.costCents, t.priceCents])).toEqual([
      [1, 77_170, 140_500], [12, 31_337, 48_500], [50, 28_170, 38_000],
    ]);
    expect(c.tiers[1]).toMatchObject({ catalogCents: 45_000, commissionCents: 0, profitCents: 48_500 - 31_337 });
    expect(c.suggestions.map((s: { code: string }) => s.code)).toEqual(['STARTER_RULES', 'BELOW_TARGET']);
    expect(c.suggestions[1].message).toBe("At 12+ pcs the price list's ₱450.00 earns about 30%, under the 35% wanted. Suggested: ₱485.00.");
  });

  it('says when a supply cost has moved since the sheet was saved, and keeps every version', async () => {
    await owner.post('/api/est/sheets', sheet());
    setFabricCost(15_000);
    const c = (await owner.get(`/api/est/sheets/${polo}`)).json().sheet;
    expect(c.lines[0]).toMatchObject({ unitCostCents: 15_000, savedCostCents: 12_000 });
    expect(c.suggestions.find((s: { code: string }) => s.code === 'COST_UP').message).toBe('Honeycomb fabric now costs ₱150.00 a yard (the supplies list), up 25% from ₱120.00 when this sheet was saved.');
    // Saved again: the new cost is the one saved; the first version stays.
    const again = (await owner.post('/api/est/sheets', sheet({ reason: 'Fabric went up' }))).json();
    expect(again.suggestions.some((s: { code: string }) => s.code === 'COST_UP')).toBe(false);
    expect(env.db.prepare('SELECT COUNT(*) FROM est_sheet_versions').pluck().get()).toBe(2);
  });

  it('commission and margin both come out of the price; new rules apply to every sheet', async () => {
    await owner.post('/api/est/sheets', sheet());
    const bad = await owner.post('/api/est/rules', { overheadBp: 1_000, commissionBp: 500, roundToCents: 100, tiers: [{ fromQty: 12, marginBp: 3_000 }], reason: 'Our own costing rules' });
    expect(bad.json().code).toBe('TIERS');
    const res = await owner.post('/api/est/rules', { overheadBp: 1_500, commissionBp: 500, roundToCents: 100, tiers: [{ fromQty: 1, marginBp: 3_000 }, { fromQty: 24, marginBp: 2_000 }], reason: 'Our own costing rules' });
    expect(res.statusCode, res.body).toBe(200);
    const c = (await owner.get(`/api/est/sheets/${polo}`)).json().sheet;
    expect(c.overheadCents).toBe(3_705);
    expect(c.tiers.map((t: { fromQty: number }) => t.fromQty)).toEqual([1, 24]);
    const t = c.tiers[1]; // cost ₱284.05 + ₱20.84 setup = ₱304.89; ÷ (1 − 20% − 5%) = ₱406.52 → ₱407
    expect([t.costCents, t.priceCents, t.commissionCents]).toEqual([30_489, 40_700, 2_035]);
    expect(c.suggestions.some((s: { code: string }) => s.code === 'STARTER_RULES')).toBe(false);
    expect(priceFor(10_000, 4_000, { commissionBp: 0, roundToCents: 1 })).toBe(16_667);
  });

  it('shows an encoder the suggested prices only, and keeps the costs and the set-up with the owner', async () => {
    await owner.post('/api/est/sheets', sheet());
    const list = (await encoder.get('/api/est/sheets')).json();
    expect(list.costs).toBe(false);
    expect(list.sheets[0]).toEqual({ itemId: polo, itemName: 'Polo shirt plain', unit: 'pc', savedAt: expect.any(String), tiers: [
      { fromQty: 1, priceCents: 140_500, catalogCents: 150_000 }, { fromQty: 12, priceCents: 48_500, catalogCents: 45_000 }, { fromQty: 50, priceCents: 38_000, catalogCents: 45_000 },
    ] });
    expect((await encoder.get('/api/est/rules')).statusCode).toBe(403);
    expect((await encoder.post('/api/est/sheets', sheet())).statusCode).toBe(403);
  });

  it('says when a supply has no purchase cost yet, and when the rates of a set need "A set" ticked', async () => {
    setFabricCost(0);
    const c = (await owner.post('/api/est/sheets/preview', { ...sheet(), reason: undefined, garmentType: 'Practice set' })).json();
    env.db.prepare("INSERT INTO rate_piece_rates (garment_type, step_code, complexity, part, rate_cents, effective_from, reason, created_at) VALUES ('Practice set', 'SEWING', 'standard', 'upper', 5000, '2026-01-01', 'Made-up set rate', '2026-09-28T00:00:00.000+08:00')").run();
    expect(c.suggestions.map((s: { code: string }) => s.code)).toEqual(['STARTER_RULES', 'NO_COST', 'NO_LABOUR']);
    const again = (await owner.post('/api/est/sheets/preview', { ...sheet(), reason: undefined, garmentType: 'Practice set' })).json();
    expect(again.suggestions.find((s: { code: string }) => s.code === 'NO_LABOUR').message).toBe('Practice set has piece rates for its upper and lower parts only: tick "A set" to count them.');
    expect((await owner.post('/api/est/sheets/preview', { ...sheet(), reason: undefined, garmentType: 'Practice set', isSet: true })).json().labourCents).toBe(5_000);
  });

  it('refuses a line with both a supply and a typed cost, or neither', async () => {
    const both = await owner.post('/api/est/sheets/preview', { ...sheet(), reason: undefined, lines: [{ kind: 'materials', supplyId: fabric, description: 'Fabric', qtyMilli: 1_000, typedCostCents: 100 }] });
    expect(both.json()).toMatchObject({ code: 'LINE', message: 'Line 1: pick a supply, or type a cost per piece (not both).' });
    const none = await owner.post('/api/est/sheets/preview', { ...sheet(), reason: undefined, lines: [{ kind: 'materials', description: 'Fabric', qtyMilli: 1_000 }] });
    expect(none.json().code).toBe('LINE');
  });
});
