/**
 * The allowance for credit losses (1209, PLAN D5 BAD-ALLOW, ACC-26), read from the ledger: what it holds per customer on
 * a date, and what a write-off under the allowance method may use. The allowance document (doctypes/allowance.ts) says
 * whether it was made per customer or in total; the latest one on or before a date decides which: per customer, a
 * write-off uses its customer's allowance; in total, the whole allowance.
 */
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import type { Db } from '../../platform/db/driver.ts';

export type AllowanceBasis = 'customer' | 'total';

/** 1209 per customer on `asOf`, credit-positive (what the allowance holds), leaving out customers at zero. */
export function allowanceByCustomer(db: Db, asOf: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT l.party_id AS customerId, SUM(l.credit_cents - l.debit_cents) AS cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND j.sealed = 1 AND j.business_date <= ? GROUP BY l.party_id HAVING cents <> 0`,
    )
    .all(resolveAccount(db, { role: 'AR_ALLOWANCE' }).id, asOf) as { customerId: string; cents: number }[];
  return new Map(rows.map((r) => [r.customerId, r.cents]));
}

/** The latest recorded allowance document on or before `date`, if any. */
export function latestAllowance(db: Db, date: string): { id: string; number: string; date: string; basis: AllowanceBasis } | undefined {
  return db
    .prepare(
      `SELECT d.id, d.number, a.as_of AS date, a.basis FROM col_allowances a JOIN documents d ON d.id = a.document_id
       WHERE d.status = 'posted' AND a.as_of <= ? ORDER BY a.as_of DESC, d.number DESC LIMIT 1`,
    )
    .get(date) as { id: string; number: string; date: string; basis: AllowanceBasis } | undefined;
}

/** What a write-off of this customer on `date` may take from the allowance: its own, or all of it when made in total. */
export function allowanceAvailable(db: Db, customerId: string, date: string): { basis: AllowanceBasis; cents: number } {
  const basis = latestAllowance(db, date)?.basis ?? 'customer';
  const held = allowanceByCustomer(db, date);
  return { basis, cents: basis === 'total' ? [...held.values()].reduce((s, c) => s + c, 0) : (held.get(customerId) ?? 0) };
}

/** The bad-debt method a recorded write-off used (none recorded: it predates the allowance method, so direct). */
export const writeOffMethod = (db: Db, documentId: string): 'direct' | 'allowance' =>
  ((db.prepare('SELECT method FROM col_write_off_methods WHERE document_id = ?').pluck().get(documentId) as 'direct' | 'allowance' | undefined) ?? 'direct');
