/**
 * Income tax provision (ITP-, PLAN D5 IT-PROV), by the accountant: the year's income tax from the 1702-RT worksheet
 * (annual-income-tax.ts), dated the last day of the year (31 December; recorded later, the accountant dates it back).
 *   Dr 8101 income tax – current / Cr 2320 income tax payable: the tax due, less what the old books' 1702Qs of the year
 *   already put on 2320 at the cut-over (opening tax payables).
 * One posted per year. Its cancel mirrors it on its own date (31 December), so the year's income statement is as if it
 * had never been recorded and a new provision replaces it exactly; the settlement of the year is cancelled first.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { annualIncomeTaxPosition, annualOpeningOf, settlementOf, yearChecks, type DeductionMethod } from '../annual-income-tax.ts';

export const incomeTaxProvisionInput = z
  .object({
    year: z.number().int().min(2000).max(2999),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type IncomeTaxProvisionInput = z.infer<typeof incomeTaxProvisionInput>;
export interface IncomeTaxProvision extends IncomeTaxProvisionInput {
  deductionMethod: DeductionMethod; taxableIncomeCents: number; basis: 'regular' | 'mcit'; taxDueCents: number;
  /** What the old books' 1702Qs of the year put on 2320 at the cut-over. */
  openedCents: number;
  /** Dr 8101 / Cr 2320. */
  amountCents: number;
  totalCents: number;
}

const today = (at: string) => at.slice(0, 10); // ctx.at is Manila time (+08:00)

/** The years with a posting on the income statement, for the generator. */
export const yearsWithIncome = (db: Db): number[] =>
  db
    .prepare(
      `SELECT DISTINCT CAST(substr(j.business_date, 1, 4) AS INTEGER) FROM journals j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND substr(a.code, 1, 1) BETWEEN '4' AND '7' ORDER BY 1`,
    )
    .pluck()
    .all() as number[];

export const incomeTaxProvisionDoc: DocTypeDef<IncomeTaxProvisionInput, IncomeTaxProvision> = {
  key: 'tax.it_provision',
  module: 'TAX',
  title: 'Income Tax Provision',
  numbering: { series: { key: 'ITP', prefix: 'ITP-' } },
  permissions: { view: 'tax.income_tax.view', create: 'tax.income_tax.post', post: 'tax.income_tax.post', cancel: 'tax.income_tax.cancel' },
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: incomeTaxProvisionInput,

  compute(input, ctx) {
    const w = annualIncomeTaxPosition(ctx.db, input.year, today(ctx.at));
    return {
      ...input, deductionMethod: w.deduction.method, taxableIncomeCents: w.taxableIncomeCents, basis: w.basis, taxDueCents: w.taxDueCents,
      openedCents: w.openedCents, amountCents: w.provisionCents, totalCents: Math.max(w.provisionCents, 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const end = `${doc.year}-12-31`;
    if (ctx.businessDate !== end) {
      add('error', 'year', ctx.businessDate < end ? 'YEAR_OPEN' : 'DATE', ctx.businessDate < end
        ? `${doc.year} ends on ${end}: its income tax is provided on that day or after, dated ${end}.`
        : `The provision of ${doc.year} is dated the last day of the year: record it with the date ${end}.`);
      return issues;
    }
    const other = ctx.db
      .prepare(`SELECT d.number FROM tax_income_tax_provisions p JOIN documents d ON d.id = p.document_id WHERE p.year = ? AND d.status = 'posted'`)
      .pluck()
      .get(doc.year) as string | undefined;
    if (other) add('error', 'year', 'PROVIDED_ALREADY', `The income tax of ${doc.year} is already provided by ${other}. Cancel that one first to provide it again.`);
    const settled = settlementOf(ctx.db, doc.year);
    if (settled) add('error', 'year', 'SETTLED', `The income tax of ${doc.year} is already settled (${settled.number}). Cancel the settlement first.`);
    const opened = annualOpeningOf(ctx.db, doc.year);
    if (opened) add('error', 'year', 'OPENED_AT_CUTOVER', `The 1702 of ${doc.year} was brought in from the old books by ${opened.number}: its income tax is on 2320 already.`);
    if (doc.amountCents < 0) {
      add('error', 'year', 'OPENINGS_OVER', `The old books' 1702Qs of ${doc.year} put ${formatPeso(doc.openedCents)} on 2320, more than the ${formatPeso(doc.taxDueCents)} these books give for the year. Add the old books' income, or correct the opening, first.`);
    } else if (doc.amountCents === 0) {
      add('error', 'year', 'NOTHING_TO_PROVIDE', doc.taxDueCents === 0
        ? `The 1702-RT worksheet gives no income tax for ${doc.year}: there is nothing to provide. Settle the year's credits directly.`
        : `The old books' 1702Qs of ${doc.year} already put all of its income tax on 2320.`);
    }
    // Warnings before filing: the rates, the deduction method, MCIT and the cut-over.
    for (const c of yearChecks(ctx.db, annualIncomeTaxPosition(ctx.db, doc.year, today(ctx.at)))) {
      if (c.level === 'warning') add('warning', 'year', c.code, c.message);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO tax_income_tax_provisions (document_id, year, deduction_method, taxable_income_cents, basis, tax_due_cents, opened_cents, amount_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.year, doc.deductionMethod, doc.taxableIncomeCents, doc.basis, doc.taxDueCents, doc.openedCents, doc.amountCents, doc.note ?? null);
  },

  journal(doc) {
    return {
      memo: `Income tax of ${doc.year} provided (1702-RT, ${doc.basis === 'mcit' ? 'MCIT' : 'regular rate'})`,
      lines: [
        { account: { role: 'INCOME_TAX_CURRENT' }, debitCents: doc.amountCents, memo: `Income tax of ${doc.year}` },
        { account: { role: 'INCOME_TAX_PAYABLE' }, creditCents: doc.amountCents, memo: `Income tax of ${doc.year} (1702-RT)` },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM tax_income_tax_provisions WHERE document_id = ?').get(documentId) as
      | { year: number; deduction_method: DeductionMethod; taxable_income_cents: number; basis: 'regular' | 'mcit'; tax_due_cents: number; opened_cents: number; amount_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Income tax provision ${documentId} not found`);
    return {
      year: r.year, ...(r.note ? { note: r.note } : {}), deductionMethod: r.deduction_method, taxableIncomeCents: r.taxable_income_cents, basis: r.basis,
      taxDueCents: r.tax_due_cents, openedCents: r.opened_cents, amountCents: r.amount_cents, totalCents: r.amount_cents,
    };
  },

  toInput: ({ year, note }) => ({ year, ...(note ? { note } : {}) }),

  /** The settlement applied the year's credits against this provision: cancel it first. */
  dependents(db, documentId) {
    const year = db.prepare('SELECT year FROM tax_income_tax_provisions WHERE document_id = ?').pluck().get(documentId) as number | undefined;
    const s = year === undefined ? null : settlementOf(db, year);
    return s ? [{ id: s.documentId, number: s.number }] : [];
  },

  summary(doc) {
    const opened = doc.openedCents ? `, less ${formatPeso(doc.openedCents)} the old books' 1702Qs already put on 2320` : '';
    return `This will provide ${formatPeso(doc.amountCents)} income tax for ${doc.year} (taxable income ${formatPeso(doc.taxableIncomeCents)}, tax due ${formatPeso(doc.taxDueCents)} at the ${doc.basis === 'mcit' ? 'MCIT' : 'regular rate'}${opened}): Dr income tax – current, Cr income tax payable, dated ${doc.year}-12-31.`;
  },

  arbitrary(db) {
    const years = yearsWithIncome(db);
    if (!years.length) throw new Error('No year with income to provide');
    return fc
      .record({ year: fc.constantFrom(...years), note: fc.constantFrom(undefined, 'For the 1702-RT') })
      .map(({ note, ...r }) => ({ ...r, ...(note ? { note } : {}) }));
  },
};
