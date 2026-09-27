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
