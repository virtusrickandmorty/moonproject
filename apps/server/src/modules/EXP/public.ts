/** What other modules may read from EXP: the expense categories, the EWT rule that vouchers and AP bills share, and a voucher's tax facts. */
import type { Db } from '../../platform/db/driver.ts';
import { settingAt, type EwtClass } from '../../engine/settings.ts';

export { category, listCategories, type Category } from './categories.ts';

/** Withheld only when Virtus is a published Top Withholding Agent (setting tax.top_withholding_agent). */
export const TWA_ONLY: ReadonlySet<string> = new Set(['goods_1', 'services_2']);

/**
 * The EWT class that applies on `date` (PLAN D4.8): the one picked ('none' = no EWT), else the usual one, unless
 * that one is withheld only by a Top Withholding Agent and Virtus is not one on that date.
 */
export function appliedEwtClass(db: Db, picked: EwtClass | 'none' | undefined, usual: EwtClass | null, date: string): EwtClass | null {
  if (picked === 'none') return null;
  if (picked) return picked;
  return usual && (!TWA_ONLY.has(usual) || settingAt(db, 'tax.top_withholding_agent', date)) ? usual : null;
}

/** An expense voucher's payee (a supplier on file, or a one-off payee as typed), receipt number and EWT, for the TAX registers. */
export interface VoucherTaxFacts {
  supplierId: string | null; payeeName: string; payeeTin: string | null; supplierInvoiceNo: string | null;
  ewtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number;
}

export function voucherTaxFacts(db: Db, documentId: string): VoucherTaxFacts | undefined {
  return db
    .prepare(
      `SELECT supplier_id AS supplierId, payee_name AS payeeName, payee_tin AS payeeTin, supplier_invoice_no AS supplierInvoiceNo, ewt_class AS ewtClass,
         ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM exp_vouchers WHERE document_id = ?`,
    )
    .get(documentId) as VoucherTaxFacts | undefined;
}
