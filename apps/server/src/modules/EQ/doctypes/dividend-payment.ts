/**
 * Dividend Payment (DIVP-, PLAN D5 DIV, E10): the company pays a stockholder the dividend a declaration made payable
 * (net of the final tax withheld), from a cash place, like any other payment. Dated the day paid.
 *   Dr 2503 dividends payable (the stockholder) / Cr cash place
 * Never more than the stockholder is owed on 2503, so the payable never flips sides. Cancel mirrors it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { dividendsPayable, listPeople, person } from '../people.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const dividendPaymentInput = z
  .object({
    personId: z.string().trim().min(1).max(80),
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    note: z.string().trim().min(1).max(300).optional(), // check number, bank reference
  })
  .strict();
export type DividendPaymentInput = z.infer<typeof dividendPaymentInput>;

export interface DividendPayment extends DividendPaymentInput {
  totalCents: number;
  personName: string;
  cashPlaceName: string;
  /** What the stockholder was owed on 2503 before this payment. */
  payableCents: number;
}

const named = (db: Db, input: DividendPaymentInput, payableCents: number): DividendPayment => ({
  ...input,
  totalCents: input.amountCents,
  personName: person(db, input.personId)?.name ?? '?',
  cashPlaceName: getCashPlace(db, input.cashPlaceId)?.name ?? '?',
  payableCents,
});

export const dividendPaymentDoc: DocTypeDef<DividendPaymentInput, DividendPayment> = {
  key: 'eq.dividend_payment',
  module: 'EQ',
  title: 'Dividend Payment',
  numbering: { series: { key: 'DIVP', prefix: 'DIVP-' } },
  permissions: { view: 'eq.divp.view', create: 'eq.divp.create', post: 'eq.divp.post', cancel: 'eq.divp.cancel' },
  dating: 'system',
  inputSchema: dividendPaymentInput,

  compute(input, ctx) {
    return named(ctx.db, input, person(ctx.db, input.personId) ? dividendsPayable(ctx.db, input.personId) : 0);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const p = person(ctx.db, doc.personId);
    if (!p) err('personId', 'PERSON', 'Pick the stockholder from the register of stockholders and officers.');
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) err('cashPlaceId', 'CASH_PLACE', 'Pick where the money came from.');
    if (p && doc.payableCents <= 0) err('amountCents', 'NOTHING_OWED', `The company owes ${p.name} no dividends.`);
    else if (p && doc.amountCents > doc.payableCents) err('amountCents', 'MORE_THAN_OWED', `The company owes ${p.name} only ${formatPeso(doc.payableCents)} in dividends.`);
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO eq_dividend_payments (document_id, person_id, account_id, payable_cents, amount_cents, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.personId, doc.cashPlaceId, doc.payableCents, doc.amountCents, doc.note ?? null);
  },

  journal(doc) {
    return {
      memo: `Dividend paid to ${doc.personName}${doc.note ? ` (${doc.note})` : ''}`,
      lines: [
        { account: { role: 'DIVIDENDS_PAYABLE' }, party: { type: 'stockholder', id: doc.personId }, debitCents: doc.amountCents },
        { account: { cashPlace: doc.cashPlaceId }, creditCents: doc.amountCents },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT person_id, account_id, payable_cents, amount_cents, note FROM eq_dividend_payments WHERE document_id = ?').get(documentId) as
      | { person_id: string; account_id: number; payable_cents: number; amount_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Dividend payment ${documentId} not found`);
    return named(db, { personId: r.person_id, cashPlaceId: r.account_id, amountCents: r.amount_cents, ...(r.note ? { note: r.note } : {}) }, r.payable_cents);
  },

  toInput(doc) {
    const { personId, cashPlaceId, amountCents, note } = doc;
    return { personId, cashPlaceId, amountCents, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const left = doc.payableCents - doc.amountCents;
    return `This will record ${formatPeso(doc.amountCents)} of dividends paid to ${doc.personName} from ${doc.cashPlaceName}.${left > 0 ? ` ${formatPeso(left)} stays payable to them.` : ''}`;
  },

  /** A stockholder the company owes dividends, paid in full or in part; payments above what is owed are refused by validate. */
  arbitrary(db) {
    const owed = listPeople(db, true).map((p) => ({ id: p.id, cents: dividendsPayable(db, p.id) })).filter((o) => o.cents > 0);
    if (!owed.length) throw new Error('No dividends to pay');
    return fc
      .record({ o: fc.constantFrom(...owed), cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)), part: fc.boolean() })
      .chain(({ o, cashPlaceId, part }) =>
        (part ? fc.integer({ min: 1, max: o.cents }) : fc.constant(o.cents)).map((amountCents) => ({ personId: o.id, cashPlaceId, amountCents })),
      );
  },
};
