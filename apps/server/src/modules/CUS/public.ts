/** Read-only CUS contract for other modules. Callers must enforce their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { chartResponse } from './measurements.ts';

export interface CustomerRef {
  id: string;
  code: string;
  display_name: string;
  is_active: number;
  merged_into_id: string | null;
}

export function customerRef(db: Db, id: string): CustomerRef | undefined {
  return db.prepare('SELECT id,code,display_name,is_active,merged_into_id FROM cus_customers WHERE id = ?').get(id) as CustomerRef | undefined;
}

export function wearerRef(db: Db, id: string): { id: string; customer_id: string; group_id: string | null; full_name: string; is_active: number } | undefined {
  return db.prepare('SELECT id,customer_id,group_id,full_name,is_active FROM cus_people WHERE id = ?').get(id) as
    | { id: string; customer_id: string; group_id: string | null; full_name: string; is_active: number }
    | undefined;
}

export function activeMeasurements(db: Db, personId: string): Record<string, unknown> | undefined {
  const row = db.prepare("SELECT * FROM cus_measure_charts WHERE person_id = ? AND status = 'active'").get(personId) as Record<string, unknown> | undefined;
  return row ? chartResponse(row) : undefined;
}
