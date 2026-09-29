/**
 * Annual income tax (1702-RT, PLAN D5 IT-PROV and IT-SETTLE, D8 "Yearly", E12). The year from 1 January to 31 December,
 * read from sealed journals the way the 1702Q is (income-tax.ts), every figure in whole pesos (PLAN D4 rule 10):
 *   Sales − cost of sales = gross income from operations; + other income not under final tax = total gross income
 *   − deductions: itemized (operating and other expenses, 6290 penalties aside) or, if the accountant picks it for the
 *     year (a dated setting, tax_income_tax_deductions; itemized and flagged until confirmed), the 40% optional
 *     standard deduction on total gross income
 *   = taxable income. Income tax: the regular rate, or MCIT where it applies (from the 4th year after operations began)
 *   if higher, with the rates in force on 31 December.
 *   Less last year's excess credits carried over (its settlement's carry-over), the year's 1702Q payments, other prepaid
 *   income tax on 1411 dated in the year, and the CWT of the year with the customer's 2307 in hand (1410).
 *   = tax payable with the 1702, or an overpayment (carried over to next year, the default; refund and tax credit
 *   certificate are not built).
 * The provision (ITP-) and the settlement (ITS-) post it (doctypes/income-tax-provision.ts, income-tax-settlement.ts)
 * from the centavo figures here: the provision books the tax due less what the old books' 1702Qs of the year already
 * put on 2320 (opening tax payables); the settlement applies 1411 and 1410 exactly and leaves on 2320 what the return
 * leaves to pay, the difference between centavos and whole pesos going to 8101 as rounding.
 */
import { z } from 'zod';
import { badRequest, conflict, formatPeso } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { cutoverDate } from '../ACC/public.ts';
import { returnDue } from './calendar.ts';
import {
  carriedOverInto, cwtOfYear, incomeTaxSettingsAt, ledgerYearToDate, mcitApplies, otherPrepaid, posted, taxOn, wholePesos, type IncomeTaxSettings, type PaymentRef,
} from './income-tax.ts';
import { openedByParty, openingsOf } from './opening-payables.ts';
import { annualIncomeTaxDue, quarterPeriod, type BirForm } from './payments.ts';
import type { WorksheetCheck } from './vat-return.ts';

// ---------- The deduction method of a year (dated setting) ----------

export const DEDUCTION_METHODS = ['itemized', 'osd'] as const;
export type DeductionMethod = (typeof DEDUCTION_METHODS)[number];
/** The optional standard deduction of a corporation: 40% of gross income. */
export const OSD_RATE_BP = 4000;

export interface DeductionSetting {
  id: number | null; year: number; method: DeductionMethod; effectiveFrom: string | null; reason: string | null; createdAt: string | null; createdBy: string | null;
  /** False for the default (itemized) while the accountant has not picked the year's method. */
  confirmed: boolean;
}
const DEDUCTION_SQL = `SELECT id, year, method, effective_from AS effectiveFrom, reason, created_at AS createdAt, created_by AS createdBy FROM tax_income_tax_deductions`;
const defaultDeduction = (year: number): DeductionSetting => ({ id: null, year, method: 'itemized', effectiveFrom: null, reason: null, createdAt: null, createdBy: null, confirmed: false });

/** The year's method in force on `date`: the newest version for the year dated on or before it, else itemized, unconfirmed. */
export function deductionAt(db: Db, year: number, date: string): DeductionSetting {
  const r = db.prepare(`${DEDUCTION_SQL} WHERE year = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`).get(year, date) as Omit<DeductionSetting, 'confirmed'> | undefined;
  return r ? { ...r, confirmed: true } : defaultDeduction(year);
}

/** Every version for a year, newest first. */
export const deductionHistory = (db: Db, year: number): DeductionSetting[] =>
  (db.prepare(`${DEDUCTION_SQL} WHERE year = ? ORDER BY effective_from DESC, id DESC`).all(year) as Omit<DeductionSetting, 'confirmed'>[]).map((r) => ({ ...r, confirmed: true }));

export const deductionChange = z
  .object({
    year: z.number().int().min(2000).max(2999),
    method: z.enum(DEDUCTION_METHODS),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

/** Adds a version from today or a later date (never earlier), like every dated setting. Call inside a transaction. */
export function addDeductionSetting(db: Db, body: unknown, who: { userId: string; at: string; today: string }): DeductionSetting {
  const parsed = deductionChange.safeParse(body);
  if (!parsed.success) {
    throw badRequest('BAD_VALUE', 'Give the year, itemized or the optional standard deduction, the date it takes effect and a reason of 10 characters or more.',
      parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  const { year, method, effectiveFrom, reason } = parsed.data;
  if (effectiveFrom < who.today) throw badRequest('SETTING_BACKDATED', 'A setting can change from today or a later date, never an earlier one.');
  const before = deductionAt(db, year, effectiveFrom);
  if (before.confirmed && before.method === method) throw conflict('NO_CHANGE', `The deductions of ${year} are already ${method === 'osd' ? 'the optional standard deduction' : 'itemized'} on that date.`);
  const id = Number(
    db.prepare('INSERT INTO tax_income_tax_deductions (year, method, effective_from, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(year, method, effectiveFrom, reason, who.at, who.userId).lastInsertRowid,
  );
  appendAudit(db, {
    at: who.at, userId: who.userId, action: 'tax.income_tax_deduction.add', entityType: 'setting', entityId: `tax.income_tax_deduction.${year}`,
    data: { year, effectiveFrom, before: before.confirmed ? before.method : null, after: method, reason },
  });
  return { id, year, method, effectiveFrom, reason, createdAt: who.at, createdBy: who.userId, confirmed: true };
}

// ---------- The 1702-RT ----------

export type AnnualKey =
  | 'sales' | 'cost_of_sales' | 'gross_income' | 'other_income' | 'total_gross_income' | 'deductions' | 'taxable_income'
  | 'regular_tax' | 'mcit' | 'tax_due' | 'prior_excess' | 'quarterly_payments' | 'other_prepaid' | 'cwt' | 'payable';
export interface AnnualLine { key: AnnualKey; label: string; cents: number }
const QUARTERS = [1, 2, 3] as const;

/** Σ the posted 1702Q payments of the year's quarters that prepaid 1411 (no opening), or that paid an opening's 2320. */
function quarterlyPaid(db: Db, year: number, opened: boolean): number {
  return db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_cents), 0) FROM tax_income_tax_payments p JOIN documents d ON d.id = p.document_id
       WHERE d.status = 'posted' AND p.period IN (?, ?, ?) AND (p.opening_id IS NOT NULL) = ?`,
    )
    .pluck()
    .get(...QUARTERS.map((q) => quarterPeriod(year, q)), opened ? 1 : 0) as number;
}

/**
 * The 1702-RT of a year without the checks: each figure of the return in whole pesos, and the centavo figures the
 * provision and the settlement post. `today` picks the deduction method in force.
 */
export function annualIncomeTaxPosition(db: Db, year: number, today: string) {
  const [from, to] = [`${year}-01-01`, `${year}-12-31`];
  const settings: IncomeTaxSettings = incomeTaxSettingsAt(db, to);
  const deduction = deductionAt(db, year, today);
  const ytd = ledgerYearToDate(db, from, to);

  const sales = wholePesos(ytd.sales);
  const costOfSales = wholePesos(ytd.costOfSales);
  const grossIncome = sales - costOfSales;
  const otherIncome = wholePesos(ytd.otherIncome);
  const totalGrossIncome = grossIncome + otherIncome;
  const itemized = wholePesos(ytd.deductions);
  const osd = totalGrossIncome > 0 ? taxOn(totalGrossIncome, OSD_RATE_BP) : 0;
  const deductions = deduction.method === 'osd' ? osd : itemized;
  const taxableIncome = totalGrossIncome - deductions;
  const regularTax = taxableIncome > 0 ? taxOn(taxableIncome, settings.regularRateBp) : 0;
  const mcit = totalGrossIncome > 0 ? taxOn(totalGrossIncome, settings.mcitRateBp) : 0;
  const applies = mcitApplies(settings, year);
  const basis: 'regular' | 'mcit' = applies && mcit > regularTax ? 'mcit' : 'regular';
  const taxDue = basis === 'mcit' ? mcit : regularTax;

  // Credits, exact (what the settlement applies) and in whole pesos (what the return says).
  const priorExcessExact = carriedOverInto(db, year);
  const quarterlyPayments: PaymentRef[] = posted(db, QUARTERS.map((q): [BirForm, string] => ['1702Q', quarterPeriod(year, q)]));
  const prepaidByQuarterlies = quarterlyPaid(db, year, false);
  const paidOpenedCents = quarterlyPaid(db, year, true);
  const otherExact = otherPrepaid(db, from, to);
  const cwt = cwtOfYear(db, year, 4, to);
  const priorExcess = wholePesos(priorExcessExact);
  const quarterlyPaidCents = wholePesos(prepaidByQuarterlies + paidOpenedCents);
  const otherPrepaidCents = wholePesos(otherExact);
  const cwtInHand = wholePesos(cwt.inHandCents);
  const payable = taxDue - priorExcess - quarterlyPaidCents - otherPrepaidCents - cwtInHand;

  // The old books' 1702Qs of the year (opening tax payables) already put their tax on 2320.
  const openedKeys = QUARTERS.map((q): [string, string] => ['1702Q', quarterPeriod(year, q)]);
  const openedCents = openedByParty(db, openedKeys).get('') ?? 0;

  const pct = (bp: number) => `${bp / 100}%`;
  const lines: AnnualLine[] = [
    { key: 'sales', label: 'Sales, net of discounts and returns', cents: sales },
    { key: 'cost_of_sales', label: 'Less: cost of sales', cents: costOfSales },
    { key: 'gross_income', label: 'Gross income from operations', cents: grossIncome },
    { key: 'other_income', label: 'Add: other income not subject to final tax', cents: otherIncome },
    { key: 'total_gross_income', label: 'Total gross income', cents: totalGrossIncome },
    { key: 'deductions', label: deduction.method === 'osd' ? 'Less: optional standard deduction (40% of total gross income)' : 'Less: deductions (itemized: operating and other expenses)', cents: deductions },
    { key: 'taxable_income', label: taxableIncome < 0 ? 'Net loss' : 'Taxable income', cents: taxableIncome },
    { key: 'regular_tax', label: `Income tax at the regular rate (${pct(settings.regularRateBp)} of taxable income)`, cents: regularTax },
    { key: 'mcit', label: `Minimum corporate income tax (${pct(settings.mcitRateBp)} of total gross income)${applies ? '' : applies === false ? ', does not apply yet' : ', year operations began not confirmed'}`, cents: mcit },
    { key: 'tax_due', label: `Income tax due (${basis === 'mcit' ? 'MCIT, the higher' : 'regular rate'})`, cents: taxDue },
    { key: 'prior_excess', label: 'Less: excess credits carried over from last year', cents: priorExcess },
    { key: 'quarterly_payments', label: 'Less: paid with the 1702Q of Q1 to Q3', cents: quarterlyPaidCents },
    { key: 'other_prepaid', label: 'Less: other prepaid income tax this year (1411 opening balance or journal vouchers)', cents: otherPrepaidCents },
    { key: 'cwt', label: 'Less: creditable tax withheld by customers, 2307s in hand (1410)', cents: cwtInHand },
    { key: 'payable', label: payable < 0 ? 'Overpayment, carried over to next year' : 'Tax payable with the 1702', cents: payable },
  ];
  return {
    year, from, to, settings, mcitApplies: applies, deduction, lines,
    salesCents: sales, costOfSalesCents: costOfSales, grossIncomeCents: grossIncome, otherIncomeCents: otherIncome, totalGrossIncomeCents: totalGrossIncome,
    itemizedDeductionsCents: itemized, osdCents: osd, deductionsCents: deductions, taxableIncomeCents: taxableIncome,
    regularTaxCents: regularTax, mcitCents: mcit, basis, taxDueCents: taxDue,
    priorExcessCents: priorExcess, quarterlyPayments, quarterlyPaidCents, otherPrepaidCents, cwtCents: cwtInHand, cwtPendingCents: cwt.pendingCents, payableCents: payable,
    /** Left out, for the checks: 6290 penalties and 7101 interest income, unrounded. */
    penaltiesCents: ytd.penalties, interestIncomeCents: ytd.interest,
    // ----- What the provision and the settlement post (centavos) -----
    /** The old books' 1702Qs of the year on 2320 (openings), and what these books paid of them. */
    openedCents, paidOpenedCents,
    /** The provision: the tax due less what the openings already put on 2320 (Dr 8101 / Cr 2320). */
    provisionCents: taxDue - openedCents,
    /** 1411 the settlement applies: last year's carry-over, the 1702Q prepayments and other prepaid dated in the year. */
    prepaidCents: priorExcessExact + prepaidByQuarterlies + otherExact,
    /** 1410 the settlement applies, per customer: the year's CWT with the 2307 in hand. */
    cwtByCustomer: [...cwt.byCustomer].filter(([, c]) => c !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([customerId, cents]) => ({ customerId, cents })),
    cwtExactCents: cwt.inHandCents,
  };
}
export type AnnualIncomeTaxPosition = ReturnType<typeof annualIncomeTaxPosition>;

export interface DocRef { documentId: string; number: string; date: string }

/** The year's posted provision (ITP-), if any. */
export function provisionOf(db: Db, year: number): (DocRef & { amountCents: number }) | null {
  return (db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.business_date AS date, p.amount_cents AS amountCents FROM tax_income_tax_provisions p JOIN documents d ON d.id = p.document_id
       WHERE p.year = ? AND d.status = 'posted'`,
    )
    .get(year) as (DocRef & { amountCents: number }) | undefined) ?? null;
}

/** The year's posted settlement (ITS-), if any. */
export function settlementOf(db: Db, year: number): (DocRef & { payableCents: number; carryOverCents: number }) | null {
  return (db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.business_date AS date, s.payable_cents AS payableCents, s.carry_over_cents AS carryOverCents
       FROM tax_income_tax_settlements s JOIN documents d ON d.id = s.document_id WHERE s.year = ? AND d.status = 'posted'`,
    )
    .get(year) as (DocRef & { payableCents: number; carryOverCents: number }) | undefined) ?? null;
}

/** The opening tax payable that brought in the year's 1702 from the old books (a year before the cut-over date), if any. */
export const annualOpeningOf = (db: Db, year: number): DocRef | null => {
  const o = openingsOf(db, [['1702', String(year)]])[0];
  return o ? { documentId: o.documentId, number: o.number, date: o.date } : null;
};

/** The checks shared by the worksheet and the provision: the settings, the deduction method and the cut-over. */
export function yearChecks(db: Db, w: AnnualIncomeTaxPosition): WorksheetCheck[] {
  const checks: WorksheetCheck[] = [];
  const check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void (when && checks.push({ code, level, message }));
  const { settings: s } = w;
  const cutover = cutoverDate(db);
  check(!s.confirmed, 'SETTINGS_DEFAULT', 'warning',
    `The rates are the defaults at install (regular ${s.regularRateBp / 100}%, MCIT ${s.mcitRateBp / 100}%): the accountant confirms them in the income tax settings before filing.`);
  check(w.mcitApplies === null, 'MCIT_UNKNOWN', 'warning',
    'The year Virtus began operations is not confirmed, so MCIT is left out. MCIT applies from the 4th taxable year after it: confirm the year in the income tax settings.');
  check(!w.deduction.confirmed, 'DEDUCTION_DEFAULT', 'warning',
    `The deductions of ${w.year} are itemized by default: the accountant confirms itemized or the 40% optional standard deduction for the year before filing.`);
  check(w.deduction.method === 'osd', 'OSD', 'info', `The 40% optional standard deduction is taken for ${w.year}: the expenses in the books (${formatPeso(w.itemizedDeductionsCents)}) are not deducted.`);
  check(cutover !== null && w.to < cutover, 'OLD_BOOKS', 'warning', `${w.year} ended before the cut-over date, ${cutover}: its 1702 is the old books'. If it is not paid yet, record it on the opening tax payable.`);
  check(cutover !== null && cutover > w.from && cutover <= w.to, 'BOOKS_START', 'warning',
    `These books start on the cut-over date, ${cutover}: income and expenses from 1 January to the day before are in the old books, so the figures above leave them out. Add them from the old books before filing.`);
  check(w.openedCents !== 0, 'OPENED', 'info', `The old books' 1702Qs of ${w.year} put ${formatPeso(w.openedCents)} on 2320 at the cut-over (opening tax payables): the provision takes it off.`);
  return checks;
}

/** The 1702-RT worksheet (GET /api/tax/1702rt): the position, its due date, the provision, settlement and 1702 payments, and the checks. */
export function annualIncomeTaxWorksheet(db: Db, year: number, today: string) {
  const w = annualIncomeTaxPosition(db, year, today);
  const provision = provisionOf(db, year);
  const settlement = settlementOf(db, year);
  const due = annualIncomeTaxDue(db, year);
  const payments = posted(db, [['1702', String(year)]]);
  const checks = yearChecks(db, w);
  const check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void (when && checks.push({ code, level, message }));
  check(w.cwtPendingCents > 0, 'PENDING_2307', 'warning', `${formatPeso(w.cwtPendingCents)} withheld by customers in ${year} still waits for its 2307, so it is not claimed on this return.`);
  check(w.penaltiesCents !== 0, 'PENALTIES', 'info', 'Penalties and surcharges (6290) are not deductible: they are left out of the deductions.');
  check(w.interestIncomeCents !== 0, 'INTEREST', 'info', 'Interest income (7101) is under the final tax the bank withheld: it is left out of gross income.');
  check(w.payableCents < 0, 'OVERPAID', 'info', 'The credits are more than the tax due: the overpayment is carried over to next year (the default; the return may ask for a refund or a tax credit certificate instead, which is not built).');
  check(today <= w.to, 'YEAR_OPEN', 'info', `${year} has not ended: these figures still change.`);
  check(today > w.to && !provision && w.provisionCents > 0, 'NOT_PROVIDED', 'info', `Record the income tax provision of ${year}, dated ${w.to}.`);
  check(!!provision && provision.amountCents !== w.provisionCents, 'PROVISION_STALE', 'warning',
    `The provision ${provision?.number} booked ${formatPeso(provision?.amountCents ?? 0)}, but the figures now give ${formatPeso(w.provisionCents)}: the books of ${year} changed after it. Cancel it and record it again.`);
  check(!!settlement && settlement.payableCents !== w.payableCents, 'SETTLEMENT_CHANGED', 'warning',
    `The settlement ${settlement?.number} left ${formatPeso(settlement?.payableCents ?? 0)}, but the return now gives ${formatPeso(w.payableCents)}: the books or the credits changed after it.`);
  return { ...w, returnDue: returnDue(db, '1702-RT', String(year), w.to), provision, settlement, opening: due.opening, dueCents: due.dueCents, payments, paidCents: due.paidCents, leftCents: due.leftCents, checks };
}
export type AnnualIncomeTaxWorksheet = ReturnType<typeof annualIncomeTaxWorksheet>;
