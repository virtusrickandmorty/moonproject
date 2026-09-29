/**
 * Opening Officer Balance (OBOF-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): what an officer owed the shop, or the shop
 * owed an officer, on the cut-over date.
 *   owes_shop  Dr 1220 due from officers (officer) / Cr 3900 opening balance equity
 *   shop_owes  Dr 3900 opening balance equity / Cr 2501 due to officers (officer)
 * It shows in the officer's ledger like any officer money (people.ts officerLedger reads the ledger, not a table), and
 * the EQ documents (eq.officer) settle it like any balance. The ACC opening contract (ACC/public.ts): dated the cut-over
 * date, cancelled on it too while the opening is open, and only after it has been settled by none.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assertOpeningOpen, duplicateOpeningIssue, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { listPeople, officerBalances, person } from '../people.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const DIRECTIONS = ['owes_shop', 'shop_owes'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const openingOfficerInput = z
  .object({
    personId: z.string().trim().min(1).max(80),
    direction: z.enum(DIRECTIONS),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    note: z.string().trim().min(3).max(500),
  })
  .strict();
export type OpeningOfficerInput = z.infer<typeof openingOfficerInput>;
export interface OpeningOfficer extends OpeningOfficerInput { personName: string; totalCents: number }

const named = (db: Db, input: OpeningOfficerInput): OpeningOfficer => ({ ...input, personName: person(db, input.personId)?.name ?? '?', totalCents: input.amountCents });

export const openingOfficerDoc: DocTypeDef<OpeningOfficerInput, OpeningOfficer> = {
  key: 'eq.opening',
  module: 'EQ',
  title: 'Opening Officer Balance',
  numbering: { series: { key: 'OBOF', prefix: 'OBOF-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingOfficerInput,

  compute(input, ctx) {
    return named(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    issues.push(...openingIssues(ctx.db, ctx.businessDate));
    const p = person(ctx.db, doc.personId);
    if (!p?.isActive) err('personId', 'PERSON', 'Pick the officer from the register of stockholders and officers.');
    else if (!p.isOfficer) err('personId', 'NOT_OFFICER', `${p.name} is not an officer in the register, so no officer balance opens for them.`);
    const earlier = ctx.db
      .prepare(`SELECT d.number FROM eq_opening_balances b JOIN documents d ON d.id = b.document_id WHERE d.status = 'posted' AND b.person_id = ? AND b.amount_cents = ? ORDER BY d.number LIMIT 1`)
      .pluck()
      .get(doc.personId, doc.amountCents) as string | undefined;
    issues.push(...duplicateOpeningIssue('personId', earlier, `this officer balance (${doc.personName}, ${formatPeso(doc.amountCents)})`));
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO eq_opening_balances (document_id, person_id, direction, amount_cents, note) VALUES (?, ?, ?, ?, ?)').run(h.documentId, doc.personId, doc.direction, doc.amountCents, doc.note);
  },

  journal(doc) {
    const party = { type: 'officer', id: doc.personId };
    const lines =
      doc.direction === 'owes_shop'
        ? [{ account: { role: 'DUE_FROM_OFFICERS' }, party, debitCents: doc.amountCents, memo: doc.note }, { account: { role: 'OPENING_EQUITY' }, creditCents: doc.amountCents }]
        : [{ account: { role: 'OPENING_EQUITY' }, debitCents: doc.amountCents }, { account: { role: 'DUE_TO_OFFICERS' }, party, creditCents: doc.amountCents, memo: doc.note }];
    return { memo: `Opening officer balance: ${doc.personName}`, lines };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT person_id AS personId, direction, amount_cents AS amountCents, note FROM eq_opening_balances WHERE document_id = ?').get(documentId) as OpeningOfficerInput | undefined;
    if (!r) throw new Error(`Opening officer balance ${documentId} not found`);
    return named(db, r);
  },

  toInput(doc) {
    const { personId, direction, amountCents, note } = doc;
    return { personId, direction, amountCents, note };
  },

  /** A settlement recorded after it (eq.officer) that has taken the balance below what this one opened. */
  dependents(db, documentId) {
    const r = db.prepare('SELECT person_id, direction, amount_cents FROM eq_opening_balances WHERE document_id = ?').get(documentId) as
      | { person_id: string; direction: Direction; amount_cents: number }
      | undefined;
    if (!r) return [];
    const b = officerBalances(db, r.person_id);
    const still = r.direction === 'owes_shop' ? b.dueFromCents : b.dueToCents;
    if (still >= r.amount_cents) return [];
    const kind = r.direction === 'owes_shop' ? 'returned' : 'repaid_to_officer';
    return db
      .prepare(`SELECT d.id, d.number FROM eq_officer_transactions t JOIN documents d ON d.id = t.document_id WHERE t.person_id = ? AND t.kind = ? AND d.status = 'posted' ORDER BY d.number DESC`)
      .all(r.person_id, kind) as { id: string; number: string }[];
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its opening balances. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const words = doc.direction === 'owes_shop' ? `${doc.personName} owed the company` : `the company owed ${doc.personName}`;
    return `This will record ${formatPeso(doc.amountCents)} ${words} on the cut-over date ${ctx.businessDate} (${doc.note}).`;
  },

  /** Needs officers on file. */
  arbitrary(db) {
    const officers = listPeople(db).filter((p) => p.isOfficer);
    return fc.record({
      personId: fc.constantFrom(...officers.map((p) => p.id)),
      direction: fc.constantFrom(...DIRECTIONS),
      amountCents: fc.integer({ min: 100, max: 5_000_000_00 }),
      note: fc.constantFrom('Old officer ledger balance from the prior book', 'Per the accountant’s opening schedule'),
    });
  },
};
