/** What other modules may read from AP (read-only): a supplier bill's tax facts, for the TAX registers. */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from '../../engine/settings.ts';

/** What a bill line bought: a supply on file, freight-in, subcontracted production, or an expense category. */
export type BillLineKind = 'supply' | 'freight_in' | 'subcontract' | 'category';

export interface BillTaxFacts {
  supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string;
  ewtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number;
  /** Per line: what it bought, its cost before VAT (what the journal debits) and its share of the input VAT. */
  lines: { kind: BillLineKind; costCents: number; vatCents: number }[];
}

export function billTaxFacts(db: Db, documentId: string): BillTaxFacts | undefined {
  const b = db
    .prepare(
      `SELECT supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo, supplier_invoice_date AS supplierInvoiceDate, ewt_class AS ewtClass,
         ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM ap_bills WHERE document_id = ?`,
    )
    .get(documentId) as Omit<BillTaxFacts, 'lines'> | undefined;
  if (!b) return undefined;
  const lines = db
    .prepare(
      `SELECT CASE WHEN supply_id IS NOT NULL THEN 'supply' WHEN category_id IS NOT NULL THEN 'category' ELSE purchase END AS kind,
         amount_cents - vat_cents AS costCents, vat_cents AS vatCents FROM ap_bill_lines WHERE document_id = ? ORDER BY line_no`,
    )
    .all(documentId) as BillTaxFacts['lines'];
  return { ...b, lines };
}
