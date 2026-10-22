/**
 * TPL in the books (the owner's request, 22 Oct 2026): the clients' stock valued at cost at a month end (1303 against
 * 5109), the delivery fee as delivery income (4104, not repairs and alterations), and restocks margined per client in
 * the job margin report, not as a loss each.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobMargins } from '../../RPT/payroll-production.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
let accountant: Client;
let programId: string;
let polo: string;
let cap: string;

beforeEach(async () => {
  env = await createTestEnv('2026-09-30T02:00:00Z'); encoderOwnDefaults(env); // 10:00 on 30 September in Manila: a month end
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  const c = seedCustomers(env.db, encoder.userId);
  programId = (await owner.post('/api/tpl/programs', { customerId: c.school, termsDays: 30, creditLimitCents: 0 })).json().id;
  polo = (await owner.post(`/api/tpl/programs/${programId}/items`, { kind: 'made_to_order', description: 'School polo', size: 'M', priceCents: 50_000, reorderLevel: 20 })).json().id;
  cap = (await owner.post(`/api/tpl/programs/${programId}/items`, { kind: 'ready_made', description: 'School cap', priceCents: 15_000, reorderLevel: 5 })).json().id;
});

/** A restock of 100 polos and 10 caps, made and all put into stock. */
async function stocked() {
  const jo = (await encoder.post('/api/tpl/restocks', { programId, dueInDays: 10, priority: 'normal', lines: [{ itemId: polo, qty: 100 }, { itemId: cap, qty: 10 }] })).json().id as string;
  await encoder.post(`/api/jo/orders/${jo}/stage`, { from: 'open', to: 'in_production' });
  await encoder.post(`/api/jo/orders/${jo}/stage`, { from: 'in_production', to: 'ready' });
  const put = await encoder.post('/api/tpl/put-in', { jobOrderId: jo, lines: [{ lineNo: 1, qty: 100 }, { lineNo: 2, qty: 10 }] });
  expect(put.statusCode, put.body).toBe(200);
  return jo;
}
const deliver = (body: object, total: number) => encoder.post('/api/tpl/deliveries', { delivery: { programId, deliveredBy: 'Rider Jun', feeCents: 0, ...body }, expectedTotalCents: total }, idem());
/** A document's journal: [code, debit, credit] per line. */
const journalOf = (documentId: string, kind = 'original') => env.db.prepare(`SELECT a.code, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
  JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`).raw().all(documentId, kind) as [string, number, number][];
/** An account's balance, debit side positive. */
const balance = (code: string) => env.db.prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?`).pluck().get(code) as number;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const value = (c: Client, lines: { itemId: string; unitCostCents: number }[], total: number, businessDate?: string) =>
  c.post('/api/docs/tpl.valuation/post', { input: { lines }, expectedTotalCents: total, ...(businessDate ? { businessDate } : {}) }, idem());

describe('the delivery fee is delivery income', () => {
  it('moves the fee out of repairs and alterations into 4104, exactly as its invoice split it; a cancel takes it back', async () => {
    await stocked();
    const res = await deliver({ invoiceNumber: '0601', lines: [{ itemId: polo, qty: 30 }], feeCents: 15_000 }, 1_515_000);
    expect(res.statusCode, res.body).toBe(200);
    const { delivery, invoice } = res.json();
    const service = journalOf(invoice.id).find(([code]) => code === '4103')![2];
    expect(service).toBeGreaterThan(13_000); // the fee's NET: ₱150 less its VAT share
    expect(journalOf(delivery.id)).toEqual([['4103', service, 0], ['4104', 0, service]]);
    expect([balance('4103'), balance('4104')]).toEqual([0, -service]);
    expect((await owner.post(`/api/tpl/deliveries/${delivery.id}/cancel`, { reason: 'Delivered to the wrong campus' }, idem())).statusCode).toBe(200);
    expect([balance('4103'), balance('4104')]).toEqual([0, 0]);
    noBrokenInvariants();
  });

  it('a delivery with no fee posts no journal of its own', async () => {
    await stocked();
    const { delivery } = (await deliver({ invoiceNumber: '0601', lines: [{ itemId: cap, qty: 2 }] }, 30_000)).json();
    expect(journalOf(delivery.id)).toEqual([]);
  });
});

describe('the clients\' stock valued at cost at a month end', () => {
  it('values the pieces on hand at their cost: Dr 1303 / Cr 5109; a later value adjusts by the difference', async () => {
    await stocked();
    await deliver({ invoiceNumber: '0601', lines: [{ itemId: polo, qty: 30 }] }, 1_500_000);
    const sheet = (await accountant.get('/api/tpl/value-sheet?date=2026-09-30')).json();
    expect(sheet.items.map((i: { description: string; qty: number; lastCostCents: number | null }) => [i.description, i.qty, i.lastCostCents])).toEqual([['School cap', 10, null], ['School polo', 70, null]]);

    // 70 polos at ₱200 and 10 caps at ₱60: ₱14,600.
    const first = await value(accountant, [{ itemId: polo, unitCostCents: 20_000 }, { itemId: cap, unitCostCents: 6_000 }], 1_460_000);
    expect(first.statusCode, first.body).toBe(200);
    expect(journalOf(first.json().id)).toEqual([['1303', 1_460_000, 0], ['5109', 0, 1_460_000]]);
    expect((await accountant.get('/api/tpl/value-sheet?date=2026-09-30')).json().items.map((i: { lastCostCents: number }) => i.lastCostCents)).toEqual([6_000, 20_000]);

    // The same date again: refused; an edit is the way.
    expect((await value(accountant, [{ itemId: polo, unitCostCents: 20_000 }, { itemId: cap, unitCostCents: 6_000 }], 1_460_000)).json().details.map((i: { code: string }) => i.code)).toContain('ALREADY_VALUED');
    noBrokenInvariants();
  });

  it('needs every item on hand, a month end, and the accountant or an owner; nothing to adjust is refused', async () => {
    await stocked();
    const codes = async (r: Promise<{ json(): { code?: string; details?: { code: string }[] } }>) => { const j = (await r).json(); return Array.isArray(j.details) ? j.details.map((i) => i.code) : [j.code, JSON.stringify(j)]; };
    expect(await codes(value(accountant, [{ itemId: polo, unitCostCents: 20_000 }], 2_000_000))).toContain('MISSING');
    expect(await codes(value(accountant, [{ itemId: polo, unitCostCents: 0 }, { itemId: cap, unitCostCents: 0 }], 0))).toContain('NO_DIFFERENCE');
    expect((await value(encoder, [{ itemId: polo, unitCostCents: 20_000 }, { itemId: cap, unitCostCents: 6_000 }], 2_060_000)).statusCode).toBe(403);
    expect(await codes(value(accountant, [{ itemId: polo, unitCostCents: 20_000 }, { itemId: cap, unitCostCents: 6_000 }], 0, '2026-09-15'))).toContain('NOT_MONTH_END'); // nothing on hand yet on the 15th, so ₱0
  });
});

describe('job margin: TPL restocks per client, not as a loss each', () => {
  it('leaves restock job orders out of the per-job rows and margins each client on its deliveries', async () => {
    const jo = await stocked();
    await deliver({ invoiceNumber: '0601', lines: [{ itemId: polo, qty: 30 }], feeCents: 15_000 }, 1_515_000);
    const m = jobMargins(env.db);
    expect(m.rows.map((r) => r.id)).not.toContain(jo);
    expect(m.tplClients).toHaveLength(1);
    // 30 polos at ₱500 with VAT: ₱13,392.86 net of VAT (the fee is delivery income, left out); no piece labor paid yet.
    expect(m.tplClients[0]).toMatchObject({ customerName: 'Moonlight Test School', restocks: 1, piecesIn: 110, piecesDelivered: 30, pieceLaborCents: 0, laborPerPieceCents: 0 });
    expect(m.tplClients[0]!.invoiceNetCents).toBe(m.tplClients[0]!.marginCents);
    expect(m.tplClients[0]!.invoiceNetCents).toBeGreaterThan(1_330_000);
    expect(m.tplClients[0]!.invoiceNetCents).toBeLessThan(1_345_000);
  });
});
