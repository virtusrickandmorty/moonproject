/**
 * Customer ratings (the owner's request, Nov 2026): the day after a job order is fully released its customer is emailed a
 * private link (if they agreed to emails), or staff make the link to send; the customer rates once; a low rating shows in
 * the bell. Made-up people only; a fake mail transport, no network.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PASSWORD, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { stamp } from '../../../platform/clock.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { scanOnce } from '../../COM/scan.ts';
import { useTransport } from '../../COM/transport.ts';

const SETTINGS = { sendingOn: true, host: 'smtp.example.test', port: 587, user: 'shop@example.test', senderName: 'Example', senderAddress: 'shop@example.test', appPassword: 'zqxj wvut mnbp lkhg' };
let env: TestEnv, owner: Client, encoder: Client, accountant: Client, c: ReturnType<typeof seedCustomers>, dir: string;
const now = () => stamp(env.clock);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fbk-'));
  process.env.MOONPROJECT_COM_DIR = dir;
  env = await createTestEnv('2026-11-09T02:00:00Z'); encoderOwnDefaults(env); // 10 AM in Manila
  owner = await env.as('owner'); encoder = await env.as('encoder'); accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  useTransport({ online: async () => true, send: async () => undefined });
  env.db.prepare(`INSERT INTO prt_company_profile (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
    VALUES (1, 'Example Garments, Inc.', 'Example', '000-000-000-000', 'Silang, Cavite', 1, 1, ?, ?)`).run(now(), owner.userId);
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const version = (await owner.get('/api/com/settings')).json().version;
  expect((await owner.put('/api/com/settings', SETTINGS, { 'if-match': String(version) })).statusCode).toBe(200);
  env.db.prepare('UPDATE cus_customers SET email = ?, email_consent = 1 WHERE id = ?').run('school@example.test', c.school);
});
afterEach(() => { useTransport(null); delete process.env.MOONPROJECT_COM_DIR; rmSync(dir, { recursive: true, force: true }); });

/** A job order made, finished and fully released today. */
async function released(qty = 20) {
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty, unitPriceCents: 10_000, discountCents: 0, roster: [] }] };
  const jo = (await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: qty * 10_000 }, idem())).json() as { id: string; number: string };
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${jo.id}/stage`, { from, to })).statusCode).toBe(200);
  const release = { jobOrderId: jo.id, lines: [{ lineNo: 1, qty }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: '0801' }, expectedTotalCents: qty * 10_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return jo;
}
const rateIt = (token: string, body: object) => env.app.inject({ method: 'POST', url: `/api/fbk/r/${token}`, payload: body, remoteAddress: '10.8.8.8' });
const page = (token: string) => env.app.inject({ method: 'GET', url: `/api/fbk/r/${token}`, remoteAddress: '10.8.8.8' });
const asked = () => env.db.prepare("SELECT subject, body FROM com_outbox WHERE template = 'rating_request'").all() as { subject: string; body: string }[];

describe('asking for a rating', () => {
  it('emails the customer the day after the order is fully released, once, with a private link', async () => {
    const jo = await released();
    scanOnce(env.db, now());
    expect(asked()).toHaveLength(0); // not on the day itself
    env.clock.set('2026-11-10T02:00:00Z');
    expect(scanOnce(env.db, now()).ratings).toBe(1);
    const [m] = asked();
    expect(m!.subject).toBe(`Example Garments, Inc.: how did we do on your order ${jo.number}?`);
    const token = /https:\/\/www\.virtusgarments\.com\/r\/([\w-]+)/.exec(m!.body)![1]!;
    expect((await page(token)).json()).toMatchObject({ jobOrderNumber: jo.number, lines: [{ description: 'Team jersey set', qty: 20 }], rating: null });
    expect((await page(token)).body).not.toMatch(/Cents|Moonlight/);
    env.clock.set('2026-11-11T02:00:00Z');
    expect(scanOnce(env.db, now()).ratings).toBe(0);
  });

  it('lets staff make the link to send on Messenger, the same one the email uses', async () => {
    const jo = await released();
    expect((await encoder.get(`/api/fbk/job-orders/${jo.id}`)).json()).toMatchObject({ stage: 'released', token: null, rating: null });
    const made = (await encoder.post(`/api/fbk/job-orders/${jo.id}/link`, {})).json();
    expect(made.token).toMatch(/^[\w-]{20,64}$/);
    expect((await encoder.post(`/api/fbk/job-orders/${jo.id}/link`, {})).json().token).toBe(made.token);
    env.clock.set('2026-11-10T02:00:00Z');
    scanOnce(env.db, now());
    expect(asked()[0]!.body).toContain(`/r/${made.token}`);
    expect((await (await env.as('production')).post(`/api/fbk/job-orders/${jo.id}/link`, {})).statusCode).toBe(403);
  });
});

describe('the customer rates', () => {
  it('once; a low rating shows in the bell; the ratings screen shows the average', async () => {
    const jo = await released();
    const token = (await encoder.post(`/api/fbk/job-orders/${jo.id}/link`, {})).json().token as string;
    expect((await rateIt(token, { stars: 0 })).statusCode).toBe(400);
    const r = await rateIt(token, { stars: 2, comment: 'Two shirts had the wrong size', name: 'Coach Ana' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().rating).toMatchObject({ stars: 2, comment: 'Two shirts had the wrong size', name: 'Coach Ana' });
    expect((await rateIt(token, { stars: 5 })).json().code).toBe('RATED');
    const bell = (await encoder.get('/api/dash/notifications')).json();
    expect(((bell.items ?? bell) as { kind: string; label: string }[]).find((n) => n.kind === 'rating-low')?.label).toBe(`${jo.number}: Coach Ana rated it 2 stars: call them`);
    expect((await owner.get('/api/fbk/ratings')).json()).toMatchObject({ asked: 1, rated: 1, average: 2, rows: [{ jobOrderNumber: jo.number, stars: 2 }] });
    expect(verifyAuditChain(env.db)).toBeNull();
  });
});
