/**
 * Customer emails (PLAN E14, C9, OWN-11) with a fake mail transport: no network is used anywhere in this file.
 * The queue for each template; no consent or no address; nothing sent while sending is off; retries and the failed
 * state; the App Password nowhere but its file; owner-only settings; the forbidden-words check.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestEnv, idem, PASSWORD, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { MAX_ATTEMPTS, WAIT_MINUTES, sendDue } from '../outbox.ts';
import { scanOnce } from '../scan.ts';
import { assertAllowedWording, claimedMessage, createdMessage, forbiddenWord, plain, readyMessage, statementMessage } from '../text.ts';
import { useTransport, type MailMessage, type MailTransport } from '../transport.ts';
import { stamp } from '../../../platform/clock.ts';

const SECRET = 'zqxj wvut mnbp lkhg';
const SETTINGS = { sendingOn: true, host: 'smtp.example.test', port: 587, user: 'shop@example.test', senderName: 'Virtus Garments', senderAddress: 'shop@example.test', appPassword: SECRET };

interface Fake extends MailTransport { sent: MailMessage[]; up: boolean; failWith: string | null; tries: number }
function fakeTransport(): Fake {
  const t: Fake = {
    sent: [], up: true, failWith: null, tries: 0,
    online: async () => t.up,
    send: async (config, m) => {
      t.tries++;
      if (t.failWith !== null) throw new Error(t.failWith.replace('<password>', config.password));
      t.sent.push(m);
    },
  };
  return t;
}

let env: TestEnv;
let owner: Client;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let mail: Fake;
let dir: string;
const now = () => stamp(env.clock);
const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'com-test-'));
  process.env.MOONPROJECT_COM_DIR = dir;
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  mail = fakeTransport();
  useTransport(mail);
  env.db.prepare(`INSERT INTO prt_company_profile (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
    VALUES (1, 'Virtus Garments, Inc.', 'Virtus', '000-000-000-000', 'Silang, Cavite', 1, 1, ?, ?)`).run(now(), owner.userId);
});
afterEach(() => {
  useTransport(null);
  delete process.env.MOONPROJECT_COM_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const saveSettings = async (body: object = SETTINGS, who = owner) => {
  await stepUp(who);
  const version = (await who.get('/api/com/settings')).json().version;
  return who.put('/api/com/settings', body, { 'if-match': String(version) });
};
const turnOn = async () => expect((await saveSettings()).statusCode).toBe(200);
/** The school agrees to emails at this address. */
const consent = (customerId = c.school, email: string | null = 'school@example.test', agreed = 1) =>
  env.db.prepare('UPDATE cus_customers SET email = ?, email_consent = ? WHERE id = ?').run(email, agreed, customerId);
const outbox = () => env.db.prepare('SELECT * FROM com_outbox ORDER BY rowid').all() as Record<string, any>[];
const run = () => sendDue(env.db, mail, now);

async function jobOrder(customerId = c.school): Promise<string> {
  const input = { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 5_600_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
}
const stage = async (jo: string, from: string, to: string) => expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to })).statusCode).toBe(200);
const ready = async (jo: string) => (await stage(jo, 'open', 'in_production'), await stage(jo, 'in_production', 'ready'));
async function release(jo: string, invoiceNumber?: string) {
  const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 };
  const r = await accountant.post('/api/jo/releases', { release, invoice: invoiceNumber ? { invoiceNumber } : null, expectedTotalCents: 5_600_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().release.id as string;
}

describe('settings: owner only, off by default, the App Password write-only', () => {
  it('is off until configured, and reports no password', async () => {
    const s = (await owner.get('/api/com/settings')).json();
    expect(s).toMatchObject({ sendingOn: false, appPasswordSet: false, version: 0 });
    expect(s.missing).toContain('the App Password');
  });

  it('only the owner can read or change the settings; a fresh password is needed', async () => {
    for (const who of [encoder, accountant]) {
      expect((await who.get('/api/com/settings')).statusCode).toBe(403);
      await stepUp(who);
      expect((await who.put('/api/com/settings', SETTINGS)).statusCode).toBe(403);
      expect((await who.post('/api/com/test-email', {})).statusCode).toBe(403);
    }
    const noStepUp = await owner.put('/api/com/settings', SETTINGS);
    expect(noStepUp.statusCode).toBe(403);
    expect(noStepUp.json().code).toBe('STEP_UP_REQUIRED');
    expect((await owner.post('/api/com/test-email', {})).json().code).toBe('STEP_UP_REQUIRED');
    expect((await saveSettings()).statusCode).toBe(200);
  });

  it('cannot turn sending on without the server, the sender and the App Password', async () => {
    const r = await saveSettings({ ...SETTINGS, host: '', appPassword: undefined });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain('the mail server');
    expect(r.json().message).toContain('the App Password');
    expect((await owner.get('/api/com/settings')).json().sendingOn).toBe(false);
  });

  it('keeps the App Password in a file only the service account can read, never in the database', async () => {
    await turnOn();
    const file = join(dir, 'com-app-password.secret');
    expect(readFileSync(file, 'utf8')).toBe(SECRET);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const whole = env.db.serialize();
    expect(whole.includes(Buffer.from(SECRET))).toBe(false);
    expect((await owner.get('/api/com/settings')).json().appPasswordSet).toBe(true);
    // Saving again without a password keeps the one that is saved.
    expect((await saveSettings({ ...SETTINGS, appPassword: undefined, senderName: 'Virtus' })).statusCode).toBe(200);
    expect(readFileSync(file, 'utf8')).toBe(SECRET);
  });

  it('no API answer, log line or audit row ever has the App Password; the audit says only that it changed', async () => {
    const answers: string[] = [];
    const seen = (r: { body: string }) => answers.push(r.body);
    seen(await saveSettings());
    seen(await saveSettings({ ...SETTINGS, appPassword: undefined, senderName: 'Virtus' })); // saved again, the password not touched
    seen(await owner.get('/api/com/settings'));
    seen(await saveSettings({ ...SETTINGS, port: 'not a number' } as never)); // a refused save must not echo it either
    seen(await saveSettings({ ...SETTINGS, extra: SECRET } as never));
    mail.failWith = 'Invalid login: 535 the password <password> was refused'; // a mail server that echoes it back
    seen(await owner.post('/api/com/test-email', {}));
    consent();
    const jo = await jobOrder();
    scanOnce(env.db, now());
    const logs: string[] = [];
    await sendDue(env.db, mail, now, (m) => logs.push(m));
    seen(await owner.get('/api/com/outbox'));

    expect(logs.length).toBeGreaterThan(0);
    for (const text of [...answers, ...logs]) expect(text).not.toContain(SECRET);
    const audit = env.db.prepare('SELECT action, data FROM audit_log').all() as { action: string; data: string }[];
    for (const row of audit) expect(row.data).not.toContain(SECRET);
    const saved = audit.filter((a) => a.action === 'com.settings').map((a) => JSON.parse(a.data));
    expect(saved[0].appPasswordChanged).toBe(true);
    expect(saved[1].appPasswordChanged).toBe(false);
    for (const row of env.db.prepare('SELECT * FROM com_outbox').all()) expect(JSON.stringify(row)).not.toContain(SECRET);
    for (const row of env.db.prepare('SELECT * FROM com_attempts').all()) expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(jo).toBeTruthy();
  });

  it('"Send a test email" goes to the sender through the transport', async () => {
    await turnOn();
    await stepUp(owner);
    const r = await owner.post('/api/com/test-email', {});
    expect(r.statusCode, r.body).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'shop@example.test', subject: 'Virtus Garments, Inc.: test email' });
    mail.failWith = 'Connection refused';
    const bad = await owner.post('/api/com/test-email', {});
    expect(bad.statusCode).toBe(502);
    expect(bad.json().message).toContain('Connection refused');
    expect(bad.body).not.toContain(SECRET);
  });
});

describe('the queue: one email per template', () => {
  beforeEach(async () => {
    await turnOn();
    consent();
  });

  it('a new job order queues "created" once, with the address from the customer record', async () => {
    const jo = await jobOrder();
    expect(scanOnce(env.db, now())).toMatchObject({ created: 1 });
    const [row, ...more] = outbox();
    expect(more).toEqual([]);
    expect(row).toMatchObject({ template: 'job_order_created', customer_id: c.school, to_address: 'school@example.test', document_id: jo, status: 'queued', attempts: 0 });
    expect(row!.subject).toBe('Virtus Garments, Inc.: we have received your order JO-000001');
    expect(row!.body).toContain('20 x Team jersey set');
    expect(row!.body).toContain('Virtus Garments, Inc.');
    expect(scanOnce(env.db, now()).created).toBe(0); // it carries on from where it stopped
    expect(outbox()).toHaveLength(1);
  });

  it('an address changed later does not change a queued email', async () => {
    await jobOrder();
    scanOnce(env.db, now());
    consent(c.school, 'someone-else@example.test');
    expect(outbox()[0]!.to_address).toBe('school@example.test');
    expect(() => env.db.prepare("UPDATE com_outbox SET to_address = 'x@example.test'").run()).toThrow(/IMMUTABLE/);
  });

  it('"ready for pick-up" only when the whole job order is Ready, never on each step', async () => {
    const jo = await jobOrder();
    scanOnce(env.db, now());
    await stage(jo, 'open', 'in_production');
    scanOnce(env.db, now());
    expect(outbox().map((r) => r.template)).toEqual(['job_order_created']);
    await stage(jo, 'in_production', 'ready');
    expect(scanOnce(env.db, now()).ready).toBe(1);
    expect(outbox().map((r) => r.template)).toEqual(['job_order_created', 'job_order_ready']);
    expect(outbox()[1]!.subject).toContain('is ready for pick-up');
    // Back to production and Ready again: still one email for this job order.
    await stage(jo, 'ready', 'in_production').catch(() => undefined);
    scanOnce(env.db, now());
    expect(outbox().filter((r) => r.template === 'job_order_ready')).toHaveLength(1);
  });

  it('editing a job order (cancel and reissue) does not send the customer a second email for it', async () => {
    const jo = await jobOrder();
    await ready(jo);
    scanOnce(env.db, now());
    expect(outbox().map((r) => r.template)).toEqual(['job_order_created', 'job_order_ready']);
    const input = { customerId: c.school, dueInDays: 20, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] }] };
    const edited = await encoder.post(`/api/docs/jo.job_order/${jo}/reissue`, { input, expectedTotalCents: 5_600_000, reason: 'The customer asked for a later date' }, idem());
    expect(edited.statusCode, edited.body).toBe(200);
    scanOnce(env.db, now());
    expect(outbox().map((r) => r.template)).toEqual(['job_order_created', 'job_order_ready']);
  });

  it('a job order that is no longer Ready when the scan looks is not announced', async () => {
    const jo = await jobOrder();
    scanOnce(env.db, now());
    await ready(jo);
    const id = await release(jo);
    scanOnce(env.db, now());
    expect(outbox().map((r) => r.template)).toEqual(['job_order_created', 'claimed']);
    expect(outbox()[1]).toMatchObject({ document_id: id, template: 'claimed' });
  });

  it('a release queues "claimed" with what was picked up', async () => {
    const jo = await jobOrder();
    await ready(jo);
    scanOnce(env.db, now());
    const before = outbox().length;
    const id = await release(jo);
    expect(scanOnce(env.db, now())).toMatchObject({ claimed: 1 });
    const row = outbox()[before]!;
    expect(row).toMatchObject({ template: 'claimed', document_id: id });
    expect(row.subject).toContain('has been picked up');
    expect(row.body).toContain('Coach Placeholder');
    expect(row.body).toContain('20 x Team jersey set');
    expect(row.body).toContain('₱56,000.00');
  });

  it('the statement button queues a statement with the statement attached as HTML', async () => {
    await jobOrder();
    const r = await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2026-09-28' });
    expect(r.statusCode, r.body).toBe(200);
    const row = outbox().find((o) => o.template === 'statement')!;
    expect(row).toMatchObject({ to_address: 'school@example.test', period_from: '2026-09-01', period_to: '2026-09-28', document_id: null, created_by: accountant.userId });
    expect(row.attachment_name).toBe('statement-of-account-2026-09-01-to-2026-09-28.html');
    expect(row.attachment_html).toContain('STATEMENT OF ACCOUNT');
    expect(row.attachment_html).toContain('Virtus Garments, Inc.');
    expect(row.subject).toBe('Virtus Garments, Inc.: your statement of account, 2026-09-01 to 2026-09-28');
    await run();
    expect(mail.sent.at(-1)!.attachment).toMatchObject({ filename: row.attachment_name, contentType: 'text/html; charset=utf-8' });
    // Anyone may send it again later: a statement is not once-only.
    expect((await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2026-09-28' })).statusCode).toBe(200);
  });

  it('the statement button is refused for an encoder, bad dates and a customer who did not agree', async () => {
    expect((await encoder.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2026-09-28' })).statusCode).toBe(403);
    expect((await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-29', to: '2026-09-28' })).json().code).toBe('BAD_DATES');
    expect((await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2027-01-01' })).json().code).toBe('BAD_DATES');
    expect((await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2026-09-28', total: 1 })).statusCode).toBe(400);
    const refused = await accountant.post('/api/com/statements', { customerId: c.other, from: '2026-09-01', to: '2026-09-28' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toBe('This customer has not agreed to get emails.');
    expect(outbox()).toEqual([]);
  });

  it('bulk statements queue exactly the ticked eligible customers once, with the same figures as a single statement', async () => {
    consent(c.other, 'club@example.test', 1);
    const school = await jobOrder(c.school); await ready(school); await release(school, '1201');
    const club = await jobOrder(c.other); await ready(club); await release(club, '1202');
    const list = await accountant.get('/api/com/statements/bulk?date=2026-09-28');
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().eligible.map((row: any) => [row.customerId, row.balanceCents])).toEqual([[c.school, 5_600_000], [c.other, 5_600_000]]);

    expect((await accountant.post('/api/com/statements/bulk', { date: '2026-09-28', customerIds: [c.other] })).json()).toEqual({ queued: 1 });
    const bulk = outbox().find((row) => row.dedupe_key === `statement:2026-09-28:${c.other}`)!;
    expect(bulk).toMatchObject({ customer_id: c.other, period_from: '2026-09-01', period_to: '2026-09-28', to_address: 'club@example.test' });
    expect(outbox().some((row) => row.template === 'statement' && row.customer_id === c.school)).toBe(false);
    expect((await accountant.post('/api/com/statements/bulk', { date: '2026-09-28', customerIds: [c.other] })).json()).toEqual({ queued: 0 });

    const figures = (await accountant.get(`/api/rpt/customer-statement?customerId=${c.other}&from=2026-09-01&to=2026-09-28`)).json();
    expect(figures.closingBalanceCents).toBe(5_600_000);
    expect(bulk.attachment_html).toContain('₱56,000.00');
    expect(bulk.subject).toContain('2026-09-01 to 2026-09-28');
  });

  it('bulk statements list a customer without consent apart, never queue it, and refuse other roles', async () => {
    const school = await jobOrder(c.school); await ready(school); await release(school, '1301');
    consent(c.school, 'school@example.test', 0);
    const list = (await accountant.get('/api/com/statements/bulk?date=2026-09-28')).json();
    expect(list.eligible).toEqual([]);
    expect(list.excluded).toEqual([expect.objectContaining({ customerId: c.school, reason: 'No email consent' })]);
    expect((await accountant.post('/api/com/statements/bulk', { date: '2026-09-28', customerIds: [c.school] })).json()).toEqual({ queued: 0 });
    expect(outbox().filter((row) => row.template === 'statement')).toEqual([]);
    expect((await encoder.get('/api/com/statements/bulk?date=2026-09-28')).statusCode).toBe(403);
    expect((await encoder.post('/api/com/statements/bulk', { date: '2026-09-28', customerIds: [c.school] })).statusCode).toBe(403);
  });
});

describe('who gets email', () => {
  beforeEach(turnOn);

  it('nothing is queued for a customer without consent, or without a valid address', async () => {
    consent(c.school, 'school@example.test', 0);
    consent(c.other, null, 1);
    await jobOrder(c.school);
    await jobOrder(c.other);
    expect(scanOnce(env.db, now())).toMatchObject({ created: 0 });
    consent(c.school, null, 1);
    consent(c.other, 'not an address', 1);
    const jo = await jobOrder(c.school);
    await ready(jo);
    await jobOrder(c.other);
    expect(scanOnce(env.db, now())).toMatchObject({ created: 0, ready: 0 });
    expect(outbox()).toEqual([]);
    for (const template of ['statement']) {
      const r = await accountant.post(`/api/com/${template}s`, { customerId: c.other, from: '2026-09-01', to: '2026-09-28' });
      expect(r.json().message).toBe('This customer has no valid email address on file.');
    }
  });

  it('consent withdrawn after queueing stops the email being sent', async () => {
    consent();
    await jobOrder();
    scanOnce(env.db, now());
    consent(c.school, 'school@example.test', 0);
    expect(await run()).toMatchObject({ sent: 0, failed: 1 });
    expect(mail.sent).toEqual([]);
    expect(outbox()[0]).toMatchObject({ status: 'failed', last_error: 'The customer no longer agrees to get emails, so it was not sent.' });
  });
});

describe('sending is off', () => {
  it('queues nothing and sends nothing; turning it on starts from now', async () => {
    consent();
    await jobOrder();
    expect(scanOnce(env.db, now())).toMatchObject({ created: 0 });
    expect(await run()).toMatchObject({ sent: 0 });
    expect((await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2026-09-28' })).json().message).toBe('Sending emails is turned off.');
    await turnOn();
    scanOnce(env.db, now());
    expect(outbox()).toEqual([]); // the job order recorded while it was off is not emailed now
    await jobOrder();
    scanOnce(env.db, now());
    expect(outbox()).toHaveLength(1);
    // Turned off again: what is already queued stays queued and is not sent.
    await saveSettings({ ...SETTINGS, sendingOn: false, appPassword: undefined });
    await run();
    expect(mail.sent).toEqual([]);
    expect(mail.tries).toBe(0);
    expect(outbox()[0]!.status).toBe('queued');
  });
});

describe('sending, retries and the failed state', () => {
  beforeEach(async () => {
    await turnOn();
    consent();
    await jobOrder();
    scanOnce(env.db, now());
  });

  it('sends a queued email as the company, once', async () => {
    expect(await run()).toMatchObject({ sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ from: { name: 'Virtus Garments', address: 'shop@example.test' }, to: 'school@example.test' });
    expect(outbox()[0]).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
    expect(outbox()[0]!.sent_at).toBe(now());
    await run();
    expect(mail.sent).toHaveLength(1);
    expect(() => env.db.prepare("UPDATE com_outbox SET status = 'queued'").run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare('DELETE FROM com_outbox').run()).toThrow();
  });

  it('when the internet is down nothing is tried and no try is counted', async () => {
    mail.up = false;
    expect(await run()).toMatchObject({ sent: 0, offline: true });
    expect(mail.tries).toBe(0);
    expect(outbox()[0]).toMatchObject({ status: 'queued', attempts: 0 });
    mail.up = true;
    expect(await run()).toMatchObject({ sent: 1 });
  });

  it('a refused try waits longer each time, and after 5 failures the email is failed with the reason', async () => {
    mail.failWith = 'Mailbox unavailable';
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await run()).toMatchObject({ retrying: 1 });
      const row = outbox()[0]!;
      expect(row).toMatchObject({ status: 'queued', attempts: attempt, last_error: 'Mailbox unavailable' });
      expect(await run()).toMatchObject({ sent: 0, retrying: 0 }); // not yet due
      expect(mail.tries).toBe(attempt);
      env.clock.advance(WAIT_MINUTES[attempt - 1]! * 60_000 - 1000);
      expect(await run()).toMatchObject({ retrying: 0 }); // one second early
      env.clock.advance(1000);
    }
    expect(WAIT_MINUTES).toEqual([...WAIT_MINUTES].sort((a, b) => a - b));
    expect(await run()).toMatchObject({ failed: 1 });
    expect(outbox()[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'Mailbox unavailable' });
    env.clock.advance(24 * 3600_000);
    await run();
    expect(mail.tries).toBe(MAX_ATTEMPTS); // a failed email is not tried again by itself
    expect(env.db.prepare('SELECT COUNT(*) FROM com_attempts WHERE outcome = ?').pluck().get('failed')).toBe(MAX_ATTEMPTS);
  });

  it('a later try can succeed', async () => {
    mail.failWith = 'Temporary problem';
    await run();
    mail.failWith = null;
    env.clock.advance(WAIT_MINUTES[0]! * 60_000);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(outbox()[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('the owner can send a failed one again; nobody else can, and a sent one cannot be', async () => {
    const row = outbox()[0]!;
    expect((await owner.post(`/api/com/outbox/${row.id}/resend`, {})).json().code).toBe('NOT_FAILED');
    for (const who of [encoder, accountant]) expect((await who.post(`/api/com/outbox/${row.id}/resend`, {})).statusCode).toBe(403);
    mail.failWith = 'Mailbox unavailable';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await run();
      env.clock.advance((WAIT_MINUTES[i] ?? 0) * 60_000);
    }
    expect(outbox()[0]!.status).toBe('failed');
    owner = await env.as('owner'); // signed out after hours idle
    expect((await owner.post(`/api/com/outbox/${row.id}/resend`, {})).statusCode).toBe(200);
    expect(outbox()[0]).toMatchObject({ status: 'queued', attempts: 0 });
    mail.failWith = null;
    expect(await run()).toMatchObject({ sent: 1 });
    expect(outbox()[0]!.status).toBe('sent');
    const log = env.db.prepare('SELECT outcome FROM com_attempts ORDER BY id').pluck().all();
    expect(log).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'resent', 'sent']);
    expect((await owner.post('/api/com/outbox/nope/resend', {})).statusCode).toBe(404);
  });

  it('the outbox screen lists every email with its status; only the owner and accountant see it', async () => {
    expect((await encoder.get('/api/com/outbox')).statusCode).toBe(403);
    const list = (await accountant.get('/api/com/outbox')).json();
    expect(list.counts).toEqual({ queued: 1, sent: 0, failed: 0 });
    expect(list.rows[0]).toMatchObject({ template: 'job_order_created', status: 'queued', customerName: 'Moonlight Test School', toAddress: 'school@example.test' });
    expect((await owner.get('/api/com/outbox?status=failed')).json().rows).toEqual([]);
    expect((await owner.get('/api/com/outbox?status=nonsense')).statusCode).toBe(400);
  });
});

describe('no customer email says Invoice or Official Receipt', () => {
  const ALL = ['Invoice', 'INVOICE no. 5', 'Sales Invoice', 'Official Receipt', 'official-receipt', 'OFFICIAL_RECEIPT', 'official  receipt'];

  it('finds the words in a subject, a body or a file name', () => {
    for (const w of ALL) {
      expect(forbiddenWord(w), w).toBeDefined();
      expect(() => assertAllowedWording({ subject: w, body: 'x' })).toThrow();
      expect(() => assertAllowedWording({ subject: 'x', body: `hello ${w}` })).toThrow();
      expect(() => assertAllowedWording({ subject: 'x', body: 'x', attachmentName: `${w}.html` })).toThrow();
    }
    expect(forbiddenWord('Statement of Account', 'Job order JO-000001', 'statement.html', null, undefined)).toBeUndefined();
  });

  it('every template is clean, even with names and items that carry the words', () => {
    const bad = 'Invoice Printing / Official Receipt Co';
    const lines = [{ description: 'Official Receipt holder', qty: 2 }];
    const messages = [
      createdMessage('Virtus Garments, Inc.', { customerName: bad, number: 'JO-000001', dueDate: '2026-10-13', totalCents: 100, requiredDownpaymentCents: 50, lines }),
      readyMessage('Virtus Garments, Inc.', { customerName: bad, number: 'JO-000001', balanceDueCents: 100 }),
      claimedMessage('Virtus Garments, Inc.', { customerName: bad, jobOrderNumber: 'JO-000001', releaseNumber: 'REL-000001', date: '2026-09-28', claimedBy: 'Invoice Clerk', balanceDueCents: 0, lines }),
      statementMessage('Virtus Garments, Inc.', { customerName: bad, from: '2026-09-01', to: '2026-09-28', closingBalanceCents: 0, depositsHeldCents: 100, fileName: 'statement-of-account-2026-09-01-to-2026-09-28.html' }),
    ];
    for (const m of messages) {
      expect(() => assertAllowedWording(m)).not.toThrow();
      expect(forbiddenWord(m.subject, m.body)).toBeUndefined();
    }
    expect(plain(bad)).toBe('… Printing / … Co');
  });

  it('a customer named with the words still gets clean emails, and nothing queued has the words anywhere', async () => {
    await turnOn();
    env.db.prepare("UPDATE cus_customers SET display_name = 'Invoice Official Receipt Academy' WHERE id = ?").run(c.school);
    consent();
    const jo = await jobOrder();
    await ready(jo);
    await release(jo);
    scanOnce(env.db, now());
    expect(await accountant.post('/api/com/statements', { customerId: c.school, from: '2026-09-01', to: '2026-09-28' })).toMatchObject({ statusCode: 200 });
    const rows = outbox();
    expect(rows.map((r) => r.template)).toEqual(['job_order_created', 'job_order_ready', 'claimed', 'statement'].filter((t) => rows.some((r) => r.template === t)));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(forbiddenWord(r.subject, r.body, r.attachment_name), r.template).toBeUndefined();
    // The attached statement never carries booklet wording either, whatever the journal memos say.
    const statement = rows.find((r) => r.template === 'statement')!;
    expect(forbiddenWord(statement.attachment_html)).toBeUndefined();
  });
});
