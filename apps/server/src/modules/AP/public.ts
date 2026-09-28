/** What other modules may read from AP (read-only): a supplier bill's tax facts, for the TAX registers. */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from '../../engine/settings.ts';
import { categoryPurchaseClass, type GoodsOrServices } from '../EXP/public.ts';

/** What a bill line bought: a supply on file, freight-in, subcontracted production, or an expense category. */
export type BillLineKind = 'supply' | 'freight_in' | 'subcontract' | 'category';

export interface BillTaxFacts {
  supplierId: string; supplierInvoiceNo: string; supplierInvoiceDate: string;
  ewtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number;
  /**
   * Per line: what it bought, and whether that is goods or services (supplies and freight-in are goods, subcontracting
   * is a service, an expense category says which), its cost before VAT (what the journal debits) and its share of the input VAT.
   */
  lines: { kind: BillLineKind; bought: GoodsOrServices; costCents: number; vatCents: number }[];
}

export function billTaxFacts(db: Db, documentId: string): BillTaxFacts | undefined {
  const b = db
    .prepare(
      `SELECT supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo, supplier_invoice_date AS supplierInvoiceDate, ewt_class AS ewtClass,
         ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM ap_bills WHERE document_id = ?`,
    )
    .get(documentId) as Omit<BillTaxFacts, 'lines'> | undefined;
  if (!b) return undefined;
  const rows = db
    .prepare(
      `SELECT CASE WHEN supply_id IS NOT NULL THEN 'supply' WHEN category_id IS NOT NULL THEN 'category' ELSE purchase END AS kind, category_id AS categoryId,
         amount_cents - vat_cents AS costCents, vat_cents AS vatCents FROM ap_bill_lines WHERE document_id = ? ORDER BY line_no`,
    )
    .all(documentId) as (Omit<BillTaxFacts['lines'][number], 'bought'> & { categoryId: number | null })[];
  const lines = rows.map(({ categoryId, ...l }) => ({
    ...l,
    bought: l.kind === 'category' ? (categoryPurchaseClass(db, categoryId!) ?? 'services') : l.kind === 'subcontract' ? ('services' as const) : ('goods' as const),
  }));
  return { ...b, lines };
}
