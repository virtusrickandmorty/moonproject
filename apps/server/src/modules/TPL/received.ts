/**
 * Who received a delivery (the owner's request, Nov 2026). Often nobody knows until the signed receipt comes back, and a recorded
 * delivery is never changed, so it is typed afterwards as a row of its own; the latest counts, and a wrong name is put right the same way.
 */
import { z } from 'zod';
import { badRequest, conflict, isBusinessDate, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

export const receivedInput = z.object({ receivedBy: z.string().trim().min(1).max(120), receivedOn: z.string() }).strict();

/** The latest name and date typed for a delivery, if any. */
export const latestReceived = (db: Db, documentId: string) => db.prepare('SELECT received_by AS receivedBy, received_on AS receivedOn FROM tpl_delivery_received WHERE document_id = ? ORDER BY id DESC LIMIT 1')
  .get(documentId) as { receivedBy: string; receivedOn: string } | undefined;

/** Call inside a transaction. The date is on or after the delivery, and not in the future. */
export function recordReceived(db: Db, documentId: string, raw: unknown, who: { userId: string; at: string; today: string }) {
  const v = receivedInput.parse(raw);
  const doc = db.prepare(`SELECT d.number, d.status, d.business_date AS date FROM documents d WHERE d.id = ? AND d.doc_type = 'tpl.delivery'`).get(documentId) as { number: string; status: string; date: string } | undefined;
  if (!doc) throw notFound('The delivery');
  if (doc.status !== 'posted') throw conflict('CANCELLED', `${doc.number} is cancelled.`);
  if (!isBusinessDate(v.receivedOn)) throw badRequest('BAD_DATE', 'Enter the date it was received.');
  if (v.receivedOn < doc.date) throw badRequest('BEFORE_DELIVERY', `${doc.number} went out on ${doc.date}: it cannot be received before that.`);
  if (v.receivedOn > who.today) throw badRequest('FUTURE', 'The date received cannot be later than today.');
  db.prepare('INSERT INTO tpl_delivery_received (document_id, received_by, received_on, at, user_id) VALUES (?, ?, ?, ?, ?)').run(documentId, v.receivedBy, v.receivedOn, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.delivery.received', entityType: 'document', entityId: documentId, data: { number: doc.number, receivedBy: v.receivedBy, receivedOn: v.receivedOn } });
  return { receivedBy: v.receivedBy, receivedOn: v.receivedOn };
}
