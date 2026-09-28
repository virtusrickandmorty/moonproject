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
import { returnDue, vatReturnDue } from '../calendar.ts';
import { OPENING_PAYABLE, openingsOf } from '../opening-payables.ts';
import { BIR_FORM, BIR_FORMS, birPaymentsOf, ewtDue, ewtPaidWith, parsePeriod, periodsDue, quarterPeriod, vatDue, type BirForm, type Period } from '../payments.ts';

const MAX_CENTS = 100_000_000_00;
export const birPaymentInput = z
  .object({
    form: z.enum(BIR_FORMS),
    period: z.string().refine((p) => parsePeriod(p) !== null, 'Use a quarter like 2026-Q3, or a month like 2026-07 for a 0619-E.'), // what the return covers, not the day paid
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
  /** 2550Q of a quarter before the cut-over date: the opening tax payable whose 2550Q it pays. */
  opening: { documentId: string; number: string; date: string } | null;
  payableCents: number;
  /** 0619-E and 1601-EQ: what it clears per payee. */
  lines: BirPaymentLine[];
  totalCents: number;
}

/** The period, if it is the kind the form pays (a month for a 0619-E, a quarter for the others). */
function periodFor(form: BirForm, period: string): Period | null {
  const p = parsePeriod(period);
  return p && p.kind === BIR_FORM[form].period ? p : null;
}
const thirdMonth = (form: BirForm, p: Period) => form === '0619-E' && p.month! % 3 === 0;

/** What the period leaves to pay, and for EWT what the amount clears per payee (in proportion if less). */
function due(db: Db, input: BirPaymentInput, p: Period | null): Pick<BirPayment, 'vatClose' | 'opening' | 'payableCents' | 'lines'> {
  if (!p || thirdMonth(input.form, p)) return { vatClose: null, opening: null, payableCents: 0, lines: [] };
  if (input.form === '2550Q') {
    const v = vatDue(db, p.year, p.quarter);
    return { vatClose: v.close, opening: v.opening, payableCents: Math.max(v.dueCents, 0), lines: [] };
  }
  const owed = ewtDue(db, input.form, input.period, p).filter((d) => d.dueCents > 0);
  const payableCents = owed.reduce((s, d) => s + d.dueCents, 0);
  const paid = payableCents > 0 && input.amountCents <= payableCents ? allocate(input.amountCents, owed.map((d) => d.dueCents)) : owed.map((d) => d.dueCents);
  return {
    vatClose: null, opening: null, payableCents,
    lines: owed.map((d, i) => ({ partyId: d.partyId, name: d.name, payableCents: d.dueCents, amountCents: paid[i]! })).filter((l) => l.amountCents > 0),
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
      add('error', 'period', 'PERIOD', doc.form === '0619-E' ? 'A 0619-E pays one month: pick a month like 2026-07.' : `A ${doc.form} pays one quarter: pick a quarter like 2026-Q3.`);
      return issues;
    }
    if (thirdMonth(doc.form, p)) {
      add('error', 'period', 'THIRD_MONTH', `${p.label} is the last month of Q${p.quarter} ${p.year}, which has no 0619-E: its EWT is paid with the 1601-EQ for the quarter.`);
      return issues;
    }
    if (ctx.businessDate < p.from) add('error', 'period', 'PERIOD_AHEAD', `${p.label} had not started on ${ctx.businessDate}.`);
    const what = `the ${doc.form} for ${p.label}`;

    const beforeOpening = (o: { number: string; date: string } | undefined | null) => {
      if (o && ctx.businessDate < o.date) {
        add('error', 'period', 'BEFORE_OPENING', `The ${doc.form} for ${p.label} came in with the opening (${o.number}) on the cut-over date, ${o.date}. Date the payment on that day or later: one paid before it belongs in the old books.`);
      }
    };
    if (doc.form === '2550Q') {
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

    const source = doc.vatClose ? `VAT close (${doc.vatClose.number})` : `opening (${doc.opening?.number})`;
    if (doc.payableCents === 0) {
      add('error', 'period', 'NOTHING_DUE', doc.form === '2550Q'
        ? `Nothing is left to pay with ${what}: its ${source} made no VAT payable, or it is all paid.`
        : `No EWT is left to pay with ${what}: none was withheld in it, or it is all paid.`);
    } else if (doc.amountCents > doc.payableCents) {
      const left = `${formatPeso(doc.payableCents)} is left to pay with ${what}, ${formatPeso(doc.amountCents - doc.payableCents)} less than this.`;
      add('error', 'amountCents', 'OVER', doc.form === '2550Q'
        ? `${left} Check the amount against the ${source}; if the return says more, the accountant corrects the books first.`
        : `${left} Find the difference first (a bill or voucher not recorded yet); the accountant records any extra with a journal voucher.`);
    } else if (doc.amountCents < doc.payableCents) {
      add('warning', 'amountCents', 'UNDER', `${formatPeso(doc.payableCents)} is left to pay with ${what}; ${formatPeso(doc.payableCents - doc.amountCents)} stays payable after this.`);
    }

    const dueDate = doc.form === '2550Q' ? vatReturnDue(ctx.db, p.year, p.quarter) : returnDue(ctx.db, doc.form, doc.period, p.to);
    if (dueDate && ctx.businessDate > dueDate && !doc.penaltyCents) {
      add('warning', 'penaltyCents', 'LATE', `The ${doc.form} for ${p.label} was due ${dueDate}. If the BIR charged a surcharge, interest or compromise penalty, enter it as the penalty.`);
    }
    return issues;
  },

  persist(db, doc, h) {
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
    const tax: DraftLine[] = doc.form === '2550Q'
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
      payableCents: r.payable_cents, lines, totalCents: r.amount_cents + r.penalty_cents,
    };
  },

  toInput(doc) {
    const { form, period, cashPlaceId, amountCents, penaltyCents, reference, note } = doc;
    return { form, period, cashPlaceId, amountCents, ...(penaltyCents ? { penaltyCents } : {}), reference, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const n = doc.lines.length;
    const who = doc.form === '2550Q' ? '' : `, for ${n} ${n === 1 ? 'payee' : 'payees'}`;
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
