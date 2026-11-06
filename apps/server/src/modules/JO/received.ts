/**
 * Who received a release sent out for delivery (the owner's request, Nov 2026). Nobody knows until the signed slip comes back, and a
 * recorded release is never changed, so it is typed afterwards as a row of its own; the latest counts, and a wrong name is put right
 * the same way. A release someone claimed in person already says who.
 */
import { z } from 'zod';
import { badRequest, conflict, isBusinessDate, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';

export const receivedInput = z.object({ receivedBy: z.string().trim().min(1).max(120), receivedOn: z.string() }).strict();

/** The latest name and date typed for a release, if any. */
export const latestReceived = (db: Db, documentId: string) => db.prepare('SELECT received_by AS receivedBy, received_on AS receivedOn FROM jo_release_received WHERE document_id = ? ORDER BY id DESC LIMIT 1')
  .get(documentId) as { receivedBy: string; receivedOn: string } | undefined;

/** Call inside a transaction. The date is on or after the release, and not in the future. */
export function recordReceived(db: Db, documentId: string, raw: unknown, who: { userId: string; at: string; today: string }) {
  const v = receivedInput.parse(raw);
  const doc = db.prepare(`SELECT d.number, d.status, d.business_date AS date, r.for_delivery AS forDelivery FROM documents d JOIN jo_releases r ON r.document_id = d.id WHERE d.id = ?`).get(documentId) as
    { number: string; status: string; date: string; forDelivery: number } | undefined;
  if (!doc) throw notFound('The release');
  if (doc.status !== 'posted') throw conflict('CANCELLED', `${doc.number} is cancelled.`);
  if (!doc.forDelivery) throw conflict('NOT_FOR_DELIVERY', `${doc.number} was claimed in person, so it already says who.`);
  if (!isBusinessDate(v.receivedOn)) throw badRequest('BAD_DATE', 'Enter the date it was received.');
  if (v.receivedOn < doc.date) throw badRequest('BEFORE_RELEASE', `${doc.number} went out on ${doc.date}: it cannot be received before that.`);
  if (v.receivedOn > who.today) throw badRequest('FUTURE', 'The date received cannot be later than today.');
  db.prepare('INSERT INTO jo_release_received (document_id, received_by, received_on, at, user_id) VALUES (?, ?, ?, ?, ?)').run(documentId, v.receivedBy, v.receivedOn, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'jo.release.received', entityType: 'document', entityId: documentId, data: { number: doc.number, receivedBy: v.receivedBy, receivedOn: v.receivedOn } });
  return { receivedBy: v.receivedBy, receivedOn: v.receivedOn };
}
