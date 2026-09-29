/**
 * Remittance (REM-, PLAN D5 STAT-REM, E11): paying SSS, PhilHealth, Pag-IBIG or the BIR (1601-C) what the payrolls of
 * one contribution month left payable, with the PRN, payment reference or receipt number. Dated the day paid: today, or
 * earlier by someone who may backdate (acc.backdate), since bank and online payments are often seen days later and the
 * cash book should show the day the money left (STAT-1).
 *   Dr 2401 SSS / 2402 PhilHealth / 2403 Pag-IBIG / 2310 withholding tax (per employee, month M); Dr 2404 SSS loans /
 *   2405 Pag-IBIG loans (per employee, month M); Dr 6290 late-payment penalty (optional) / Cr cash place (all)
 * An SSS or Pag-IBIG remittance pays the month's contributions and loan amortizations of that agency together, and the
 * variance check covers both.
 * The variance check compares the amount paid with the month's payable (ledger.ts): the same amount clears every
 * employee's share; less is a partial payment, spread over the employees in proportion, and the rest stays payable;
 * more is refused, since the payrolls do not show it. A month remitted more than its payrolls now show (a run cancelled
 * after remittance, D6) is warned about. A penalty is paid on top: it is no one's payable, so it never enters the check
 * or the employees' lines. Cancel mirrors it.
 * Withholding tax and year-end tax refunds (K23, BIR RR 11-2018): the month's tax to remit is the net, tax withheld less
 * the year-end refunds of its runs (ledger.ts wtaxPosition), and never more. The journal debits 2310 for each employee
 * still owing and credits it for each employee's refund, so after a full payment every employee's 2310 for the month is
 * zero and the cash paid is the net. When an earlier month's refunds were more than its tax (it had nothing to remit),
 * the excess is taken off this remittance (ledger.ts carriedInto) and it settles that month too:
 *   Dr 2310 (per employee still owing, month M and the earlier month) / Cr 2310 (per year-end refund, both months) /
 *   Dr 6290 penalty (optional) / Cr cash place (the net, plus any penalty)
 * The refunds and the earlier month's lines are kept per month settled (stat_remittance_adjustments). A partial payment
 * takes every refund and the earlier month off in full and spreads the rest over this month's employees still owing.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { employee } from '../../EMP/public.ts';
import { SCHEME, SCHEMES, carriedInto, dueOf, isMonth, payableByPart, statMonths, wtaxPosition, type Scheme } from '../ledger.ts';

const MAX_CENTS = 100_000_000_00;
export const remittanceInput = z
  .object({
    scheme: z.enum(SCHEMES),
    month: z.string().refine(isMonth, 'Use a month like 2026-09.'), // the contribution month paid for, not the document's date
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // what clears the month's payable
    penaltyCents: z.number().int().positive().max(MAX_CENTS).optional(), // late-payment penalty paid with it (6290)
    reference: z.string().trim().min(3).max(60), // PRN, payment reference or receipt number
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type RemittanceInput = z.infer<typeof remittanceInput>;
/** Per employee: the payable and the amount paid, in total and their loan part (SSS and Pag-IBIG loans). */
export interface RemittanceLine { employeeId: string; name: string; payableCents: number; amountCents: number; loanPayableCents: number; loanAmountCents: number }
/**
 * Withholding tax only: a year-end tax refund taken off (credit) of this month or an earlier one, or an earlier month's
 * tax still owing settled with it (debit), per employee and month settled (stat_remittance_adjustments).
 */
export interface RemittanceAdjustment { month: string; employeeId: string; name: string; debitCents: number; creditCents: number }
export interface Remittance extends RemittanceInput {
  label: string; cashPlaceName: string;
  /** What the month left to remit when recorded; for the withholding tax, the net of year-end refunds (zero or less: nothing to remit). */
  payableCents: number;
  lines: RemittanceLine[]; adjustments: RemittanceAdjustment[]; totalCents: number;
}

const byName = (a: { name: string; employeeId: string }, b: { name: string; employeeId: string }) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId);

/** Who still has something payable for the month, and what the amount paid clears for each (in proportion if less). */
function linesFor(db: Db, scheme: Scheme, month: string, amountCents: number): { payableCents: number; lines: RemittanceLine[]; adjustments: RemittanceAdjustment[] } {
  if (scheme === 'WTAX') return wtaxLinesFor(db, month, amountCents);
  // Each employee's contributions and loans are payables of their own; less than the whole is spread over all of them.
  const owed = payableByPart(db, scheme, month)
    .filter((p) => p.cents > 0)
    .map((p) => ({ ...p, name: employee(db, p.employeeId)?.name ?? '?' }))
    .sort((a, b) => byName(a, b) || (a.part === 'contribution' ? -1 : 1));
  const payableCents = owed.reduce((s, o) => s + o.cents, 0);
  const paid = payableCents > 0 && amountCents <= payableCents ? allocate(amountCents, owed.map((o) => o.cents)) : owed.map((o) => o.cents);
  const lines = new Map<string, RemittanceLine>();
  owed.forEach((o, i) => {
    const l = lines.get(o.employeeId) ?? { employeeId: o.employeeId, name: o.name, payableCents: 0, amountCents: 0, loanPayableCents: 0, loanAmountCents: 0 };
    const loan = o.part === 'loan';
    lines.set(o.employeeId, {
      ...l, payableCents: l.payableCents + o.cents, amountCents: l.amountCents + paid[i]!,
      loanPayableCents: l.loanPayableCents + (loan ? o.cents : 0), loanAmountCents: l.loanAmountCents + (loan ? paid[i]! : 0),
    });
  });
  return { payableCents, lines: [...lines.values()].filter((l) => l.amountCents > 0), adjustments: [] };
}

/**
 * The withholding tax: the net of this month (employees still owing less year-end refunds) and of the earlier months
 * carried into it. Refunds and the earlier months are taken in full; the amount paid plus them is spread over this
 * month's employees still owing (all of it when paid in full).
 */
function wtaxLinesFor(db: Db, month: string, amountCents: number): { payableCents: number; lines: RemittanceLine[]; adjustments: RemittanceAdjustment[] } {
  const own = wtaxPosition(db, month);
  const carried = carriedInto(db, month);
  const name = (id: string) => employee(db, id)?.name ?? '?';
  const owed = own.rows.filter((r) => r.cents > 0).map((r) => ({ employeeId: r.employeeId, name: name(r.employeeId), cents: r.cents })).sort(byName);
  const payableCents = own.dueCents + carried.cents;
  const debits = amountCents + own.refundCents - carried.cents; // what this month's employees still owing are paid
  const paid = payableCents > 0 && amountCents <= payableCents ? allocate(debits, owed.map((o) => o.cents)) : owed.map((o) => o.cents);
  const settle = (p: typeof own, withOwing: boolean) =>
    p.rows
      .flatMap((r): RemittanceAdjustment[] => [
        ...(withOwing && r.cents > 0 ? [{ month: p.month, employeeId: r.employeeId, name: name(r.employeeId), debitCents: r.cents, creditCents: 0 }] : []),
        ...(r.refundCents > 0 ? [{ month: p.month, employeeId: r.employeeId, name: name(r.employeeId), debitCents: 0, creditCents: r.refundCents }] : []),
      ])
      .sort(byName);
  return {
    payableCents,
    lines: owed.map((o, i) => ({ employeeId: o.employeeId, name: o.name, payableCents: o.cents, amountCents: paid[i]!, loanPayableCents: 0, loanAmountCents: 0 })).filter((l) => l.amountCents > 0),
    adjustments: [...carried.months.flatMap((p) => settle(p, true)), ...settle(own, false)],
  };
}

/** The tax withheld the withholding-tax remittance pays (its debits) and the year-end refunds it takes off (its credits). */
function refundsOf(doc: Remittance): { taxCents: number; refundCents: number } {
  const refundCents = doc.adjustments.reduce((s, a) => s + a.creditCents, 0);
  return { taxCents: doc.payableCents + refundCents, refundCents };
}
/** The earlier months this remittance settles (their refunds were more than their tax). */
const carriedFrom = (doc: Remittance) => [...new Set(doc.adjustments.map((a) => a.month).filter((m) => m !== doc.month))].sort();

export const remittanceDoc: DocTypeDef<RemittanceInput, Remittance> = {
  key: 'stat.remittance',
  module: 'STAT',
  title: 'Remittance',
  numbering: { series: { key: 'REM', prefix: 'REM-' } },
  permissions: { view: 'stat.rem.view', create: 'stat.rem.post', post: 'stat.rem.post', cancel: 'stat.rem.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: remittanceInput,

  compute(input, ctx) {
    return {
      ...input, label: SCHEME[input.scheme].label, cashPlaceName: getCashPlace(ctx.db, input.cashPlaceId)?.name ?? '?',
      ...linesFor(ctx.db, input.scheme, input.month, input.amountCents), totalCents: input.amountCents + (input.penaltyCents ?? 0),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick where the money came from.');
    if (doc.month > ctx.businessDate.slice(0, 7)) add('error', 'month', 'MONTH', `${doc.month} has not started yet.`);
    const what = `${doc.label} for ${doc.month}`;
    const { taxCents, refundCents } = refundsOf(doc);
    // The withholding tax is remitted net of year-end tax refunds: say so wherever the payable is named.
    const net = refundCents > 0 ? ` (${formatPeso(taxCents)} of tax withheld less ${formatPeso(refundCents)} of year-end tax refunds)` : '';
    if (doc.payableCents <= 0 && refundCents > 0) {
      const excess = doc.payableCents < 0 ? ` The ${formatPeso(-doc.payableCents)} of refunds above the tax is taken off the next month's withholding-tax remittance.` : '';
      add('error', 'month', 'NOTHING_DUE', `Nothing is left to remit for ${doc.month}: its year-end tax refunds still to take off (${formatPeso(refundCents)}) are ${doc.payableCents < 0 ? 'more than' : 'the same as'} the tax withheld still to remit (${formatPeso(taxCents)}).${excess}`);
    } else if (doc.payableCents <= 0) add('error', 'month', 'NOTHING_DUE', `Nothing is payable to ${what}: no payroll of that month is recorded, or it is all remitted.`);
    else if (doc.amountCents > doc.payableCents) {
      add('error', 'amountCents', 'OVER', `The payrolls of ${doc.month} left ${formatPeso(doc.payableCents)} payable to ${doc.label}${net}, ${formatPeso(doc.amountCents - doc.payableCents)} less than this. Find the difference first (a payroll not recorded yet, or shares the pay could not cover); the accountant records any extra with a journal voucher.`);
    } else if (doc.amountCents < doc.payableCents) {
      add('warning', 'amountCents', 'UNDER', `The payrolls of ${doc.month} left ${formatPeso(doc.payableCents)} payable to ${doc.label}${net}; ${formatPeso(doc.payableCents - doc.amountCents)} stays payable after this.`);
    }
    // D6: shares of the month remitted already that the payrolls no longer show (a run cancelled after remittance). A
    // withholding-tax negative that is a year-end refund is not one: it is taken off above.
    const over = (doc.scheme === 'WTAX'
      ? wtaxPosition(ctx.db, doc.month).rows.map((r) => ({ employeeId: r.employeeId, part: 'contribution', cents: -r.overCents }))
      : payableByPart(ctx.db, doc.scheme, doc.month))
      .filter((p) => p.cents < 0)
      .map((p) => `${employee(ctx.db, p.employeeId)?.name ?? '?'}${p.part === 'loan' ? ' (loan)' : ''} ${formatPeso(-p.cents)}`);
    if (over.length) {
      const who = over.sort().join(', ');
      add('warning', 'month', 'OVER_REMITTED', `${what} was remitted for more than the payrolls now show (${who}): a payroll was cancelled after it was remitted. Redo that payroll, or tell the accountant.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO stat_remittances (document_id, scheme, month, cash_account_id, reference, payable_cents, amount_cents, penalty_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.scheme, doc.month, doc.cashPlaceId, doc.reference, doc.payableCents, doc.amountCents, doc.penaltyCents ?? 0, doc.note ?? null,
    );
    const line = db.prepare(
      'INSERT INTO stat_remittance_lines (document_id, employee_id, employee_name, payable_cents, amount_cents, loan_payable_cents, loan_amount_cents) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const l of doc.lines) line.run(h.documentId, l.employeeId, l.name, l.payableCents, l.amountCents, l.loanPayableCents, l.loanAmountCents);
    const adjustment = db.prepare('INSERT INTO stat_remittance_adjustments (document_id, month, employee_id, employee_name, debit_cents, credit_cents) VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of doc.adjustments) adjustment.run(h.documentId, a.month, a.employeeId, a.name, a.debitCents, a.creditCents);
  },

  journal(doc) {
    const s = SCHEME[doc.scheme];
    const tag = `${s.tag} ${doc.month}`;
    return {
      memo: `${doc.label} remittance for ${doc.month} (${doc.reference})`,
      lines: [
        ...doc.lines.flatMap((l) => [
          { account: { role: s.role }, party: { type: 'employee', id: l.employeeId }, debitCents: l.amountCents - l.loanAmountCents, memo: tag },
          ...(s.loan && l.loanAmountCents > 0 ? [{ account: { role: s.loan.role }, party: { type: 'employee', id: l.employeeId }, debitCents: l.loanAmountCents, memo: `${s.loan.tag} ${doc.month}` }] : []),
        ]),
        // Withholding tax: the year-end refunds taken off, and an earlier month carried into this one.
        ...doc.adjustments.map((a) => ({
          account: { role: s.role }, party: { type: 'employee', id: a.employeeId }, debitCents: a.debitCents, creditCents: a.creditCents,
          memo: a.creditCents > 0 ? `Year-end tax refund ${a.month}` : `${s.tag} ${a.month}`,
        })),
        { account: { role: 'PENALTIES' }, debitCents: doc.penaltyCents ?? 0, memo: `Late payment, ${tag}` },
        { account: { cashPlace: doc.cashPlaceId }, creditCents: doc.totalCents, memo: doc.reference },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM stat_remittances WHERE document_id = ?').get(documentId) as
      | { scheme: Scheme; month: string; cash_account_id: number; reference: string; payable_cents: number; amount_cents: number; penalty_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Remittance ${documentId} not found`);
    const lines = db
      .prepare(
        `SELECT employee_id AS employeeId, employee_name AS name, payable_cents AS payableCents, amount_cents AS amountCents, loan_payable_cents AS loanPayableCents,
           loan_amount_cents AS loanAmountCents FROM stat_remittance_lines WHERE document_id = ? ORDER BY rowid`,
      )
      .all(documentId) as RemittanceLine[];
    const adjustments = db
      .prepare(`SELECT month, employee_id AS employeeId, employee_name AS name, debit_cents AS debitCents, credit_cents AS creditCents FROM stat_remittance_adjustments WHERE document_id = ? ORDER BY rowid`)
      .all(documentId) as RemittanceAdjustment[];
    return {
      scheme: r.scheme, month: r.month, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.penalty_cents ? { penaltyCents: r.penalty_cents } : {}),
      reference: r.reference, ...(r.note ? { note: r.note } : {}),
      label: SCHEME[r.scheme].label, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?', payableCents: r.payable_cents, lines, adjustments, totalCents: r.amount_cents + r.penalty_cents,
    };
  },

  toInput(doc) {
    const { scheme, month, cashPlaceId, amountCents, penaltyCents, reference, note } = doc;
    return { scheme, month, cashPlaceId, amountCents, ...(penaltyCents ? { penaltyCents } : {}), reference, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const n = doc.lines.length;
    const left = doc.payableCents - doc.amountCents;
    const penalty = doc.penaltyCents ? `, plus ${formatPeso(doc.penaltyCents)} late-payment penalty (${formatPeso(doc.totalCents)} in all)` : '';
    const loans = doc.lines.reduce((s, l) => s + l.loanAmountCents, 0);
    const of = loans > 0 ? ` (${formatPeso(doc.amountCents - loans)} contributions and ${formatPeso(loans)} loans)` : '';
    const { taxCents, refundCents } = refundsOf(doc);
    const earlier = carriedFrom(doc);
    const refunds = refundCents > 0 ? `: ${formatPeso(taxCents)} of tax withheld less ${formatPeso(refundCents)} of year-end tax refunds${earlier.length ? `, with ${earlier.join(' and ')} (its refunds were more than its tax)` : ''}` : '';
    return `This will record ${formatPeso(doc.amountCents)} paid to ${doc.label} for ${doc.month}${of} (${doc.reference}) from ${doc.cashPlaceName}, for ${n} ${n === 1 ? 'employee' : 'employees'}${refunds}${penalty}.${left > 0 ? ` ${formatPeso(left)} stays payable.` : ''}`;
  },

  /** A scheme and month with something payable, paid in full or in part from one cash place, sometimes with a penalty. */
  arbitrary(db) {
    const due = statMonths(db).flatMap((month) =>
      SCHEMES.map((scheme) => ({ scheme, month, payable: dueOf(db, scheme, month) })).filter((x) => x.payable > 0),
    );
    if (!due.length) throw new Error('Nothing to remit');
    const places = listCashPlaces(db).map((c) => c.id);
    return fc
      .record({
        d: fc.constantFrom(...due), cashPlaceId: fc.constantFrom(...places), part: fc.boolean(), prn: fc.integer({ min: 100_000, max: 999_999 }),
        penaltyCents: fc.option(fc.integer({ min: 1, max: 500_000 }), { nil: undefined }),
      })
      .chain(({ d, cashPlaceId, part, prn, penaltyCents }) =>
        (part ? fc.integer({ min: 1, max: d.payable }) : fc.constant(d.payable)).map((amountCents) => ({
          scheme: d.scheme, month: d.month, cashPlaceId, amountCents, ...(penaltyCents ? { penaltyCents } : {}), reference: `PRN ${prn}`,
        })),
      );
  },
};
