/**
 * The customers' 2307s (PLAN E5 "2307 register", D8 "Cut-over" step 3): the ones a collection records and the ones an
 * opening withholding (OBWT-) brings in from before the cut-over date, each with its ATC and whether the certificate is
 * in hand. One recorded as pending is marked received here when it comes (tax_2307_receipts), the same way for both.
 * The 2307s-received register reads the status from here, and so do the VAT of a quarter and its close, so the next
 * VAT close claims the VAT withheld once its 2307 is in hand.
 */
import { z } from 'zod';
import { conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { withholdingOf } from '../COL/public.ts';
import type { Quarter } from './calendar.ts';

export const OPENING_WITHHOLDING = 'tax.opening';
export const ATCS = ['WC158', 'WC160', 'other'] as const;
export type Atc = (typeof ATCS)[number];
export type Certificate = 'pending' | 'received';

/** One row of an opening withholding, as recorded. */
export interface OpeningLine {
  lineNo: number; customerId: string; customerName: string; year: number; quarter: Quarter; atc: Atc;
  cwtCents: number; vatWithheldCents: number; certificate: Certificate;
}

export function openingLines(db: Db, documentId: string): OpeningLine[] {
  return db
    .prepare(
      `SELECT line_no AS lineNo, customer_id AS customerId, customer_name AS customerName, year, quarter, atc, cwt_cents AS cwtCents,
         vat_withheld_cents AS vatWithheldCents, cert_2307 AS certificate FROM tax_opening_lines WHERE document_id = ? ORDER BY line_no`,
    )
    .all(documentId) as OpeningLine[];
}

/** The day a 2307 recorded as pending was marked received; null while it is still to come. */
export function receivedOn(db: Db, documentId: string, lineNo: number): string | null {
  return (db.prepare('SELECT received_on FROM tax_2307_receipts WHERE document_id = ? AND line_no = ?').pluck().get(documentId, lineNo) as string | undefined) ?? null;
}

/** Which 2307: a collection's (line 0, its only one) or an opening withholding's row. */
export const markReceivedInput = z.object({ documentId: z.string().trim().min(1).max(80), lineNo: z.number().int().min(0).max(200) }).strict();

/**
 * Marks a pending 2307 received, dated today. Only once, only on a posted collection or opening withholding, and only
 * when it was recorded as pending: nothing is changed on the document itself.
 */
export function markReceived(db: Db, body: unknown, who: { userId: string; at: string; today: string }) {
  const { documentId, lineNo } = markReceivedInput.parse(body);
  const d = db.prepare('SELECT doc_type AS docType, number, status FROM documents WHERE id = ?').get(documentId) as
    | { docType: string; number: string; status: string }
    | undefined;
  const recorded =
    d?.docType === OPENING_WITHHOLDING ? openingLines(db, documentId).find((l) => l.lineNo === lineNo)?.certificate
    : d?.docType === 'col.collection' && lineNo === 0 ? withholdingOf(db, documentId)?.certificate
    : undefined;
  if (!d || !recorded) throw notFound('The 2307');
  const which = lineNo > 0 ? `row ${lineNo} of ${d.number}` : d.number;
  if (d.status !== 'posted') throw conflict('CANCELLED', `${d.number} is cancelled, so its 2307 no longer counts.`);
  if (recorded === 'received') throw conflict('ALREADY_RECEIVED', `The 2307 on ${which} was recorded as in hand.`);
  const before = receivedOn(db, documentId, lineNo);
  if (before) throw conflict('ALREADY_RECEIVED', `The 2307 on ${which} was marked received on ${before}.`);
  db.prepare('INSERT INTO tax_2307_receipts (document_id, line_no, received_on, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(
    documentId, lineNo, who.today, who.at, who.userId,
  );
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tax.2307.received', entityType: d.docType, entityId: documentId, data: { number: d.number, lineNo, receivedOn: who.today } });
  return { documentId, number: d.number, lineNo, receivedOn: who.today };
}
