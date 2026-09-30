/** Read-only PRT contract for other modules. */
import type { Db } from '../../platform/db/driver.ts';

/** The company's registered name from the print profile, or undefined until an owner has filled the profile in. */
export function companyRegisteredName(db: Db): string | undefined {
  return (db.prepare('SELECT registered_name FROM prt_company_profile WHERE id = 1').pluck().get() as string | undefined)?.trim() || undefined;
}
