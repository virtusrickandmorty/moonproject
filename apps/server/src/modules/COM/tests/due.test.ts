/**
 * Payment reminders (the owner's request, Nov 2026): an amount still owed that falls due within 3 days gets one email, to a
 * customer who agreed to emails, with how to pay. Made-up people only; a fake mail transport, no network.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PASSWORD, cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { stamp } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { scanOnce } from '../scan.ts';
import { forbiddenWord } from '../text.ts';
import { useTransport, type MailTransport } from '../transport.ts';

const SETTINGS = { sendingOn: true, host: 'smtp.example.test', port: 587, user: 'shop@example.test', senderName: 'Virtus Garments', senderAddress: 'shop@example.test', appPassword: 'zqxj wvut mnbp lkhg' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');

let env: TestEnv, owner: Client, encoder: Client, c: ReturnType<typeof seedCustomers>, dir: string;
const now = () => stamp(env.clock);
const reminders = () => env.db.prepare("SELECT customer_id AS customerId, subject, body, dedupe_key AS dedupeKey FROM com_outbox WHERE template = 'payment_due' ORDER BY rowid").all() as
  { customerId: string; subject: string; body: string; dedupeKey: string }[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'com-due-'));
  process.env.MOONPROJECT_COM_DIR = dir;
  env = await createTestEnv('2026-11-09T02:00:00Z'); encoderOwnDefaults(env); // 10 AM in Manila
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
  useTransport({ online: async () => true, send: async () => undefined } satisfies MailTransport);
  env.db.prepare(`INSERT INTO prt_company_profile (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
    VALUES (1, 'Example Garments, Inc.', 'Example', '000-000-000-000', 'Silang, Cavite', 1, 1, ?, ?)`).run(now(), owner.userId);
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const version = (await owner.get('/api/com/settings')).json().version;
  expect((await owner.put('/api/com/settings', SETTINGS, { 'if-match': String(version) })).statusCode).toBe(200);
  env.db.prepare('UPDATE cus_customers SET email = ?, email_consent = 1 WHERE id = ?').run('school@example.test', c.school);
});
afterEach(() => { useTransport(null); delete process.env.MOONPROJECT_COM_DIR; rmSync(dir, { recursive: true, force: true }); });

/** A TPL delivery on these terms: its invoice falls due that many days from today. */
async function delivered(termsDays: number, invoiceNumber: string) {
  const programId = (await owner.post('/api/tpl/programs', { customerId: c.school, termsDays, creditLimitCents: 5_000_000 })).json().id;
  const polo = (await owner.post(`/api/tpl/programs/${programId}/items`, { kind: 'made_to_order', description: 'School polo', size: 'M', priceCents: 50_000, reorderLevel: 1 })).json().id;
  const jo = (await encoder.post('/api/tpl/restocks', { programId, dueInDays: 10, priority: 'normal', lines: [{ itemId: polo, qty: 10 }] })).json().id as string;
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
  await encoder.post('/api/tpl/put-in', { jobOrderId: jo, lines: [{ lineNo: 1, qty: 10 }] });
  const r = await owner.post('/api/tpl/deliveries', { delivery: { programId, invoiceNumber, deliveredBy: 'Rider Jun', feeCents: 0, lines: [{ itemId: polo, qty: 4 }] }, expectedTotalCents: 200_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
}

it('reminds a customer once, three days before an amount falls due, with how to pay and never the word on the booklet', async () => {
  await delivered(3, '0501');
  expect(scanOnce(env.db, now()).due).toBe(1);
  const [r] = reminders();
  expect(r).toMatchObject({ customerId: c.school, subject: 'Example Garments, Inc.: a reminder, ₱2,000.00 is due Thursday, November 12, 2026' });
  expect(r!.body).toContain('₱2,000.00 for booklet no. 0501 is due on Thursday, November 12, 2026.');
  expect(r!.body).toContain('You can pay at the shop'); // no account saved for the website yet
  expect(forbiddenWord(r!.subject, r!.body)).toBeFalsy();
  // Once a day, and once per amount.
  expect(scanOnce(env.db, now()).due).toBe(0);
  expect(reminders()).toHaveLength(1);
});

it("gives the shop's account and QR code once they are saved", async () => {
  await owner.post('/api/shp/admin/payment', { bankName: 'GCash', accountName: 'Example Garments', accountHint: '0917 *** 1234', cashPlaceId: cashPlaceId(env.db, '1111'), qr: { name: 'qr.png', data: PNG }, deliveryOptions: [] });
  await delivered(2, '0601');
  scanOnce(env.db, now());
  expect(reminders()[0]!.body).toMatch(/GCash\n {2}Example Garments\n {2}0917 \*\*\* 1234/);
  expect(reminders()[0]!.body).toMatch(/Or scan our QR code: https:\/\/www\.virtusgarments\.com\/api\/shp\/payment\/qr\/\d+/);
});

it('waits until three days before', async () => {
  await delivered(4, '0502');
  expect(scanOnce(env.db, now()).due).toBe(0);
  expect(reminders()).toHaveLength(0);
});

it('leaves out customers who did not agree to emails', async () => {
  env.db.prepare('UPDATE cus_customers SET email_consent = 0 WHERE id = ?').run(c.school);
  await delivered(1, '0701');
  expect(scanOnce(env.db, now()).due).toBe(0);
  expect(reminders()).toHaveLength(0);
});
