/** AP's documents that stand on purchasing's (engine DependentsFn): a bill on its receiving report, an advance on its order. */
import type { Db } from '../../platform/db/driver.ts';

export function apOverPurchasing(db: Db, docType: string, documentId: string): { id: string; number: string }[] {
  const on = docType === 'pur.rr' ? `SELECT d.id, d.number FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE b.receiving_report_id = ? AND d.status = 'posted'`
    : docType === 'pur.po' ? `SELECT d.id, d.number FROM ap_advances a JOIN documents d ON d.id = a.document_id WHERE a.purchase_order_id = ? AND d.status = 'posted'`
    : null;
  return on ? db.prepare(on).all(documentId) as { id: string; number: string }[] : [];
}
