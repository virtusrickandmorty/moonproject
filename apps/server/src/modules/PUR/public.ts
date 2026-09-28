/** What other modules may read from PUR (read-only): suppliers, supplies and receiving reports. */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from '../../engine/settings.ts';

export interface Supplier {
  id: string; name: string; tin: string | null; isVatRegistered: boolean; ewtClass: EwtClass | null; paymentTermsDays: number | null; isActive: boolean;
}

export function supplier(db: Db, id: string): Supplier | undefined {
  const r = db.prepare('SELECT id, name, tin, is_vat_registered, ewt_class, payment_terms_days, is_active FROM pur_suppliers WHERE id = ?').get(id) as
    | { id: string; name: string; tin: string | null; is_vat_registered: number; ewt_class: EwtClass | null; payment_terms_days: number | null; is_active: number }
    | undefined;
  return r && {
    id: r.id, name: r.name, tin: r.tin, isVatRegistered: r.is_vat_registered === 1, ewtClass: r.ewt_class, paymentTermsDays: r.payment_terms_days, isActive: r.is_active === 1,
  };
}

/** The name and TIN a supplier is registered with at the BIR, for the tax registers and the 2307 (read-only). */
export function supplierTaxInfo(db: Db, id: string): { registeredName: string; tin: string | null } | undefined {
  return db.prepare('SELECT registered_name AS registeredName, tin FROM pur_suppliers WHERE id = ?').get(id) as { registeredName: string; tin: string | null } | undefined;
}

export const activeSupplierIds = (db: Db): string[] => db.prepare('SELECT id FROM pur_suppliers WHERE is_active = 1 ORDER BY id').pluck().all() as string[];

export interface Supply { id: string; name: string; category: 'materials' | 'ready_made'; isActive: boolean }

export function supply(db: Db, id: string): Supply | undefined {
  const r = db.prepare('SELECT id, name, category, is_active FROM pur_supplies WHERE id = ?').get(id) as
    | { id: string; name: string; category: Supply['category']; is_active: number }
    | undefined;
  return r && { id: r.id, name: r.name, category: r.category, isActive: r.is_active === 1 };
}

export const activeSupplyIds = (db: Db): string[] => db.prepare('SELECT id FROM pur_supplies WHERE is_active = 1 ORDER BY id').pluck().all() as string[];

/** A receiving report (RR-) with the supplier of its purchase order. */
export interface ReceivingReport { id: string; number: string; status: 'posted' | 'cancelled'; supplierId: string; poNumber: string }

export function receivingReport(db: Db, id: string): ReceivingReport | undefined {
  return db
    .prepare(
      `SELECT d.id, d.number, d.status, po.supplier_id AS supplierId, pd.number AS poNumber FROM pur_receiving_reports r
       JOIN documents d ON d.id = r.document_id JOIN pur_purchase_orders po ON po.document_id = r.po_document_id
       JOIN documents pd ON pd.id = r.po_document_id WHERE r.document_id = ?`,
    )
    .get(id) as ReceivingReport | undefined;
}

/** Read-only names for purchase order printouts. Callers enforce their own view permission. */
export function purchaseOrderNames(db: Db, supplierId: string, supplyIds: string[]) {
  const supplier = db.prepare('SELECT name, registered_name FROM pur_suppliers WHERE id = ?').get(supplierId) as
    { name: string; registered_name: string } | undefined;
  const supply = db.prepare('SELECT name, unit FROM pur_supplies WHERE id = ?');
  return {
    supplierName: supplier?.registered_name || supplier?.name || 'Unknown supplier',
    supplies: Object.fromEntries(supplyIds.map((id) => [id, supply.get(id) as { name: string; unit: string } | undefined])),
  };
}
