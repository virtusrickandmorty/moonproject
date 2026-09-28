/** What other modules may read from LOAN. */
import type { Db } from '../../platform/db/driver.ts';

/** Posted loans that took over the financed part of an FA- purchase (FA-BUY cancels only after these). */
export const loansFinancingAsset = (db: Db, assetPurchaseId: string) =>
  db
    .prepare(`SELECT d.id, d.number FROM loan_loans l JOIN documents d ON d.id = l.document_id WHERE l.asset_purchase_id = ? AND d.status = 'posted' ORDER BY d.number`)
    .all(assetPurchaseId) as { id: string; number: string }[];
