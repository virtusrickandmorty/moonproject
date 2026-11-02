/** Each member pays their own share (the owner's request, Nov 2026): price, QR, picture of the payment, staff check. */
import { beforeEach, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
let env: TestEnv;
let owner: Client;
let top: string, pants: string;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const item = async (code: string, name: string, tiers: [number, number][]) => {
    const id = (await owner.post('/api/cat/items', { code, name, class: 'made_to_order_garment', garmentType: name, unit: 'pc', setComponents: 1 })).json().id as string;
    let version = 1;
    for (const [minQty, unitPriceCents] of tiers) {
      const p = await owner.post(`/api/cat/items/${id}/prices`, { effectiveFrom: '2026-09-28', minQty, unitPriceCents }, { 'if-match': String(version++) });
      expect(p.statusCode, p.body).toBe(200);
    }
    return id;
  };
  [top, pants] = [await item('TOP-1', 'Scrub top', [[1, 60_000], [3, 55_000]]), await item('PNT-1', 'Scrub pants', [[1, 50_000]])];
  await owner.post('/api/shp/admin/payment', { bankName: 'Sample Bank', accountName: 'Sample Garments', accountHint: '••••0000', cashPlaceId: cashPlaceId(env.db, '1111'), qr: { name: 'qr.png', data: PNG } });
});

const pub = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
  const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}), remoteAddress: '203.0.113.7' });
  return { status: r.statusCode, body: r.json() };
};
const member = { name: 'Made-up Ana', gender: 'female', mobile: '0917 000 0000', email: 'ana@example.test', address: '12 Made-up St.',
  people: [{ row: 0, gender: 'female', pieces: [{ lineNo: 1, qty: 3, size: 'M' }, { lineNo: 2, qty: 1, size: 'M' }] }] };
const paying = (amountCents: number, reference = 'GC 1234 5678') => ({ amountCents, reference, proof: { name: 'paid.png', data: PNG } });

it('a member paying their own share sees the price, pays with the QR code, and staff take it on their job order', async () => {
  const link = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Clinic uniforms', closesOn: '2026-10-10', payOwn: true,
    items: [{ itemId: top, sizing: 'size' }, { itemId: pants, sizing: 'size' }] })).json();
  const page = (await pub('GET', `/api/olk/l/${link.token}`)).body;
  expect(page.prices).toEqual([{ lineNo: 1, tiers: [{ fromQty: 1, unitPriceCents: 60_000 }, { fromQty: 3, unitPriceCents: 55_000 }] }, { lineNo: 2, tiers: [{ fromQty: 1, unitPriceCents: 50_000 }] }]);
  expect(page.pay).toMatchObject({ bankName: 'Sample Bank', accountName: 'Sample Garments', qrUrl: expect.stringMatching(/^\/api\/shp\/payment\/qr\/\d+$/) });

  const sent = (await pub('POST', `/api/olk/l/${link.token}/answers`, member)).body;
  expect(sent.share).toEqual({ totalCents: 215_000, lines: [{ lineNo: 1, name: 'Scrub top', qty: 3, unitCents: 55_000 }, { lineNo: 2, name: 'Scrub pants', qty: 1, unitCents: 50_000 }] });
  expect(sent.payments).toEqual([]);

  // The payment: kept with its picture, waiting for the shop; a second one waits until the first is checked.
  const paid = await pub('POST', `/api/olk/l/${link.token}/answers/${sent.key}/payment`, paying(215_000));
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  expect(paid.body.payments).toMatchObject([{ amountCents: 215_000, reference: 'GC 1234 5678', status: 'sent' }]);
  expect((await pub('POST', `/api/olk/l/${link.token}/answers/${sent.key}/payment`, paying(100))).body.code).toBe('WAITING');
  expect((await pub('POST', `/api/olk/l/${link.token}/answers/${sent.key}/payment`, { ...paying(100), proof: { name: 'x.txt', data: Buffer.from('hello').toString('base64') } })).body.code).toBe('FILE_TYPE');

  const detail = (await owner.get(`/api/olk/links/${link.id}`)).json();
  const pay = detail.responses[0].payments[0];
  expect(detail.responses[0].share.totalCents).toBe(215_000);
  expect((await owner.get(`/api/olk/payments/${pay.id}/picture`)).headers['content-type']).toBe('image/png');
  expect((await env.app.inject({ method: 'GET', url: `/api/olk/payments/${pay.id}/picture` })).statusCode).toBe(401);

  // Not on a job order yet: nothing to collect on. Then the member's own job order is made and recorded.
  expect((await owner.get(`/api/olk/payments/${pay.id}/job-orders`)).json()).toEqual([]);
  const p = (await owner.post(`/api/olk/links/${link.id}/job-order`, { responseIds: [sent.id], together: false })).json();
  const lines = p.lines.map((l: { kind: string; description: string; qty: number; listCents: number; roster: { name: string }[] }) => ({ kind: l.kind, description: l.description, qty: l.qty, unitPriceCents: l.listCents, discountCents: 0, roster: l.roster }));
  const jo = await owner.post('/api/docs/jo.job_order/post', { input: { customerId: p.customer.id, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', notes: p.notes, lines }, expectedTotalCents: 215_000 }, idem());
  expect(jo.statusCode, jo.body).toBe(200);
  expect((await owner.get(`/api/olk/payments/${pay.id}/job-orders`)).json()).toMatchObject([{ id: jo.json().id, number: jo.json().number, totalCents: 215_000 }]);

  const ok = await owner.post(`/api/olk/payments/${pay.id}/accept`, { jobOrderId: jo.json().id });
  expect(ok.json()).toEqual({ jobOrderId: jo.json().id, jobOrderNumber: jo.json().number, amountCents: 215_000, note: 'Paid through the order link by Made-up Ana, reference GC 1234 5678.' });
  expect((await owner.post(`/api/olk/payments/${pay.id}/accept`, { jobOrderId: jo.json().id })).json().code).toBe('DECIDED');
  expect((await pub('GET', `/api/olk/l/${link.token}/answers/${sent.key}`)).body.payments).toMatchObject([{ status: 'accepted' }]);
});

it('a payment the shop did not find: the member sees why and sends it again; a group-paid link takes none', async () => {
  const link = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Office polos', closesOn: '2026-10-10', payOwn: true, items: [{ itemId: top, sizing: 'size' }] })).json();
  const sent = (await pub('POST', `/api/olk/l/${link.token}/answers`, { ...member, people: [{ row: 0, gender: 'female', pieces: [{ lineNo: 1, qty: 1, size: 'M' }] }] })).body;
  await pub('POST', `/api/olk/l/${link.token}/answers/${sent.key}/payment`, paying(60_000, 'WRONG-REF'));
  const id = (await owner.get(`/api/olk/links/${link.id}`)).json().responses[0].payments[0].id;
  expect((await owner.post(`/api/olk/payments/${id}/not-received`, { reason: 'No payment with this reference in the account.' })).statusCode).toBe(200);
  const mine = (await pub('GET', `/api/olk/l/${link.token}/answers/${sent.key}`)).body;
  expect(mine.payments).toMatchObject([{ status: 'not_received', reason: 'No payment with this reference in the account.' }]);
  expect(mine.payments[0].id).toBeUndefined(); // the member never sees staff ids
  expect((await pub('POST', `/api/olk/l/${link.token}/answers/${sent.key}/payment`, paying(60_000))).status).toBe(200);

  const together = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Team shirts', closesOn: '2026-10-10', items: [{ itemId: top, sizing: 'size' }] })).json();
  const page = (await pub('GET', `/api/olk/l/${together.token}`)).body;
  expect(page.prices).toBeUndefined();
  const one = (await pub('POST', `/api/olk/l/${together.token}/answers`, { ...member, email: 'bea@example.test', people: [{ row: 0, gender: 'female', pieces: [{ lineNo: 1, qty: 1, size: 'M' }] }] })).body;
  expect(one.share).toBeUndefined();
  expect((await pub('POST', `/api/olk/l/${together.token}/answers/${one.key}/payment`, paying(60_000))).body.code).toBe('NOT_PAY_OWN');
});
