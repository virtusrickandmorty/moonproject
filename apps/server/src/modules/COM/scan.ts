/**
 * The timed scan (PLAN E14): finds new job orders, job orders that became Ready, releases and payroll releases by reading
 * them from the place the last scan reached (com_cursors), never through a hook in posting code. It only queues emails,
 * so a job order, release or payroll release is recorded, and stays recorded, whatever happens here.
 */
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { invoiceRecordRef, newJobOrdersAfter, newReleasesAfter, readyJobOrdersAfter, type ScanResult } from '../JO/public.ts';
import { saleRef } from '../QS/public.ts';
import { arAging } from '../RPT/public.ts';
import { paymentDetails } from '../SHP/public.ts';
import { jobOrdersToRate, requestFor } from '../FBK/public.ts';
import { payrollRunDoc, payrollReleasesAfter } from '../PAY/public.ts';
import { renderEmployeePayslip } from '../PRT/public.ts';
import { enqueue, type EnqueueRequest, type NotQueued } from './outbox.ts';
import { CURSORS, comSettings, setCursors } from './settings.ts';
import { claimedMessage, createdMessage, paymentDueMessage, payslipMessage, ratingMessage, readyMessage } from './text.ts';

const BATCH = 100;
/** A calendar day n days from another (YYYY-MM-DD). */
const plusDays = (date: string, n: number) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
/** A payment reminder goes this many days before the amount is due (the owner's request, Nov 2026), from 8 AM. */
export const REMIND_DAYS_BEFORE = 3;
const REMIND_FROM_HOUR = 8;
/** The day the reminders were last looked for, per database: once a day is enough (the scan runs every minute). */
const remindedOn = new WeakMap<Db, string>();
/** The website, where the shop's QR code is shown (SHP). */
const SITE = 'https://www.virtusgarments.com';

export interface ScanCounts { created: number; ready: number; claimed: number; payslips: number; due: number; ratings: number; skipped: Record<NotQueued, number> }

/** One pass over the three streams. Does nothing while sending is off (turning it on starts the scan from now). */
export function scanOnce(db: Db, at: string, log: (message: string) => void = () => {}): ScanCounts {
  const counts: ScanCounts = { created: 0, ready: 0, claimed: 0, payslips: 0, due: 0, ratings: 0, skipped: { sending_off: 0, no_customer: 0, no_employee: 0, no_consent: 0, no_email: 0, no_profile: 0, already_queued: 0 } };
  if (!comSettings(db).sendingOn) return counts;
  return tx(db, () => {
    const have = db.prepare('SELECT COUNT(*) FROM com_cursors').pluck().get() as number;
    if (have === 0) {
      setCursors(db, at);
      return counts;
    }
    // A scan added by an update starts from now; the others carry on from where they were.
    if (have < CURSORS.length) setCursors(db, at, true);
    const cursor = (key: string) => db.prepare('SELECT last_rowid FROM com_cursors WHERE key = ?').pluck().get(key) as number;
    const advance = (key: string, next: number) => db.prepare('UPDATE com_cursors SET last_rowid = ?, updated_at = ? WHERE key = ?').run(next, at, key);

    /** Queues each item; a profile that is not filled in yet holds the stream where it is, to try again next time. */
    const run = <T extends { id: string; number?: string; customerId: string }>(
      key: string, read: (after: number, limit: number) => ScanResult<T>, template: EnqueueRequest['template'], count: 'created' | 'ready' | 'claimed',
      make: (item: T) => Pick<EnqueueRequest, 'build' | 'dedupeKey' | 'alsoCoveredBy' | 'document'>,
    ) => {
      const { items, next } = read(cursor(key), BATCH);
      for (const item of items) {
        try {
          const queued = enqueue(db, { template, customerId: item.customerId, at, ...make(item) });
          if (queued.ok) counts[count]++;
          else if (queued.reason === 'no_profile') return log('Emails are waiting: the company profile is not filled in yet.');
          else counts.skipped[queued.reason]++;
        } catch (e) {
          // A message that cannot be made is left out and noted; it never stops the ones after it.
          appendAudit(db, { at, userId: null, action: 'com.not_queued', entityType: 'com.outbox', entityId: item.id, data: { template, reason: (e as Error).message } });
        }
      }
      advance(key, next);
    };

    run('job_order_created', (a, l) => newJobOrdersAfter(db, a, l), 'job_order_created', 'created', (jo) => ({
      document: { id: jo.id, number: jo.number }, dedupeKey: `created:${jo.id}`,
      build: (company, customerName) => createdMessage(company, { customerName, number: jo.number, dueDate: jo.dueDate, totalCents: jo.totalCents, requiredDownpaymentCents: jo.requiredDownpaymentCents, lines: jo.lines }),
    }));
    run('job_order_ready', (a, l) => readyJobOrdersAfter(db, a, l), 'job_order_ready', 'ready', (jo) => ({
      document: { id: jo.id, number: jo.number }, dedupeKey: `ready:${jo.id}`, alsoCoveredBy: jo.earlierIds.map((id) => `ready:${id}`),
      build: (company, customerName) => readyMessage(company, { customerName, number: jo.number, balanceDueCents: jo.balanceDueCents }),
    }));
    run('release', (a, l) => newReleasesAfter(db, a, l), 'claimed', 'claimed', (rel) => ({
      document: { id: rel.id, number: rel.number }, dedupeKey: `claimed:${rel.id}`,
      build: (company, customerName) => claimedMessage(company, { customerName, jobOrderNumber: rel.jobOrderNumber, releaseNumber: rel.number, date: rel.date, claimedBy: rel.claimedBy, forDelivery: rel.forDelivery === 1, balanceDueCents: rel.balanceDueCents, lines: rel.lines }),
    }));

    scanPayslips(cursor('payroll_release'), (next) => advance('payroll_release', next));
    scanDueSoon();
    return counts;

    /**
     * Payment reminders: each amount still owed that falls due within the next few days (or today), once per amount and due
     * date, to customers who agreed to emails. Looked for once a day, from 8 AM.
     */
    function scanDueSoon() {
      const day = at.slice(0, 10);
      if (Number(at.slice(11, 13)) < REMIND_FROM_HOUR || remindedOn.get(db) === day) return;
      const last = plusDays(day, REMIND_DAYS_BEFORE);
      const pay = paymentDetails(db);
      const payHow = pay ? { bankName: pay.bankName, accountName: pay.accountName, accountHint: pay.accountHint, instructions: pay.instructions, qrUrl: `${SITE}/api/shp/payment/qr/${pay.version}` } : null;
      for (const row of arAging(db, day).rows) {
        if (!row.customerId || !row.documentId || row.totalCents <= 0 || !row.dueDate || row.dueDate < day || row.dueDate > last) continue;
        const what = row.documentType === 'jo.invoice_record' ? (() => { const r = invoiceRecordRef(db, row.documentId!); return r ? `your order ${r.jobOrderNumber} (booklet no. ${r.invoiceNumber})` : `your order ${row.jobOrderNumber}`; })()
          : row.documentType === 'qs.sale' ? (() => { const s = saleRef(db, row.documentId!); return s ? `booklet no. ${s.invoiceNumber}` : row.documentNumber; })()
          : `your order ${row.documentNumber}`;
        const daysLeft = Math.round((Date.parse(`${row.dueDate}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
        try {
          const queued = enqueue(db, {
            template: 'payment_due', customerId: row.customerId, at, document: { id: row.documentId, number: row.documentNumber }, dedupeKey: `due:${row.documentId}:${row.dueDate}`,
            build: (company, customerName) => paymentDueMessage(company, { customerName, what, amountCents: row.totalCents, dueDate: row.dueDate, daysLeft, pay: payHow }),
          });
          if (queued.ok) counts.due++;
          else if (queued.reason === 'no_profile') return log('Emails are waiting: the company profile is not filled in yet.');
          else counts.skipped[queued.reason]++;
        } catch (e) {
          appendAudit(db, { at, userId: null, action: 'com.not_queued', entityType: 'com.outbox', entityId: row.documentId, data: { template: 'payment_due', reason: (e as Error).message } });
        }
      }
      askRatings(day);
      remindedOn.set(db, day);
    }

    /** Rating requests (FBK): each job order fully released since two weeks ago, the day after, once. */
    function askRatings(day: string) {
      for (const jo of jobOrdersToRate(db, day)) {
        try {
          const queued = enqueue(db, {
            template: 'rating_request', customerId: jo.customerId, at, document: { id: jo.id, number: jo.number }, dedupeKey: `rate:${jo.number}`,
            build: (company, customerName) => ratingMessage(company, { customerName, number: jo.number, url: `${SITE}/r/${requestFor(db, jo.id, { userId: null, at }).token}` }),
          });
          if (queued.ok) counts.ratings++;
          else if (queued.reason === 'no_profile') return log('Emails are waiting: the company profile is not filled in yet.');
          else counts.skipped[queued.reason]++;
        } catch (e) {
          appendAudit(db, { at, userId: null, action: 'com.not_queued', entityType: 'com.outbox', entityId: jo.id, data: { template: 'rating_request', reason: (e as Error).message } });
        }
      }
    }

    /** One payslip email per employee a payroll release paid, for those who agreed and have an address (dedupe: release and employee). */
    function scanPayslips(after: number, advanceTo: (next: number) => void) {
      const { items, next } = payrollReleasesAfter(db, after, BATCH);
      for (const rel of items) {
        for (const employeeId of rel.employeeIds) {
          try {
            const queued = enqueue(db, {
              template: 'payslip', employeeId, at, document: { id: rel.id, number: rel.number }, period: { from: rel.periodStart, to: rel.periodEnd },
              dedupeKey: `payslip:${rel.id}:${employeeId}`,
              build: (company, employeeName) => {
                const file = `payslip-${rel.periodStart}-to-${rel.periodEnd}.html`;
                const html = renderEmployeePayslip(db, { id: rel.runId, doc: payrollRunDoc(db, rel.runId) }, employeeId, `${company} (emailed)`, at);
                if (html === undefined) throw new Error('The payslip could not be made from the payroll run.');
                return { ...payslipMessage(company, { employeeName, from: rel.periodStart, to: rel.periodEnd, fileName: file }), attachment: { name: file, html } };
              },
            });
            if (queued.ok) {
              counts.payslips++;
              // Who and which period, never an amount.
              appendAudit(db, { at, userId: null, action: 'com.payslip_queued', entityType: 'com.outbox', entityId: queued.id, data: { employeeId, releaseId: rel.id, from: rel.periodStart, to: rel.periodEnd } });
            } else if (queued.reason === 'no_profile') return log('Emails are waiting: the company profile is not filled in yet.');
            else counts.skipped[queued.reason]++;
          } catch (e) {
            appendAudit(db, { at, userId: null, action: 'com.not_queued', entityType: 'com.outbox', entityId: rel.id, data: { template: 'payslip', employeeId, reason: (e as Error).message } });
          }
        }
      }
      advanceTo(next);
    }
  });
}
