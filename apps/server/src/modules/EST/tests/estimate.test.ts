/** Cost estimates (the owner's request, Nov 2026): an order priced from the cost sheets, recorded as it was worked out. */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
let polo: string;
let jacket: string;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  const item = async (code: string, name: string, garmentType: string) =>
    (await owner.post('/api/cat/items', { code, name, class: 'made_to_order_garment', garmentType, unit: 'pc', setComponents: 1 })).json().id as string;
  polo = await item('POLO-1', 'Polo shirt plain', 'Polo shirt');
  jacket = await item('JKT-1', 'Varsity jacket', 'Jacket'); // no cost sheet
  const fabric = (await owner.post('/api/pur/supplies', { name: 'Honeycomb fabric', unit: 'yard', category: 'materials' })).json().id;
  env.db.prepare('UPDATE pur_supplies SET last_purchase_cost_cents = 12000 WHERE id = ?').run(fabric);
  // ₱150 fabric + ₱25 paper and ink + ₱72 labour + 10% overhead = ₱271.70 a piece, ₱500 setup per order.
  const res = await owner.post('/api/est/sheets', { itemId: polo, garmentType: 'Polo shirt', complexity: 'standard', isSet: false, setupCents: 50_000, reason: 'First cost sheet',
    lines: [{ kind: 'materials', supplyId: fabric, description: 'Honeycomb fabric', qtyMilli: 1_250 }, { kind: 'sublimation', description: 'Paper and ink', qtyMilli: 1_000, typedCostCents: 2_500 }] });
  expect(res.statusCode, res.body).toBe(200);
});

const preview = (input: object) => owner.post('/api/docs/est.estimate/preview', { input });
const post = async (input: object) => {
  const p = (await preview(input)).json();
  return owner.post('/api/docs/est.estimate/post', { input, expectedTotalCents: p.totalCents }, idem());
};
type Line = { unitCostCents: number; suggestedCents: number; priceCents: number; tierFromQty: number; marginBp: number; lineTotalCents: number };

describe('cost estimates', () => {
  it('prices each line from its cost sheet at its quantity, keeps a typed price with its reason, and records what it took', async () => {
    const input = { prospectName: 'Made-up Barangay League', lines: [
      { itemId: polo, description: 'Team polo', qty: 30, extraCostCents: 1_500, extraReason: 'Gold foil logo' },
      { itemId: polo, description: 'Coach polo', qty: 5, unitPriceCents: 60_000, priceReason: 'Same price as the team' },
    ] };
    const p = (await preview(input)).json();
    expect(p.issues).toEqual([]);
    const [team, coach] = p.doc.lines as Line[];
    // 30 pcs: ₱271.70 + ₱500 ÷ 30 (₱16.67) + ₱15 extra = ₱303.37; 35% from 12 pcs: ÷ 0.65 = ₱466.72 → ₱470.
    expect(team).toMatchObject({ unitCostCents: 30_337, tierFromQty: 12, marginBp: 3_500, suggestedCents: 47_000, priceCents: 47_000, lineTotalCents: 1_410_000 });
    // 5 pcs: ₱271.70 + ₱100 setup = ₱371.70; 45%: ÷ 0.55 = ₱675.82 → ₱680; ₱600 typed.
    expect(coach).toMatchObject({ unitCostCents: 37_170, tierFromQty: 1, suggestedCents: 68_000, priceCents: 60_000, lineTotalCents: 300_000 });
    expect([p.doc.totalCents, p.doc.costCents, p.doc.profitCents, p.doc.marginBp]).toEqual([1_710_000, 1_095_960, 614_040, 3_591]);
    expect(p.summary).toBe('This will record a cost estimate for Made-up Barangay League: 2 items totalling ₱17,100.00, a profit of ₱6,140.40 (35.91%).');

    const res = await post(input);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().number).toBe('EST-000001');
    const d = (await owner.get(`/api/docs/est.estimate/${res.json().id}`)).json();
    expect(d.doc.lines.map((l: Line) => [l.unitCostCents, l.priceCents])).toEqual([[30_337, 47_000], [37_170, 60_000]]);
    expect(d.input).toEqual(input);
    // A later cost change leaves the recorded estimate as it was.
    env.db.prepare("UPDATE pur_supplies SET last_purchase_cost_cents = 20000 WHERE name = 'Honeycomb fabric'").run();
    expect((await owner.get(`/api/docs/est.estimate/${res.json().id}`)).json().doc.totalCents).toBe(1_710_000);
    expect((await preview(input)).json().doc.lines[0].unitCostCents).toBeGreaterThan(30_337);
  });

  it('refuses an item with no cost sheet and a changed price with no reason; warns when the price is below the cost', async () => {
    const p = (await preview({ prospectName: 'Made-up School', lines: [
      { itemId: jacket, description: 'Jacket', qty: 10 },
      { itemId: polo, description: 'Polo', qty: 10, unitPriceCents: 20_000 },
    ] })).json();
    expect(p.issues.map((i: { code: string; level: string }) => `${i.code} ${i.level}`)).toEqual(['NO_SHEET error', 'PRICE_REASON error', 'BELOW_COST warning']);
    expect(p.issues[2].message).toBe('Line 2: ₱200.00 is below the cost of ₱321.70 a piece; the order loses ₱1,217.00.');
  });

  it('keeps estimates with the accountant and the owners', async () => {
    const encoder = await env.as('encoder');
    expect((await encoder.post('/api/docs/est.estimate/preview', { input: { prospectName: 'X Co', lines: [{ itemId: polo, description: 'Polo', qty: 1 }] } })).statusCode).toBe(403);
  });

  it('never suggests a price below the cost of a piece, whatever the quantity', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5_000 }), async (qty) => {
      const l = (await preview({ prospectName: 'Made-up Prospect', lines: [{ itemId: polo, description: 'Polo', qty }] })).json().doc.lines[0] as Line;
      expect(l.suggestedCents).toBeGreaterThanOrEqual(l.unitCostCents);
      expect(l.lineTotalCents).toBe(qty * l.suggestedCents);
    }), { numRuns: 15 });
  });
});
