/**
 * Payslip email (PLAN B3, E11, E14) with a fake mail transport: no network is used anywhere in this file.
 * Queued when a payroll release is recorded, for employees who agreed and have an address; once per employee per release;
 * none for a cancelled release, a new one when it is recorded again; no pay figure in the subject, the text, the audit
 * rows or the outbox list of someone without payroll view (the figures are only in the attachment). Made-up people only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPeso, formatPesos } from '@moonproject/shared';
import { cashPlaceId, PASSWORD, type Client } from '../../../../test/helpers.ts';
import { openDb } from '../../../platform/db/driver.ts';
import { stamp } from '../../../platform/clock.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { releaseDoc, releaseStatus } from '../../PAY/doctypes/release.ts';
import { world } from '../../PAY/tests/world.ts';
import { sendDue } from '../outbox.ts';
import { scanOnce } from '../scan.ts';
import { periodWords } from '../text.ts';
import { useTransport, type MailMessage, type MailTransport } from '../transport.ts';

type World = Awaited<ReturnType<typeof world>>;

const SECRET = 'zqxj wvut mnbp lkhg';
const SETTINGS = { sendingOn: true, host: 'smtp.example.test', port: 587, user: 'shop@example.test', senderName: 'Virtus Garments', senderAddress: 'shop@example.test', appPassword: SECRET };

interface Fake extends MailTransport { sent: MailMessage[]; up: boolean; failWith: string | null }
function fakeTransport(): Fake {
  const t: Fake = {
    sent: [], up: true, failWith: null,
    online: async () => t.up,
    send: async (config, m) => {
      if (t.failWith !== null) throw new Error(t.failWith.replace('<password>', config.password));
      t.sent.push(m);
    },
  };
  return t;
}

let w: World;
let mail: Fake;
let dir: string;
let owner: Client;
let accountant: Client;
let encoder: Client;
let cash: number;
const now = () => stamp(w.env.clock);
const outbox = () => w.db.prepare('SELECT * FROM com_outbox ORDER BY rowid').all() as Record<string, any>[];
const scan = () => scanOnce(w.db, now());
const send = () => sendDue(w.db, mail, now);
const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'com-payslip-'));
  process.env.MOONPROJECT_COM_DIR = dir;
  w = await world('2026-09-30');
  // The outbox screen for someone with no payroll view: an encoder who has been given the outbox.
  w.db.prepare(`INSERT INTO role_permissions (role_key, permission_key, granted, updated_at) VALUES ('encoder', 'com.outbox.view', 1, 'x')
    ON CONFLICT (role_key, permission_key) DO UPDATE SET granted = 1`).run();
  owner = await w.env.as('owner');
  accountant = await w.env.as('accountant');
  encoder = await w.env.as('encoder');
  mail = fakeTransport();
  useTransport(mail);
  cash = cashPlaceId(w.db, '1101');
  w.db.prepare(`INSERT INTO prt_company_profile (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
    VALUES (1, 'Virtus Garments, Inc.', 'Virtus', '000-000-000-000', 'Silang, Cavite', 1, 1, ?, ?)`).run(now(), owner.userId);
});
afterEach(() => {
  useTransport(null);
  delete process.env.MOONPROJECT_COM_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const turnOn = async () => {
  await stepUp(owner);
  const version = (await owner.get('/api/com/settings')).json().version;
  expect((await owner.put('/api/com/settings', SETTINGS, { 'if-match': String(version) })).statusCode).toBe(200);
};
/** Sets an employee's payslip email address and consent as the payroll setup permission holder does. */
async function setMail(id: string, email: string | null, consent: boolean, who = accountant) {
  const version = (await who.get(`/api/emp/employees/${id}`)).json().employee.version;
  return who.put(`/api/emp/employees/${id}/payslip-email`, { email, consent }, { 'if-match': String(version) });
}
/** Three people worked the second half of September; each is on a daily rate. */
function staff() {
  const ids = ['Ana Tahi', 'Ben Uy', 'Cy Lim'].map((name, i) => w.person(name, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000 + i * 5_000 }));
  w.attend(ids.flatMap((employeeId) => ['16', '17', '18', '19', '22', '23'].map((d) => ({ employeeId, date: `2026-09-${d}`, status: 'present' }))));
  return { ana: ids[0]!, ben: ids[1]!, cy: ids[2]! };
}
const recordRun = () => w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' });
function recordRelease(runId: string, employeeIds: string[]) {
  const amountCents = releaseStatus(w.db, runId).filter((s) => employeeIds.includes(s.employeeId)).reduce((sum, s) => sum + s.netCents, 0);
  return w.record(releaseDoc, { runId, employeeIds, tenders: [{ cashPlaceId: cash, amountCents }] });
}
/** Every pay figure on one employee's payslip, as it is written on the print and as raw centavos. */
function figuresOf(runId: string, employeeId: string): string[] {
  const e = runDoc.load(w.db, runId).employees.find((x) => x.employeeId === employeeId)!;
  const cents = [e.grossCents, e.netCents, e.sssEeCents, e.phicEeCents, e.hdmfEeCents, e.wtaxCents, ...e.lines.map((l) => l.amountCents)].filter((c) => c !== 0);
  return [...new Set(cents.flatMap((c) => [formatPeso(c), formatPesos(c), String(c)]))];
}
const auditRows = () => (w.db.prepare(`SELECT action, entity_id AS entityId, data FROM audit_log WHERE action IN ('emp.payslip_email', 'com.payslip_queued', 'com.resend', 'com.not_queued', 'com.settings')`).all() as { action: string; data: string }[]);

describe('the employee record: address and consent', () => {
  it('only someone with the payroll setup permission changes them, and the audit names the fields, never the address', async () => {
    const { ana } = staff();
    expect((await setMail(ana, 'ana@example.test', true, encoder)).statusCode).toBe(403);
    expect((await setMail(ana, 'ana@example.test', true, accountant)).statusCode).toBe(200);
    const shown = (await accountant.get(`/api/emp/employees/${ana}`)).json();
    expect(shown.payslipEmail).toEqual({ email: 'ana@example.test', consent: true });
    expect((await encoder.get(`/api/emp/employees/${ana}`)).json().payslipEmail).toBeNull();

    // The ordinary edit route cannot carry them (its input is strict), so emp.manage alone never changes them.
    const version = shown.employee.version;
    const sneaky = await accountant.put(`/api/emp/employees/${ana}`, { payslipEmail: 'x@example.test' }, { 'if-match': String(version) });
    expect(sneaky.statusCode).toBe(400);

    const audit = auditRows().filter((r) => r.action === 'emp.payslip_email');
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.data)).toEqual({ fields: ['payslipEmail', 'payslipEmailConsent'], addressNow: 'set', consentBefore: false, consentNow: true });
    expect(JSON.stringify(audit)).not.toContain('example.test');
  });

  it('needs a valid address to tick consent, a version to save, and a real change', async () => {
    const { ana } = staff();
    expect((await setMail(ana, null, true)).statusCode).toBe(400);
    expect((await setMail(ana, 'not an address', false)).statusCode).toBe(400);
    expect((await accountant.put(`/api/emp/employees/${ana}/payslip-email`, { email: 'ana@example.test', consent: true })).statusCode).toBe(428);
    expect((await setMail(ana, 'ana@example.test', true)).statusCode).toBe(200);
    expect((await setMail(ana, 'ana@example.test', true)).json().code).toBe('NO_CHANGES');
    // Withdrawing consent, and the address alone changing, are audited too.
    expect((await setMail(ana, 'ana@example.test', false)).statusCode).toBe(200);
    expect((await setMail(ana, 'ana2@example.test', false)).statusCode).toBe(200);
    expect(auditRows().filter((r) => r.action === 'emp.payslip_email').map((r) => JSON.parse(r.data).fields)).toEqual([['payslipEmail', 'payslipEmailConsent'], ['payslipEmailConsent'], ['payslipEmail']]);
  });
});

describe('queued when a payroll release is recorded', () => {
  it('one payslip email for each released employee who agreed and has an address, and none for the others', async () => {
    const { ana, ben, cy } = staff();
    await setMail(ana, 'ana@example.test', true);
    await setMail(ben, 'ben@example.test', false); // an address, but no consent
    // Cy has neither. A consent given with an address that is not valid (typed straight into the table) queues nothing either.
    await turnOn();
    const run = recordRun();
    recordRelease(run.id, [ana, ben, cy]);
    const counts = scan();
    expect(counts.payslips).toBe(1);
    expect(counts.skipped).toMatchObject({ no_consent: 2 });

    const [row, ...rest] = outbox();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      template: 'payslip', employee_id: ana, customer_id: null, customer_name: 'Ana Tahi', to_address: 'ana@example.test', status: 'queued', document_number: 'POUT-000001',
      period_from: '2026-09-16', period_to: '2026-09-30', subject: 'Payslip for 16 to 30 September 2026', attachment_name: 'payslip-2026-09-16-to-2026-09-30.html',
    });
    expect(row!.dedupe_key).toMatch(/^payslip:/);

    // Sent through the same job: as the company, with the payslip attached as HTML.
    expect(await send()).toMatchObject({ sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'ana@example.test', subject: 'Payslip for 16 to 30 September 2026', from: { name: 'Virtus Garments', address: 'shop@example.test' } });
    expect(mail.sent[0]!.attachment).toMatchObject({ filename: 'payslip-2026-09-16-to-2026-09-30.html', contentType: 'text/html; charset=utf-8' });
  });

  it('the attachment is the payslip print of that one employee: the same HTML as the print route, with only their figures', async () => {
    const { ana, ben } = staff();
    await setMail(ana, 'ana@example.test', true);
    await setMail(ben, 'ben@example.test', true);
    await turnOn();
    const run = recordRun();
    recordRelease(run.id, [ana, ben]);
    scan();
    await send();
    const anaMail = mail.sent.find((m) => m.to === 'ana@example.test')!;
    const html = anaMail.attachment!.content;

    const printed = (await accountant.post(`/api/prt/print/pay.run/${run.id}`, { employeeId: ana })).json().html as string;
    const body = (page: string) => page.match(/<main>[\s\S]*?<\/main>/)![0];
    expect(body(html)).toBe(body(printed));
    expect(html).toContain('PAYSLIP');
    expect(html).toContain('Ana Tahi');
    expect(html).not.toContain('Ben Uy');
    // The figures are here, and only here.
    const net = runDoc.load(w.db, run.id).employees.find((e) => e.employeeId === ana)!.netCents;
    expect(html).toContain(formatPeso(net));
    // An emailed payslip is not a print: it is not counted as one.
    expect(w.db.prepare('SELECT COUNT(*) FROM prt_print_log WHERE document_id = ?').pluck().get(run.id)).toBe(1); // only the print route above
  });

  it('never twice: the same release scanned again, or from the start, queues nothing more', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    const run = recordRun();
    recordRelease(run.id, [ana]);
    expect(scan().payslips).toBe(1);
    expect(scan().payslips).toBe(0);
    w.db.prepare(`UPDATE com_cursors SET last_rowid = 0 WHERE key = 'payroll_release'`).run();
    const again = scan();
    expect(again.payslips).toBe(0);
    expect(again.skipped.already_queued).toBe(1);
    expect(outbox()).toHaveLength(1);
  });

  it('a release for some of the run queues for those paid; a later release of the rest queues for them', async () => {
    const { ana, ben } = staff();
    await setMail(ana, 'ana@example.test', true);
    await setMail(ben, 'ben@example.test', true);
    await turnOn();
    const run = recordRun();
    recordRelease(run.id, [ana]);
    scan();
    expect(outbox().map((r) => r.employee_id)).toEqual([ana]);
    recordRelease(run.id, [ben]);
    scan();
    expect(outbox().map((r) => r.employee_id)).toEqual([ana, ben]);
  });

  it('nothing for a cancelled release; a release recorded again after a cancel gets a new email', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    const run = recordRun();

    // Cancelled before the scan looked: no one to pay, no email.
    const first = recordRelease(run.id, [ana]);
    w.cancel(releaseDoc, first.id);
    expect(scan().payslips).toBe(0);
    expect(outbox()).toEqual([]);

    // Recorded again: a new release, a new email.
    const second = recordRelease(run.id, [ana]);
    expect(second.number).not.toBe(first.number);
    expect(scan().payslips).toBe(1);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ document_id: second.id, document_number: second.number });

    // Queued, then the release is cancelled before the email goes: it is not sent, and says why.
    w.cancel(releaseDoc, second.id);
    expect(await send()).toMatchObject({ sent: 0, failed: 1 });
    expect(mail.sent).toEqual([]);
    expect(outbox()[0]).toMatchObject({ status: 'failed', last_error: 'The payroll release was cancelled, so the payslip was not sent.' });

    // Recorded a third time, after it was cancelled twice: yet another email.
    const third = recordRelease(run.id, [ana]);
    expect(scan().payslips).toBe(1);
    expect(outbox().map((r) => r.document_id)).toEqual([second.id, third.id]);
    expect(await send()).toMatchObject({ sent: 1 });
  });

  it('consent withdrawn after queueing stops it being sent; a bad address queues nothing', async () => {
    const { ana, ben } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    // Ben agreed, but the address in the table is not one (as an import might leave it).
    w.db.prepare(`UPDATE emp_employees SET payslip_email = 'nobody', payslip_email_consent = 1 WHERE id = ?`).run(ben);
    const run = recordRun();
    recordRelease(run.id, [ana, ben]);
    const counts = scan();
    expect(counts).toMatchObject({ payslips: 1, skipped: { no_email: 1 } });
    await setMail(ana, 'ana@example.test', false);
    expect(await send()).toMatchObject({ sent: 0, failed: 1 });
    expect(mail.sent).toEqual([]);
    expect(outbox()[0]!.last_error).toBe('The employee no longer agrees to get emails, so it was not sent.');
  });

  it('while sending is off nothing is queued; turning it on starts from now, so an earlier release is not emailed', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    const run = recordRun();
    recordRelease(run.id, [ana]);
    expect(scan().payslips).toBe(0);
    expect(outbox()).toEqual([]);
    await turnOn();
    expect(scan().payslips).toBe(0);
    expect(outbox()).toEqual([]);
  });

  it('a payroll release with no company profile waits and is queued when the profile is filled in', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    const run = recordRun();
    recordRelease(run.id, [ana]);
    w.db.prepare('UPDATE prt_company_profile SET registered_name = \'\' WHERE id = 1').run();
    expect(scan().payslips).toBe(0);
    w.db.prepare(`UPDATE prt_company_profile SET registered_name = 'Virtus Garments, Inc.' WHERE id = 1`).run();
    expect(scan().payslips).toBe(1);
  });

  it('a scan added by this update starts from now on a shop that already had the other three', async () => {
    staff();
    await turnOn();
    scan();
    // The shop as it was before this update: three cursors (the table refuses deletes, so the guard is lifted for the test).
    w.db.exec(`DROP TRIGGER com_cursors_no_delete; DELETE FROM com_cursors WHERE key = 'payroll_release'`);
    expect(w.db.prepare('SELECT COUNT(*) FROM com_cursors').pluck().get()).toBe(3);
    scan();
    expect(w.db.prepare('SELECT key FROM com_cursors ORDER BY key').pluck().all()).toEqual(['job_order_created', 'job_order_ready', 'payroll_release', 'release']);
  });
});

describe('payslips hold pay figures', () => {
  it('no figure is in the subject or the text, and none is in the audit rows or the outbox list of someone without payroll view', async () => {
    const { ana, ben } = staff();
    await setMail(ana, 'ana@example.test', true);
    await setMail(ben, 'ben@example.test', true);
    await turnOn();
    const run = recordRun();
    recordRelease(run.id, [ana, ben]);
    scan();
    await send();
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[0]!.attachment!.content).toContain(formatPeso(runDoc.load(w.db, run.id).employees.find((e) => e.name === 'Ana Tahi')!.netCents));

    const everyFigure = [...figuresOf(run.id, ana), ...figuresOf(run.id, ben)];
    expect(everyFigure.length).toBeGreaterThan(8);
    const mustHaveNone = (label: string, text: string) => {
      expect(text, label).not.toMatch(/₱|PHP|\bnet pay\b:?\s*\d/i);
      for (const f of everyFigure) expect(text.includes(f), `${label} has ${f}`).toBe(false);
    };
    for (const m of mail.sent) {
      mustHaveNone('subject', m.subject);
      mustHaveNone('body', m.text);
    }
    // The audit rows this feature writes: who and which period, never an amount.
    const audit = auditRows();
    expect(audit.map((r) => r.action).sort()).toEqual(['com.payslip_queued', 'com.payslip_queued', 'com.settings', 'emp.payslip_email', 'emp.payslip_email']);
    mustHaveNone('audit', JSON.stringify(audit));

    // The outbox list: an encoder with the outbox and no payroll view sees the recipient and the period.
    expect((await encoder.get('/api/pay/runs/' + run.id + '/payslips')).statusCode).toBe(403);
    const seen = await encoder.get('/api/com/outbox');
    expect(seen.statusCode).toBe(200);
    const rows = seen.json().rows as Record<string, any>[];
    expect(rows.map((r) => [r.kind, r.customerName, r.toAddress, r.periodFrom, r.periodTo])).toEqual([
      ['payslip', 'Ben Uy', 'ben@example.test', '2026-09-16', '2026-09-30'],
      ['payslip', 'Ana Tahi', 'ana@example.test', '2026-09-16', '2026-09-30'],
    ]);
    mustHaveNone('outbox list', seen.body);
    expect(seen.body).not.toContain('attachment_html');
    expect(seen.body).not.toContain('<html');
    // Nor does the owner's list carry them: the figures are only in the attachment.
    mustHaveNone('owner outbox list', (await owner.get('/api/com/outbox')).body);
  });

  it('every word an email says is clean: no "Invoice", and the text says only who, which period and that it is attached', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    recordRelease(recordRun().id, [ana]);
    scan();
    const { subject, body } = outbox()[0]!;
    expect(subject).toBe('Payslip for 16 to 30 September 2026');
    expect(body).toContain('Hello Ana Tahi,');
    expect(body).toContain('Attached (payslip-2026-09-16-to-2026-09-30.html) is your payslip for 16 to 30 September 2026.');
    expect(`${subject} ${body}`).not.toMatch(/invoice|official receipt/i);
  });

  it('a payslip row an owner resends after the mail server refused it keeps the same attachment; the App Password never shows', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    recordRelease(recordRun().id, [ana]);
    scan();
    mail.failWith = `535 authentication failed for <password>`;
    for (let i = 0; i < 5; i++) {
      await send();
      w.env.clock.advance(5 * 60 * 60_000);
    }
    const failed = outbox()[0]!;
    expect(failed).toMatchObject({ status: 'failed', attempts: 5 });
    expect(failed.last_error).not.toContain(SECRET);
    expect(failed.last_error).toContain('***');
    const html = failed.attachment_html as string;

    // Nobody but the owner can send it again (the hours passed, so everyone signs in again).
    [owner, accountant, encoder] = [await w.env.as('owner'), await w.env.as('accountant'), await w.env.as('encoder')];
    expect((await accountant.post(`/api/com/outbox/${failed.id}/resend`, {})).statusCode).toBe(403);
    expect((await encoder.post(`/api/com/outbox/${failed.id}/resend`, {})).statusCode).toBe(403);
    mail.failWith = null;
    expect((await owner.post(`/api/com/outbox/${failed.id}/resend`, {})).statusCode).toBe(200);
    expect(await send()).toMatchObject({ sent: 1 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.attachment!.content).toBe(html);
    expect(outbox()[0]).toMatchObject({ status: 'sent' });
    // A sent one cannot be sent again, and nothing in the audit or the log has the password.
    expect((await owner.post(`/api/com/outbox/${failed.id}/resend`, {})).statusCode).toBe(409);
    expect(JSON.stringify(auditRows())).not.toContain(SECRET);
    expect(JSON.stringify(w.db.prepare('SELECT * FROM com_attempts').all())).not.toContain(SECRET);
  });
});

describe('the outbox screen shows both kinds and filters by kind', () => {
  it('customer emails and payslip emails, each filter with its own counts', async () => {
    const { ana } = staff();
    await setMail(ana, 'ana@example.test', true);
    await turnOn();
    // A customer email (a statement) and a payslip email side by side.
    w.db.prepare(`INSERT INTO com_outbox (id, template, customer_id, customer_name, to_address, subject, body, status, attempts, next_attempt_at, created_at)
      VALUES ('cust-1', 'statement', 'c1', 'Placeholder School', 'school@example.test', 'S', 'B', 'failed', 5, ?, ?)`).run(now(), now());
    recordRelease(recordRun().id, [ana]);
    scan();

    const all = (await owner.get('/api/com/outbox')).json();
    expect(all.rows.map((r: any) => r.kind).sort()).toEqual(['customer', 'payslip']);
    expect(all.counts).toEqual({ queued: 1, sent: 0, failed: 1 });
    const payslips = (await owner.get('/api/com/outbox?kind=payslip')).json();
    expect(payslips.rows.map((r: any) => [r.kind, r.customerName])).toEqual([['payslip', 'Ana Tahi']]);
    expect(payslips.counts).toEqual({ queued: 1, sent: 0, failed: 0 });
    const customers = (await owner.get('/api/com/outbox?kind=customer&status=failed')).json();
    expect(customers.rows.map((r: any) => [r.kind, r.customerName])).toEqual([['customer', 'Placeholder School']]);
    expect(customers.counts).toEqual({ queued: 0, sent: 0, failed: 1 });
    expect((await owner.get('/api/com/outbox?kind=other')).statusCode).toBe(400);
    // Only those who may see the outbox see either kind.
    const production = await w.env.as('production');
    expect((await production.get('/api/com/outbox?kind=payslip')).statusCode).toBe(403);
  });
});

describe('the pay period in words', () => {
  it('within a month, across two months and across a year', () => {
    expect(periodWords('2026-09-16', '2026-09-30')).toBe('16 to 30 September 2026');
    expect(periodWords('2026-09-01', '2026-09-15')).toBe('1 to 15 September 2026');
    expect(periodWords('2026-09-28', '2026-10-04')).toBe('28 September to 4 October 2026');
    expect(periodWords('2026-12-28', '2027-01-03')).toBe('28 December 2026 to 3 January 2027');
  });
});

describe('the update: an outbox that already has customer emails keeps every row', () => {
  it('rebuilds the outbox, its attempt log and the cursors with the rows, the order and the guards kept', () => {
    const dir = fileURLToPath(new URL('../migrations', import.meta.url));
    const db = openDb(':memory:');
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE documents (id TEXT PRIMARY KEY);`);
    db.exec(readFileSync(join(dir, '0001_com.sql'), 'utf8'));
    db.prepare(`INSERT INTO com_outbox (id, template, customer_id, customer_name, to_address, subject, body, dedupe_key, status, attempts, next_attempt_at, created_at)
      VALUES ('a', 'statement', 'c1', 'C One', 'c1@example.test', 'S', 'B', 'k1', 'failed', 5, 't', 't'), ('b', 'claimed', 'c2', 'C Two', 'c2@example.test', 'S2', 'B2', 'k2', 'queued', 0, 't', 't')`).run();
    db.prepare(`INSERT INTO com_attempts (outbox_id, at, outcome, error) VALUES ('a', 't1', 'failed', 'e1'), ('a', 't2', 'failed', 'e2'), ('b', 't3', 'resent', NULL)`).run();
    db.prepare(`INSERT INTO com_cursors (key, last_rowid, updated_at) VALUES ('release', 7, 't')`).run();
    db.exec(readFileSync(join(dir, '0002_com_payslips.sql'), 'utf8'));

    expect(db.prepare('SELECT id, template, customer_id, employee_id, customer_name, dedupe_key, status, attempts FROM com_outbox ORDER BY rowid').all()).toEqual([
      { id: 'a', template: 'statement', customer_id: 'c1', employee_id: null, customer_name: 'C One', dedupe_key: 'k1', status: 'failed', attempts: 5 },
      { id: 'b', template: 'claimed', customer_id: 'c2', employee_id: null, customer_name: 'C Two', dedupe_key: 'k2', status: 'queued', attempts: 0 },
    ]);
    expect(db.prepare('SELECT id, outbox_id, at, outcome FROM com_attempts ORDER BY id').all()).toEqual([
      { id: 1, outbox_id: 'a', at: 't1', outcome: 'failed' }, { id: 2, outbox_id: 'a', at: 't2', outcome: 'failed' }, { id: 3, outbox_id: 'b', at: 't3', outcome: 'resent' },
    ]);
    expect(db.prepare('SELECT * FROM com_cursors').all()).toEqual([{ key: 'release', last_rowid: 7, updated_at: 't' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    // The guards are back: an attempt needs its email, a queued email keeps its text, a payslip needs its employee and period.
    expect(() => db.prepare(`INSERT INTO com_attempts (outbox_id, at, outcome) VALUES ('nope', 't', 'sent')`).run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(`UPDATE com_outbox SET subject = 'changed' WHERE id = 'a'`).run()).toThrow(/IMMUTABLE/);
    expect(() => db.prepare(`UPDATE com_attempts SET outcome = 'sent' WHERE id = 1`).run()).toThrow(/append-only/);
    expect(() => db.prepare(`INSERT INTO com_outbox (id, template, customer_id, customer_name, to_address, subject, body, status, next_attempt_at, created_at)
      VALUES ('p', 'payslip', 'c1', 'X', 'x@example.test', 'S', 'B', 'queued', 't', 't')`).run()).toThrow(/CHECK/);
    db.prepare(`INSERT INTO com_cursors (key, last_rowid, updated_at) VALUES ('payroll_release', 0, 't')`).run();
  });
});
