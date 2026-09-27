/**
 * The register of stockholders and officers (PLAN E10) and what the EQ documents read from the ledger (NR-2).
 * Master data: changed in place with If-Match and an audit row, switched off, never deleted. A person's id is the party
 * id on 1220/2501 (party type officer) and on 2502/3101/3103/3105 (party type stockholder).
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, formatPeso, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

const fields = {
  name: z.string().trim().min(2).max(120),
  isStockholder: z.boolean(),
  isOfficer: z.boolean(),
  position: z.string().trim().min(1).max(60).nullable(), // officer title, e.g. President, Treasurer
  shares: z.number().int().min(0).max(1_000_000_000).nullable(), // if known
};
export const personInput = z.object(fields).partial({ position: true, shares: true }).strict();
export const personUpdate = z.object(fields).partial().strict();

export interface Person { id: string; name: string; isStockholder: boolean; isOfficer: boolean; position: string | null; shares: number | null; isActive: boolean; version: number; updatedAt: string }

const SELECT = `SELECT id, name, is_stockholder AS isStockholder, is_officer AS isOfficer, position, shares, is_active AS isActive, version, updated_at AS updatedAt FROM eq_people`;
const asPerson = (r: Record<keyof Person, unknown>) => ({ ...r, isStockholder: r.isStockholder === 1, isOfficer: r.isOfficer === 1, isActive: r.isActive === 1 }) as Person;

export function person(db: Db, id: string): Person | undefined {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Record<keyof Person, unknown> | undefined;
  return r && asPerson(r);
}

export function listPeople(db: Db, includeInactive = false): Person[] {
  const rows = db.prepare(`${SELECT} ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY is_active DESC, name, id`).all() as Record<keyof Person, unknown>[];
  return rows.map(asPerson);
}

function mustGet(db: Db, id: string): Person {
  const p = person(db, id);
  if (!p) throw notFound('The person');
  return p;
}

function checkVersion(ifMatch: unknown, version: number): void {
  if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Reload this person before saving.', 428);
  if (Number(ifMatch) !== version) throw conflict('VERSION_CHANGED', 'Someone changed this person. Reload and check their changes.');
}

function checkRoles(p: { isStockholder: boolean; isOfficer: boolean }): void {
  if (!p.isStockholder && !p.isOfficer) throw badRequest('ROLE_REQUIRED', 'Tick stockholder, officer or both.');
}

export interface Who { userId: string; at: string }

/** Adds a person to the register. Call inside a transaction. */
export function createPerson(db: Db, raw: unknown, who: Who): Person {
  const v = personInput.parse(raw);
  checkRoles(v);
  const id = newId();
  db.prepare('INSERT INTO eq_people (id, name, is_stockholder, is_officer, position, shares, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, v.name, +v.isStockholder, +v.isOfficer, v.position ?? null, v.shares ?? null, who.at, who.at);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'eq.person.create', entityType: 'eq.person', entityId: id, data: v });
  return mustGet(db, id);
}

const COLUMN = { name: 'name', isStockholder: 'is_stockholder', isOfficer: 'is_officer', position: 'position', shares: 'shares' } as const;

/** Edits an active person (If-Match). Call inside a transaction. */
export function updatePerson(db: Db, id: string, ifMatch: unknown, raw: unknown, who: Who): Person {
  const v = personUpdate.parse(raw);
  const before = mustGet(db, id);
  checkVersion(ifMatch, before.version);
  if (!before.isActive) throw conflict('INACTIVE', `${before.name} is switched off. Switch them on before editing.`);
  const changes = Object.entries(v).filter(([, x]) => x !== undefined) as [keyof typeof COLUMN, string | number | boolean | null][];
  if (changes.length === 0) throw badRequest('NO_CHANGES', 'Enter a change before saving.');
  checkRoles({ ...before, ...v });
  const sets = changes.map(([k]) => `${COLUMN[k]} = ?`);
  const values = changes.map(([, x]) => (typeof x === 'boolean' ? +x : x));
  db.prepare(`UPDATE eq_people SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`).run(...values, who.at, id);
  const after = mustGet(db, id);
  const diff = Object.fromEntries(changes.map(([k]) => [k, { before: before[k], after: after[k] }]));
  appendAudit(db, { at: who.at, userId: who.userId, action: 'eq.person.update', entityType: 'eq.person', entityId: id, data: diff });
  return after;
}

/** Switches a person off or on (If-Match). Off only when nothing is owed either way. Call inside a transaction. */
export function setPersonActive(db: Db, id: string, ifMatch: unknown, active: boolean, who: Who): Person {
  const p = mustGet(db, id);
  checkVersion(ifMatch, p.version);
  if (p.isActive === active) throw conflict('NO_CHANGE', `${p.name} is already ${active ? 'on' : 'off'}.`);
  if (!active) {
    const b = officerBalances(db, id);
    if (b.dueFromCents !== 0 || b.dueToCents !== 0) {
      throw conflict('HAS_BALANCE', `${p.name} still owes ${formatPeso(b.dueFromCents)} and is owed ${formatPeso(b.dueToCents)}. Settle both first.`);
    }
  }
  db.prepare('UPDATE eq_people SET is_active = ?, version = version + 1, updated_at = ? WHERE id = ?').run(+active, who.at, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: active ? 'eq.person.activate' : 'eq.person.deactivate', entityType: 'eq.person', entityId: id, data: {} });
  return mustGet(db, id);
}

/** What the person owes the company (1220) and what the company owes them (2501), both as positive amounts. */
export function officerBalances(db: Db, personId: string): { dueFromCents: number; dueToCents: number } {
  const party = { type: 'officer', id: personId };
  return {
    dueFromCents: accountBalance(db, resolveAccount(db, { role: 'DUE_FROM_OFFICERS' }).id, { party }),
    dueToCents: 0 - accountBalance(db, resolveAccount(db, { role: 'DUE_TO_OFFICERS' }).id, { party }),
  };
}

/** The unpaid part of a stockholder's subscription (3103, debit balance). */
export function unpaidSubscription(db: Db, personId: string): number {
  return accountBalance(db, resolveAccount(db, { role: 'SUBSCRIPTIONS_RECEIVABLE' }).id, { party: { type: 'stockholder', id: personId } });
}

export interface LedgerLine {
  date: string;
  journalNumber: string;
  documentNumber: string | null;
  accountCode: string;
  accountName: string;
  memo: string;
  /** Debit-positive: + means the person owes the company more (or is owed less). */
  amountCents: number;
  /** Running net: + the person owes the company, − the company owes the person. */
  netCents: number;
}

/** The officer ledger (PLAN E10): every line with the person as officer party, oldest first, with a running net. */
export function officerLedger(db: Db, personId: string): LedgerLine[] {
  const rows = db
    .prepare(
      `SELECT j.business_date AS date, j.number AS journalNumber, d.number AS documentNumber, a.code AS accountCode, a.name AS accountName,
              COALESCE(l.memo, j.memo) AS memo, l.debit_cents - l.credit_cents AS amountCents
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN documents d ON d.id = j.source_id AND j.source_type IN ('document', 'document-cancel')
       WHERE j.sealed = 1 AND l.party_type = 'officer' AND l.party_id = ?
       ORDER BY j.business_date, j.number, l.line_no`,
    )
    .all(personId) as Omit<LedgerLine, 'netCents'>[];
  let net = 0;
  return rows.map((r) => ({ ...r, netCents: (net += r.amountCents) }));
}
