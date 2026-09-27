/**
 * The only JO file that reads customers and wearers. Until CUS (PR #4) is merged it reads the PLAN E1 fields;
 * after that each function becomes a call into modules/CUS/public.ts and nothing else in JO changes.
 */
import type { Db } from '../../platform/db/driver.ts';

export interface Customer { id: string; name: string; active: boolean }
export interface Wearer { id: string; customerId: string; groupId: string | null; name: string; jerseyName: string | null; jerseyNumber: string | null; active: boolean }

const WEARER = `SELECT id, customer_id AS customerId, group_id AS groupId, full_name AS name, default_jersey_name AS jerseyName,
  default_jersey_number AS jerseyNumber, is_active = 1 AS active FROM cus_people`;
type WearerRow = Omit<Wearer, 'active'> & { active: number };
const asWearer = (r: WearerRow): Wearer => ({ ...r, active: r.active === 1 });

export function customer(db: Db, id: string): Customer | undefined {
  const r = db.prepare('SELECT id, display_name AS name, is_active FROM cus_customers WHERE id = ?').get(id) as { id: string; name: string; is_active: number } | undefined;
  return r && { id: r.id, name: r.name, active: r.is_active === 1 };
}

export function wearer(db: Db, id: string): Wearer | undefined {
  const r = db.prepare(`${WEARER} WHERE id = ?`).get(id) as WearerRow | undefined;
  return r && asWearer(r);
}

/** Active wearers of one group (to pull a whole group onto a roster), or of every customer when no group is given. */
export function activeWearers(db: Db, groupId?: string): Wearer[] {
  const rows = db.prepare(`${WEARER} WHERE is_active = 1 AND (@g IS NULL OR group_id = @g) ORDER BY full_name, id`).all({ g: groupId ?? null });
  return (rows as WearerRow[]).map(asWearer);
}

/** The wearer's one active measurement revision, if any (E1: never updated; a change is a new revision). */
export function activeChart(db: Db, personId: string): { id: string; revision: number } | undefined {
  return db.prepare(`SELECT id, revision_no AS revision FROM cus_measure_charts WHERE person_id = ? AND status = 'active'`).get(personId) as
    | { id: string; revision: number }
    | undefined;
}
