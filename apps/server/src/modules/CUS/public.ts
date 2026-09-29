/** Read-only CUS contract for other modules. Callers must enforce their own route permission. */
import type { Db } from '../../platform/db/driver.ts';
import { chartResponse } from './measurements.ts';
export { addCustomerPhone, createCustomer, createGroup, createWearer, createMeasurement } from './create.ts';
export { normalizePhone } from './schemas.ts';

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

/** Name matches for permission-filtered navigation search. */
export function searchCustomers(db: Db, query: string, limit = 20): { id: string; name: string }[] {
  return db.prepare(`SELECT id, display_name AS name FROM cus_customers
    WHERE merged_into_id IS NULL AND display_name LIKE ? COLLATE NOCASE ORDER BY display_name LIMIT ?`)
    .all(`%${query}%`, limit) as { id: string; name: string }[];
}

/** Wearer matches include their owning customer so the customer screen can open the right record. */
export function searchWearers(db: Db, query: string, limit = 20): { id: string; customerId: string; name: string }[] {
  return db.prepare(`SELECT p.id, p.customer_id AS customerId, p.full_name AS name FROM cus_people p
    JOIN cus_customers c ON c.id = p.customer_id WHERE p.is_active = 1 AND c.merged_into_id IS NULL
      AND p.full_name LIKE ? COLLATE NOCASE ORDER BY p.full_name LIMIT ?`)
    .all(`%${query}%`, limit) as { id: string; customerId: string; name: string }[];
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

/** The current wearer chart exactly as shown on the customer screen, with names for a sizing-profile print. */
export function sizingProfile(db: Db, personId: string): Record<string, unknown> | undefined {
  const row = db.prepare(`SELECT m.*, p.full_name AS wearer_name, c.display_name AS customer_name,
    g.name AS group_name, upper.label AS upper_size_label, lower.label AS lower_size_label
    FROM cus_measure_charts m JOIN cus_people p ON p.id = m.person_id
    JOIN cus_customers c ON c.id = p.customer_id LEFT JOIN cus_groups g ON g.id = p.group_id
    LEFT JOIN cus_sizes upper ON upper.id = m.upper_size LEFT JOIN cus_sizes lower ON lower.id = m.lower_size
    WHERE p.id = ? AND m.status = 'active'`).get(personId) as Record<string, unknown> | undefined;
  return row ? chartResponse(row) : undefined;
}
