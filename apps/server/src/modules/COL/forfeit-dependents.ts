/** A deposit forfeit closes its job order as abandoned, so a release of that job order stands until the forfeit is cancelled. */
import type { Db } from '../../platform/db/driver.ts';
import { jobOrderOfRelease } from '../JO/public.ts';

export function forfeitOverRelease(db: Db, docType: string, documentId: string): { id: string; number: string }[] {
  if (docType !== 'jo.release') return [];
  return db
    .prepare(`SELECT d.id, d.number FROM col_forfeits f JOIN documents d ON d.id = f.document_id WHERE f.job_order_id = ? AND d.status = 'posted'`)
    .all(jobOrderOfRelease(db, documentId)) as { id: string; number: string }[];
}
