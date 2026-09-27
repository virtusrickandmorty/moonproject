/**
 * The only EXP file that reads suppliers. PUR has no public.ts yet; when it has one, each function here becomes a call
 * into modules/PUR/public.ts and nothing else in EXP changes (the JO/cus.ts pattern).
 */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from './doctypes/voucher.ts';

export interface Supplier { id: string; name: string; tin: string | null; isVatRegistered: boolean; ewtClass: EwtClass | null; isActive: boolean }

export function supplier(db: Db, id: string): Supplier | undefined {
  const r = db.prepare('SELECT id, name, tin, is_vat_registered, ewt_class, is_active FROM pur_suppliers WHERE id = ?').get(id) as
    | { id: string; name: string; tin: string | null; is_vat_registered: number; ewt_class: EwtClass | null; is_active: number }
    | undefined;
  return r && { id: r.id, name: r.name, tin: r.tin, isVatRegistered: r.is_vat_registered === 1, ewtClass: r.ewt_class, isActive: r.is_active === 1 };
}
