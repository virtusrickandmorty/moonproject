/**
 * Who received a release sent out for delivery (the owner's request, Nov 2026). Nobody knows until the signed slip comes back, and a
 * recorded release is never changed, so it is typed afterwards as a row of its own; the latest counts, and a wrong name is put right
 * the same way. A release someone claimed in person already says who.
 * A job order is not Released while a delivery's receiver is not typed (the owner's rule, Nov 2026): with everything out it
 * stays Partly released, shown as Out for delivery, and moves to Released when the last receiver is typed.
 */
import { z } from 'zod';
import { badRequest, conflict, isBusinessDate, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentStage, moveTo, type Stage } from './stages.ts';

export const receivedInput = z.object({ receivedBy: z.string().trim().min(1).max(120), receivedOn: z.string() }).strict();

/** The latest name and date typed for a release, if any. */
export const latestReceived = (db: Db, documentId: string) => db.prepare('SELECT received_by AS receivedBy, received_on AS receivedOn FROM jo_release_received WHERE document_id = ? ORDER BY id DESC LIMIT 1')
  .get(documentId) as { receivedBy: string; receivedOn: string } | undefined;

/** The job order's releases sent for delivery whose receiver is not typed yet (recorded ones only), oldest first. */
export const awaitingReceiver = (db: Db, jobOrderId: string) => db.prepare(`SELECT d.id, d.number, d.business_date AS date FROM jo_releases r JOIN documents d ON d.id = r.document_id
  WHERE r.job_order_id = ? AND r.for_delivery = 1 AND d.status = 'posted' AND NOT EXISTS (SELECT 1 FROM jo_release_received x WHERE x.document_id = r.document_id)
  ORDER BY d.number`).all(jobOrderId) as { id: string; number: string; date: string }[];

/** Every piece of the job order is out on recorded releases. */
const allOut = (db: Db, jobOrderId: string) => !db.prepare(`SELECT 1 FROM jo_lines l WHERE l.document_id = ? AND l.qty > (SELECT COALESCE(SUM(rl.qty), 0)
  FROM jo_release_lines rl JOIN jo_releases r ON r.document_id = rl.document_id JOIN documents d ON d.id = r.document_id
  WHERE r.job_order_id = l.document_id AND rl.line_no = l.line_no AND d.status = 'posted') LIMIT 1`).get(jobOrderId);

/** The stage a release leaves the job order at: Released only once everything is out and every delivery has its receiver. */
export const stageAfterRelease = (db: Db, jobOrderId: string): 'partially_released' | 'released' =>
  allOut(db, jobOrderId) && awaitingReceiver(db, jobOrderId).length === 0 ? 'released' : 'partially_released';

export const OUT_FOR_DELIVERY = 'Out for delivery';
/** Everything is out, but a delivery waits for its receiver to be typed: shown as Out for delivery, not Partly released. */
export const isOutForDelivery = (db: Db, jobOrderId: string, stage: Stage | 'cancelled') =>
  stage === 'partially_released' && allOut(db, jobOrderId) && awaitingReceiver(db, jobOrderId).length > 0;

/** Every delivery waiting for its receiver, for the bell: the release, its job order and its customer. */
export const deliveriesAwaitingReceiver = (db: Db) => db.prepare(`SELECT d.id, d.number, d.business_date AS date, j.id AS jobOrderId, j.number AS jobOrderNumber, o.customer_name AS customerName
  FROM jo_releases r JOIN documents d ON d.id = r.document_id JOIN documents j ON j.id = r.job_order_id JOIN jo_orders o ON o.document_id = r.job_order_id
  WHERE r.for_delivery = 1 AND d.status = 'posted' AND NOT EXISTS (SELECT 1 FROM jo_release_received x WHERE x.document_id = r.document_id)
  ORDER BY d.business_date, d.number`).all() as { id: string; number: string; date: string; jobOrderId: string; jobOrderNumber: string; customerName: string }[];

/**
 * Call inside a transaction. The date is on or after the release, and not in the future. When it was the last receiver
 * missing and everything is out, the job order moves to Released.
 */
export function recordReceived(db: Db, documentId: string, raw: unknown, who: { userId: string; at: string; today: string }) {
  const v = receivedInput.parse(raw);
  const doc = db.prepare(`SELECT d.number, d.status, d.business_date AS date, r.for_delivery AS forDelivery, r.job_order_id AS jobOrderId FROM documents d JOIN jo_releases r ON r.document_id = d.id WHERE d.id = ?`).get(documentId) as
    { number: string; status: string; date: string; forDelivery: number; jobOrderId: string } | undefined;
  if (!doc) throw notFound('The release');
  if (doc.status !== 'posted') throw conflict('CANCELLED', `${doc.number} is cancelled.`);
  if (!doc.forDelivery) throw conflict('NOT_FOR_DELIVERY', `${doc.number} was claimed in person, so it already says who.`);
  if (!isBusinessDate(v.receivedOn)) throw badRequest('BAD_DATE', 'Enter the date it was received.');
  if (v.receivedOn < doc.date) throw badRequest('BEFORE_RELEASE', `${doc.number} went out on ${doc.date}: it cannot be received before that.`);
  if (v.receivedOn > who.today) throw badRequest('FUTURE', 'The date received cannot be later than today.');
  db.prepare('INSERT INTO jo_release_received (document_id, received_by, received_on, at, user_id) VALUES (?, ?, ?, ?, ?)').run(documentId, v.receivedBy, v.receivedOn, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'jo.release.received', entityType: 'document', entityId: documentId, data: { number: doc.number, receivedBy: v.receivedBy, receivedOn: v.receivedOn } });
  if (currentStage(db, doc.jobOrderId) === 'partially_released' && stageAfterRelease(db, doc.jobOrderId) === 'released') {
    moveTo(db, doc.jobOrderId, 'released', `${doc.number} received by ${v.receivedBy}`, who);
  }
  return { receivedBy: v.receivedBy, receivedOn: v.receivedOn };
}
