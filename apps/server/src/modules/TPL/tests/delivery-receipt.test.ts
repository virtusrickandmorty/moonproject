/**
 * The delivery receipt (the owner's request, Nov 2026): it prints to sign, and who received it is typed afterwards from the signed
 * copy, since a recorded delivery is never changed. Made-up people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { deliveryDoc } from '../doctypes/delivery.ts';

let env: TestEnv, owner: Client, encoder: Client, programId: string, polo: string, today: string;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  const c = seedCustomers(env.db, encoder.userId);
  programId = (await owner.post('/api/tpl/programs', { customerId: c.school, termsDays: 30, creditLimitCents: 5_000_000 })).json().id;
  polo = (await owner.post(`/api/tpl/programs/${programId}/items`, { kind: 'made_to_order', description: 'School polo', size: 'M', priceCents: 50_000, reorderLevel: 20 })).json().id;
  const jo = (await encoder.post('/api/tpl/restocks', { programId, dueInDays: 10, priority: 'normal', lines: [{ itemId: polo, qty: 10 }] })).json().id as string;
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
  expect((await encoder.post('/api/tpl/put-in', { jobOrderId: jo, lines: [{ lineNo: 1, qty: 10 }] })).statusCode).toBe(200);
  today = (await owner.get('/api/rate/rates')).json().asOf;
  const profile = { registeredName: 'Example Garments Corp.', tradeName: 'Example Garments', tin: '000-111-222', registeredAddress: '1 Sample Street, Manila', isVatRegistered: true };
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  expect((await owner.put('/api/prt/company-profile', profile, { 'if-match': '0' })).statusCode).toBe(200);
});

const deliver = async (extra: object = {}) => {
  const r = await owner.post('/api/tpl/deliveries', { delivery: { programId, invoiceNumber: '501', deliveredBy: 'Rider Jun', feeCents: 0, lines: [{ itemId: polo, qty: 4 }], ...extra }, expectedTotalCents: 200_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().delivery as { id: string; number: string };
};
const received = (id: string, body: object) => owner.post(`/api/tpl/deliveries/${id}/received`, body);
const print = async (id: string) => { const r = await owner.post(`/api/prt/print/tpl.delivery/${id}`, {}); expect(r.statusCode, r.body).toBe(200); return r.json().html as string; };
const row = async (id: string) => ((await owner.get(`/api/tpl/programs/${programId}`)).json().deliveries as { id: string; receivedBy: string | null; receivedOn: string | null }[]).find((d) => d.id === id)!;

describe('the printed delivery receipt', () => {
  it('lists the pieces in two copies, with the receiver blank to sign, and never the word on the booklet', async () => {
    const html = await print((await deliver()).id);
    expect(html).toMatch(/Delivery Receipt/i);
    for (const words of ['School polo', 'Total pieces', 'Rider Jun', 'Delivered by', 'Received by (name and signature)', 'Date received', 'Booklet no.', '501']) expect(html).toContain(words);
    expect(html.match(/THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX\./g)).toHaveLength(2);
    expect(html).not.toMatch(/invoice/i);
  });

  it('shows no money: that is on the booklet', async () => {
    expect(await print((await deliver()).id)).not.toContain('500.00');
  });

  it('shows the courier tracking number only when there is one', async () => {
    expect(await print((await deliver()).id)).not.toContain('Tracking no.');
    expect(await print((await deliver({ tracking: 'LB-12345', invoiceNumber: '502' })).id)).toContain('LB-12345');
  });

  it('prints the name and date once they are recorded', async () => {
    const d = await deliver();
    expect((await received(d.id, { receivedBy: 'Ana Halimbawa', receivedOn: today })).statusCode).toBe(200);
    const html = await print(d.id);
    expect(html).toContain('Ana Halimbawa');
    expect(html).not.toContain(`>${today}<`); // the date in words, like the rest of the printout
    expect(html).not.toContain('Received by (name and signature)');
  });
});

describe('recording who received it', () => {
  it('keeps it apart from the delivery, shows it on the list, and leaves a trail', async () => {
    const d = await deliver();
    expect(await row(d.id)).toMatchObject({ receivedBy: null, receivedOn: null });
    expect((await received(d.id, { receivedBy: 'Ana Halimbawa', receivedOn: today })).statusCode).toBe(200);
    expect(await row(d.id)).toMatchObject({ receivedBy: 'Ana Halimbawa', receivedOn: today });
    expect(deliveryDoc.load(env.db, d.id)).toMatchObject({ receivedBy: 'Ana Halimbawa', receivedOn: today });
    expect(env.db.prepare('SELECT received_by FROM tpl_deliveries WHERE document_id = ?').pluck().get(d.id)).toBeNull(); // the recorded delivery stays as it was
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('puts a wrong name right, keeping the first', async () => {
    const d = await deliver();
    await received(d.id, { receivedBy: 'Wrong Name', receivedOn: today });
    await received(d.id, { receivedBy: 'Right Name', receivedOn: today });
    expect(await row(d.id)).toMatchObject({ receivedBy: 'Right Name' });
    expect(env.db.prepare('SELECT COUNT(*) FROM tpl_delivery_received WHERE document_id = ?').pluck().get(d.id)).toBe(2);
  });

  it('shows a name typed when the delivery was recorded, and a later one over it', async () => {
    const d = await deliver({ receivedBy: 'Typed At Delivery' });
    expect(await row(d.id)).toMatchObject({ receivedBy: 'Typed At Delivery' });
    await received(d.id, { receivedBy: 'Corrected Later', receivedOn: today });
    expect(await row(d.id)).toMatchObject({ receivedBy: 'Corrected Later' });
  });

  it('refuses a date before the delivery or in the future, an empty name, and a cancelled delivery', async () => {
    const d = await deliver();
    expect((await received(d.id, { receivedBy: 'Ana', receivedOn: '2020-01-01' })).json().code).toBe('BEFORE_DELIVERY');
    expect((await received(d.id, { receivedBy: 'Ana', receivedOn: '2999-01-01' })).json().code).toBe('FUTURE');
    expect((await received(d.id, { receivedBy: '  ', receivedOn: today })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await owner.post(`/api/tpl/deliveries/${d.id}/cancel`, { reason: 'Recorded by mistake' }, idem())).statusCode).toBe(200);
    expect((await received(d.id, { receivedBy: 'Ana', receivedOn: today })).json().code).toBe('CANCELLED');
  });

  it('is for those who may record deliveries', async () => {
    const d = await deliver();
    expect((await (await env.as('production')).post(`/api/tpl/deliveries/${d.id}/received`, { receivedBy: 'Ana', receivedOn: today })).statusCode).toBe(403);
  });
});
