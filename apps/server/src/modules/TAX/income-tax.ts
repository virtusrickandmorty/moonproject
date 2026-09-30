/**
 * Quarterly income tax (1702Q, PLAN D5 IT-QPAY, D8 "Quarterly", E12). The 1702Q is cumulative: it covers 1 January to
 * the end of Q1, Q2 or Q3 (the annual 1702 covers Q4), and pays the year's tax so far less what was already paid.
 * Read from the ledger (sealed journals), the way the income statement is: 4xxx sales, 5xxx cost of sales, 6xxx
 * operating expenses, 7xxx other income (revenue accounts) and other expenses (expense accounts), 8xxx income tax.
 *   Sales (4xxx, net of discounts and returns) − cost of sales (5xxx) = gross income from operations
 *   + other income not subject to final tax (7xxx revenue accounts but 7101 interest income, which the bank's final
 *     tax already covers) = total gross income
 *   − deductions (itemized: 6xxx operating expenses but 6290 penalties, which are not deductible, and 7xxx expenses)
 *   = taxable income (a loss if below zero).
 *   Income tax: the regular rate on taxable income, or the MCIT rate on total gross income where MCIT applies (from
 *   the 4th taxable year after the year operations began), whichever is higher.
 *   Less the tax paid for the earlier quarters of the year (their 1702Q payments, and what 1411 prepaid income tax got
 *   from an opening balance or a journal voucher dated in the year so far, and the overpayment last year's settlement
 *   carried over) and less the creditable withholding tax of
 *   the year so far backed by a customer's 2307 in hand (1410; one still pending is not claimed). What is left is due
 *   with this 1702Q; below zero it is an excess credit the next quarter's return takes off again.
 * Every amount on the worksheet is in whole pesos (PLAN D4 rule 10), each ledger figure rounded half away from zero.
 * The rates and the year operations began are dated settings (tax_income_tax_settings), read on the quarter's last day.
 * A quarter an opening tax payable (OBTP-) brought in from the old books is due as the opening says, less its payments.
 */
import { z } from 'zod';
import { applyRate, badRequest, conflict, divRoundHalfAway, formatPeso } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { cutoverDate } from '../ACC/public.ts';
import { quarterRange, returnDue, type Quarter } from './calendar.ts';
import { openedByParty, openingsOf } from './opening-payables.ts';
import { birPaymentsOf, quarterPeriod, type BirForm } from './payments.ts';
import { withholdingReceivedRegister } from './registers.ts';
import type { WorksheetCheck } from './vat-return.ts';

// ---------- Settings ----------

export const incomeTaxSettingsValue = z
  .object({
    regularRateBp: z.number().int().min(0).max(5000), // 2000 = 20% (net taxable income ≤ ₱5M and assets ≤ ₱100M), else 2500
    mcitRateBp: z.number().int().min(0).max(1000), // 200 = 2% of gross income
    operationsBeganYear: z.number().int().min(1900).max(2999).nullable(), // MCIT applies from this year + 4
  })
  .strict();
export type IncomeTaxSettingsValue = z.infer<typeof incomeTaxSettingsValue>;
export interface IncomeTaxSettings extends IncomeTaxSettingsValue {
  id: number; effectiveFrom: string; reason: string; createdAt: string; createdBy: string | null;
  /** False for the default at install, until the accountant confirms a version. */
  confirmed: boolean;
}

const SETTINGS_SQL = `SELECT id, effective_from AS effectiveFrom, regular_rate_bp AS regularRateBp, mcit_rate_bp AS mcitRateBp,
  operations_began_year AS operationsBeganYear, reason, created_at AS createdAt, created_by AS createdBy FROM tax_income_tax_settings`;
const withConfirmed = (r: Omit<IncomeTaxSettings, 'confirmed'>): IncomeTaxSettings => ({ ...r, confirmed: r.createdBy !== null });

/** The version in force on `date`. */
export function incomeTaxSettingsAt(db: Db, date: string): IncomeTaxSettings {
  const r = db.prepare(`${SETTINGS_SQL} WHERE effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(date) as Omit<IncomeTaxSettings, 'confirmed'> | undefined;
  if (!r) throw badRequest('SETTING_MISSING', `No income tax settings apply on ${date}.`);
  return withConfirmed(r);
}

/** Every version, newest first. */
export const incomeTaxSettingsHistory = (db: Db): IncomeTaxSettings[] =>
  (db.prepare(`${SETTINGS_SQL} ORDER BY effective_from DESC, id DESC`).all() as Omit<IncomeTaxSettings, 'confirmed'>[]).map(withConfirmed);

export const incomeTaxSettingsChange = z
  .object({ effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: incomeTaxSettingsValue, reason: z.string().trim().min(10).max(500) })
  .strict();

/**
 * Adds a version from today or a later date, like the engine's settings (engine/settings.ts): a quarter already worked
 * out keeps the rates it used. Call inside a transaction; the audit entry goes with it.
 */
export function addIncomeTaxSettings(db: Db, body: unknown, who: { userId: string; at: string; today: string }): IncomeTaxSettings {
  const parsed = incomeTaxSettingsChange.safeParse(body);
  if (!parsed.success) {
    throw badRequest('BAD_VALUE', 'Give the date it takes effect, the rates and a reason of 10 characters or more.', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  const { effectiveFrom, value, reason } = parsed.data;
  if (effectiveFrom < who.today) {
    throw badRequest('SETTING_BACKDATED', 'A setting can change from today or a later date, never an earlier one, so quarters already worked out keep the rates they used.');
  }
  const before = incomeTaxSettingsAt(db, effectiveFrom);
  if (before.regularRateBp === value.regularRateBp && before.mcitRateBp === value.mcitRateBp && before.operationsBeganYear === value.operationsBeganYear && before.confirmed) {
    throw conflict('NO_CHANGE', 'The income tax settings already have these values on that date.');
  }
  const id = Number(
    db
      .prepare('INSERT INTO tax_income_tax_settings (effective_from, regular_rate_bp, mcit_rate_bp, operations_began_year, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(effectiveFrom, value.regularRateBp, value.mcitRateBp, value.operationsBeganYear, reason, who.at, who.userId).lastInsertRowid,
  );
  const { id: _i, effectiveFrom: _f, reason: _r, createdAt: _c, createdBy: _b, confirmed: _k, ...old } = before;
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tax.income_tax_settings.add', entityType: 'setting', entityId: 'tax.income_tax', data: { effectiveFrom, before: old, after: value, reason } });
  return withConfirmed({ id, effectiveFrom, ...value, reason, createdAt: who.at, createdBy: who.userId });
}

/** MCIT applies from the 4th taxable year after the year operations began; null while that year is not confirmed. */
export const mcitApplies = (s: Pick<IncomeTaxSettingsValue, 'operationsBeganYear'>, year: number): boolean | null =>
  s.operationsBeganYear === null ? null : year >= s.operationsBeganYear + 4;

// ---------- The 1702Q ----------

/** Centavos rounded half away from zero to whole pesos (still in centavos). */
export const wholePesos = (cents: number) => divRoundHalfAway(cents, 100) * 100 || 0; // never -0
/** A rate on a whole-peso amount, in whole pesos. */
export const taxOn = (cents: number, bp: number) => applyRate(cents / 100, bp) * 100;

export type IncomeTaxKey =
  | 'sales' | 'cost_of_sales' | 'gross_income' | 'other_income' | 'total_gross_income' | 'deductions' | 'taxable_income'
  | 'regular_tax' | 'mcit' | 'tax_due' | 'prior_payments' | 'prior_prepaid' | 'cwt' | 'payable';
export interface IncomeTaxLine { key: IncomeTaxKey; label: string; cents: number }
export interface PaymentRef { id: string; number: string; date: string; period: string; reference: string; amountCents: number; penaltyCents: number }

/** Debit-positive movement in [from, to] of the income statement accounts, by what the 1702Q does with them. */
export function ledgerYearToDate(db: Db, from: string, to: string) {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN substr(a.code, 1, 1) = '4' THEN l.credit_cents - l.debit_cents END), 0) AS sales,
         COALESCE(SUM(CASE WHEN substr(a.code, 1, 1) = '5' THEN l.debit_cents - l.credit_cents END), 0) AS costOfSales,
         COALESCE(SUM(CASE WHEN substr(a.code, 1, 1) = '7' AND a.type = 'revenue' AND COALESCE(a.role_key, '') <> 'INTEREST_INCOME' THEN l.credit_cents - l.debit_cents END), 0) AS otherIncome,
         COALESCE(SUM(CASE WHEN (substr(a.code, 1, 1) = '6' AND COALESCE(a.role_key, '') <> 'PENALTIES') OR (substr(a.code, 1, 1) = '7' AND a.type = 'expense')
           THEN l.debit_cents - l.credit_cents END), 0) AS deductions,
         COALESCE(SUM(CASE WHEN a.role_key = 'PENALTIES' THEN l.debit_cents - l.credit_cents END), 0) AS penalties,
         COALESCE(SUM(CASE WHEN a.role_key = 'INTEREST_INCOME' THEN l.credit_cents - l.debit_cents END), 0) AS interest
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { sales: number; costOfSales: number; otherIncome: number; deductions: number; penalties: number; interest: number };
}

/**
 * 1411 prepaid income tax put in by anything but a 1702Q payment (an opening balance, a journal voucher), dated in
 * [from, to]. The year-end settlement (ITS-) is left out too: it applies the year's 1411 against its income tax and
 * carries an overpayment over, which the next year takes off as last year's excess credits (carriedOverInto).
 */
export function otherPrepaid(db: Db, from: string, to: string): number {
  return db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND a.role_key = 'PREPAID_INCOME_TAX' AND j.business_date BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM tax_income_tax_payments p WHERE p.document_id = j.source_id AND j.source_type IN ('document', 'document-cancel'))
         AND NOT EXISTS (SELECT 1 FROM tax_income_tax_settlements s WHERE s.document_id = j.source_id AND j.source_type IN ('document', 'document-cancel'))`,
    )
    .pluck()
    .get(from, to) as number;
}

/** The overpayment the year before's posted settlement carried over to `year` (1411), in centavos; 0 if none. */
export function carriedOverInto(db: Db, year: number): number {
  return db
    .prepare(
      `SELECT COALESCE(SUM(s.carry_over_cents), 0) FROM tax_income_tax_settlements s JOIN documents d ON d.id = s.document_id
       WHERE d.status = 'posted' AND s.year = ?`,
    )
    .pluck()
    .get(year - 1) as number;
}

/**
 * CWT of the year up to the quarter's end, from the 2307s-received register: a collection's by its date, an opening
 * withholding's (OBWT-, dated the cut-over date) by the quarter its 2307 covers. In hand (also per customer, for the
 * year-end settlement's 1410 lines), or still pending.
 */
export function cwtOfYear(db: Db, year: number, quarter: Quarter, to: string): { inHandCents: number; pendingCents: number; byCustomer: Map<string, number> } {
  let [inHandCents, pendingCents] = [0, 0];
  const byCustomer = new Map<string, number>();
  for (const r of withholdingReceivedRegister(db, `${year}-01-01`, `${year + 1}-12-31`).rows) {
    const inYear = r.opening ? r.period !== null && Number(r.period.slice(0, 4)) === year && Number(r.period.slice(6)) <= quarter : r.date <= to;
    if (!inYear || !r.cwtCents) continue;
    if (r.certificate === 'received') {
      inHandCents += r.cwtCents;
      if (r.customerId) byCustomer.set(r.customerId, (byCustomer.get(r.customerId) ?? 0) + r.cwtCents);
    } else if (r.certificate === 'pending') pendingCents += r.cwtCents;
  }
  return { inHandCents, pendingCents, byCustomer };
}

export const posted = (db: Db, keys: [BirForm, string][]): PaymentRef[] =>
  birPaymentsOf(db, keys)
    .filter((p) => p.status === 'posted')
    .map(({ id, number, date, period, reference, amountCents, penaltyCents }) => ({ id, number, date, period, reference, amountCents, penaltyCents }));

/**
 * The 1702Q of Q1, Q2 or Q3 of a year, without the checks: each figure of the return, what it leaves to pay, the
 * payments made with it and what is left. The BIR payment's compute reads this.
 */
export function incomeTaxPosition(db: Db, year: number, quarter: Quarter) {
  const { to } = quarterRange(year, quarter);
  const from = `${year}-01-01`;
  const period = quarterPeriod(year, quarter);
  const settings = incomeTaxSettingsAt(db, to);
  const ytd = ledgerYearToDate(db, from, to);

  const sales = wholePesos(ytd.sales);
  const costOfSales = wholePesos(ytd.costOfSales);
  const grossIncome = sales - costOfSales;
  const otherIncome = wholePesos(ytd.otherIncome);
  const totalGrossIncome = grossIncome + otherIncome;
  const deductions = wholePesos(ytd.deductions);
  const taxableIncome = totalGrossIncome - deductions;
  const regularTax = taxableIncome > 0 ? taxOn(taxableIncome, settings.regularRateBp) : 0;
  const mcit = totalGrossIncome > 0 ? taxOn(totalGrossIncome, settings.mcitRateBp) : 0;
  const applies = mcitApplies(settings, year);
  const basis: 'regular' | 'mcit' = applies && mcit > regularTax ? 'mcit' : 'regular';
  const taxDue = basis === 'mcit' ? mcit : regularTax;

  const earlier = ([1, 2, 3] as Quarter[]).filter((q) => q < quarter).map((q): [BirForm, string] => ['1702Q', quarterPeriod(year, q)]);
  const priorPayments = earlier.length ? posted(db, earlier) : [];
  const priorPaid = wholePesos(priorPayments.reduce((s, p) => s + p.amountCents, 0));
  const priorPrepaid = wholePesos(otherPrepaid(db, from, to) + carriedOverInto(db, year));
  const cwt = cwtOfYear(db, year, quarter, to);
  const cwtInHand = wholePesos(cwt.inHandCents);
  const payable = taxDue - priorPaid - priorPrepaid - cwtInHand;

  const key: [BirForm, string][] = [['1702Q', period]];
  const opening = openingsOf(db, key)[0];
  const openingCents = openedByParty(db, key).get('') ?? 0;
  const payments = posted(db, key);
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  // A quarter the old books filed is due as its opening left it on 2320 (its payments pay 2320).
  const dueCents = opening ? openingCents : Math.max(payable, 0);
  const leftCents = dueCents - paidCents;

  const pct = (bp: number) => `${bp / 100}%`;
  const lines: IncomeTaxLine[] = [
    { key: 'sales', label: 'Sales, net of discounts and returns', cents: sales },
    { key: 'cost_of_sales', label: 'Less: cost of sales', cents: costOfSales },
    { key: 'gross_income', label: 'Gross income from operations', cents: grossIncome },
    { key: 'other_income', label: 'Add: other income not subject to final tax', cents: otherIncome },
    { key: 'total_gross_income', label: 'Total gross income', cents: totalGrossIncome },
    { key: 'deductions', label: 'Less: deductions (itemized: operating and other expenses)', cents: deductions },
    { key: 'taxable_income', label: taxableIncome < 0 ? 'Net loss' : 'Taxable income', cents: taxableIncome },
    { key: 'regular_tax', label: `Income tax at the regular rate (${pct(settings.regularRateBp)} of taxable income)`, cents: regularTax },
    { key: 'mcit', label: `Minimum corporate income tax (${pct(settings.mcitRateBp)} of total gross income)${applies ? '' : applies === false ? ', does not apply yet' : ', year operations began not confirmed'}`, cents: mcit },
    { key: 'tax_due', label: `Income tax due (${basis === 'mcit' ? 'MCIT, the higher' : 'regular rate'})`, cents: taxDue },
    { key: 'prior_payments', label: 'Less: paid with the 1702Q of the earlier quarters', cents: priorPaid },
    { key: 'prior_prepaid', label: 'Less: excess credits carried over from last year and other prepaid income tax this year (1411)', cents: priorPrepaid },
    { key: 'cwt', label: 'Less: creditable tax withheld by customers, 2307s in hand (1410)', cents: cwtInHand },
    { key: 'payable', label: payable < 0 ? 'Excess credits (nothing to pay)' : 'Tax payable with this return', cents: payable },
  ];
  return {
    year, quarter, period, from, to,
    settings,
    mcitApplies: applies,
    lines,
    salesCents: sales, costOfSalesCents: costOfSales, grossIncomeCents: grossIncome, otherIncomeCents: otherIncome, totalGrossIncomeCents: totalGrossIncome,
    deductionsCents: deductions, taxableIncomeCents: taxableIncome, regularTaxCents: regularTax, mcitCents: mcit, basis, taxDueCents: taxDue,
    priorPayments, priorPaidCents: priorPaid, priorPrepaidCents: priorPrepaid, cwtCents: cwtInHand, cwtPendingCents: cwt.pendingCents, payableCents: payable,
    /** Left out, for the checks: 6290 penalties (not deductible) and 7101 interest income (under final tax), unrounded. */
    penaltiesCents: ytd.penalties, interestIncomeCents: ytd.interest,
    /** A quarter before the cut-over date the old books filed: the opening tax payable that brought in its 1702Q. */
    opening: opening ? { documentId: opening.documentId, number: opening.number, date: opening.date } : null, openingCents,
    /** Due with this 1702Q (never below zero), the payments made with it, and what is left. */
    dueCents, payments, paidCents, leftCents,
  };
}
export type IncomeTaxPosition = ReturnType<typeof incomeTaxPosition>;

/** The 1702Q worksheet (GET /api/tax/1702q): the position, its due date and the checks before filing. */
export function incomeTaxWorksheet(db: Db, year: number, quarter: Quarter, today: string) {
  const w = incomeTaxPosition(db, year, quarter);
  const cutover = cutoverDate(db);
  const checks: WorksheetCheck[] = [];
  const check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void (when && checks.push({ code, level, message }));
  const { settings: s } = w;
  check(!s.confirmed, 'SETTINGS_DEFAULT', 'warning',
    `The rates are the defaults at install (regular ${s.regularRateBp / 100}%, MCIT ${s.mcitRateBp / 100}%): the accountant confirms them in the income tax settings before filing.`);
  check(w.mcitApplies === null, 'MCIT_UNKNOWN', 'warning',
    'The year Virtus began operations is not confirmed, so MCIT is left out. MCIT applies from the 4th taxable year after it: confirm the year in the income tax settings.');
  check(!!w.opening, 'OPENED', 'info',
    `This 1702Q was prepared from the old books: the opening ${w.opening?.number} left ${formatPeso(w.openingCents)} to pay on 2320. The figures above are these books' only.`);
  check(!w.opening && cutover !== null && w.to < cutover, 'OLD_BOOKS', 'warning',
    `The quarter ended before the cut-over date, ${cutover}: its 1702Q is the old books'. If it is not paid yet, record it on the opening tax payable.`);
  check(cutover !== null && cutover > w.from && cutover <= w.to, 'BOOKS_START', 'warning',
    `These books start on the cut-over date, ${cutover}: income and expenses from 1 January to the day before are in the old books, so the figures above leave them out. Add them from the old books before filing; the tax paid for the earlier quarters comes in on 1411.`);
  check(w.priorPrepaidCents !== 0, 'PRIOR_PREPAID', 'info', 'Prepaid income tax from an opening balance or a journal voucher on 1411 dated this year is taken off as paid for the earlier quarters: check that it is this year’s.');
  check(w.cwtPendingCents > 0, 'PENDING_2307', 'warning', 'Some tax withheld by customers still waits for its 2307, so it is not claimed on this return.');
  check(w.penaltiesCents !== 0, 'PENALTIES', 'info', 'Penalties and surcharges (6290) are not deductible: they are left out of the deductions.');
  check(w.interestIncomeCents !== 0, 'INTEREST', 'info', 'Interest income (7101) is under the final tax the bank withheld: it is left out of gross income.');
  check(w.payableCents < 0, 'EXCESS', 'info', 'The credits are more than the tax due: nothing is payable, and the next quarter’s return takes them off again.');
  check(today <= w.to, 'QUARTER_OPEN', 'info', 'The quarter has not ended: these figures still change.');
  return { ...w, returnDue: returnDue(db, '1702Q', w.period, w.to), checks };
}
export type IncomeTaxWorksheet = ReturnType<typeof incomeTaxWorksheet>;
