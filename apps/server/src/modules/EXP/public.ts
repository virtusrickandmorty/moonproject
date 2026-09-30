/** What other modules may read from EXP: the expense categories, the EWT rule that vouchers and AP bills share, and a voucher's tax facts. */
import type { Db } from '../../platform/db/driver.ts';
import { settingAt, type EwtClass } from '../../engine/settings.ts';

export { category, listCategories, type Category } from './categories.ts';

/** What an expense category buys, for the purchases register and the 2550Q (migration 0002). */
export type GoodsOrServices = 'goods' | 'services';
export const categoryPurchaseClass = (db: Db, categoryId: number): GoodsOrServices | undefined =>
  db.prepare('SELECT purchase_class FROM exp_categories WHERE id = ?').pluck().get(categoryId) as GoodsOrServices | undefined;

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

/** An expense voucher's payee (a supplier on file, or a one-off payee as typed), receipt number, what it bought and EWT, for the TAX registers. */
export interface VoucherTaxFacts {
  supplierId: string | null; payeeName: string; payeeTin: string | null; supplierInvoiceNo: string | null; bought: GoodsOrServices;
  ewtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number;
}

export function voucherTaxFacts(db: Db, documentId: string): VoucherTaxFacts | undefined {
  return db
    .prepare(
      `SELECT v.supplier_id AS supplierId, v.payee_name AS payeeName, v.payee_tin AS payeeTin, v.supplier_invoice_no AS supplierInvoiceNo,
         c.purchase_class AS bought, v.ewt_class AS ewtClass, v.ewt_rate_bp AS ewtRateBp, v.ewt_base_cents AS ewtBaseCents, v.ewt_cents AS ewtCents
       FROM exp_vouchers v JOIN exp_categories c ON c.id = v.category_id WHERE v.document_id = ?`,
    )
    .get(documentId) as VoucherTaxFacts | undefined;
}

/** Monthly expense totals used by the control report's Miscellaneous threshold. */
export function monthlyMiscException(db: Db, month: string) {
  return db.prepare(`SELECT SUM(CASE WHEN a.code='6990' THEN l.debit_cents-l.credit_cents ELSE 0 END) AS miscCents,
    SUM(l.debit_cents-l.credit_cents) AS totalCents FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE j.sealed=1 AND j.business_date LIKE ? AND a.type='expense'`).get(`${month}-%`) as {miscCents:number|null;totalCents:number|null};
}
