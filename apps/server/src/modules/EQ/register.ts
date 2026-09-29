/**
 * Read-only lists for the owners and officers screens (PLAN E10, H2): one person's owner money and officer
 * transactions as documents, and what every person owes and is owed. Balances come from the ledger (NR-2).
 */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { listPeople, officerBalances, person, unpaidSubscription } from './people.ts';

export interface PersonDocument { id: string; number: string; date: string; status: 'posted' | 'cancelled'; amountCents: number; accountName: string; kind: string; note: string | null }

function mustHave(db: Db, personId: string): void {
  if (!person(db, personId)) throw notFound('The person');
}

/** A person's owner money (OWN-), newest first; `kind` is the classification. */
export function ownerMoneyOf(db: Db, personId: string): PersonDocument[] {
  mustHave(db, personId);
  return db
    .prepare(
      `SELECT d.id, d.number, d.business_date AS date, d.status, m.amount_cents AS amountCents, a.name AS accountName, m.classification AS kind, m.note
       FROM eq_owner_money m JOIN documents d ON d.id = m.document_id JOIN accounts a ON a.id = m.account_id
       WHERE m.person_id = ? ORDER BY d.business_date DESC, d.number DESC`,
    )
    .all(personId) as PersonDocument[];
}

/** A person's officer money out and back (OFC-), newest first; `kind` is taken, returned or repaid_to_officer and `note` the purpose. */
export function officerTransactionsOf(db: Db, personId: string): PersonDocument[] {
  mustHave(db, personId);
  return db
    .prepare(
      `SELECT d.id, d.number, d.business_date AS date, d.status, t.amount_cents AS amountCents, a.name AS accountName, t.kind, t.purpose AS note
       FROM eq_officer_transactions t JOIN documents d ON d.id = t.document_id JOIN accounts a ON a.id = t.account_id
       WHERE t.person_id = ? ORDER BY d.business_date DESC, d.number DESC`,
    )
    .all(personId) as PersonDocument[];
}

export interface PersonBalances { personId: string; dueFromCents: number; dueToCents: number; unpaidSubscriptionCents: number }

/** What each person owes the company (1220), is owed (2501) and still has to pay on a stock subscription (3103). */
export function allBalances(db: Db): PersonBalances[] {
  return listPeople(db, true).map((p) => ({ personId: p.id, ...officerBalances(db, p.id), unpaidSubscriptionCents: p.isStockholder ? unpaidSubscription(db, p.id) : 0 }));
}
