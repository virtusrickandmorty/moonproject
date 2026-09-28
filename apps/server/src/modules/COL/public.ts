/** COL contract for other modules (QS). Callers check their own route permission. */
import type { Db } from '../../platform/db/driver.ts';

export { collectionDoc, collectionInput, type CollectionInput } from './doctypes/collection.ts';

export interface SalePayment { id: string; number: string; status: 'posted' | 'cancelled'; crNumber: string; totalCents: number; paysOnlyThis: boolean }

/**
 * Collections that paid a quick sale, cancelled ones included, oldest first. paysOnlyThis: the sale is all it pays (no job
 * order, no other sale, nothing kept as a deposit), so cancelling the quick sale may cancel it too (E6 "cancel cancels both").
 */
export function salePayments(db: Db, saleId: string): SalePayment[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.number, d.status, c.cr_number AS crNumber, d.total_cents AS totalCents, c.unapplied_cents = 0
         AND NOT EXISTS (SELECT 1 FROM col_applications a WHERE a.document_id = d.id)
         AND NOT EXISTS (SELECT 1 FROM col_sale_applications o WHERE o.document_id = d.id AND o.sale_id <> s.sale_id) AS only
       FROM col_sale_applications s JOIN col_collections c ON c.document_id = s.document_id JOIN documents d ON d.id = s.document_id
       WHERE s.sale_id = ? ORDER BY d.number`,
    )
    .all(saleId) as (Omit<SalePayment, 'paysOnlyThis'> & { only: number })[];
  return rows.map(({ only, ...r }) => ({ ...r, paysOnlyThis: only === 1 }));
}

/** CR booklet numbers collections used between two numbers, cancelled ones included (TAX's booklet usage report). */
export function crNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  return db
    .prepare(`SELECT CAST(c.cr_number AS INTEGER) AS n, d.number, d.status FROM col_collections c JOIN documents d ON d.id = c.document_id
              WHERE CAST(c.cr_number AS INTEGER) BETWEEN ? AND ? ORDER BY 1`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
}

/** What a collection's 2307 says (ATC and whether the certificate is in hand), for the tax registers; undefined if none. */
export function withholdingOf(db: Db, documentId: string): { atc: 'WC158' | 'WC160' | 'other'; certificate: 'pending' | 'received' } | undefined {
  const r = db.prepare('SELECT cwt_atc AS atc, cert_2307 AS certificate FROM col_collections WHERE document_id = ?').get(documentId) as
    | { atc: 'WC158' | 'WC160' | 'other' | null; certificate: 'pending' | 'received' | null }
    | undefined;
  return r?.atc && r.certificate ? { atc: r.atc, certificate: r.certificate } : undefined;
}
