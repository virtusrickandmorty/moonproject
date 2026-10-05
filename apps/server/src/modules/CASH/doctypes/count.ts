/**
 * Cash Count (CNT-, PLAN D5 CASH-COUNT, E10, golden G-18): the bills and coins counted in one cash box, against the
 * box's ledger balance when the count is recorded. The difference posts to cash short and over.
 *   short: Dr 6280 cash short and over / Cr cash box        over: Dr cash box / Cr 6280
 * A count that matches the ledger records the count and posts nothing. Cancel mirrors the difference.
 * The ledger balance is read again when the count is recorded, so the form sends back the ledger version its first preview
 * gave (`ledgerVersion`, a fingerprint of the box's newest journal line, never an amount): when money moved in or out of
 * the box since, the count is refused (LEDGER_MOVED) instead of posting a different short or over than the one shown.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { listPlaces, place, seesBalance } from '../places.ts';

/** Philippine bills and coins, in centavos. */
export const DENOMINATIONS = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 100, 25, 5, 1] as const;
const BIG_DIFFERENCE_CENTS = 100_000; // ₱1,000: warn and ask for a recount

export const countInput = z
  .object({
    cashPlaceId: z.number().int().positive(),
    lines: z
      .array(z.object({ denominationCents: z.number().int().refine((d) => (DENOMINATIONS as readonly number[]).includes(d), 'Pick a bill or coin.'), qty: z.number().int().min(1).max(100_000) }).strict())
      .max(DENOMINATIONS.length),
    note: z.string().trim().min(1).max(500).optional(),
    ledgerVersion: z.string().trim().min(1).max(80).optional(), // from the preview the count started with
  })
  .strict();
export type CountInput = z.infer<typeof countInput>;

export interface Count extends CountInput {
  placeName: string;
  countedCents: number;
  ledgerCents: number;
  differenceCents: number;
  totalCents: number;
  /** The box's ledger version now (null for someone who may not see its balance). */
  ledgerVersionNow: string | null;
}

/** A fingerprint of the newest journal line on a cash box: it changes whenever money moves in or out, and tells no amount. */
export function ledgerVersion(db: Db, accountId: number): string {
  const last = db.prepare('SELECT MAX(id) FROM journal_lines WHERE account_id = ?').pluck().get(accountId) as number | null;
  return createHash('sha256').update(`cash.count:${accountId}:${last ?? 0}`).digest('hex').slice(0, 16);
}

export const countDoc: DocTypeDef<CountInput, Count> = {
  key: 'cash.count',
  module: 'CASH',
  title: 'Cash Count',
  numbering: { series: { key: 'CNT', prefix: 'CNT-' } },
  permissions: { view: 'cash.count.view', create: 'cash.count.create', post: 'cash.count.post', cancel: 'cash.count.cancel' },
  dating: 'system',
  inputSchema: countInput,

  compute(input, ctx) {
    const lines = [...input.lines].sort((a, b) => b.denominationCents - a.denominationCents);
    const countedCents = lines.reduce((s, l) => s + l.denominationCents * l.qty, 0);
    const p = place(ctx.db, input.cashPlaceId);
    // Someone who may not see this box's balance never gets it back from a preview; validate refuses their count anyway.
    const sees = p !== undefined && seesBalance(p, ctx.can);
    const ledgerCents = sees ? accountBalance(ctx.db, p.id) : 0;
    const ledgerVersionNow = sees ? ledgerVersion(ctx.db, p.id) : null;
    return { ...input, lines, placeName: p?.name ?? '?', countedCents, ledgerCents, differenceCents: countedCents - ledgerCents, totalCents: countedCents, ledgerVersionNow };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const p = place(ctx.db, doc.cashPlaceId);
    if (!p?.isActive || p.kind !== 'cash') error('cashPlaceId', 'CASH_PLACE', 'Pick the cash box you counted (cash on hand or petty cash).');
    else if (!seesBalance(p, ctx.can)) error('cashPlaceId', 'NOT_ALLOWED', `Only the accountant or an owner counts ${p.name}.`);
    if (new Set(doc.lines.map((l) => l.denominationCents)).size !== doc.lines.length) error('lines', 'DUPLICATE', 'Each bill or coin goes on one line.');
    if (issues.length === 0 && doc.ledgerVersion !== undefined && doc.ledgerVersion !== doc.ledgerVersionNow) {
      error('ledgerVersion', 'LEDGER_MOVED', 'Money moved since you started the count. Check and save again.');
    }
    if (issues.length === 0 && Math.abs(doc.differenceCents) >= BIG_DIFFERENCE_CENTS) {
      issues.push({ field: 'lines', code: 'BIG_DIFFERENCE', level: 'warning', message: `The count is ${formatPeso(Math.abs(doc.differenceCents))} ${doc.differenceCents < 0 ? 'short' : 'over'}. Please count again before recording.` });
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO cash_counts (document_id, cash_account_id, counted_cents, ledger_cents, difference_cents, note) VALUES (?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.cashPlaceId, doc.countedCents, doc.ledgerCents, doc.differenceCents, doc.note ?? null,
    );
    const line = db.prepare('INSERT INTO cash_count_lines (document_id, denomination_cents, qty) VALUES (?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.denominationCents, l.qty);
  },

  journal(doc) {
    if (doc.differenceCents === 0) return null;
    const d = Math.abs(doc.differenceCents);
    const box = { account: { cashPlace: doc.cashPlaceId } };
    const shortOver = { account: { role: 'CASH_SHORT_OVER' }, memo: `Counted ${formatPeso(doc.countedCents)}, ledger ${formatPeso(doc.ledgerCents)}` };
    return {
      memo: `Cash count of ${doc.placeName}: ${formatPeso(d)} ${doc.differenceCents < 0 ? 'short' : 'over'}`,
      lines: doc.differenceCents < 0 ? [{ ...shortOver, debitCents: d }, { ...box, creditCents: d }] : [{ ...box, debitCents: d }, { ...shortOver, creditCents: d }],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM cash_counts WHERE document_id = ?').get(documentId) as
      | { cash_account_id: number; counted_cents: number; ledger_cents: number; difference_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Cash count ${documentId} not found`);
    const lines = db.prepare('SELECT denomination_cents AS denominationCents, qty FROM cash_count_lines WHERE document_id = ? ORDER BY denomination_cents DESC').all(documentId) as CountInput['lines'];
    return {
      cashPlaceId: r.cash_account_id, lines, ...(r.note ? { note: r.note } : {}), placeName: place(db, r.cash_account_id)?.name ?? '?',
      countedCents: r.counted_cents, ledgerCents: r.ledger_cents, differenceCents: r.difference_cents, totalCents: r.counted_cents, ledgerVersionNow: null,
    };
  },

  toInput: ({ cashPlaceId, lines, note }) => ({ cashPlaceId, lines: lines.map(({ denominationCents, qty }) => ({ denominationCents, qty })), ...(note ? { note } : {}) }),

  summary(doc, ctx) {
    // The summary is stored and listed to everyone who views counts, so a hidden box's ledger figure stays out of it.
    const p = place(ctx.db, doc.cashPlaceId);
    const counted = `This will record a count of ${formatPeso(doc.countedCents)} in ${doc.placeName}`;
    if (!p?.encoderSeesBalance) return `${counted}. Any difference from the ledger posts to cash short and over.`;
    if (doc.differenceCents === 0) return `${counted}. It matches the ledger.`;
    return `${counted} against ${formatPeso(doc.ledgerCents)} in the ledger: ${formatPeso(Math.abs(doc.differenceCents))} ${doc.differenceCents < 0 ? 'short' : 'over'}, posted to cash short and over.`;
  },

  arbitrary(db) {
    const boxes = listPlaces(db, false).filter((p) => p.kind === 'cash').map((p) => p.id);
    const line = fc.record({ denominationCents: fc.constantFrom(...DENOMINATIONS), qty: fc.integer({ min: 1, max: 200 }) });
    return fc
      .record({ cashPlaceId: fc.constantFrom(...boxes), lines: fc.uniqueArray(line, { selector: (l) => l.denominationCents, maxLength: 6 }), note: fc.constantFrom(undefined, 'End-of-day count') })
      .map(({ note, ...r }) => ({ ...r, ...(note ? { note } : {}) }));
  },
};
