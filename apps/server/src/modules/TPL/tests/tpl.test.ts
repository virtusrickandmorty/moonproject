/**
 * TPL Services (the owner's request, 11 Oct 2026): a stock program; a restock job order through production; finished
 * pieces into stock (never more than finished, and never released to the client); a delivery with its invoice on terms
 * (never below zero stock, credit hold and override); cancel takes both and returns the pieces; counts and the stock card.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { arAging } from '../../RPT/receivables.ts';
import { openSalesOf } from '../../QS/public.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let programId: string;
let polo: string;
let cap: string;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  const p = await owner.post('/api/tpl/programs', { customerId: c.school, termsDays: 30, creditLimitCents: 5_000_000 });
  expect(p.statusCode, p.body).toBe(200);
  programId = p.json().id;
  polo = (await owner.post(`/api/tpl/programs/${programId}/items`, { kind: 'made_to_order', description: 'School polo', size: 'M', priceCents: 50_000, reorderLevel: 20 })).json().id;
  cap = (await owner.post(`/api/tpl/programs/${programId}/items`, { kind: 'ready_made', description: 'School cap', priceCents: 15_000, reorderLevel: 5 })).json().id;
});

const onHand = (itemId: string) => env.db.prepare(`SELECT
    COALESCE((SELECT SUM(qty) FROM tpl_stock_moves WHERE item_id = @i), 0)
  - COALESCE((SELECT SUM(l.qty) FROM tpl_delivery_lines l JOIN documents d ON d.id = l.document_id WHERE l.item_id = @i AND d.status = 'posted'), 0)`).pluck().get({ i: itemId }) as number;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const stage = (jo: string, from: string, to: string) => encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
const deliver = (who: Client, body: object, total: number) => who.post('/api/tpl/deliveries', { delivery: { programId, deliveredBy: 'Rider Jun', feeCents: 0, ...body }, expectedTotalCents: total }, idem());

/** A restock of 100 polos and 10 caps, made and all put into stock. */
async function stocked() {
  const r = await encoder.post('/api/tpl/restocks', { programId, dueInDays: 10, priority: 'normal', lines: [{ itemId: polo, qty: 100 }, { itemId: cap, qty: 10 }] });
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json().id as string;
  await stage(jo, 'open', 'in_production');
  await stage(jo, 'in_production', 'ready');
  const put = await encoder.post('/api/tpl/put-in', { jobOrderId: jo, lines: [{ lineNo: 1, qty: 100 }, { lineNo: 2, qty: 10 }] });
  expect(put.statusCode, put.body).toBe(200);
  return jo;
}

describe('restock and stock', () => {
  it('a restock is a ₱0 job order for the client, with no downpayment; it cannot be released, only put into stock as it finishes', async () => {
    const r = await encoder.post('/api/tpl/restocks', { programId, dueInDays: 10, priority: 'rush', lines: [{ itemId: polo, qty: 100 }] });
    expect(r.statusCode, r.body).toBe(200);
    const jo = r.json();
    expect(jo).toMatchObject({ number: 'JO-000001', totalCents: 0 });
    expect(env.db.prepare('SELECT payment_terms, required_dp_cents FROM jo_orders WHERE document_id = ?').get(jo.id)).toEqual({ payment_terms: 'cod', required_dp_cents: 0 });
    expect(env.db.prepare('SELECT description, qty, unit_price_cents FROM jo_lines WHERE document_id = ?').get(jo.id)).toEqual({ description: 'School polo (M)', qty: 100, unit_price_cents: 0 });

    // Nothing finished yet: nothing goes in.
    const early = await encoder.post('/api/tpl/put-in', { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 10 }] });
    expect(early.json().code).toBe('NOT_FINISHED');

    // A release slip is refused: its pieces are the client's stock.
    await stage(jo.id, 'open', 'in_production');
    await stage(jo.id, 'in_production', 'ready');
    const release = await owner.post('/api/docs/jo.release/preview', { input: { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 10 }], claimedBy: 'Juan', idSeen: 'none' } });
    expect(release.json().issues.map((i: { code: string }) => i.code)).toContain('FOR_STOCK');

    // Ready: 60 go in, then the other 40, and the job order is done.
    expect((await encoder.post('/api/tpl/put-in', { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 60 }] })).json().complete).toBe(false);
    expect(onHand(polo)).toBe(60);
    expect((await encoder.post('/api/tpl/put-in', { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 41 }] })).json().code).toBe('NOT_FINISHED');
    expect((await encoder.post('/api/tpl/put-in', { jobOrderId: jo.id, lines: [{ lineNo: 1, qty: 40 }] })).json().complete).toBe(true);
    expect(onHand(polo)).toBe(100);
    expect(env.db.prepare('SELECT to_stage FROM jo_stage_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1').pluck().get(jo.id)).toBe('released');

    // With pieces in stock, the job order stays.
    const cancel = await owner.post(`/api/docs/jo.job_order/${jo.id}/cancel`, { reason: 'Client changed their mind' }, idem());
    expect(cancel.json().code).toBe('IN_STOCK');
  });

  it('a count sets the pieces on hand with a reason, and the stock card shows every move with its balance', async () => {
    await stocked();
    expect((await encoder.post(`/api/tpl/items/${polo}/count`, { countedQty: 97, reason: 'Count on 28 Sep: 3 stained' })).statusCode).toBe(403);
    const short = await accountant.post(`/api/tpl/items/${polo}/count`, { countedQty: 97, reason: 'short' });
    expect(short.statusCode).toBe(400);
    const counted = await accountant.post(`/api/tpl/items/${polo}/count`, { countedQty: 97, reason: 'Count on 28 Sep: 3 stained' });
    expect(counted.json()).toMatchObject({ onHand: 97 });
    const card = (await encoder.get(`/api/tpl/items/${polo}/card`)).json();
    expect(card.rows.map((r: { kind: string; qty: number; balance: number }) => [r.kind, r.qty, r.balance])).toEqual([['count', -3, 97], ['in', 100, 100]]);
  });
});

describe('deliveries', () => {
  it('delivers from stock with its invoice on the client\'s terms; the invoice ages from its due date and a collection can pay it', async () => {
    await stocked();
    const body = { invoiceNumber: '0601', lines: [{ itemId: polo, qty: 30 }, { itemId: cap, qty: 2 }], feeCents: 15_000, receivedBy: 'Ms. Cruz' };
    const pre = (await encoder.post('/api/tpl/deliveries/preview', { delivery: { programId, deliveredBy: 'Rider Jun', ...body } })).json();
    expect(pre).toMatchObject({ totalCents: 1_545_000, dueDate: '2026-10-28', delivery: { issues: [] }, invoice: { issues: [] } });
    expect(pre.delivery.summary).toBe('This will deliver 32 pieces to Moonlight Test School from their stock and record invoice no. 0601: ₱15,300.00 for the pieces and a delivery fee of ₱150.00, ₱15,450.00 in all, due 2026-10-28 (30 days).');

    const res = await deliver(encoder, body, 1_545_000);
    expect(res.statusCode, res.body).toBe(200);
    const { delivery, invoice } = res.json();
    expect(delivery).toMatchObject({ number: 'DR-000001', totalCents: 1_545_000 });
    expect(invoice).toMatchObject({ number: 'IR-000001', totalCents: 1_545_000 });
    expect(onHand(polo)).toBe(70);
    expect(onHand(cap)).toBe(8);

    // The invoice: a quick sale on 30 days, its lines the pieces at the program price and the fee as a service.
    expect(env.db.prepare('SELECT terms_days, due_date FROM qs_sale_terms WHERE document_id = ?').get(invoice.id)).toEqual({ terms_days: 30, due_date: '2026-10-28' });
    expect(env.db.prepare('SELECT kind, description, qty, unit_price_cents FROM qs_sale_lines WHERE document_id = ? ORDER BY line_no').raw().all(invoice.id)).toEqual([
      ['made_to_order', 'School polo (M)', 30, 50_000], ['ready_made', 'School cap', 2, 15_000], ['service', 'Delivery fee', 1, 15_000],
    ]);
    expect(openSalesOf(env.db, c.school).map((s) => [s.number, s.openCents])).toEqual([['IR-000001', 1_545_000]]);
    const aging = arAging(env.db, '2026-11-15').rows.find((r) => r.documentNumber === 'IR-000001');
    expect(aging).toMatchObject({ documentType: 'qs.sale', dueDate: '2026-10-28', buckets: { days1to30: 1_545_000 } });
    noBrokenInvariants();
  });

  it('never delivers more than is on hand, and the generic document route cannot record one without its invoice', async () => {
    await stocked();
    const over = await deliver(encoder, { invoiceNumber: '0601', lines: [{ itemId: polo, qty: 101 }] }, 5_050_000);
    expect(over.statusCode).toBe(422);
    expect(over.json().details.map((i: { code: string }) => i.code)).toContain('NOT_ENOUGH');
    const generic = await owner.post('/api/docs/tpl.delivery/post', { input: { programId, invoiceNumber: '0601', lines: [{ itemId: polo, qty: 1 }], feeCents: 0, deliveredBy: 'Rider' }, expectedTotalCents: 50_000 }, idem());
    expect(generic.json().code).toBe('USE_TPL_DELIVERY');
    expect(onHand(polo)).toBe(100);
  });

  it('holds a delivery over the credit limit or with an invoice past due, unless the owner gives a reason', async () => {
    await stocked();
    expect((await deliver(encoder, { invoiceNumber: '0601', lines: [{ itemId: polo, qty: 90 }] }, 4_500_000)).statusCode).toBe(200);
    // ₱45,000 owed; ₱10,000 more is over the ₱50,000 limit.
    const held = await deliver(encoder, { invoiceNumber: '0602', lines: [{ itemId: polo, qty: 10 }], feeCents: 1 }, 500_001);
    expect(held.json().details.find((i: { code: string }) => i.code === 'CREDIT_HOLD')?.message).toContain('over the credit limit of ₱50,000.00');
    const tried = await deliver(encoder, { invoiceNumber: '0602', lines: [{ itemId: polo, qty: 10 }], feeCents: 1, overrideReason: 'The principal promised to pay Friday' }, 500_001);
    expect(tried.json().details.find((i: { code: string }) => i.code === 'CREDIT_HOLD')?.message).toContain('Only someone allowed to override');
    const ok = await deliver(owner, { invoiceNumber: '0602', lines: [{ itemId: polo, qty: 10 }], feeCents: 1, overrideReason: 'The principal promised to pay Friday' }, 500_001);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(env.db.prepare('SELECT override_reason FROM tpl_deliveries WHERE document_id = ?').pluck().get(ok.json().delivery.id)).toBe('The principal promised to pay Friday');
  });

  it('cancel takes the delivery and its invoice together and the pieces come back; the invoice alone cannot be cancelled', async () => {
    await stocked();
    const { delivery, invoice } = (await deliver(encoder, { invoiceNumber: '0601', lines: [{ itemId: polo, qty: 30 }] }, 1_500_000)).json();
    const alone = await accountant.post(`/api/qs/sales/${invoice.id}/cancel`, { reason: 'Wrong invoice number used' }, idem());
    expect(alone.json().code).toBe('HAS_DEPENDENTS');
    const generic = await accountant.post(`/api/docs/tpl.delivery/${delivery.id}/cancel`, { reason: 'Wrong invoice number used' }, idem());
    expect(generic.json().code).toBe('HAS_DEPENDENTS');
    expect((await encoder.post(`/api/tpl/deliveries/${delivery.id}/cancel`, { reason: 'Wrong invoice number used' }, idem())).statusCode).toBe(403);

    const res = await accountant.post(`/api/tpl/deliveries/${delivery.id}/cancel`, { reason: 'Wrong invoice number used' }, idem());
    expect(res.statusCode, res.body).toBe(200);
    expect(env.db.prepare('SELECT status FROM documents WHERE id IN (?, ?)').pluck().all(delivery.id, invoice.id)).toEqual(['cancelled', 'cancelled']);
    expect(onHand(polo)).toBe(100);
    const card = (await encoder.get(`/api/tpl/items/${polo}/card`)).json();
    expect(card.rows.map((r: { kind: string; qty: number; balance: number }) => [r.kind, r.qty, r.balance])).toEqual([['back', 30, 100], ['out', -30, 70], ['in', 100, 100]]);
    noBrokenInvariants();
  });

  it('lists the program with its stock and money, and the home card shows items to restock', async () => {
    await stocked();
    await deliver(encoder, { invoiceNumber: '0601', lines: [{ itemId: polo, qty: 85 }] }, 4_250_000);
    const list = (await encoder.get('/api/tpl/programs')).json().rows;
    expect(list[0]).toMatchObject({ customerName: 'Moonlight Test School', items: 2, onHand: 25, belowReorder: 1, openCents: 4_250_000, overdueCents: 0 });
    const home = (await encoder.get('/api/tpl/home')).json();
    expect(home.restock).toEqual([{ programId, customerName: 'Moonlight Test School', item: 'School polo (M)', onHand: 15, reorderLevel: 20 }]);
  });
});
