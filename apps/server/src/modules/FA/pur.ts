/**
 * The only FA file that reads suppliers. PUR has no public.ts yet; when it has one, this becomes a call into
 * modules/PUR/public.ts and nothing else in FA changes (the EXP/pur.ts pattern).
 */
import type { Db } from '../../platform/db/driver.ts';

export interface Supplier { id: string; name: string; tin: string | null; isVatRegistered: boolean; isActive: boolean }

export function supplier(db: Db, id: string): Supplier | undefined {
  const r = db.prepare('SELECT id, name, tin, is_vat_registered, is_active FROM pur_suppliers WHERE id = ?').get(id) as
    | { id: string; name: string; tin: string | null; is_vat_registered: number; is_active: number }
    | undefined;
  return r && { id: r.id, name: r.name, tin: r.tin, isVatRegistered: r.is_vat_registered === 1, isActive: r.is_active === 1 };
}

export function activeSupplierIds(db: Db): string[] {
  return db.prepare('SELECT id FROM pur_suppliers WHERE is_active = 1 ORDER BY id').pluck().all() as string[];
}
