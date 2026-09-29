/** Read-only CUS contract for other modules. Callers must enforce their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { chartResponse } from './measurements.ts';
export { createCustomer, createGroup, createWearer, createMeasurement } from './create.ts';

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

/** Tax details used when a sale is written into the manual invoice booklet. */
export function customerTaxInfo(db: Db, id: string): { tin: string | null; registeredName: string | null; isVatRegistered: boolean } | undefined {
  const row = db.prepare('SELECT tin, registered_name, is_vat_registered FROM cus_customers WHERE id = ?').get(id) as
    | { tin: string | null; registered_name: string | null; is_vat_registered: number }
    | undefined;
  return row && { tin: row.tin, registeredName: row.registered_name, isVatRegistered: row.is_vat_registered === 1 };
}

/** Active, unmerged customers for customer pickers in sales documents. */
export function activeCustomers(db: Db): { id: string; name: string }[] {
  return db.prepare(`SELECT id, display_name AS name FROM cus_customers
    WHERE is_active = 1 AND merged_into_id IS NULL ORDER BY display_name, id`).all() as { id: string; name: string }[];
}

/** Names exposed to permission-filtered navigation search. */
export function searchCustomers(db: Db, query: string, limit = 20): { id: string; name: string }[] {
  return db.prepare(`SELECT id, display_name AS name FROM cus_customers
    WHERE lower(replace(display_name, ' ', '')) LIKE @q AND merged_into_id IS NULL ORDER BY display_name LIMIT @limit`)
    .all({ q: `%${query.toLowerCase().replaceAll(' ', '')}%`, limit }) as { id: string; name: string }[];
}

/** Wearer names exposed to permission-filtered navigation search. */
export function searchWearers(db: Db, query: string, limit = 20): { id: string; customerId: string; name: string }[] {
  return db.prepare(`SELECT id, customer_id AS customerId, full_name AS name FROM cus_people
    WHERE lower(replace(full_name, ' ', '')) LIKE @q ORDER BY full_name LIMIT @limit`)
    .all({ q: `%${query.toLowerCase().replaceAll(' ', '')}%`, limit }) as { id: string; customerId: string; name: string }[];
}

/** All customer names for historical statements, including inactive and merged records. */
export function statementCustomers(db: Db): { id: string; name: string }[] {
  return db.prepare('SELECT id, display_name AS name FROM cus_customers ORDER BY display_name, id')
    .all() as { id: string; name: string }[];
}


/** Birthdays recorded for active people linked to active, unmerged customers. */
export function customerBirthdays(db: Db): { id: string; customerId: string; name: string; birthday: string }[] {
  return db.prepare(`SELECT p.id, p.customer_id AS customerId, p.full_name AS name, p.birthday
    FROM cus_people p JOIN cus_customers c ON c.id = p.customer_id
    WHERE p.is_active = 1 AND c.is_active = 1 AND c.merged_into_id IS NULL AND p.birthday IS NOT NULL
    ORDER BY p.full_name, p.id`).all() as { id: string; customerId: string; name: string; birthday: string }[];
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
