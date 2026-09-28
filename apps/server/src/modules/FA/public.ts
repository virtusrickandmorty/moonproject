/** What other modules may read from FA. */
import type { Db } from '../../platform/db/driver.ts';
import { supplier } from './pur.ts';

export interface FinancedPurchase {
  id: string; number: string; status: 'posted' | 'cancelled'; date: string; description: string; supplierName: string; lender: string; financedCents: number;
}
const SELECT = `SELECT d.id, d.number, d.status, d.business_date AS date, a.description, a.supplier_id AS supplierId, a.lender, a.financed_cents AS financedCents
  FROM fa_assets a JOIN documents d ON d.id = a.document_id WHERE a.financed_cents > 0`;
type Row = Omit<FinancedPurchase, 'supplierName'> & { supplierId: string };
const named = (db: Db, { supplierId, ...r }: Row): FinancedPurchase => ({ ...r, supplierName: supplier(db, supplierId)?.name ?? '?' });

/** An FA- purchase with a financed part (FA-BUY credited 2602 with the purchase as party), or undefined. */
export function financedPurchase(db: Db, id: string): FinancedPurchase | undefined {
  const r = db.prepare(`${SELECT} AND d.id = ?`).get(id) as Row | undefined;
  return r && named(db, r);
}

/** Posted FA- purchases with a financed part, oldest first. */
export const financedPurchases = (db: Db): FinancedPurchase[] => (db.prepare(`${SELECT} AND d.status = 'posted' ORDER BY d.number`).all() as Row[]).map((r) => named(db, r));

/** An FA- purchase's supplier and invoice number, for the TAX purchases register. */
export function purchaseTaxFacts(db: Db, id: string): { supplierId: string; supplierInvoiceNo: string | null } | undefined {
  return db.prepare('SELECT supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo FROM fa_assets WHERE document_id = ?').get(id) as
    | { supplierId: string; supplierInvoiceNo: string | null }
    | undefined;
}
