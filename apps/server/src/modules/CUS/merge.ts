/**
 * Merging a duplicate customer (the owner's request, 26 Oct 2026), read-only parts: what a merge would move, what stops it,
 * and the likely duplicates. A merge moves the duplicate's contacts, phones, groups, people (with their measurements) and
 * sub-customers to the record kept, and switches the duplicate off (routes.ts). Recorded documents stay with the record
 * they were made for, so a merge waits until nothing is open on the duplicate: no money owed or held in the books (read
 * here from the ledger) and nothing other modules still have open (mergeBlockers: JO's job orders not yet released).
 */
import type { Db } from '../../platform/db/driver.ts';
import { formatPeso } from '@moonproject/shared';
import { mergeBlockers } from './public.ts';

/** Money in the books for a customer: owed on invoices (1201) and held for them (2201: deposits, payments not applied). */
function moneyBlockers(db: Db, customerId: string): string[] {
  const rows = db.prepare(`SELECT a.role_key AS role, SUM(l.debit_cents - l.credit_cents) AS cents FROM journal_lines l
    JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE l.party_type = 'customer' AND l.party_id = ? AND j.sealed = 1 AND a.role_key IN ('AR_TRADE', 'CUSTOMER_DEPOSITS') GROUP BY a.role_key`).all(customerId) as { role: string; cents: number }[];
  const of = (role: string) => rows.find((r) => r.role === role)?.cents ?? 0;
  const out: string[] = [];
  if (of('AR_TRADE') !== 0) out.push(of('AR_TRADE') > 0 ? `${formatPeso(of('AR_TRADE'))} is still owed on their invoices: collect it first.` : `${formatPeso(-of('AR_TRADE'))} is owed back to them on their invoices: settle it first.`);
  if (of('CUSTOMER_DEPOSITS') !== 0) out.push(`${formatPeso(Math.abs(of('CUSTOMER_DEPOSITS')))} is held for them (deposits or a payment not yet applied): apply, move or refund it first.`);
  return out;
}

/** Why a customer cannot be merged now, in plain words; empty when it can. */
export function whyNotMerge(db: Db, customerId: string): string[] {
  return [...moneyBlockers(db, customerId), ...mergeBlockers(db, customerId)];
}

export interface MergePreview {
  from: { id: string; code: string; name: string };
  into: { id: string; code: string; name: string };
  moves: { contacts: number; phones: number; groups: number; people: number; subCustomers: number };
  /** Group names both have: rename one before merging. */
  sameGroups: string[];
  blockers: string[];
}

export function mergePreview(db: Db, fromId: string, intoId: string): MergePreview | undefined {
  const head = (id: string) => db.prepare('SELECT id, code, display_name AS name FROM cus_customers WHERE id = ?').get(id) as { id: string; code: string; name: string } | undefined;
  const from = head(fromId), into = head(intoId);
  if (!from || !into) return undefined;
  const count = (sql: string) => db.prepare(sql).pluck().get(fromId) as number;
  return {
    from, into,
    moves: {
      contacts: count('SELECT COUNT(*) FROM cus_customer_contacts WHERE customer_id = ? AND is_active = 1'),
      phones: count('SELECT COUNT(*) FROM cus_customer_phones WHERE customer_id = ? AND is_active = 1'),
      groups: count('SELECT COUNT(*) FROM cus_groups WHERE customer_id = ? AND is_active = 1'),
      people: count('SELECT COUNT(*) FROM cus_people WHERE customer_id = ? AND is_active = 1'),
      subCustomers: count('SELECT COUNT(*) FROM cus_customers WHERE parent_customer_id = ?'),
    },
    sameGroups: db.prepare(`SELECT s.name FROM cus_groups s JOIN cus_groups t ON t.customer_id = ? AND t.is_active = 1 AND t.name = s.name COLLATE NOCASE
      WHERE s.customer_id = ? AND s.is_active = 1 ORDER BY s.name`).pluck().all(intoId, fromId) as string[],
    blockers: whyNotMerge(db, fromId),
  };
}

export interface DuplicateGroup { reason: 'same name' | 'same email' | 'same phone'; customers: { id: string; code: string; name: string; createdAt: string }[] }

/** Active customers that look like the same one: the same name (letters and digits only), email or phone; oldest first in each. */
export function duplicateGroups(db: Db): DuplicateGroup[] {
  const rows = db.prepare(`SELECT id, code, display_name AS name, email, created_at AS createdAt FROM cus_customers
    WHERE is_active = 1 AND merged_into_id IS NULL ORDER BY created_at, code`).all() as { id: string; code: string; name: string; email: string | null; createdAt: string }[];
  const phones = db.prepare(`SELECT p.customer_id AS id, p.phone FROM cus_customer_phones p JOIN cus_customers c ON c.id = p.customer_id
    WHERE p.is_active = 1 AND c.is_active = 1 AND c.merged_into_id IS NULL`).all() as { id: string; phone: string }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const collect = (reason: DuplicateGroup['reason'], keyed: [string, string][]) => {
    const map = new Map<string, Set<string>>();
    for (const [key, id] of keyed) if (key) map.set(key, (map.get(key) ?? new Set()).add(id));
    for (const ids of map.values()) {
      if (ids.size < 2) continue;
      const sig = [...ids].sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      groups.push({ reason, customers: [...ids].map((id) => byId.get(id)!).filter(Boolean).map(({ id, code, name, createdAt }) => ({ id, code, name, createdAt })) });
    }
  };
  collect('same name', rows.map((r) => [r.name.toLowerCase().replace(/[^a-z0-9]/g, ''), r.id]));
  collect('same email', rows.map((r) => [r.email?.trim().toLowerCase() ?? '', r.id]));
  collect('same phone', phones.filter((p) => byId.has(p.id)).map((p) => [p.phone, p.id]));
  return groups;
}
