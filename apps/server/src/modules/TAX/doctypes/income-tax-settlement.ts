/**
 * Income tax settlement (ITS-, PLAN D5 IT-SETTLE), by the accountant when the 1702-RT is prepared: the year's credits
 * applied against its income tax (annual-income-tax.ts).
 *   Dr 2320 income tax payable: what the year left on it (the provision, and the old books' 1702Qs opened and not yet
 *   paid) less what the return still leaves to pay, which stays on 2320 for the 1702's BIR payment (BIRP-);
 *   Dr 1411 an overpayment, carried over to next year (the default), whose return takes it off again;
 *   Cr 1411 the year's prepaid income tax (its 1702Q payments, other prepaid dated in the year, last year's carry-over);
 *   Cr 1410 per customer: the year's CWT backed by a 2307 in hand (a pending one stays on 1410);
 *   8101 the rounding between the books' centavos and the return's whole pesos (a peso or two at most).
 * With no credits to apply, the whole tax stays on 2320 and the settlement posts nothing: it records what the 1702 pays.
 * Dated 31 December of the year or later (the accountant may date it back to that day). One posted per year, after the
 * year's provision (when there is tax to provide) and before any later year's settlement; the provision must still
 * give what the books now give. Cancel mirrors it on its own date; the 1702 payments of the year and a later year's
 * settlement are cancelled first.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { annualIncomeTaxPosition, annualOpeningOf, provisionOf, settlementOf, type DocRef } from '../annual-income-tax.ts';
import { yearsWithIncome } from './income-tax-provision.ts';

/** Past this, the books and the return differ by more than rounding each credit to whole pesos. */
const ROUNDING_LIMIT = 500;

export const incomeTaxSettlementInput = z
  .object({
    year: z.number().int().min(2000).max(2999),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type IncomeTaxSettlementInput = z.infer<typeof incomeTaxSettlementInput>;
export interface IncomeTaxSettlement extends IncomeTaxSettlementInput {
  provision: (DocRef & { amountCents: number }) | null;
  taxDueCents: number;
  /** What the return leaves to pay (below zero: the overpayment carried over). */
  payableCents: number;
  /** Dr 2320, Dr 1411 carried over, Cr 1411 applied, Cr 1410 per customer, 8101 rounding (+ Cr, − Dr). */
  liabilityCents: number; carryOverCents: number; prepaidCents: number;
  cwt: { customerId: string; cents: number }[]; cwtCents: number; cwtPendingCents: number;
  roundingCents: number;
  /** For the checks only (not stored): what the provision should now be, and what the year left on 2320. */
  provisionDueCents: number; leftOnPayableCents: number;
  totalCents: number;
}

const today = (at: string) => at.slice(0, 10);

function lines(doc: Omit<IncomeTaxSettlement, 'totalCents'>): DraftLine[] {
  const y = doc.year;
  return [
    { account: { role: 'INCOME_TAX_PAYABLE' }, debitCents: doc.liabilityCents, memo: `Income tax of ${y} settled against its credits` },
    { account: { role: 'PREPAID_INCOME_TAX' }, debitCents: doc.carryOverCents, memo: `Excess credits of ${y} carried over to ${y + 1}` },
    { account: { role: 'PREPAID_INCOME_TAX' }, creditCents: doc.prepaidCents, memo: `1702Q payments and prepaid income tax of ${y} applied` },
    ...doc.cwt.map((c): DraftLine => ({
      account: { role: 'CWT' }, party: { type: 'customer', id: c.customerId }, [c.cents > 0 ? 'creditCents' : 'debitCents']: Math.abs(c.cents), memo: `2307s of ${y} applied (1702-RT)`,
    })),
    { account: { role: 'INCOME_TAX_CURRENT' }, [doc.roundingCents > 0 ? 'creditCents' : 'debitCents']: Math.abs(doc.roundingCents), memo: `Rounding to whole pesos on the 1702-RT of ${y}` },
  ];
}
const debits = (ls: DraftLine[]) => ls.reduce((s, l) => s + (l.debitCents ?? 0), 0);

export const incomeTaxSettlementDoc: DocTypeDef<IncomeTaxSettlementInput, IncomeTaxSettlement> = {
  key: 'tax.it_settlement',
  module: 'TAX',
  title: 'Income Tax Settlement',
  numbering: { series: { key: 'ITS', prefix: 'ITS-' } },
  permissions: { view: 'tax.income_tax.view', create: 'tax.income_tax.post', post: 'tax.income_tax.post', cancel: 'tax.income_tax.cancel' },
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: incomeTaxSettlementInput,

  compute(input, ctx) {
    const w = annualIncomeTaxPosition(ctx.db, input.year, today(ctx.at));
    const provision = provisionOf(ctx.db, input.year);
    // What the year left on 2320: the provision, and the old books' 1702Qs opened and not yet paid.
    const leftOnPayableCents = (provision?.amountCents ?? 0) + w.openedCents - w.paidOpenedCents;
    const liabilityCents = leftOnPayableCents - Math.max(w.payableCents, 0);
    const carryOverCents = Math.max(-w.payableCents, 0);
    const cwtCents = w.cwtByCustomer.reduce((sum, c) => sum + c.cents, 0);
    const doc = {
      ...input, provision, taxDueCents: w.taxDueCents, payableCents: w.payableCents, liabilityCents, carryOverCents, prepaidCents: w.prepaidCents,
      cwt: w.cwtByCustomer, cwtCents, cwtPendingCents: w.cwtPendingCents,
      roundingCents: liabilityCents + carryOverCents - w.prepaidCents - cwtCents,
      provisionDueCents: w.provisionCents, leftOnPayableCents,
    };
    return { ...doc, totalCents: liabilityCents < 0 ? 0 : debits(lines(doc)) };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const end = `${doc.year}-12-31`;
    if (ctx.businessDate < end) {
      add('error', 'year', 'YEAR_OPEN', `${doc.year} ends on ${end}: its income tax is settled on that day or later.`);
      return issues;
    }
    const same = settlementOf(ctx.db, doc.year);
    if (same) add('error', 'year', 'SETTLED_ALREADY', `The income tax of ${doc.year} is already settled by ${same.number}. Cancel that one first to settle it again.`);
    const later = ctx.db
      .prepare(`SELECT s.year, d.number FROM tax_income_tax_settlements s JOIN documents d ON d.id = s.document_id WHERE d.status = 'posted' AND s.year > ? ORDER BY s.year`)
      .get(doc.year) as { year: number; number: string } | undefined;
    if (later) add('error', 'year', 'LATER_SETTLED', `${later.year} is already settled (${later.number}), and took over what ${doc.year} carried over. Years settle in order: cancel it first.`);
    const opened = annualOpeningOf(ctx.db, doc.year);
    if (opened) add('error', 'year', 'OPENED_AT_CUTOVER', `The 1702 of ${doc.year} was brought in from the old books by ${opened.number}: pay it with a BIR payment; there is nothing to settle here.`);
    if (issues.length) return issues;

    if (doc.provisionDueCents < 0) {
      add('error', 'year', 'OPENINGS_OVER', `The old books' 1702Qs of ${doc.year} put more on 2320 than the ${formatPeso(doc.taxDueCents)} these books give for the year. Add the old books' income, or correct the opening, first.`);
    } else if (!doc.provision && doc.provisionDueCents > 0) {
      add('error', 'year', 'NOT_PROVIDED', `Record the income tax provision of ${doc.year} first (${formatPeso(doc.provisionDueCents)}, dated ${end}): the settlement applies the credits against it.`);
    } else if (doc.provision && doc.provision.amountCents !== doc.provisionDueCents) {
      add('error', 'year', 'PROVISION_STALE', `The provision ${doc.provision.number} booked ${formatPeso(doc.provision.amountCents)}, but the books of ${doc.year} now give ${formatPeso(doc.provisionDueCents)}. Cancel it and provide again first.`);
    } else if (doc.liabilityCents < 0 || Math.abs(doc.roundingCents) > ROUNDING_LIMIT) {
      add('error', 'year', 'NOT_TIED', `The books and the 1702-RT worksheet of ${doc.year} differ by more than rounding (${formatPeso(Math.abs(doc.roundingCents))}): check 2320 and 1411 for journal vouchers of the year first.`);
    } else if (doc.totalCents === 0 && doc.payableCents === 0) {
      add('error', 'year', 'NOTHING_TO_SETTLE', `${doc.year} has no income tax and no credits to settle.`);
    }
    if (issues.length) return issues;
    if (doc.cwtPendingCents > 0) {
      add('warning', 'year', 'PENDING_2307', `${formatPeso(doc.cwtPendingCents)} withheld by customers in ${doc.year} still waits for its 2307: it stays on 1410 and is not claimed.`);
    }
    if (doc.carryOverCents > 0) add('warning', 'year', 'CARRIED_OVER', `The credits are ${formatPeso(doc.carryOverCents)} more than the tax: the overpayment is carried over to ${doc.year + 1}.`);
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO tax_income_tax_settlements (document_id, year, provision_id, tax_due_cents, payable_cents, liability_cents, carry_over_cents, prepaid_cents,
         cwt_cents, cwt_pending_cents, rounding_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.year, doc.provision?.documentId ?? null, doc.taxDueCents, doc.payableCents, doc.liabilityCents, doc.carryOverCents, doc.prepaidCents,
      doc.cwtCents, doc.cwtPendingCents, doc.roundingCents, doc.note ?? null);
    const ins = db.prepare('INSERT INTO tax_income_tax_settlement_lines (document_id, customer_id, amount_cents) VALUES (?, ?, ?)');
    for (const c of doc.cwt) ins.run(h.documentId, c.customerId, c.cents);
  },

  /** No credits to apply (the tax all left to pay): it records the year's result for the 1702 and posts nothing. */
  journal(doc) {
    if (doc.totalCents === 0) return null;
    const result = doc.payableCents > 0 ? `${formatPeso(doc.payableCents)} left to pay with the 1702` : doc.carryOverCents > 0 ? `${formatPeso(doc.carryOverCents)} carried over` : 'nothing left to pay';
    return { memo: `Income tax of ${doc.year} settled: ${result}`, lines: lines(doc) };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT s.*, d.number AS provision_number, d.business_date AS provision_date, p.amount_cents AS provision_cents FROM tax_income_tax_settlements s
         LEFT JOIN documents d ON d.id = s.provision_id LEFT JOIN tax_income_tax_provisions p ON p.document_id = s.provision_id WHERE s.document_id = ?`,
      )
      .get(documentId) as
      | { year: number; provision_id: string | null; provision_number: string | null; provision_date: string | null; provision_cents: number | null; tax_due_cents: number;
          payable_cents: number; liability_cents: number; carry_over_cents: number; prepaid_cents: number; cwt_cents: number; cwt_pending_cents: number; rounding_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Income tax settlement ${documentId} not found`);
    const cwt = db.prepare('SELECT customer_id AS customerId, amount_cents AS cents FROM tax_income_tax_settlement_lines WHERE document_id = ? ORDER BY customer_id').all(documentId) as { customerId: string; cents: number }[];
    const provision = r.provision_id ? { documentId: r.provision_id, number: r.provision_number!, date: r.provision_date!, amountCents: r.provision_cents! } : null;
    const doc = {
      year: r.year, ...(r.note ? { note: r.note } : {}), provision, taxDueCents: r.tax_due_cents, payableCents: r.payable_cents,
      liabilityCents: r.liability_cents, carryOverCents: r.carry_over_cents, prepaidCents: r.prepaid_cents, cwt, cwtCents: r.cwt_cents, cwtPendingCents: r.cwt_pending_cents,
      roundingCents: r.rounding_cents,
      // As at posting: the provision stood at what the books gave, and the year left the liability and the payable on 2320.
      provisionDueCents: provision?.amountCents ?? 0, leftOnPayableCents: r.liability_cents + Math.max(r.payable_cents, 0),
    };
    return { ...doc, totalCents: debits(lines(doc)) };
  },

  toInput: ({ year, note }) => ({ year, ...(note ? { note } : {}) }),

  /** A 1702 payment paid what it left on 2320, and a later year's settlement took over its carry-over: cancel them first. */
  dependents(db, documentId) {
    const year = db.prepare('SELECT year FROM tax_income_tax_settlements WHERE document_id = ?').pluck().get(documentId) as number | undefined;
    if (year === undefined) return [];
    return db
      .prepare(
        `SELECT d.id, d.number FROM tax_income_tax_annual_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted' AND p.settlement_id = @id
         UNION ALL
         SELECT d.id, d.number FROM tax_income_tax_settlements s JOIN documents d ON d.id = s.document_id WHERE d.status = 'posted' AND s.year > @year ORDER BY 2`,
      )
      .all({ id: documentId, year }) as { id: string; number: string }[];
  },

  summary(doc) {
    const parts = [`${formatPeso(doc.prepaidCents)} prepaid income tax (1411)`, `${formatPeso(doc.cwtCents)} CWT with the 2307s in hand (1410)`];
    const result = doc.payableCents > 0
      ? `${formatPeso(doc.payableCents)} is left on income tax payable, to pay with the 1702`
      : doc.carryOverCents > 0 ? `the ${formatPeso(doc.carryOverCents)} overpaid is carried over to ${doc.year + 1}` : 'nothing is left to pay';
    return `This will settle the income tax of ${doc.year} (${formatPeso(doc.taxDueCents)}) against ${parts.join(' and ')}: ${result}.`;
  },

  arbitrary(db) {
    const years = yearsWithIncome(db);
    if (!years.length) throw new Error('No year with income to settle');
    return fc
      .record({ year: fc.constantFrom(...years), note: fc.constantFrom(undefined, 'With the 1702-RT') })
      .map(({ note, ...r }) => ({ ...r, ...(note ? { note } : {}) }));
  },
};
