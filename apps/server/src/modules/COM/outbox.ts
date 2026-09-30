/**
 * The outbox (PLAN E14, C9). Every email is a row: the customer, the template, the address taken from the customer
 * record when it was queued, and the document. A timed job sends the queued ones while sending is on and the internet
 * is up. A failed try waits longer each time; after 5 failures the row is `failed` with the reason. Rows are never
 * deleted, and what an email says never changes.
 *
 * Nothing here is called from posting code: the timed scan (scan.ts) finds new job orders, ready job orders and
 * releases by reading them, and an email that cannot be made or sent never touches the work that caused it.
 */
import { AppError, conflict, manilaTimestamp, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { customerContact } from '../CUS/public.ts';
import { companyRegisteredName } from '../PRT/public.ts';
import { EMAIL, comSettings, missingForSending, readAppPassword, scrub } from './settings.ts';
import { assertAllowedWording, type Template } from './text.ts';
import type { MailTransport } from './transport.ts';

export const MAX_ATTEMPTS = 5;
/** Minutes to wait after the 1st, 2nd, 3rd and 4th failed try. */
export const WAIT_MINUTES = [5, 15, 60, 240] as const;
const BATCH = 20;

export interface Contact { id: string; name: string; email: string }
export type NotQueued = 'sending_off' | 'no_customer' | 'no_consent' | 'no_email' | 'no_profile' | 'already_queued';
export const NOT_QUEUED_WORDS: Record<NotQueued, string> = {
  sending_off: 'Sending emails is turned off.',
  no_customer: 'That customer is not on file.',
  no_consent: 'This customer has not agreed to get emails.',
  no_email: 'This customer has no valid email address on file.',
  no_profile: 'The company profile is not filled in yet, so the emails cannot say who they are from.',
  already_queued: 'That email was already queued.',
};

export interface Draft { subject: string; body: string; attachment?: { name: string; html: string } }
export interface EnqueueRequest {
  template: Template;
  customerId: string;
  document?: { id: string; number: string };
  period?: { from: string; to: string };
  /** One email per job order or release: a second try to queue the same one does nothing. Statements have none. */
  dedupeKey?: string;
  /** Other keys that mean the same email was already queued (an edited job order that was already announced). */
  alsoCoveredBy?: string[];
  userId?: string;
  at: string;
  build(company: string, customerName: string): Draft;
}

export function enqueue(db: Db, r: EnqueueRequest): { ok: true; id: string } | { ok: false; reason: NotQueued } {
  if (!comSettings(db).sendingOn) return { ok: false, reason: 'sending_off' };
  const customer = customerContact(db, r.customerId);
  if (!customer) return { ok: false, reason: 'no_customer' };
  if (!customer.emailConsent) return { ok: false, reason: 'no_consent' };
  if (!customer.email || !EMAIL.test(customer.email)) return { ok: false, reason: 'no_email' };
  const company = companyRegisteredName(db);
  if (!company) return { ok: false, reason: 'no_profile' };
  const queuedBefore = db.prepare('SELECT 1 FROM com_outbox WHERE dedupe_key = ?');
  if (r.dedupeKey && [r.dedupeKey, ...(r.alsoCoveredBy ?? [])].some((key) => queuedBefore.get(key))) return { ok: false, reason: 'already_queued' };
  const draft = r.build(company, customer.name);
  assertAllowedWording({ subject: draft.subject, body: draft.body, attachmentName: draft.attachment?.name });
  const id = newId();
  db.prepare(`INSERT INTO com_outbox (id, template, customer_id, customer_name, to_address, document_id, document_number, period_from, period_to,
      subject, body, attachment_name, attachment_html, dedupe_key, status, attempts, next_attempt_at, created_at, created_by)
    VALUES (@id, @template, @customerId, @customerName, @to, @documentId, @documentNumber, @from, @to2, @subject, @body, @attachmentName, @attachmentHtml,
      @dedupeKey, 'queued', 0, @at, @at, @userId)`).run({
    id, template: r.template, customerId: customer.id, customerName: customer.name, to: customer.email, documentId: r.document?.id ?? null,
    documentNumber: r.document?.number ?? null, from: r.period?.from ?? null, to2: r.period?.to ?? null, subject: draft.subject, body: draft.body,
    attachmentName: draft.attachment?.name ?? null, attachmentHtml: draft.attachment?.html ?? null, dedupeKey: r.dedupeKey ?? null, at: r.at, userId: r.userId ?? null,
  });
  return { ok: true, id };
}

interface DueRow {
  id: string; template: Template; customer_id: string; to_address: string; subject: string; body: string;
  attachment_name: string | null; attachment_html: string | null; attempts: number;
}
const after = (at: string, minutes: number) => manilaTimestamp(new Date(Date.parse(at) + minutes * 60_000));

export interface SendResult { sent: number; retrying: number; failed: number; offline: boolean }

/**
 * Sends what is due. Off, unconfigured or offline: nothing is tried and no try is counted. A try that the mail server
 * refuses counts; the error is stripped of the App Password before it is kept.
 */
export async function sendDue(db: Db, transport: MailTransport, now: () => string, log: (message: string) => void = () => {}): Promise<SendResult> {
  const result: SendResult = { sent: 0, retrying: 0, failed: 0, offline: false };
  const settings = comSettings(db);
  if (!settings.sendingOn) return result;
  const password = readAppPassword(db);
  if (missingForSending(settings, password !== null).length > 0 || password === null) return result;
  const due = db.prepare(`SELECT id, template, customer_id, to_address, subject, body, attachment_name, attachment_html, attempts
    FROM com_outbox WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY rowid LIMIT ?`).all(now(), BATCH) as DueRow[];
  if (due.length === 0) return result;
  if (!(await transport.online())) return { ...result, offline: true };

  const record = (row: DueRow, outcome: 'sent' | 'failed', error: string | null, next: { status: 'sent' | 'queued' | 'failed'; attempts: number; at: string }) =>
    tx(db, () => {
      db.prepare(`UPDATE com_outbox SET status = @status, attempts = @attempts, next_attempt_at = @nextAt, last_error = @error, sent_at = @sentAt WHERE id = @id`)
        .run({ id: row.id, status: next.status, attempts: next.attempts, nextAt: next.at, error, sentAt: next.status === 'sent' ? next.at : null });
      db.prepare('INSERT INTO com_attempts (outbox_id, at, outcome, error) VALUES (?, ?, ?, ?)').run(row.id, next.at, outcome, error);
    });

  for (const row of due) {
    const at = now();
    // Consent can be withdrawn after an email was queued; the address stays as it was when queued.
    if (!customerContact(db, row.customer_id)?.emailConsent) {
      record(row, 'failed', 'The customer no longer agrees to get emails, so it was not sent.', { status: 'failed', attempts: row.attempts, at });
      result.failed++;
      continue;
    }
    try {
      await transport.send({ host: settings.host, port: settings.port, user: settings.user, password }, {
        from: { name: settings.senderName, address: settings.senderAddress }, to: row.to_address, subject: row.subject, text: row.body,
        ...(row.attachment_name && row.attachment_html ? { attachment: { filename: row.attachment_name, content: row.attachment_html, contentType: 'text/html; charset=utf-8' } } : {}),
      });
      record(row, 'sent', null, { status: 'sent', attempts: row.attempts + 1, at: now() });
      result.sent++;
    } catch (e) {
      const error = scrub((e as Error).message || 'The mail server refused it.', password);
      const attempts = row.attempts + 1;
      const failedFor = attempts >= MAX_ATTEMPTS;
      record(row, 'failed', error, { status: failedFor ? 'failed' : 'queued', attempts, at: failedFor ? at : after(at, WAIT_MINUTES[attempts - 1]!) });
      failedFor ? result.failed++ : result.retrying++;
      log(`Email ${row.id} (${row.template}) try ${attempts} failed: ${error}`);
    }
  }
  return result;
}

/** The owner sends a failed one again: a fresh set of 5 tries. The earlier tries stay in the log. */
export function resend(db: Db, id: string, who: { userId: string; at: string }): void {
  if (!comSettings(db).sendingOn) throw conflict('SENDING_OFF', 'Sending emails is turned off. Turn it on in the email settings first.');
  tx(db, () => {
    const row = db.prepare('SELECT status FROM com_outbox WHERE id = ?').get(id) as { status: string } | undefined;
    if (!row) throw notFound('That email');
    if (row.status !== 'failed') throw conflict('NOT_FAILED', 'Only an email that failed can be sent again.');
    db.prepare(`UPDATE com_outbox SET status = 'queued', attempts = 0, next_attempt_at = ? WHERE id = ?`).run(who.at, id);
    db.prepare(`INSERT INTO com_attempts (outbox_id, at, outcome, user_id) VALUES (?, ?, 'resent', ?)`).run(id, who.at, who.userId);
    appendAudit(db, { at: who.at, userId: who.userId, action: 'com.resend', entityType: 'com.outbox', entityId: id });
  });
}

export function outboxList(db: Db, status?: string, limit = 100) {
  const rows = db.prepare(`SELECT id, template, customer_id AS customerId, customer_name AS customerName, to_address AS toAddress, document_id AS documentId,
      document_number AS documentNumber, period_from AS periodFrom, period_to AS periodTo, subject, body, attachment_name AS attachmentName, status, attempts,
      next_attempt_at AS nextAttemptAt, last_error AS lastError, created_at AS createdAt, sent_at AS sentAt
    FROM com_outbox WHERE (@status IS NULL OR status = @status) ORDER BY rowid DESC LIMIT @limit`).all({ status: status ?? null, limit });
  const counts = Object.fromEntries((db.prepare('SELECT status, COUNT(*) AS n FROM com_outbox GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  return { rows, counts: { queued: 0, sent: 0, failed: 0, ...counts } };
}

/** "Send a test email": one message to the sender's own address, to prove the settings work. Not kept in the outbox. */
export async function sendTest(db: Db, transport: MailTransport, who: { userId: string; at: string }): Promise<void> {
  const settings = comSettings(db);
  const password = readAppPassword(db);
  const missing = missingForSending(settings, password !== null);
  if (missing.length > 0 || password === null) throw conflict('NOT_CONFIGURED', `Fill in first: ${missing.join(', ')}.`);
  const company = companyRegisteredName(db) ?? 'Moonproject';
  const message = { subject: `${company}: test email`, body: `This is a test email from ${company}. If you can read it, sending emails works.\n` };
  assertAllowedWording(message);
  let error: string | null = null;
  try {
    await transport.send({ host: settings.host, port: settings.port, user: settings.user, password }, {
      from: { name: settings.senderName, address: settings.senderAddress }, to: settings.senderAddress, subject: message.subject, text: message.body,
    });
  } catch (e) {
    error = scrub((e as Error).message || 'The mail server refused it.', password);
  }
  tx(db, () => appendAudit(db, { at: who.at, userId: who.userId, action: 'com.test_email', entityType: 'com.settings', entityId: '1', data: { ok: error === null, error } }));
  if (error !== null) throw new AppError('MAIL_FAILED', `The test email was not sent: ${error}`, 502);
}
