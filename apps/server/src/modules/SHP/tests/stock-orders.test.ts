/**
 * The website shop's stock and online orders: categories; pieces in and counts; a counter sale (POS) takes pieces off and its
 * cancel gives them back; an online order holds its pieces for 24 hours, the customer sends the payment, staff confirm it
 * into a quick sale (the usual journal) or reject it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
let env: TestEnv;
let owner: Client;
let encoder: Client;
let category = '';
let tee = '';
let BDO = 0, CASH = 0;
let walkIn = '';

const product = (extra: object = {}) => ({
  name: 'Sample classic tee', categoryId: category, shape: 'tee', priceCents: 25_000, madeToOrder: false, minQty: 1, leadDays: 2, badge: '',
  summary: 'A made-up tee for the tests.', sortOrder: 1, features: [], sizes: ['S', 'M'], colours: [{ name: 'White', hex: '#ffffff' }, { name: 'Ink', hex: '#1e293b' }], ...extra,
});
const stock = async (id = tee) => ((await encoder.get(`/api/shp/products/${id}/stock`)).json() as { lines: { size: string; colour: string; onHand: number; held: number; available: number }[] }).lines;
const item = async (size: string, colour: string, id = tee) => (await stock(id)).find((l) => l.size === size && l.colour === colour)!;
const send = (url: string, payload: object, ip = '10.0.0.9') => env.app.inject({ method: 'POST', url, payload, remoteAddress: ip });
const order = (lines: object[], extra: object = {}) => send('/api/shp/orders', {
  name: 'Sample Buyer', email: 'buyer@example.com', phone: '0917 000 0000', fulfilment: 'pickup', consent: true, lines, ...extra,
});

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  walkIn = seedCustomers(env.db, encoder.userId).school;
  [CASH, BDO] = ['1101', '1111'].map((code) => cashPlaceId(env.db, code)) as [number, number];
  category = ((await owner.post('/api/shp/categories', { name: 'Shirts', sortOrder: 1 })).json() as { id: string }).id;
  tee = ((await owner.post('/api/shp/products', product())).json() as { id: string }).id;
});

describe('categories', () => {
  it('are kept by staff: unique names, a rename shows on every product, and one in use cannot be hidden', async () => {
    expect((await owner.post('/api/shp/categories', { name: 'shirts', sortOrder: 2 })).statusCode).toBe(409);
    expect((await owner.post('/api/shp/products', product({ categoryId: 'nope' }))).json().code).toBe('CATEGORY');
    expect((await owner.put(`/api/shp/categories/${category}`, { name: 'Tees and shirts', sortOrder: 1 }, { 'if-match': '1' })).statusCode).toBe(200);
    const shown = (await env.app.inject({ method: 'GET', url: '/api/shp/products' })).json() as { category: string }[];
    expect(shown[0]!.category).toBe('Tees and shirts');
    expect((await owner.post(`/api/shp/categories/${category}/hide`, {}, { 'if-match': '2' })).json().code).toBe('CATEGORY_IN_USE');
    expect((await (await env.as('accountant')).post('/api/shp/categories', { name: 'Caps', sortOrder: 3 })).statusCode).toBe(403);
  });
});

describe('stock', () => {
  it('comes in, is counted, goes down with a counter sale and comes back when the sale is cancelled', async () => {
    expect((await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 10 }, { size: 'S', colour: 'Ink', qty: 4 }] })).statusCode).toBe(200);
    expect(await item('M', 'White')).toMatchObject({ onHand: 10, available: 10 });
    // A count sets what is on the shelf: 8 counted where 10 were expected records -2.
    expect((await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'count', note: 'Monthly count', lines: [{ size: 'M', colour: 'White', qty: 8 }] })).statusCode).toBe(200);
    expect(await item('M', 'White')).toMatchObject({ onHand: 8 });
    expect((await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'XL', colour: 'White', qty: 1 }] })).json().code).toBe('ITEM');

    // The POS: a quick sale whose ready-made line names the item.
    const line = (qty: number) => ({ kind: 'ready_made', description: 'Sample classic tee (White, M)', qty, unitPriceCents: 25_000, discountCents: 0, item: { productId: tee, size: 'M', colour: 'White' } });
    const preview = (await encoder.post('/api/qs/sales/preview', { sale: { customerId: walkIn, invoiceNumber: '9001', lines: [line(9)] }, payment: { crNumber: '9101', tenders: [{ cashPlaceId: CASH, amountCents: 225_000 }] } })).json();
    expect(preview.sale.issues).toEqual([expect.objectContaining({ code: 'STOCK', level: 'warning' })]); // 9 asked, 8 on hand: a warning, not a refusal
    const sold = await encoder.post('/api/qs/sales', { sale: { customerId: walkIn, invoiceNumber: '9001', lines: [line(3)] }, payment: { crNumber: '9101', tenders: [{ cashPlaceId: CASH, amountCents: 75_000 }] }, expectedTotalCents: 75_000 }, idem());
    expect(sold.statusCode, sold.body).toBe(200);
    expect(await item('M', 'White')).toMatchObject({ onHand: 5, available: 5 });
    const accountant = await env.as('accountant');
    expect((await accountant.post(`/api/qs/sales/${sold.json().sale.id}/cancel`, { reason: 'Rang up the wrong size' }, idem())).statusCode).toBe(200);
    expect(await item('M', 'White')).toMatchObject({ onHand: 8 });
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('is not kept for made-to-order products', async () => {
    const mto = ((await owner.post('/api/shp/products', product({ name: 'Sample jersey', madeToOrder: true }))).json() as { id: string }).id;
    expect((await encoder.post(`/api/shp/products/${mto}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 5 }] })).json().code).toBe('MADE_TO_ORDER');
  });
});

describe('online orders', () => {
  const setUpPayment = () => owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample Garments', accountHint: '••••0000', cashPlaceId: BDO, qr: { name: 'qr.png', data: PNG } });
  const pay = (number: string, token: string) => send(`/api/shp/orders/${number}/payment`, { token, reference: 'REF 123456', proof: { name: 'proof.png', data: PNG } });
  const status = async (number: string, token: string) => (await env.app.inject({ method: 'GET', url: `/api/shp/orders/${number}?t=${token}` })).json() as { status: string; saleNumber: string | null };
  beforeEach(async () => { await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 3 }] }); });

  it('are closed until the owner sets how customers pay', async () => {
    expect((await order([{ productId: tee, size: 'M', colour: 'White', qty: 1 }])).json().code).toBe('NO_ONLINE_PAYMENT');
    expect((await env.app.inject({ method: 'GET', url: '/api/shp/payment' })).json()).toBeNull();
    expect((await encoder.post('/api/shp/admin/payment', { bankName: 'x', accountName: 'y', cashPlaceId: BDO, qr: { name: 'qr.png', data: PNG } })).statusCode).toBe(403);
  });

  it('hold their pieces, take the payment proof, and once confirmed are a quick sale paid into the bank', async () => {
    expect((await setUpPayment()).statusCode).toBe(200);
    expect((await order([{ productId: tee, size: 'M', colour: 'White', qty: 4 }])).json().code).toBe('OUT_OF_STOCK');
    const placed = (await order([{ productId: tee, size: 'M', colour: 'White', qty: 2 }])).json() as { number: string; token: string; totalCents: number };
    expect(placed).toMatchObject({ number: 'WEB-000001', totalCents: 50_000 }); // the shop's price, never the browser's
    expect(await item('M', 'White')).toMatchObject({ onHand: 3, held: 2, available: 1 });
    expect((await env.app.inject({ method: 'GET', url: `/api/shp/orders/${placed.number}?t=wrong-token-123` })).statusCode).toBe(404);

    expect((await send(`/api/shp/orders/${placed.number}/payment`, { token: placed.token, reference: 'REF 1', proof: { name: 'x.png', data: Buffer.from('MZ no').toString('base64') } })).statusCode).toBe(415);
    expect((await pay(placed.number, placed.token)).statusCode).toBe(200);
    expect(await status(placed.number, placed.token)).toMatchObject({ status: 'payment_sent' });
    const notes = (await encoder.get('/api/dash/notifications')).json() as { kind: string }[];
    expect(notes.some((n) => n.kind === 'online-payment')).toBe(true);

    const id = ((await encoder.get('/api/shp/admin/orders?status=payment_sent')).json() as { rows: { id: string }[] }).rows[0]!.id;
    const confirmed = await encoder.post(`/api/shp/admin/orders/${id}/confirm`, { customerId: walkIn, invoiceNumber: '9002', crNumber: '9102', version: 2 });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await status(placed.number, placed.token)).toMatchObject({ status: 'confirmed', saleNumber: expect.stringMatching(/^IR-/) });
    expect(await item('M', 'White')).toMatchObject({ onHand: 1, held: 0, available: 1 });
    // The usual quick sale journal, with the money in the online payment account (BDO).
    const bdo = env.db.prepare(`SELECT SUM(l.debit_cents) - SUM(l.credit_cents) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.id = ?`).pluck().get(BDO);
    expect(bdo).toBe(50_000);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
    expect((await encoder.post(`/api/shp/admin/orders/${id}/confirm`, { customerId: walkIn, invoiceNumber: '9003', crNumber: '9103', version: 3 })).json().code).toBe('NOT_CONFIRMABLE');
    expect((await encoder.post(`/api/shp/admin/orders/${id}/move`, { to: 'ready', version: 3 })).statusCode).toBe(200);
  });

  it('give their pieces back when rejected or when 24 hours pass without payment', async () => {
    await setUpPayment();
    const a = (await order([{ productId: tee, size: 'M', colour: 'White', qty: 1 }])).json() as { number: string; token: string };
    await pay(a.number, a.token);
    const list = await encoder.get('/api/shp/admin/orders');
    expect(list.statusCode, list.body).toBe(200);
    const id = (list.json() as { rows: { id: string; number: string }[] }).rows.find((r) => r.number === a.number)!.id;
    expect((await encoder.post(`/api/shp/admin/orders/${id}/reject`, { reason: 'No such transfer in the bank today', version: 2 })).statusCode).toBe(200);
    expect(await status(a.number, a.token)).toMatchObject({ status: 'rejected' });

    const b = (await order([{ productId: tee, size: 'M', colour: 'White', qty: 3 }])).json() as { number: string; token: string };
    expect(await item('M', 'White')).toMatchObject({ available: 0 });
    env.clock.advance(24 * 60 * 60 * 1000 + 1);
    encoder = await env.as('encoder'); // a day later the old session has ended
    expect(await status(b.number, b.token)).toMatchObject({ status: 'expired' });
    expect(await item('M', 'White')).toMatchObject({ available: 3 });
    // Paid late, but the pieces are still on the shelf: the payment is taken (refused once they sell: next test).
    expect((await pay(b.number, b.token)).statusCode).toBe(200);
    expect(await item('M', 'White')).toMatchObject({ held: 3, available: 0 });
  });

  it('work the delivery fee out from the address, and record it as a delivery service line on the sale', async () => {
    const fee = async (city: string, province: string) => (await env.app.inject({ method: 'GET', url: `/api/shp/delivery-fee?city=${encodeURIComponent(city)}&province=${encodeURIComponent(province)}` })).json();
    expect((await owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample Garments', cashPlaceId: BDO, qr: { name: 'qr.png', data: PNG },
      deliveryOptions: [{ name: 'Metro Manila', feeCents: 15_000, places: ['Quezon City', 'Parañaque', 'Metro Manila'] }, { name: 'Cavite', feeCents: 10_000, places: ['Cavite'] }] })).statusCode).toBe(200);
    expect(await fee('Paranaque City', 'Metro Manila')).toEqual({ delivers: true, area: 'Metro Manila', feeCents: 15_000 }); // accents, "City" and case ignored
    expect(await fee('Dasmariñas', 'Cavite')).toEqual({ delivers: true, area: 'Cavite', feeCents: 10_000 }); // the province decides when the city is not listed
    expect(await fee('Davao City', 'Davao del Sur')).toEqual({ delivers: false }); // no area takes every other address
    // Only one area may take every other address, and every other area lists its places.
    expect((await owner.post('/api/shp/admin/payment', { bankName: 'b', accountName: 'a', cashPlaceId: BDO, deliveryOptions: [{ name: 'A', feeCents: 1, otherwise: true }, { name: 'B', feeCents: 2, otherwise: true }] })).statusCode).toBe(400);
    expect((await owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample Garments', cashPlaceId: BDO,
      deliveryOptions: [{ name: 'Metro Manila', feeCents: 15_000, places: ['Quezon City', 'Metro Manila'] }, { name: 'Outside Metro Manila', feeCents: 25_000, otherwise: true }] })).statusCode).toBe(200);
    expect(await fee('Davao City', 'Davao del Sur')).toEqual({ delivers: true, area: 'Outside Metro Manila', feeCents: 25_000 });

    const lines = [{ productId: tee, size: 'M', colour: 'White', qty: 1 }];
    expect((await order(lines, { fulfilment: 'delivery', address: '1 Sample St' })).json().code).toBe('ADDRESS_REQUIRED');
    // The area always comes from the address: a browser that names one (to pay a cheaper fee) is refused.
    expect((await order(lines, { fulfilment: 'delivery', address: '1 Sample St, Brgy. Uno', city: 'Quezon City', province: 'Metro Manila', deliveryOption: 'Cavite' })).statusCode).toBe(400);
    const ok = (await order(lines, { fulfilment: 'delivery', address: '1 Sample St, Brgy. Uno', city: 'quezon city', province: 'Metro Manila' })).json() as { number: string; token: string; totalCents: number };
    expect(ok.totalCents).toBe(40_000); // ₱250 tee + ₱150 Metro Manila delivery, worked out by the shop
    const placedOk = ok;
    await pay(placedOk.number, placedOk.token);
    const id = ((await encoder.get('/api/shp/admin/orders')).json() as { rows: { id: string; number: string }[] }).rows.find((r) => r.number === placedOk.number)!.id;
    const done = await encoder.post(`/api/shp/admin/orders/${id}/confirm`, { customerId: walkIn, invoiceNumber: '9201', crNumber: '9301', version: 2 });
    expect(done.statusCode, done.body).toBe(200);
    const sale = (await encoder.get(`/api/docs/qs.sale/${done.json().sale.id}`)).json() as { doc: { lines: { kind: string; description: string; amountCents: number }[]; salesCents: Record<string, number> } };
    expect(sale.doc.lines.map((l) => [l.kind, l.description, l.amountCents])).toEqual([['ready_made', 'Sample classic tee (White, M)', 25_000], ['service', 'Delivery (Metro Manila)', 15_000]]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('still take a late payment while the pieces are available, and refuse it once they have sold', async () => {
    await setUpPayment();
    const late = (await order([{ productId: tee, size: 'M', colour: 'White', qty: 2 }])).json() as { number: string; token: string };
    env.clock.advance(24 * 60 * 60 * 1000 + 1);
    encoder = await env.as('encoder');
    expect((await pay(late.number, late.token)).statusCode).toBe(200); // 3 on the shelf, none held: taken
    expect(await status(late.number, late.token)).toMatchObject({ status: 'payment_sent' });

    const sold = (await order([{ productId: tee, size: 'M', colour: 'White', qty: 1 }])).json() as { number: string; token: string };
    env.clock.advance(24 * 60 * 60 * 1000 + 1);
    encoder = await env.as('encoder');
    // Meanwhile the counter sold the last piece not held by the paid order.
    const counter = await encoder.post('/api/qs/sales', { sale: { customerId: walkIn, invoiceNumber: '9401', lines: [{ kind: 'ready_made', description: 'Tee', qty: 1, unitPriceCents: 25_000, discountCents: 0, item: { productId: tee, size: 'M', colour: 'White' } }] },
      payment: { crNumber: '9501', tenders: [{ cashPlaceId: CASH, amountCents: 25_000 }] }, expectedTotalCents: 25_000 }, idem());
    expect(counter.statusCode, counter.body).toBe(200);
    expect((await pay(sold.number, sold.token)).json().code).toBe('EXPIRED');
    const id = ((await encoder.get('/api/shp/admin/orders')).json() as { rows: { id: string; number: string }[] }).rows.find((r) => r.number === sold.number)!.id;
    expect((await encoder.post(`/api/shp/admin/orders/${id}/confirm`, { customerId: walkIn, invoiceNumber: '9402', crNumber: '9502', version: 1 })).json().code).toBe('SOLD_SINCE');
  });

  it('email the buyer at each step when the shop sends emails, the first with the order link', async () => {
    env.db.prepare(`INSERT INTO prt_company_profile (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
      VALUES (1, 'Sample Garments Inc.', 'Sample', '000-000-000-000', 'Sample City', 1, 1, '2026-09-28T10:00:00+08:00', ?)`).run(owner.userId);
    env.db.prepare(`INSERT INTO com_settings (id, sending_on, smtp_host, smtp_port, smtp_user, sender_name, sender_address, version, updated_at, updated_by)
      VALUES (1, 1, 'smtp.example.test', 587, 'shop@example.test', 'Sample', 'shop@example.test', 1, '2026-09-28T10:00:00+08:00', ?)`).run(owner.userId);
    await setUpPayment();
    const placed = (await order([{ productId: tee, size: 'M', colour: 'White', qty: 1 }])).json() as { number: string; token: string };
    await pay(placed.number, placed.token);
    const id = ((await encoder.get('/api/shp/admin/orders')).json() as { rows: { id: string }[] }).rows[0]!.id;
    await encoder.post(`/api/shp/admin/orders/${id}/confirm`, { customerId: walkIn, invoiceNumber: '9601', crNumber: '9701', version: 2 });
    await encoder.post(`/api/shp/admin/orders/${id}/move`, { to: 'ready', version: 3 });
    const mails = env.db.prepare("SELECT to_address AS toAddress, subject, body FROM com_outbox WHERE template = 'online_order' ORDER BY rowid").all() as { toAddress: string; subject: string; body: string }[];
    expect(mails.map((m) => m.subject)).toEqual([`Your order ${placed.number}: please pay ₱250.00`, `Your order ${placed.number}: payment confirmed`, `Your order ${placed.number} is ready for pickup`]);
    expect(mails[0]!.toAddress).toBe('buyer@example.com');
    expect(mails[0]!.body).toContain(`/order/${placed.number}?t=${placed.token}`);
    expect(mails.every((m) => !/invoice/i.test(m.subject + m.body))).toBe(true);
  });

  it('are limited per sender', async () => {
    await setUpPayment();
    await encoder.post(`/api/shp/products/${tee}/stock`, { mode: 'in', lines: [{ size: 'M', colour: 'White', qty: 20 }] });
    for (let i = 0; i < 5; i++) expect((await order([{ productId: tee, size: 'M', colour: 'White', qty: 1 }])).statusCode).toBe(200);
    expect((await order([{ productId: tee, size: 'M', colour: 'White', qty: 1 }])).statusCode).toBe(429);
  });
});
