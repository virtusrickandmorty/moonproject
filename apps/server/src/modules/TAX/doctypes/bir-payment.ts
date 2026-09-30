/**
 * BIR payment (BIRP-, PLAN D5 VAT-PAY and EWT-REM): the tax paid with one BIR return, with its eFPS, eBIRForms or bank
 * reference. Dated the day paid: today, or earlier by someone who may backdate (acc.backdate), as a remittance is.
 *   2550Q (a quarter): Dr 2302 VAT payable, up to what the quarter's posted VAT close made payable less the quarter's
 *   earlier 2550Q payments.
 *   0619-E (month 1 or 2 of a quarter) and 1601-EQ (the quarter, less its 0619-E payments): Dr 2311 EWT payable per
 *   payee, with the party the bill or voucher credited (a supplier, or tin:… for a one-off payee), for the EWT withheld
 *   in the period and not yet paid (payments.ts). The third month of a quarter has no 0619-E: it goes on the 1601-EQ.
 *   A return of a period before the cut-over date pays what the opening tax payable (OBTP-) left to pay with it, the
 *   same way: a 2550Q with no VAT close pays its opening, and the payment is dated on the cut-over date or later.
 *   1702Q (Q1 to Q3, IT-QPAY): Dr 1411 prepaid income tax, by default what the 1702Q worksheet leaves to pay
 *   (income-tax.ts), recorded after the quarter ends. The return may say more than the books (income the ERP does not
 *   have): more than is left needs a note saying why. A 1702Q an opening tax payable brought in (on 2320) pays 2320,
 *   up to what the opening left; a quarter before the cut-over date with no opening is the old books' and is refused.
 *   1702 (a year, the annual return): Dr 2320 income tax payable, up to what the year's income tax settlement (ITS-)
 *   left to pay, or for a year before the cut-over date what its opening tax payable left, less the year's earlier 1702
 *   payments; dated on the settlement's (or the opening's) date or later. Once a year is settled, its 1702Qs are paid
 *   with the 1702 instead.
 *   1601-FQ (a quarter, PLAN D5 DIV): Dr 2312 final withholding tax payable, up to the final tax withheld in the quarter
 *   (the dividend declarations dated in it) less the quarter's earlier 1601-FQ payments (payments.ts finalTaxDue).
 *   Dr 6290 penalty (surcharge, interest, compromise; optional) / Cr cash place (both).
 * The variance check is STAT's: the same amount clears every payee; less is a partial payment, spread over the payees in
 * proportion, and the rest stays payable; more is refused. A penalty is paid on top: it is no one's payable, so it never
 * enters the check or the payees' lines. Cancel mirrors it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { cutoverDate } from '../../ACC/public.ts';
import { returnDue, vatReturnDue } from '../calendar.ts';
import { incomeTaxPosition } from '../income-tax.ts';
import { settlementOf } from '../annual-income-tax.ts';
import { OPENING_PAYABLE, openingsOf } from '../opening-payables.ts';
import {
  BIR_FORM, BIR_FORMS, annualIncomeTaxDue, birPaymentsOf, ewtDue, ewtPaidWith, finalTaxDue, parsePeriod, periodsDue, quarterPeriod, vatDue, type BirForm, type Period,
} from '../payments.ts';

const MAX_CENTS = 100_000_000_00;
export const birPaymentInput = z
  .object({
    form: z.enum(BIR_FORMS),
    period: z.string().refine((p) => parsePeriod(p) !== null, 'Use a quarter like 2026-Q3, a month like 2026-07 for a 0619-E, or a year like 2026 for a 1702.'), // what the return covers, not the day paid
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // what clears the period's payable
    penaltyCents: z.number().int().positive().max(MAX_CENTS).optional(), // surcharge, interest and compromise paid with it (6290)
    reference: z.string().trim().min(3).max(60), // eFPS, eBIRForms or bank reference
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type BirPaymentInput = z.infer<typeof birPaymentInput>;
export interface BirPaymentLine { partyId: string; name: string; payableCents: number; amountCents: number }
export interface BirPayment extends BirPaymentInput {
  periodLabel: string; cashPlaceName: string;
  /** 2550Q: the VAT close whose payable it pays. */
  vatClose: { documentId: string; number: string; date: string } | null;
  /** 2550Q, 1702Q or 1702 of a period before the cut-over date: the opening tax payable whose return it pays. */
  opening: { documentId: string; number: string; date: string } | null;
  /** 1702: the year's income tax settlement whose payable it pays. */
  settlement: { documentId: string; number: string; date: string } | null;
  payableCents: number;
  /** 0619-E and 1601-EQ: what it clears per payee. */
  lines: BirPaymentLine[];
  totalCents: number;
}

/** The period, if it is the kind the form pays (a month for a 0619-E, a year for a 1702, a quarter for the others). */
function periodFor(form: BirForm, period: string): Period | null {
  const p = parsePeriod(period);
  return p && p.kind === BIR_FORM[form].period ? p : null;
}
const thirdMonth = (form: BirForm, p: Period) => form === '0619-E' && p.month! % 3 === 0;

/** What the period leaves to pay, and for EWT what the amount clears per payee (in proportion if less). */
function due(db: Db, input: BirPaymentInput, p: Period | null): Pick<BirPayment, 'vatClose' | 'opening' | 'settlement' | 'payableCents' | 'lines'> {
  if (!p || thirdMonth(input.form, p)) return { vatClose: null, opening: null, settlement: null, payableCents: 0, lines: [] };
  if (input.form === '1702') {
    const a = annualIncomeTaxDue(db, p.year);
    return { vatClose: null, opening: a.opening, settlement: a.settlement, payableCents: Math.max(a.leftCents, 0), lines: [] };
  }
  if (input.form === '1702Q') {
    if (p.quarter === 4) return { vatClose: null, opening: null, settlement: null, payableCents: 0, lines: [] };
    const w = incomeTaxPosition(db, p.year, p.quarter);
    return { vatClose: null, opening: w.opening, settlement: null, payableCents: Math.max(w.leftCents, 0), lines: [] };
  }
  if (input.form === '1601-FQ') {
    return { vatClose: null, opening: null, settlement: null, payableCents: Math.max(finalTaxDue(db, p.year, p.quarter).leftCents, 0), lines: [] };
  }
  if (input.form === '2550Q') {
    const v = vatDue(db, p.year, p.quarter);
    return { vatClose: v.close, opening: v.opening, settlement: null, payableCents: Math.max(v.dueCents, 0), lines: [] };
  }
  const owed = ewtDue(db, input.form, input.period, p).filter((d) => d.dueCents > 0);
  const payableCents = owed.reduce((s, d) => s + d.dueCents, 0);
  const paid = payableCents > 0 && input.amountCents <= payableCents ? allocate(input.amountCents, owed.map((d) => d.dueCents)) : owed.map((d) => d.dueCents);
  return {
    vatClose: null, opening: null, settlement: null, payableCents,
    lines: owed.map((d, i) => ({ partyId: d.partyId, name: d.name, payableCents: d.dueCents, amountCents: paid[i]! })).filter((l) => l.amountCents > 0),
  };
}

/** A 1702 payment (tax_income_tax_annual_payments), or undefined for the other forms. */
function loadAnnual(db: Db, documentId: string): BirPayment | undefined {
  const r = db
    .prepare(
      `SELECT p.*, s.number AS settlement_number, s.business_date AS settlement_date, o.number AS opening_number, o.business_date AS opening_date
       FROM tax_income_tax_annual_payments p LEFT JOIN documents s ON s.id = p.settlement_id LEFT JOIN documents o ON o.id = p.opening_id WHERE p.document_id = ?`,
    )
    .get(documentId) as
    | { period: string; cash_account_id: number; reference: string; settlement_id: string | null; opening_id: string | null; payable_cents: number; amount_cents: number;
        penalty_cents: number; note: string | null; settlement_number: string | null; settlement_date: string | null; opening_number: string | null; opening_date: string | null }
    | undefined;
  if (!r) return undefined;
  return {
    form: '1702', period: r.period, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.penalty_cents ? { penaltyCents: r.penalty_cents } : {}),
    reference: r.reference, ...(r.note ? { note: r.note } : {}),
    periodLabel: r.period, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?', vatClose: null,
    opening: r.opening_id ? { documentId: r.opening_id, number: r.opening_number!, date: r.opening_date! } : null,
    settlement: r.settlement_id ? { documentId: r.settlement_id, number: r.settlement_number!, date: r.settlement_date! } : null,
    payableCents: r.payable_cents, lines: [], totalCents: r.amount_cents + r.penalty_cents,
  };
}

/** A 1601-FQ payment (tax_final_tax_payments), or undefined for the other forms. */
function loadFinalTax(db: Db, documentId: string): BirPayment | undefined {
  const r = db.prepare('SELECT * FROM tax_final_tax_payments WHERE document_id = ?').get(documentId) as
    | { period: string; cash_account_id: number; reference: string; payable_cents: number; amount_cents: number; penalty_cents: number; note: string | null }
    | undefined;
  if (!r) return undefined;
  return {
    form: '1601-FQ', period: r.period, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.penalty_cents ? { penaltyCents: r.penalty_cents } : {}),
    reference: r.reference, ...(r.note ? { note: r.note } : {}),
    periodLabel: parsePeriod(r.period)!.label, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?',
    vatClose: null, opening: null, settlement: null, payableCents: r.payable_cents, lines: [], totalCents: r.amount_cents + r.penalty_cents,
  };
}

/** A 1702Q payment (tax_income_tax_payments), or undefined for the other forms. */
function loadIncomeTax(db: Db, documentId: string): BirPayment | undefined {
  const r = db
    .prepare(
      `SELECT p.*, o.number AS opening_number, o.business_date AS opening_date FROM tax_income_tax_payments p LEFT JOIN documents o ON o.id = p.opening_id WHERE p.document_id = ?`,
    )
    .get(documentId) as
    | { period: string; cash_account_id: number; reference: string; opening_id: string | null; payable_cents: number; amount_cents: number; penalty_cents: number;
        note: string | null; opening_number: string | null; opening_date: string | null }
    | undefined;
  if (!r) return undefined;
  return {
    form: '1702Q', period: r.period, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.penalty_cents ? { penaltyCents: r.penalty_cents } : {}),
    reference: r.reference, ...(r.note ? { note: r.note } : {}),
    periodLabel: parsePeriod(r.period)!.label, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?',
    vatClose: null, opening: r.opening_id ? { documentId: r.opening_id, number: r.opening_number!, date: r.opening_date! } : null, settlement: null,
    payableCents: r.payable_cents, lines: [], totalCents: r.amount_cents + r.penalty_cents,
  };
}

export const birPaymentDoc: DocTypeDef<BirPaymentInput, BirPayment> = {
  key: 'tax.bir_payment',
  module: 'TAX',
  title: 'BIR Payment',
  numbering: { series: { key: 'BIRP', prefix: 'BIRP-' } },
  permissions: { view: 'tax.payment.view', create: 'tax.payment.create', post: 'tax.payment.post', cancel: 'tax.payment.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: birPaymentInput,

  compute(input, ctx) {
    const p = periodFor(input.form, input.period);
    return {
      ...input, periodLabel: p?.label ?? input.period, cashPlaceName: getCashPlace(ctx.db, input.cashPlaceId)?.name ?? '?',
      ...due(ctx.db, input, p), totalCents: input.amountCents + (input.penaltyCents ?? 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick where the money came from.');
    const p = periodFor(doc.form, doc.period);
    if (!p) {
      add('error', 'period', 'PERIOD', doc.form === '0619-E' ? 'A 0619-E pays one month: pick a month like 2026-07.'
        : doc.form === '1702' ? 'A 1702 pays one year: pick a year like 2026.' : `A ${doc.form} pays one quarter: pick a quarter like 2026-Q3.`);
      return issues;
    }
    if (thirdMonth(doc.form, p)) {
      add('error', 'period', 'THIRD_MONTH', `${p.label} is the last month of Q${p.quarter} ${p.year}, which has no 0619-E: its EWT is paid with the 1601-EQ for the quarter.`);
      return issues;
    }
    if (doc.form === '1702Q') {
      if (p.quarter === 4) {
        add('error', 'period', 'NO_Q4', `Q4 has no 1702Q: the annual income tax return (1702) covers ${p.year}.`);
        return issues;
      }
      if (ctx.businessDate <= p.to) {
        add('error', 'period', 'QUARTER_OPEN', `${p.label} ends on ${p.to}: its 1702Q is filed and paid after the quarter ends.`);
        return issues;
      }
      const settled = settlementOf(ctx.db, p.year);
      if (settled) {
        add('error', 'period', 'SETTLED', `The income tax of ${p.year} is settled (${settled.number}): what is left of it is paid with the 1702 for ${p.year}.`);
        return issues;
      }
      const cutover = cutoverDate(ctx.db);
      if (!doc.opening && cutover && p.to < cutover) {
        add('error', 'period', 'OLD_BOOKS', `${p.label} ended before the cut-over date, ${cutover}: its 1702Q is the old books'. If it is not paid yet, record it on the opening tax payable first, then pay it here.`);
        return issues;
      }
    }
    if (doc.form === '1702') {
      if (ctx.businessDate <= p.to) {
        add('error', 'period', 'YEAR_OPEN', `${p.year} ends on ${p.to}: its 1702 is filed and paid after the year ends.`);
        return issues;
      }
      if (!doc.settlement && !doc.opening) {
        add('error', 'period', 'NOT_SETTLED', `Record the income tax provision and settlement of ${p.year} first: the 1702 pays what the settlement leaves on income tax payable.`);
        return issues;
      }
      if (doc.settlement && ctx.businessDate < doc.settlement.date) {
        add('error', 'period', 'BEFORE_SETTLEMENT', `The income tax settlement of ${p.year} (${doc.settlement.number}) is dated ${doc.settlement.date}. Date the payment on that day or later.`);
      }
    }
    if (ctx.businessDate < p.from) add('error', 'period', 'PERIOD_AHEAD', `${p.label} had not started on ${ctx.businessDate}.`);
    const what = `the ${doc.form} for ${p.label}`;

    const beforeOpening = (o: { number: string; date: string } | undefined | null) => {
      if (o && ctx.businessDate < o.date) {
        add('error', 'period', 'BEFORE_OPENING', `The ${doc.form} for ${p.label} came in with the opening (${o.number}) on the cut-over date, ${o.date}. Date the payment on that day or later: one paid before it belongs in the old books.`);
      }
    };
    if (doc.form === '1702Q' || doc.form === '1702') beforeOpening(doc.opening);
    else if (doc.form === '1601-FQ') {
      if (ctx.businessDate <= p.to) add('warning', 'period', 'PERIOD_OPEN', `${p.label} has not ended: final tax withheld later in it stays payable.`);
    } else if (doc.form === '2550Q') {
      if (!doc.vatClose && !doc.opening) {
        add('error', 'period', 'NOT_CLOSED', `Record the VAT close of ${p.label} first: the 2550Q pays what the close made payable.`);
        return issues;
      }
      if (doc.vatClose && ctx.businessDate < doc.vatClose.date) {
        add('error', 'period', 'BEFORE_CLOSE', `The VAT close of ${p.label} (${doc.vatClose.number}) is dated ${doc.vatClose.date}. Date the payment on that day or later.`);
      }
      beforeOpening(doc.opening);
    } else {
      beforeOpening(openingsOf(ctx.db, ewtPaidWith(doc.form, doc.period, p))[0]);
      const eq = doc.form === '0619-E' ? birPaymentsOf(ctx.db, [['1601-EQ', quarterPeriod(p.year, p.quarter)]]).find((x) => x.status === 'posted') : undefined;
      if (eq) {
        add('error', 'period', 'QUARTER_PAID', `The 1601-EQ for Q${p.quarter} ${p.year} is already paid (${eq.number}). EWT of its months left unpaid goes with it.`);
        return issues;
      }
      if (ctx.businessDate <= p.to) add('warning', 'period', 'PERIOD_OPEN', `${p.label} has not ended: EWT withheld later in it stays payable.`);
      // D6: payees paid for more than is now withheld (a bill or voucher cancelled after its EWT was paid).
      const over = ewtDue(ctx.db, doc.form, doc.period, p).filter((d) => d.dueCents < 0).map((d) => `${d.name} ${formatPeso(-d.dueCents)}`);
      if (over.length) {
        add('warning', 'period', 'OVER_PAID', `EWT of ${p.label} was paid to the BIR for more than is now withheld (${over.join(', ')}): a bill or voucher was cancelled after its EWT was paid. Tell the accountant.`);
      }
    }

    const source = doc.vatClose ? `VAT close (${doc.vatClose.number})` : doc.settlement ? `income tax settlement (${doc.settlement.number})` : `opening (${doc.opening?.number})`;
    if (doc.form === '1702Q' && !doc.opening) {
      // The books may have less than the return (income of the old books, the optional standard deduction): with a note.
      const noted = 'Add a note saying why the return says more (like income before the cut-over from the old books).';
      if (doc.amountCents > doc.payableCents && !doc.note) {
        add('error', 'amountCents', doc.payableCents === 0 ? 'NOTHING_DUE' : 'OVER', doc.payableCents === 0
          ? `The 1702Q worksheet leaves nothing to pay with ${what}. ${noted}`
          : `${formatPeso(doc.payableCents)} is left to pay with ${what} by the 1702Q worksheet, ${formatPeso(doc.amountCents - doc.payableCents)} less than this. ${noted}`);
      } else if (doc.amountCents > doc.payableCents) {
        add('warning', 'amountCents', 'OVER_NOTED', `This is ${formatPeso(doc.amountCents - doc.payableCents)} more than the 1702Q worksheet leaves to pay with ${what}; the note says why.`);
      } else if (doc.amountCents < doc.payableCents) {
        add('warning', 'amountCents', 'UNDER', `${formatPeso(doc.payableCents)} is left to pay with ${what}; ${formatPeso(doc.payableCents - doc.amountCents)} stays payable after this.`);
      }
    } else if (doc.form === '1702Q' && doc.amountCents > doc.payableCents) {
      add('error', 'amountCents', doc.payableCents === 0 ? 'NOTHING_DUE' : 'OVER', `${formatPeso(doc.payableCents)} is left to pay with ${what} by the ${source}. If the return says more, the accountant corrects the opening first.`);
    } else if (doc.form === '1702Q' && doc.amountCents < doc.payableCents) {
      add('warning', 'amountCents', 'UNDER', `${formatPeso(doc.payableCents)} is left to pay with ${what}; ${formatPeso(doc.payableCents - doc.amountCents)} stays payable after this.`);
    } else if (doc.payableCents === 0) {
      add('error', 'period', 'NOTHING_DUE', doc.form === '2550Q'
        ? `Nothing is left to pay with ${what}: its ${source} made no VAT payable, or it is all paid.`
        : doc.form === '1702' ? `Nothing is left to pay with ${what}: its ${source} left no income tax payable, or it is all paid.`
        : doc.form === '1601-FQ' ? `No final tax is left to pay with ${what}: no dividend declared in it withheld any, or it is all paid.`
        : `No EWT is left to pay with ${what}: none was withheld in it, or it is all paid.`);
    } else if (doc.amountCents > doc.payableCents) {
      const left = `${formatPeso(doc.payableCents)} is left to pay with ${what}, ${formatPeso(doc.amountCents - doc.payableCents)} less than this.`;
      add('error', 'amountCents', 'OVER', doc.form === '2550Q' || doc.form === '1702'
        ? `${left} Check the amount against the ${source}; if the return says more, the accountant corrects the books first.`
        : `${left} Find the difference first (a ${doc.form === '1601-FQ' ? 'dividend declaration' : 'bill or voucher'} not recorded yet); the accountant records any extra with a journal voucher.`);
    } else if (doc.amountCents < doc.payableCents) {
      add('warning', 'amountCents', 'UNDER', `${formatPeso(doc.payableCents)} is left to pay with ${what}; ${formatPeso(doc.payableCents - doc.amountCents)} stays payable after this.`);
    }

    const dueDate = doc.form === '2550Q' ? vatReturnDue(ctx.db, p.year, p.quarter) : returnDue(ctx.db, doc.form === '1702' ? '1702-RT' : doc.form, doc.period, p.to);
    if (dueDate && ctx.businessDate > dueDate && !doc.penaltyCents) {
      add('warning', 'penaltyCents', 'LATE', `The ${doc.form} for ${p.label} was due ${dueDate}. If the BIR charged a surcharge, interest or compromise penalty, enter it as the penalty.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    if (doc.form === '1601-FQ') {
      db.prepare(
        `INSERT INTO tax_final_tax_payments (document_id, period, cash_account_id, reference, payable_cents, amount_cents, penalty_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(h.documentId, doc.period, doc.cashPlaceId, doc.reference, doc.payableCents, doc.amountCents, doc.penaltyCents ?? 0, doc.note ?? null);
      return;
    }
    if (doc.form === '1702') {
      db.prepare(
        `INSERT INTO tax_income_tax_annual_payments (document_id, period, cash_account_id, reference, settlement_id, opening_id, payable_cents, amount_cents, penalty_cents, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(h.documentId, doc.period, doc.cashPlaceId, doc.reference, doc.settlement?.documentId ?? null, doc.settlement ? null : (doc.opening?.documentId ?? null),
        doc.payableCents, doc.amountCents, doc.penaltyCents ?? 0, doc.note ?? null);
      return;
    }
    if (doc.form === '1702Q') {
      db.prepare(
        `INSERT INTO tax_income_tax_payments (document_id, period, cash_account_id, reference, opening_id, payable_cents, amount_cents, penalty_cents, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(h.documentId, doc.period, doc.cashPlaceId, doc.reference, doc.opening?.documentId ?? null, doc.payableCents, doc.amountCents, doc.penaltyCents ?? 0, doc.note ?? null);
      return;
    }
    db.prepare(
      `INSERT INTO tax_bir_payments (document_id, form, period, cash_account_id, reference, vat_close_id, payable_cents, amount_cents, penalty_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.form, doc.period, doc.cashPlaceId, doc.reference, doc.vatClose?.documentId ?? doc.opening?.documentId ?? null, // a 2550Q with no close: its opening
      doc.payableCents, doc.amountCents, doc.penaltyCents ?? 0, doc.note ?? null,
    );
    const line = db.prepare('INSERT INTO tax_bir_payment_lines (document_id, party_id, payee_name, payable_cents, amount_cents) VALUES (?, ?, ?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.partyId, l.name, l.payableCents, l.amountCents);
  },

  journal(doc) {
    const tag = `${doc.form} for ${doc.periodLabel}`;
    const tax: DraftLine[] = doc.form === '1601-FQ'
      ? [{ account: { role: 'FINAL_TAX_PAYABLE' }, debitCents: doc.amountCents, memo: `Final tax withheld in ${doc.periodLabel} (1601-FQ)` }]
      : doc.form === '1702'
      ? [{ account: { role: 'INCOME_TAX_PAYABLE' }, debitCents: doc.amountCents, memo: `Income tax of ${doc.periodLabel} (1702)` }]
      : doc.form === '1702Q'
      ? [{ account: { role: doc.opening ? 'INCOME_TAX_PAYABLE' : 'PREPAID_INCOME_TAX' }, debitCents: doc.amountCents, memo: `Income tax of ${doc.periodLabel}, year to date (1702Q)` }]
      : doc.form === '2550Q'
      ? [{ account: { role: 'VAT_PAYABLE' }, debitCents: doc.amountCents, memo: `VAT of ${doc.periodLabel} (2550Q)` }]
      : doc.lines.map((l) => ({ account: { role: 'EWT_PAYABLE' }, party: { type: 'supplier', id: l.partyId }, debitCents: l.amountCents, memo: `EWT of ${doc.periodLabel} (${doc.form})` }));
    return {
      memo: `${BIR_FORM[doc.form].tax} paid to the BIR with the ${tag} (${doc.reference})`,
      lines: [
        ...tax,
        { account: { role: 'PENALTIES' }, debitCents: doc.penaltyCents ?? 0, memo: `Surcharge, interest and compromise on the ${tag}` },
        { account: { cashPlace: doc.cashPlaceId }, creditCents: doc.totalCents, memo: doc.reference },
      ],
    };
  },

  load(db, documentId) {
    const annual = loadAnnual(db, documentId) ?? loadFinalTax(db, documentId);
    if (annual) return annual;
    const it = loadIncomeTax(db, documentId);
    if (it) return it;
    const r = db
      .prepare(
        `SELECT p.*, c.number AS close_number, c.business_date AS close_date, c.doc_type AS close_type FROM tax_bir_payments p LEFT JOIN documents c ON c.id = p.vat_close_id
         WHERE p.document_id = ?`,
      )
      .get(documentId) as
      | { form: BirForm; period: string; cash_account_id: number; reference: string; vat_close_id: string | null; payable_cents: number; amount_cents: number;
          penalty_cents: number; note: string | null; close_number: string | null; close_date: string | null; close_type: string | null }
      | undefined;
    if (!r) throw new Error(`BIR payment ${documentId} not found`);
    const lines = db
      .prepare('SELECT party_id AS partyId, payee_name AS name, payable_cents AS payableCents, amount_cents AS amountCents FROM tax_bir_payment_lines WHERE document_id = ? ORDER BY rowid')
      .all(documentId) as BirPaymentLine[];
    return {
      form: r.form, period: r.period, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.penalty_cents ? { penaltyCents: r.penalty_cents } : {}),
      reference: r.reference, ...(r.note ? { note: r.note } : {}),
      periodLabel: parsePeriod(r.period)!.label, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?',
      vatClose: r.vat_close_id && r.close_type !== OPENING_PAYABLE ? { documentId: r.vat_close_id, number: r.close_number!, date: r.close_date! } : null,
      // Stands while this payment does (its cancel waits for this one), and a return is opened once.
      opening: r.form === '2550Q' ? (openingsOf(db, [['2550Q', r.period]]).map(({ documentId, number, date }) => ({ documentId, number, date }))[0] ?? null) : null,
      settlement: null, payableCents: r.payable_cents, lines, totalCents: r.amount_cents + r.penalty_cents,
    };
  },

  toInput(doc) {
    const { form, period, cashPlaceId, amountCents, penaltyCents, reference, note } = doc;
    return { form, period, cashPlaceId, amountCents, ...(penaltyCents ? { penaltyCents } : {}), reference, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const n = doc.lines.length;
    const who = doc.form === '2550Q' || doc.form === '1702Q' || doc.form === '1702' || doc.form === '1601-FQ' ? '' : `, for ${n} ${n === 1 ? 'payee' : 'payees'}`;
    const left = doc.payableCents - doc.amountCents;
    const penalty = doc.penaltyCents ? `, plus ${formatPeso(doc.penaltyCents)} surcharge, interest and compromise (${formatPeso(doc.totalCents)} in all)` : '';
    return `This will record ${formatPeso(doc.amountCents)} ${BIR_FORM[doc.form].tax} paid to the BIR with the ${doc.form} for ${doc.periodLabel} (${doc.reference}) from ${doc.cashPlaceName}${who}${penalty}.${left > 0 ? ` ${formatPeso(left)} stays payable.` : ''}`;
  },

  /** A return with something left to pay, paid in full or in part from one cash place, sometimes with a penalty. */
  arbitrary(db) {
    const due = periodsDue(db);
    if (!due.length) throw new Error('Nothing to pay the BIR');
    const places = listCashPlaces(db).map((c) => c.id);
    return fc
      .record({
        d: fc.constantFrom(...due), cashPlaceId: fc.constantFrom(...places), part: fc.boolean(), ref: fc.integer({ min: 100_000, max: 999_999 }),
        penaltyCents: fc.option(fc.integer({ min: 1, max: 500_000 }), { nil: undefined }),
      })
      .chain(({ d, cashPlaceId, part, ref, penaltyCents }) =>
        (part ? fc.integer({ min: 1, max: d.payableCents }) : fc.constant(d.payableCents)).map((amountCents) => ({
          form: d.form, period: d.period, cashPlaceId, amountCents, ...(penaltyCents ? { penaltyCents } : {}), reference: `eFPS ${ref}`,
        })),
      );
  },
};
