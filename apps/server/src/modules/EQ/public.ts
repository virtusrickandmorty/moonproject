/** What other modules may read from EQ: the register of stockholders and officers (party ids on 2502/31xx, 1220/2501). */
import type { Db } from '../../platform/db/driver.ts';
export { person, type Person } from './people.ts';
/** The dividend lines behind the final tax withheld (TAX reads them for the 1601-FQ and 1604-F lists). */
export { dividendsWithheld, type DividendWithheld } from './dividends.ts';

/** Owners and officers by name or position, for the search bar. */
export function searchPeople(db: Db, query: string, limit = 10): { id: string; name: string; position: string | null }[] {
  return db.prepare(`SELECT id, name, position FROM eq_people WHERE is_active = 1 AND (name LIKE '%' || replace(replace(@q, '%', ''), '_', '') || '%' COLLATE NOCASE OR position LIKE '%' || replace(replace(@q, '%', ''), '_', '') || '%' COLLATE NOCASE)
    ORDER BY name LIMIT @limit`).all({ q: query, limit }) as { id: string; name: string; position: string | null }[];
}
