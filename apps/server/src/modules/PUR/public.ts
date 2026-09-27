/** Read-only names for purchase order printouts. Callers enforce their own view permission. */
import type { Db } from '../../platform/db/driver.ts';

export function purchaseOrderNames(db: Db, supplierId: string, supplyIds: string[]) {
  const supplier = db.prepare('SELECT name, registered_name FROM pur_suppliers WHERE id = ?').get(supplierId) as
    { name: string; registered_name: string } | undefined;
  const supply = db.prepare('SELECT name, unit FROM pur_supplies WHERE id = ?');
  return {
    supplierName: supplier?.registered_name || supplier?.name || 'Unknown supplier',
    supplies: Object.fromEntries(supplyIds.map((id) => [id, supply.get(id) as { name: string; unit: string } | undefined])),
  };
}
