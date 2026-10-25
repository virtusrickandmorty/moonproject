/**
 * The website shop's own stock in the books (the owner's request, 25 Oct 2026): at a month end the accountant values the
 * shop's pieces on hand at cost, 1304 against the inventory change (5109), like the TPL clients' stock. The pieces on hand
 * on the value date come from the shop's stock by date; a later value adjusts by the difference.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobMargins } from '../../RPT/payroll-production.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
let accountant: Client;
let tee = '';
let polo = '';

const journalOf = (documentId: string, kind = 'original') => env.db.prepare(`SELECT a.code, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
  JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`).raw().all(documentId, kind) as [string, number, number][];
const value = (c: Client, lines: { itemId: string; unitCostCents: number }[], total: number, businessDate?: string) =>
  c.post('/api/docs/shp.valuation/post', { input: { lines }, expectedTotalCents: total, ...(businessDate ? { businessDate } : {}) }, idem());
const sheet = async (date: string) => ((await accountant.get(`/api/shp/value-sheet?date=${date}`)).json() as { items: { itemId: string; description: string; qty: number; lastCostCents: number | null }[] }).items;
const product = async (name: string, categoryId: string) => ((await owner.post('/api/shp/products', { name, categoryId, shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2,
  badge: '', summary: 'A made-up shirt for the tests.', sortOrder: 1, features: [], sizes: ['S', 'M'], colours: [{ name: 'White', hex: '#ffffff' }] })).json() as { id: string }).id;

beforeEach(async () => {
  env = await createTestEnv('2026-09-30T02:00:00Z'); encoderOwnDefaults(env); // 10:00 on 30 September in Manila: a month end
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  const category = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
  tee = await product('Sample classic tee', category);
  polo = await product('Sample polo', category);
  await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 10 }, { size: 'S', colour: 'White', qty: 2 }] });
  await encoder.post(`/api/shp/products/${polo}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 4 }] });
});

describe("the shop's own stock valued at cost at a month end", () => {
  it('values the pieces on hand by product: Dr 1304 / Cr 5109; a cancel takes it back', async () => {
    expect((await sheet('2026-09-30')).map((i) => [i.description, i.qty, i.lastCostCents])).toEqual([['Sample classic tee', 12, null], ['Sample polo', 4, null]]);
    expect(await sheet('2026-09-29')).toEqual([]); // nothing was in the shop the day before

    // 12 tees at ₱110 and 4 polos at ₱150: ₱1,920.
    const first = await value(accountant, [{ itemId: tee, unitCostCents: 11_000 }, { itemId: polo, unitCostCents: 15_000 }], 192_000);
    expect(first.statusCode, first.body).toBe(200);
    expect(journalOf(first.json().id)).toEqual([['1304', 192_000, 0], ['5109', 0, 192_000]]);
    expect((await sheet('2026-09-30')).map((i) => i.lastCostCents)).toEqual([11_000, 15_000]);

    const cancel = await accountant.post(`/api/docs/shp.valuation/${first.json().id}/cancel`, { reason: 'Costs typed for the wrong month' }, idem());
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(journalOf(first.json().id, 'reversal')).toEqual([['1304', 0, 192_000], ['5109', 192_000, 0]]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('needs every product on hand, a month end, and the accountant or an owner; nothing to adjust is refused', async () => {
    const codes = async (r: Promise<{ json(): { code?: string; details?: { code: string }[] } }>) => { const j = (await r).json(); return Array.isArray(j.details) ? j.details.map((i) => i.code) : [j.code, JSON.stringify(j)]; };
    expect(await codes(value(accountant, [{ itemId: tee, unitCostCents: 11_000 }], 132_000))).toContain('MISSING');
    expect(await codes(value(accountant, [{ itemId: tee, unitCostCents: 0 }, { itemId: polo, unitCostCents: 0 }], 0))).toContain('NO_DIFFERENCE');
    expect((await value(encoder, [{ itemId: tee, unitCostCents: 11_000 }, { itemId: polo, unitCostCents: 15_000 }], 192_000)).statusCode).toBe(403);
    expect(await codes(value(accountant, [{ itemId: tee, unitCostCents: 11_000 }], 0, '2026-09-15'))).toContain('NOT_MONTH_END');
  });
});

describe('job margin: the website shop as one line', () => {
  it('margins what its pieces sold for, net of VAT, and its stock value counts the pieces left', async () => {
    const walkIn = seedCustomers(env.db, encoder.userId).school;
    const sold = await encoder.post('/api/qs/sales', { sale: { customerId: walkIn, invoiceNumber: '9001', lines: [{ kind: 'ready_made', description: 'Sample classic tee (White, M)', qty: 3, unitPriceCents: 25_000, discountCents: 0,
      item: { productId: tee, size: 'M', colour: 'White' } }] }, payment: { crNumber: '9101', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 75_000 }] }, expectedTotalCents: 75_000 }, idem());
    expect(sold.statusCode, sold.body).toBe(200);
    expect((await sheet('2026-09-30')).map((i) => [i.description, i.qty])).toEqual([['Sample classic tee', 9], ['Sample polo', 4]]);
    // 3 tees at ₱250 with VAT: ₱669.64 net; no shop work orders, so no labor yet.
    expect(jobMargins(env.db).tplClients).toEqual([expect.objectContaining({ programId: 'shop', customerName: 'Website shop (own brand)', piecesDelivered: 3, invoiceNetCents: 66_964, pieceLaborCents: 0, marginCents: 66_964 })]);
  });
});
