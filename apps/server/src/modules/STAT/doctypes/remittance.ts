/**
 * Remittance (REM-, PLAN D5 STAT-REM, E11): paying SSS, PhilHealth, Pag-IBIG or the BIR (1601-C) what the payrolls of
 * one contribution month left payable, with the PRN, payment reference or receipt number. Dated the day paid: today, or
 * earlier by someone who may backdate (acc.backdate), since bank and online payments are often seen days later and the
 * cash book should show the day the money left (STAT-1).
 *   Dr 2401 SSS / 2402 PhilHealth / 2403 Pag-IBIG / 2310 withholding tax (per employee, month M); Dr 6290 late-payment
 *   penalty (optional) / Cr cash place (both)
 * The variance check compares the amount paid with the month's payable (ledger.ts): the same amount clears every
 * employee's share; less is a partial payment, spread over the employees in proportion, and the rest stays payable;
 * more is refused, since the payrolls do not show it. A month remitted more than its payrolls now show (a run cancelled
 * after remittance, D6) is warned about. A penalty is paid on top: it is no one's payable, so it never enters the check
 * or the employees' lines. Cancel mirrors it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { employee } from '../../EMP/public.ts';
import { SCHEME, SCHEMES, isMonth, payableByEmployee, statMonths, type Scheme } from '../ledger.ts';

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
export interface RemittanceLine { employeeId: string; name: string; payableCents: number; amountCents: number }
export interface Remittance extends RemittanceInput { label: string; cashPlaceName: string; payableCents: number; lines: RemittanceLine[]; totalCents: number }

const byName = (a: { name: string; employeeId: string }, b: { name: string; employeeId: string }) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId);

/** Who still has something payable for the month, and what the amount paid clears for each (in proportion if less). */
function linesFor(db: Parameters<typeof payableByEmployee>[0], scheme: Scheme, month: string, amountCents: number): { payableCents: number; lines: RemittanceLine[] } {
  const owed = [...payableByEmployee(db, scheme, month)]
    .filter(([, c]) => c > 0)
    .map(([employeeId, payableCents]) => ({ employeeId, name: employee(db, employeeId)?.name ?? '?', payableCents }))
    .sort(byName);
  const payableCents = owed.reduce((s, o) => s + o.payableCents, 0);
  const paid = payableCents > 0 && amountCents <= payableCents ? allocate(amountCents, owed.map((o) => o.payableCents)) : owed.map((o) => o.payableCents);
  return { payableCents, lines: owed.map((o, i) => ({ ...o, amountCents: paid[i]! })).filter((l) => l.amountCents > 0) };
}

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
    if (doc.payableCents === 0) add('error', 'month', 'NOTHING_DUE', `Nothing is payable to ${what}: no payroll of that month is recorded, or it is all remitted.`);
    else if (doc.amountCents > doc.payableCents) {
      add('error', 'amountCents', 'OVER', `The payrolls of ${doc.month} left ${formatPeso(doc.payableCents)} payable to ${doc.label}, ${formatPeso(doc.amountCents - doc.payableCents)} less than this. Find the difference first (a payroll not recorded yet, or shares the pay could not cover); the accountant records any extra with a journal voucher.`);
    } else if (doc.amountCents < doc.payableCents) {
      add('warning', 'amountCents', 'UNDER', `The payrolls of ${doc.month} left ${formatPeso(doc.payableCents)} payable to ${doc.label}; ${formatPeso(doc.payableCents - doc.amountCents)} stays payable after this.`);
    }
    // D6: shares of the month remitted already that the payrolls no longer show (a run cancelled after remittance).
    const over = [...payableByEmployee(ctx.db, doc.scheme, doc.month)].filter(([, c]) => c < 0).map(([id, c]) => `${employee(ctx.db, id)?.name ?? '?'} ${formatPeso(-c)}`);
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
    const line = db.prepare('INSERT INTO stat_remittance_lines (document_id, employee_id, employee_name, payable_cents, amount_cents) VALUES (?, ?, ?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.employeeId, l.name, l.payableCents, l.amountCents);
  },

  journal(doc) {
    const tag = `${SCHEME[doc.scheme].tag} ${doc.month}`;
    return {
      memo: `${doc.label} remittance for ${doc.month} (${doc.reference})`,
      lines: [
        ...doc.lines.map((l) => ({ account: { role: SCHEME[doc.scheme].role }, party: { type: 'employee', id: l.employeeId }, debitCents: l.amountCents, memo: tag })),
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
      .prepare('SELECT employee_id AS employeeId, employee_name AS name, payable_cents AS payableCents, amount_cents AS amountCents FROM stat_remittance_lines WHERE document_id = ? ORDER BY rowid')
      .all(documentId) as RemittanceLine[];
    return {
      scheme: r.scheme, month: r.month, cashPlaceId: r.cash_account_id, amountCents: r.amount_cents, ...(r.penalty_cents ? { penaltyCents: r.penalty_cents } : {}),
      reference: r.reference, ...(r.note ? { note: r.note } : {}),
      label: SCHEME[r.scheme].label, cashPlaceName: getCashPlace(db, r.cash_account_id)?.name ?? '?', payableCents: r.payable_cents, lines, totalCents: r.amount_cents + r.penalty_cents,
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
    return `This will record ${formatPeso(doc.amountCents)} paid to ${doc.label} for ${doc.month} (${doc.reference}) from ${doc.cashPlaceName}, for ${n} ${n === 1 ? 'employee' : 'employees'}${penalty}.${left > 0 ? ` ${formatPeso(left)} stays payable.` : ''}`;
  },

  /** A scheme and month with something payable, paid in full or in part from one cash place, sometimes with a penalty. */
  arbitrary(db) {
    const due = statMonths(db).flatMap((month) =>
      SCHEMES.map((scheme) => ({ scheme, month, payable: [...payableByEmployee(db, scheme, month).values()].filter((c) => c > 0).reduce((s, c) => s + c, 0) })).filter((x) => x.payable > 0),
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
