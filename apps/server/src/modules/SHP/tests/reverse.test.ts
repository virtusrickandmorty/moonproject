/**
 * A confirmed online order cancelled or returned by staff: QS cancels the linked sale and its payment (one mirrored journal,
 * the pieces back in stock), the order says cancelled or returned and keeps the reason, it happens once, and the buyer and the
 * tracking page see only the status.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
const REASON = 'Customer changed their mind, pieces never left the shelf';
let env: TestEnv;
let owner: Client;
let encoder: Client;
let tee = '';
let BDO = 0;
let walkIn = '';
let invoice = 9100;

const send = (url: string, payload: object, ip = '10.0.0.9') => env.app.inject({ method: 'POST', url, payload, remoteAddress: ip });
const bank = () => env.db.prepare('SELECT COALESCE(SUM(debit_cents) - SUM(credit_cents), 0) FROM journal_lines WHERE account_id = ?').pluck().get(BDO) as number;
const available = async () => ((await encoder.get(`/api/shp/products/${tee}/stock`)).json() as { lines: { size: string; colour: string; onHand: number }[] }).lines.find((l) => l.size === 'M' && l.colour === 'White')!.onHand;
const buyerPage = async (n: string, t: string) => (await env.app.inject({ method: 'GET', url: `/api/shp/orders/${n}?t=${t}` })).json() as { status: string; events: { status: string; note: string | null }[] };
const track = (number: string, token?: string) => env.app.inject({ method: 'POST', url: '/api/shp/track', payload: { number, ...(token ? { token } : {}) }, remoteAddress: '10.1.1.1' });

/** An order placed, paid by the buyer and confirmed by staff: a posted quick sale and its payment. */
async function confirmedOrder(qty = 2) {
  const placed = (await send('/api/shp/orders', { name: 'Sample Buyer', email: 'buyer@example.com', phone: '0917 000 0000', fulfilment: 'pickup', consent: true,
    lines: [{ productId: tee, size: 'M', colour: 'White', qty }] })).json() as { number: string; token: string };
  await send(`/api/shp/orders/${placed.number}/payment`, { token: placed.token, reference: 'REF 123456', proof: { name: 'proof.png', data: PNG } });
  const id = ((await encoder.get('/api/shp/admin/orders')).json() as { rows: { id: string; number: string }[] }).rows.find((r) => r.number === placed.number)!.id;
  const n = String(invoice++);
  const confirmed = await encoder.post(`/api/shp/admin/orders/${id}/confirm`, { customerId: walkIn, invoiceNumber: n, crNumber: `${n}1`, version: 2 });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return { ...placed, id, saleId: confirmed.json().sale.id as string };
}
const detail = async (id: string) => (await encoder.get(`/api/shp/admin/orders/${id}`)).json() as { status: string; version: number; reversal: { kind: string; reason: string } | null; events: { status: string; note: string | null; userName: string | null }[] };

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  walkIn = seedCustomers(env.db, encoder.userId).school;
  BDO = cashPlaceId(env.db, '1111');
  const category = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
  tee = ((await owner.post('/api/shp/products', { name: 'Sample classic tee', categoryId: category, shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2, badge: '',
    summary: 'A made-up tee for the tests.', sortOrder: 1, features: [], sizes: ['S', 'M'], colours: [{ name: 'White', hex: '#ffffff' }] })).json() as { id: string }).id;
  await owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample Garments', cashPlaceId: BDO, qr: { name: 'qr.png', data: PNG } });
  await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 5 }] });
});

describe('cancel or return a confirmed online order', () => {
  it('reverses the sale once, returns the stock, keeps the reason and refuses a second try', async () => {
    const o = await confirmedOrder(2);
    expect(await available()).toBe(3);
    expect(bank()).toBe(50_000);

    const done = await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version: 3 });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ ok: true, status: 'cancelled' });
    expect(bank()).toBe(0); // the payment is reversed
    expect(await available()).toBe(5); // the pieces are back
    expect(env.db.prepare("SELECT status FROM documents WHERE id = ?").pluck().get(o.saleId)).toBe('cancelled');
    const reversals = env.db.prepare("SELECT COUNT(*) FROM documents WHERE status = 'cancelled'").pluck().get();
    expect(reversals).toBe(2); // the sale and its payment, once each
    const d = await detail(o.id);
    expect(d).toMatchObject({ status: 'cancelled', reversal: { kind: 'cancelled', reason: REASON } });
    expect(d.events.at(-1)).toMatchObject({ status: 'cancelled', note: REASON });

    // A second try, with the new version or the old one, is refused in plain words and moves nothing.
    for (const version of [3, d.version]) {
      const again = await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: 'ALREADY_REVERSED', message: `${o.number} was already cancelled. It can only be done once.` });
    }
    expect(bank()).toBe(0);
    expect(await available()).toBe(5);
    expect(env.db.prepare("SELECT COUNT(*) FROM documents WHERE status = 'cancelled'").pluck().get()).toBe(2);
    // The cancelled order cannot go on to ready or completed.
    expect((await encoder.post(`/api/shp/admin/orders/${o.id}/move`, { to: 'ready', version: d.version })).json().code).toBe('BAD_MOVE');
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('is a return once the order went out, and the buyer page and staff list say so', async () => {
    const o = await confirmedOrder(1);
    await encoder.post(`/api/shp/admin/orders/${o.id}/move`, { to: 'ready', version: 3 });
    expect((await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version: 4 })).json()).toMatchObject({ ok: true, status: 'returned' });
    expect(await available()).toBe(5);
    expect(await buyerPage(o.number, o.token)).toMatchObject({ status: 'returned' });
    const list = (await encoder.get('/api/shp/admin/orders?status=returned')).json() as { rows: { number: string; status: string }[]; counts: Record<string, number> };
    expect(list.rows).toEqual([expect.objectContaining({ number: o.number, status: 'returned' })]);
    expect(list.counts).toMatchObject({ returned: 1 });
    expect((await detail(o.id)).reversal).toMatchObject({ kind: 'returned', reason: REASON });
  });

  it('needs a reason of 10 to 200 characters, the shop permission, and an order the shop confirmed', async () => {
    const o = await confirmedOrder(1);
    for (const reason of ['too short', 'x'.repeat(201)]) expect((await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason, version: 3 })).statusCode).toBe(400);
    expect((await (await env.as('production')).post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version: 3 })).statusCode).toBe(403);
    expect((await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: 'x'.repeat(200), version: 3 })).statusCode).toBe(200);
    // An order still waiting for its payment is rejected, not reversed.
    const waiting = (await send('/api/shp/orders', { name: 'Sample Buyer', email: 'buyer@example.com', phone: '0917 000 0000', fulfilment: 'pickup', consent: true,
      lines: [{ productId: tee, size: 'M', colour: 'White', qty: 1 }] })).json() as { number: string };
    const id = ((await encoder.get('/api/shp/admin/orders')).json() as { rows: { id: string; number: string }[] }).rows.find((r) => r.number === waiting.number)!.id;
    expect((await encoder.post(`/api/shp/admin/orders/${id}/reverse`, { reason: REASON, version: 1 })).json().code).toBe('NOT_REVERSIBLE');
  });

  it('shows the buyer and the tracking page only the status, never the reason or the sale', async () => {
    const o = await confirmedOrder(2);
    await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version: 3 });
    const page = await buyerPage(o.number, o.token);
    expect(page.status).toBe('cancelled');
    expect(page.events.at(-1)).toMatchObject({ status: 'cancelled', note: null });
    expect(JSON.stringify(page)).not.toContain('changed their mind');

    const tracked = await track(o.number);
    expect(tracked.statusCode, tracked.body).toBe(200);
    expect(tracked.json()).toMatchObject({ kind: 'online', number: o.number, status: 'cancelled', statusLabel: 'Cancelled', pieces: 2 });
    const shown = JSON.stringify(tracked.json());
    expect(shown).not.toContain('changed their mind');
    expect(shown).not.toMatch(/IR-|COL-|sale/i);
    expect((tracked.json() as { events: object[] }).events.at(-1)).toEqual({ status: 'cancelled', at: expect.any(String) });
  });

  it('shows a returned order as Returned on the tracking page', async () => {
    const o = await confirmedOrder(1);
    await encoder.post(`/api/shp/admin/orders/${o.id}/move`, { to: 'completed', version: 3 });
    await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version: 4 });
    expect((await track(o.number)).json()).toMatchObject({ status: 'returned', statusLabel: 'Returned' });
  });

  it('does not cancel the sale twice when it was already cancelled in Quick Sale', async () => {
    const o = await confirmedOrder(1);
    const accountant = await env.as('accountant');
    expect((await accountant.post(`/api/qs/sales/${o.saleId}/cancel`, { reason: 'Rang up the wrong thing' }, { 'idempotency-key': 'cancel-sale-first-1' })).statusCode).toBe(200);
    expect((await encoder.post(`/api/shp/admin/orders/${o.id}/reverse`, { reason: REASON, version: 3 })).statusCode).toBe(200);
    expect(await buyerPage(o.number, o.token)).toMatchObject({ status: 'cancelled' });
    expect(env.db.prepare("SELECT COUNT(*) FROM documents WHERE status = 'cancelled'").pluck().get()).toBe(2);
  });
});
