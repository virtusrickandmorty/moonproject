/**
 * The timed scan (PLAN E14): finds new job orders, job orders that became Ready, and releases by reading them from the
 * place the last scan reached (com_cursors), never through a hook in posting code. It only queues emails, so a job
 * order or release is recorded, and stays recorded, whatever happens here.
 */
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { newJobOrdersAfter, newReleasesAfter, readyJobOrdersAfter, type ScanResult } from '../JO/public.ts';
import { enqueue, type EnqueueRequest, type NotQueued } from './outbox.ts';
import { comSettings, setCursors } from './settings.ts';
import { claimedMessage, createdMessage, readyMessage } from './text.ts';

const BATCH = 100;

export interface ScanCounts { created: number; ready: number; claimed: number; skipped: Record<NotQueued, number> }

/** One pass over the three streams. Does nothing while sending is off (turning it on starts the scan from now). */
export function scanOnce(db: Db, at: string, log: (message: string) => void = () => {}): ScanCounts {
  const counts: ScanCounts = { created: 0, ready: 0, claimed: 0, skipped: { sending_off: 0, no_customer: 0, no_consent: 0, no_email: 0, no_profile: 0, already_queued: 0 } };
  if (!comSettings(db).sendingOn) return counts;
  return tx(db, () => {
    const have = (db.prepare('SELECT COUNT(*) FROM com_cursors').pluck().get() as number) === 3;
    if (!have) {
      setCursors(db, at);
      return counts;
    }
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
      build: (company, customerName) => claimedMessage(company, { customerName, jobOrderNumber: rel.jobOrderNumber, releaseNumber: rel.number, date: rel.date, claimedBy: rel.claimedBy, balanceDueCents: rel.balanceDueCents, lines: rel.lines }),
    }));
    return counts;
  });
}
