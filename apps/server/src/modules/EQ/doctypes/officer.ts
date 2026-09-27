/**
 * Officer Transaction (PLAN D5 "OFC-OUT" and "OFC-IN", E10). Money between the company and an officer or stockholder,
 * never an expense and never revenue.
 *   taken              (OFC-OUT) officer took cash, or the company paid a personal expense: Dr 1220 / Cr cash place
 *   returned           (OFC-IN)  officer paid back what they took:                          Dr cash place / Cr 1220
 *   repaid_to_officer  (OFC-IN)  company paid back an advance the officer made (OWN-IN):   Dr 2501 / Cr cash place
 * A pay-back can never be more than what is owed, so the officer ledger never flips sides by mistake.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { listPeople, officerBalances, person } from '../people.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const OFFICER_KINDS = ['taken', 'returned', 'repaid_to_officer'] as const;
export type OfficerKind = (typeof OFFICER_KINDS)[number];

export const officerInput = z
  .object({
    personId: z.string().trim().min(1).max(80),
    kind: z.enum(OFFICER_KINDS),
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    purpose: z.string().trim().min(3).max(200), // what it was for, in words
  })
  .strict();
export type OfficerInput = z.infer<typeof officerInput>;

export interface OfficerTransaction extends OfficerInput {
  totalCents: number;
  personName: string;
  cashPlaceName: string;
}

const named = (db: Db, input: OfficerInput): OfficerTransaction => ({
  ...input,
  totalCents: input.amountCents,
  personName: person(db, input.personId)?.name ?? '?',
  cashPlaceName: getCashPlace(db, input.cashPlaceId)?.name ?? '?',
});

export const officerDoc: DocTypeDef<OfficerInput, OfficerTransaction> = {
  key: 'eq.officer',
  module: 'EQ',
  title: 'Officer Transaction',
  numbering: { series: { key: 'OFC', prefix: 'OFC-' } },
  permissions: { view: 'eq.ofc.view', create: 'eq.ofc.create', post: 'eq.ofc.post', cancel: 'eq.ofc.cancel' },
  dating: 'system',
  inputSchema: officerInput,

  compute(input, ctx) {
    return named(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const p = person(ctx.db, doc.personId);
    if (!p?.isActive) err('personId', 'PERSON', 'Pick the officer from the register of stockholders and officers.');
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) err('cashPlaceId', 'CASH_PLACE', doc.kind === 'returned' ? 'Pick where the money went.' : 'Pick where the money came from.');
    const b = p && officerBalances(ctx.db, p.id);
    if (p && b && doc.kind === 'returned' && doc.amountCents > b.dueFromCents) {
      err('amountCents', 'MORE_THAN_OWED', `${p.name} owes the company only ${formatPeso(b.dueFromCents)}. Record any extra as owner money.`);
    }
    if (p && b && doc.kind === 'repaid_to_officer' && doc.amountCents > b.dueToCents) {
      err('amountCents', 'MORE_THAN_OWED', `The company owes ${p.name} only ${formatPeso(b.dueToCents)}.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO eq_officer_transactions (document_id, person_id, kind, account_id, amount_cents, purpose) VALUES (?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.personId, doc.kind, doc.cashPlaceId, doc.amountCents, doc.purpose);
  },

  journal(doc) {
    const party = { type: 'officer', id: doc.personId };
    const cash = { cashPlace: doc.cashPlaceId };
    const amount = doc.amountCents;
    const lines =
      doc.kind === 'taken'
        ? [{ account: { role: 'DUE_FROM_OFFICERS' }, party, debitCents: amount, memo: doc.purpose }, { account: cash, creditCents: amount }]
        : doc.kind === 'returned'
          ? [{ account: cash, debitCents: amount }, { account: { role: 'DUE_FROM_OFFICERS' }, party, creditCents: amount, memo: doc.purpose }]
          : [{ account: { role: 'DUE_TO_OFFICERS' }, party, debitCents: amount, memo: doc.purpose }, { account: cash, creditCents: amount }];
    return { memo: `Officer ${doc.personName}: ${doc.purpose}`, lines };
  },

  /** Cancelling money taken that was already paid back in part would leave the officer owing less than nothing. */
  dependents(db, documentId) {
    const r = db.prepare('SELECT person_id, kind, amount_cents FROM eq_officer_transactions WHERE document_id = ?').get(documentId) as
      | { person_id: string; kind: OfficerKind; amount_cents: number }
      | undefined;
    if (!r || r.kind !== 'taken' || officerBalances(db, r.person_id).dueFromCents >= r.amount_cents) return [];
    return db
      .prepare(
        `SELECT d.id, d.number FROM eq_officer_transactions t JOIN documents d ON d.id = t.document_id
         WHERE t.person_id = ? AND t.kind = 'returned' AND d.status = 'posted' ORDER BY d.number DESC`,
      )
      .all(r.person_id) as { id: string; number: string }[];
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM eq_officer_transactions WHERE document_id = ?').get(documentId) as
      | { person_id: string; kind: OfficerKind; account_id: number; amount_cents: number; purpose: string }
      | undefined;
    if (!r) throw new Error(`Officer transaction ${documentId} not found`);
    return named(db, { personId: r.person_id, kind: r.kind, cashPlaceId: r.account_id, amountCents: r.amount_cents, purpose: r.purpose });
  },

  toInput(doc) {
    const { personId, kind, cashPlaceId, amountCents, purpose } = doc;
    return { personId, kind, cashPlaceId, amountCents, purpose };
  },

  summary(doc) {
    const amount = formatPeso(doc.amountCents);
    if (doc.kind === 'taken') return `This will record ${amount} from ${doc.cashPlaceName} for ${doc.personName}, who owes it to the company (${doc.purpose}).`;
    if (doc.kind === 'returned') return `This will record ${amount} paid back by ${doc.personName} into ${doc.cashPlaceName}.`;
    return `This will record ${amount} paid back to ${doc.personName} from ${doc.cashPlaceName} for money they advanced to the company.`;
  },

  /** Any kind; pay-backs larger than what is owed are refused by validate, which the property test relies on. */
  arbitrary(db) {
    return fc.record({
      personId: fc.constantFrom(...listPeople(db).map((p) => p.id)),
      kind: fc.constantFrom(...OFFICER_KINDS),
      cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
      amountCents: fc.integer({ min: 1, max: 1_000_000_00 }),
      purpose: fc.constantFrom('Personal groceries', 'Cash for a trip', 'Paid back in cash', 'School fees'),
    });
  },
};
