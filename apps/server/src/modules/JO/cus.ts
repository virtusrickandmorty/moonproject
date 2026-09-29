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

/** A customer's active wearers with their group and size on file (the active chart), for the job order form's roster. */
export interface WearerPick { personId: string; wearerName: string; groupId: string | null; sizeMode: 'preset' | 'measured'; size?: string; jerseyName?: string; jerseyNumber?: string }

export function customerWearers(db: Db, customerId: string): { groups: { id: string; name: string }[]; wearers: WearerPick[] } {
  const groups = db.prepare('SELECT id, name FROM cus_groups WHERE customer_id = ? AND is_active = 1 ORDER BY name, id').all(customerId) as { id: string; name: string }[];
  const rows = db
    .prepare(
      `SELECT p.id AS personId, p.full_name AS wearerName, p.group_id AS groupId, p.default_jersey_name AS jerseyName, p.default_jersey_number AS jerseyNumber,
         c.size_mode AS chartMode, c.upper_size AS size
       FROM cus_people p LEFT JOIN cus_measure_charts c ON c.person_id = p.id AND c.status = 'active'
       WHERE p.customer_id = ? AND p.is_active = 1 ORDER BY p.full_name, p.id`,
    )
    .all(customerId) as { personId: string; wearerName: string; groupId: string | null; jerseyName: string | null; jerseyNumber: string | null; chartMode: string | null; size: string | null }[];
  // Measured on file: the job order links the chart. A preset size on file is filled in; no chart: staff pick a size.
  const wearers = rows.map(({ chartMode, size, jerseyName, jerseyNumber, ...w }): WearerPick => ({
    ...w,
    sizeMode: chartMode === 'measured' ? 'measured' : 'preset',
    ...(chartMode === 'preset' && size ? { size } : {}),
    ...(jerseyName ? { jerseyName: jerseyName.toUpperCase() } : {}),
    ...(jerseyNumber ? { jerseyNumber } : {}),
  }));
  return { groups, wearers };
}
