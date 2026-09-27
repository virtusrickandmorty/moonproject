/**
 * Owner Money (PLAN D5 "OWN-IN", E10, golden G-19). Money an owner puts into a cash place, never revenue.
 * The classification is required; saving without one is refused.
 *   Dr cash place / Cr, by classification:
 *     advance               2501 due to officers and stockholders (the company owes it back)
 *     capital_stock         3101 capital stock (par) + 3104 additional paid-in capital (excess)
 *     subscription_payment  3103 subscriptions receivable (pays an unpaid subscription)
 *     dffs_equity           3105 deposit for future stock subscription, equity (all four SEC FRB 6 conditions met)
 *     dffs_liability        2502 deposit for future stock subscription, liability
 * Encoders record an advance; only the accountant classifies owner money as capital or a deposit (ACC-10). The
 * accountant reclassifies an advance by editing it (cancel + reissue).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { listPeople, officerBalances, person, unpaidSubscription } from '../people.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
export const CLASSIFY_PERMISSION = 'eq.own.classify';

export const CLASSIFICATIONS = ['advance', 'capital_stock', 'subscription_payment', 'dffs_equity', 'dffs_liability'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
const WORDS: Record<Classification, string> = {
  advance: 'an advance from a stockholder (the company owes it back)',
  capital_stock: 'payment for capital stock',
  subscription_payment: 'payment on a stock subscription',
  dffs_equity: 'a deposit for future stock subscription (equity)',
  dffs_liability: 'a deposit for future stock subscription (liability)',
};

export const ownerMoneyInput = z
  .object({
    personId: z.string().trim().min(1).max(80),
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    classification: z.enum(CLASSIFICATIONS),
    parValueCents: z.number().int().positive().max(MAX_CENTS).optional(), // capital stock only: the par part
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type OwnerMoneyInput = z.infer<typeof ownerMoneyInput>;

export interface OwnerMoney extends OwnerMoneyInput {
  totalCents: number;
  personName: string;
  cashPlaceName: string;
}

const named = (db: Db, input: OwnerMoneyInput): OwnerMoney => ({
  ...input,
  totalCents: input.amountCents,
  personName: person(db, input.personId)?.name ?? '?',
  cashPlaceName: getCashPlace(db, input.cashPlaceId)?.name ?? '?',
});

export const ownerMoneyDoc: DocTypeDef<OwnerMoneyInput, OwnerMoney> = {
  key: 'eq.owner_money',
  module: 'EQ',
  title: 'Owner Money',
  numbering: { series: { key: 'OWN', prefix: 'OWN-' } },
  permissions: { view: 'eq.own.view', create: 'eq.own.create', post: 'eq.own.post', cancel: 'eq.own.cancel' },
  dating: 'system',
  inputSchema: ownerMoneyInput,

  compute(input, ctx) {
    return named(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const p = person(ctx.db, doc.personId);
    if (!p?.isActive) err('personId', 'PERSON', 'Pick the owner from the register of stockholders and officers.');
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) err('cashPlaceId', 'CASH_PLACE', 'Pick where the money went.');
    if (doc.classification !== 'advance' && !ctx.can(CLASSIFY_PERMISSION)) {
      err('classification', 'CLASSIFY', 'Only the accountant classifies owner money as capital or a deposit for stock. Record it as an advance for now.');
    }
    if (doc.classification !== 'advance' && p && !p.isStockholder) {
      err('classification', 'NOT_STOCKHOLDER', `${p.name} is not a stockholder in the register, so this can only be an advance.`);
    }
    if (doc.classification === 'capital_stock') {
      if (doc.parValueCents === undefined) err('parValueCents', 'PAR_REQUIRED', 'Enter the par value of the shares issued.');
      else if (doc.parValueCents > doc.amountCents) err('parValueCents', 'PAR_TOO_BIG', 'The par value cannot be more than the amount received.');
    } else if (doc.parValueCents !== undefined) {
      err('parValueCents', 'PAR_NOT_ALLOWED', 'Par value is only for capital stock. Clear it.');
    }
    if (doc.classification === 'subscription_payment' && p) {
      const unpaid = unpaidSubscription(ctx.db, p.id);
      if (doc.amountCents > unpaid) {
        err('amountCents', 'OVER_SUBSCRIPTION', `Only ${formatPeso(unpaid)} of ${p.name}'s subscription is unpaid. Record any extra another way.`);
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO eq_owner_money (document_id, person_id, account_id, amount_cents, classification, par_value_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.personId, doc.cashPlaceId, doc.amountCents, doc.classification, doc.parValueCents ?? null, doc.note ?? null);
  },

  journal(doc) {
    const stockholder = { type: 'stockholder', id: doc.personId };
    const credit: Record<Classification, DraftLine[]> = {
      advance: [{ account: { role: 'DUE_TO_OFFICERS' }, party: { type: 'officer', id: doc.personId }, creditCents: doc.amountCents }],
      capital_stock: [
        { account: { role: 'CAPITAL_STOCK' }, party: stockholder, creditCents: doc.parValueCents ?? 0 },
        { account: { role: 'APIC' }, creditCents: doc.amountCents - (doc.parValueCents ?? 0), memo: 'Excess over par' },
      ],
      subscription_payment: [{ account: { role: 'SUBSCRIPTIONS_RECEIVABLE' }, party: stockholder, creditCents: doc.amountCents }],
      dffs_equity: [{ account: { role: 'DFFS_EQUITY' }, party: stockholder, creditCents: doc.amountCents }],
      dffs_liability: [{ account: { role: 'DFFS_LIABILITY' }, party: stockholder, creditCents: doc.amountCents }],
    };
    return {
      memo: `Owner money from ${doc.personName}`,
      lines: [{ account: { cashPlace: doc.cashPlaceId }, debitCents: doc.amountCents }, ...credit[doc.classification]],
    };
  },

  /** Cancelling an advance the company already paid back in part would leave it owing less than nothing. */
  dependents(db, documentId) {
    const r = db.prepare('SELECT person_id, amount_cents, classification FROM eq_owner_money WHERE document_id = ?').get(documentId) as
      | { person_id: string; amount_cents: number; classification: Classification }
      | undefined;
    if (!r || r.classification !== 'advance' || officerBalances(db, r.person_id).dueToCents >= r.amount_cents) return [];
    return db
      .prepare(
        `SELECT d.id, d.number FROM eq_officer_transactions t JOIN documents d ON d.id = t.document_id
         WHERE t.person_id = ? AND t.kind = 'repaid_to_officer' AND d.status = 'posted' ORDER BY d.number DESC`,
      )
      .all(r.person_id) as { id: string; number: string }[];
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM eq_owner_money WHERE document_id = ?').get(documentId) as
      | { person_id: string; account_id: number; amount_cents: number; classification: Classification; par_value_cents: number | null; note: string | null }
      | undefined;
    if (!r) throw new Error(`Owner money ${documentId} not found`);
    return named(db, {
      personId: r.person_id,
      cashPlaceId: r.account_id,
      amountCents: r.amount_cents,
      classification: r.classification,
      ...(r.par_value_cents !== null ? { parValueCents: r.par_value_cents } : {}),
      ...(r.note ? { note: r.note } : {}),
    });
  },

  toInput(doc) {
    const { personId, cashPlaceId, amountCents, classification, parValueCents, note } = doc;
    return { personId, cashPlaceId, amountCents, classification, ...(parValueCents !== undefined ? { parValueCents } : {}), ...(note ? { note } : {}) };
  },

  summary(doc) {
    const par = doc.classification === 'capital_stock' && doc.parValueCents !== undefined && doc.parValueCents < doc.amountCents
      ? ` (par ${formatPeso(doc.parValueCents)}, excess ${formatPeso(doc.amountCents - doc.parValueCents)})`
      : '';
    return `This will record ${formatPeso(doc.amountCents)} from ${doc.personName} into ${doc.cashPlaceName} as ${WORDS[doc.classification]}${par}.`;
  },

  /** Stockholders get every classification except a subscription payment (that needs an unpaid subscription first). */
  arbitrary(db) {
    const kinds = ['advance', 'capital_stock', 'dffs_equity', 'dffs_liability'] as const;
    return fc
      .record({
        p: fc.constantFrom(...listPeople(db)),
        cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
        amountCents: fc.integer({ min: 1, max: 5_000_000_00 }),
        kind: fc.constantFrom(...kinds),
        parPct: fc.integer({ min: 1, max: 100 }),
      })
      .map(({ p, cashPlaceId, amountCents, kind, parPct }): OwnerMoneyInput => {
        const classification = p.isStockholder ? kind : 'advance';
        const par = classification === 'capital_stock' ? { parValueCents: Math.ceil((amountCents * parPct) / 100) } : {};
        return { personId: p.id, cashPlaceId, amountCents, classification, ...par };
      });
  },
};
