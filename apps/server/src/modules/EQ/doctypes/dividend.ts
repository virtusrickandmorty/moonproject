/**
 * Dividend Declaration (DIV-, PLAN D5 DIV, E10): a cash dividend the board declared, recorded by the accountant with the
 * board resolution's number and date and the record date. Dated the declaration day (today, or earlier by someone who
 * may backdate), when the dividend becomes payable.
 *   The amount is per share or in total. It is split to each stockholder by the shares held at the end of the record
 *   date (people.ts holdingsOn): per share, shares × the amount; in total, in proportion to the shares by largest
 *   remainder (allocate), so the lines add up to the total exactly.
 *   Final tax: an individual stockholder (a resident citizen) has tax.dividend_final_tax_bp (10%) of their dividend
 *   withheld, rounded half away from zero per stockholder (NIRC Sec. 24(B)(2)); a domestic corporation none (Sec.
 *   27(D)(4)). It is paid to the BIR with the 1601-FQ of the declaration's quarter (TAX bir-payment.ts).
 *     Dr 3210 dividends declared (the total) / Cr 2503 dividends payable per stockholder (dividend − tax)
 *     / Cr 2312 final withholding tax payable (the tax of every stockholder)
 * Refused when the retained earnings on the declaration date (dividends.ts) are less than the total, with the figures.
 * A stockholder with no TIN on file is a warning: the 1601-FQ and 1604-F need it. Cancel mirrors it on its own date
 * (cancelOn), while no dividend payment or 1601-FQ payment stands on what it credited.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { settingAt } from '../../../engine/settings.ts';
import { dividendsPayable, holdingsOn, listPeople, person, type HolderKind } from '../people.ts';
import { retainedEarningsAt, type RetainedEarnings } from '../dividends.ts';
import { finalTaxDue } from '../../TAX/public.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
// format "date": the generic form picks it from a calendar.
const date = z.string().refine(isBusinessDate, 'Use a date like 2026-09-15.').meta({ format: 'date' });

export const dividendInput = z
  .object({
    resolutionNumber: z.string().trim().min(1).max(40), // the board resolution declaring the dividend
    resolutionDate: date,
    recordDate: date, // stockholders on the books at the end of this day get the dividend
    basis: z.enum(['per_share', 'total']),
    amountCents: z.number().int().positive().max(MAX_CENTS), // per share, or the whole dividend
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type DividendInput = z.infer<typeof dividendInput>;

export interface DividendLine { personId: string; name: string; tin: string | null; holderKind: HolderKind; shares: number; grossCents: number; taxCents: number; netCents: number }
export interface Dividend extends DividendInput {
  lines: DividendLine[];
  shares: number;
  taxRateBp: number;
  taxCents: number;
  /** The retained earnings on the declaration date before this declaration. */
  retained: RetainedEarnings;
  totalCents: number;
}

/** Splits the dividend over the holders: per share, or the total in proportion to the shares. */
export function splitDividend(input: Pick<DividendInput, 'basis' | 'amountCents'>, holdings: { shares: number }[]): number[] {
  if (input.basis === 'per_share') return holdings.map((h) => h.shares * input.amountCents);
  return holdings.length ? allocate(input.amountCents, holdings.map((h) => h.shares)) : [];
}

function build(input: DividendInput, taxRateBp: number, retained: RetainedEarnings, lines: DividendLine[]): Dividend {
  const sum = (k: 'grossCents' | 'taxCents' | 'shares') => lines.reduce((s, l) => s + l[k], 0);
  return { ...input, lines, shares: sum('shares'), taxRateBp, taxCents: sum('taxCents'), retained, totalCents: sum('grossCents') };
}

export const dividendDoc: DocTypeDef<DividendInput, Dividend> = {
  key: 'eq.dividend',
  module: 'EQ',
  title: 'Dividend Declaration',
  numbering: { series: { key: 'DIV', prefix: 'DIV-' } },
  permissions: { view: 'eq.div.view', create: 'eq.div.create', post: 'eq.div.post', cancel: 'eq.div.cancel' },
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: dividendInput,

  compute(input, ctx) {
    const taxRateBp = settingAt(ctx.db, 'tax.dividend_final_tax_bp', ctx.businessDate);
    // Only a record date that has ended can say who held the shares (validate refuses a later one).
    const holdings = input.recordDate <= ctx.at.slice(0, 10) ? holdingsOn(ctx.db, input.recordDate) : [];
    const gross = splitDividend(input, holdings);
    const lines = holdings
      .map((h, i): DividendLine => {
        const p = person(ctx.db, h.personId);
        const holderKind = p?.holderKind ?? 'individual';
        const grossCents = gross[i]!;
        const taxCents = holderKind === 'individual' ? applyRate(grossCents, taxRateBp) : 0;
        return { personId: h.personId, name: p?.name ?? '?', tin: p?.tin ?? null, holderKind, shares: h.shares, grossCents, taxCents, netCents: grossCents - taxCents };
      })
      .filter((l) => l.grossCents > 0);
    return build(input, taxRateBp, retainedEarningsAt(ctx.db, ctx.businessDate), lines);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const today = ctx.at.slice(0, 10);
    if (doc.resolutionDate > ctx.businessDate) add('error', 'resolutionDate', 'AFTER_DECLARATION', `The board resolution is dated ${doc.resolutionDate}, after the declaration date ${ctx.businessDate}. Date the declaration on the resolution's day or later.`);
    if (doc.recordDate < doc.resolutionDate) add('error', 'recordDate', 'RECORD_BEFORE_RESOLUTION', `The record date ${doc.recordDate} is before the board resolution (${doc.resolutionDate}).`);
    if (doc.recordDate > today) {
      add('error', 'recordDate', 'RECORD_AHEAD', `The record date ${doc.recordDate} has not ended, so who holds the shares is not known yet. Record the declaration after it, dated the declaration day.`);
      return issues;
    }
    if (!doc.lines.length) {
      add('error', 'recordDate', 'NO_HOLDERS', `No stockholder in the register held shares at the end of ${doc.recordDate}. Enter the shares in the register of stockholders first.`);
      return issues;
    }
    if (doc.totalCents > MAX_CENTS) add('error', 'amountCents', 'TOO_BIG', `${formatPeso(doc.totalCents)} in all is more than the ${formatPeso(MAX_CENTS)} this screen takes. Check the amount per share.`);
    const r = doc.retained;
    if (doc.totalCents > r.availableCents) {
      add('error', 'amountCents', 'RETAINED_EARNINGS', `Retained earnings on ${r.date} are ${formatPeso(r.availableCents)}: ${formatPeso(r.retainedCents)} retained earnings, `
        + `${formatPeso(r.currentYearCents)} earnings of ${r.date.slice(0, 4)} to date${r.earlierYearsCents ? `, ${formatPeso(r.earlierYearsCents)} earlier years' earnings not yet closed` : ''}, `
        + `less ${formatPeso(r.declaredCents)} dividends already declared. This dividend of ${formatPeso(doc.totalCents)} would leave ${formatPeso(r.availableCents - doc.totalCents)}.`);
    }
    for (const l of doc.lines) {
      if (!l.tin) add('warning', 'recordDate', 'NO_TIN', `${l.name} has no TIN in the register: the 1601-FQ and the 1604-F need it. Add it before filing.`);
    }
    const unknown = listPeople(ctx.db, true).filter((p) => p.isStockholder && p.shares === null).map((p) => p.name);
    if (unknown.length) add('warning', 'recordDate', 'SHARES_UNKNOWN', `No shares are typed for ${unknown.join(', ')}, so they get nothing from this dividend.`);
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO eq_dividend_declarations (document_id, resolution_number, resolution_date, record_date, basis, per_share_cents, total_cents, shares, tax_rate_bp, tax_cents,
         retained_cents, current_year_cents, earlier_years_cents, declared_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.resolutionNumber, doc.resolutionDate, doc.recordDate, doc.basis, doc.basis === 'per_share' ? doc.amountCents : null, doc.totalCents,
      doc.shares, doc.taxRateBp, doc.taxCents, doc.retained.retainedCents, doc.retained.currentYearCents, doc.retained.earlierYearsCents, doc.retained.declaredCents, doc.note ?? null);
    const line = db.prepare('INSERT INTO eq_dividend_lines (document_id, person_id, name, tin, holder_kind, shares, gross_cents, tax_cents, net_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.personId, l.name, l.tin, l.holderKind, l.shares, l.grossCents, l.taxCents, l.netCents);
  },

  journal(doc) {
    const payable: DraftLine[] = doc.lines.map((l) => ({
      account: { role: 'DIVIDENDS_PAYABLE' }, party: { type: 'stockholder', id: l.personId }, creditCents: l.netCents,
      memo: `${l.name}: ${l.shares} shares${l.taxCents ? `, less final tax ${formatPeso(l.taxCents)}` : ''}`,
    }));
    return {
      memo: `Cash dividend, board resolution ${doc.resolutionNumber} of ${doc.resolutionDate}, record date ${doc.recordDate}`,
      lines: [
        { account: { role: 'DIVIDENDS_DECLARED' }, debitCents: doc.totalCents },
        ...payable,
        { account: { role: 'FINAL_TAX_PAYABLE' }, creditCents: doc.taxCents, memo: 'Final tax on dividends (1601-FQ)' },
      ],
    };
  },

  /**
   * Cancelling takes back what it made payable: blocked while a stockholder was paid more than would be left (their
   * dividend payments), or the final tax of its quarter was paid to the BIR (the 1601-FQ payments of the quarter).
   */
  dependents(db, documentId) {
    const d = db.prepare(`SELECT business_date FROM documents WHERE id = ?`).pluck().get(documentId) as string | undefined;
    const lines = db.prepare('SELECT person_id, net_cents, tax_cents FROM eq_dividend_lines WHERE document_id = ?').all(documentId) as { person_id: string; net_cents: number; tax_cents: number }[];
    if (!d) return [];
    const short = lines.filter((l) => dividendsPayable(db, l.person_id) < l.net_cents).map((l) => l.person_id);
    const paid = short.length
      ? (db
          .prepare(
            `SELECT d.id, d.number FROM eq_dividend_payments p JOIN documents d ON d.id = p.document_id
             WHERE d.status = 'posted' AND p.person_id IN (SELECT value FROM json_each(?)) ORDER BY d.number DESC`,
          )
          .all(JSON.stringify(short)) as { id: string; number: string }[])
      : [];
    const taxCents = lines.reduce((s, l) => s + l.tax_cents, 0);
    const due = finalTaxDue(db, Number(d.slice(0, 4)), Math.ceil(Number(d.slice(5, 7)) / 3) as 1 | 2 | 3 | 4);
    const tax = taxCents > 0 && due.leftCents < taxCents ? due.payments.filter((p) => p.status === 'posted').map(({ id, number }) => ({ id, number })) : [];
    return [...paid, ...tax];
  },

  load(db, documentId) {
    const r = db
      .prepare('SELECT v.*, d.business_date FROM eq_dividend_declarations v JOIN documents d ON d.id = v.document_id WHERE v.document_id = ?')
      .get(documentId) as
      | { resolution_number: string; resolution_date: string; record_date: string; basis: 'per_share' | 'total'; per_share_cents: number | null; total_cents: number;
          tax_rate_bp: number; retained_cents: number; current_year_cents: number; earlier_years_cents: number; declared_cents: number; note: string | null; business_date: string }
      | undefined;
    if (!r) throw new Error(`Dividend declaration ${documentId} not found`);
    const lines = db
      .prepare(
        `SELECT person_id AS personId, name, tin, holder_kind AS holderKind, shares, gross_cents AS grossCents, tax_cents AS taxCents, net_cents AS netCents
         FROM eq_dividend_lines WHERE document_id = ? ORDER BY rowid`,
      )
      .all(documentId) as DividendLine[];
    const input: DividendInput = {
      resolutionNumber: r.resolution_number, resolutionDate: r.resolution_date, recordDate: r.record_date, basis: r.basis,
      amountCents: r.per_share_cents ?? r.total_cents, ...(r.note ? { note: r.note } : {}),
    };
    const retained = {
      date: r.business_date, retainedCents: r.retained_cents, currentYearCents: r.current_year_cents, earlierYearsCents: r.earlier_years_cents, declaredCents: r.declared_cents,
      availableCents: r.retained_cents + r.current_year_cents + r.earlier_years_cents - r.declared_cents,
    };
    return build(input, r.tax_rate_bp, retained, lines);
  },

  toInput(doc) {
    const { resolutionNumber, resolutionDate, recordDate, basis, amountCents, note } = doc;
    return { resolutionNumber, resolutionDate, recordDate, basis, amountCents, ...(note ? { note } : {}) };
  },

  summary(doc) {
    const n = doc.lines.length;
    const how = doc.basis === 'per_share' ? `${formatPeso(doc.amountCents)} a share on ${doc.shares.toLocaleString('en-US')} shares` : `in proportion to ${doc.shares.toLocaleString('en-US')} shares`;
    const tax = doc.taxCents ? `, less ${formatPeso(doc.taxCents)} final tax withheld (${doc.taxRateBp / 100}%, paid with the 1601-FQ)` : '';
    return `This will declare a cash dividend of ${formatPeso(doc.totalCents)} (board resolution ${doc.resolutionNumber}), ${how}, to ${n} ${n === 1 ? 'stockholder' : 'stockholders'} of record on ${doc.recordDate}${tax}.`;
  },

  /**
   * A dividend by share or in total on the register as it stood on the last day anything was recorded (the record date
   * and the resolution); the retained earnings check refuses the ones too big for the books.
   */
  arbitrary(db) {
    const day = (db.prepare('SELECT MAX(substr(at, 1, 10)) FROM audit_log').pluck().get() as string | null) ?? '2026-01-01';
    return fc
      .record({
        basis: fc.constantFrom('per_share' as const, 'total' as const),
        perShare: fc.integer({ min: 1, max: 5_000 }),
        total: fc.integer({ min: 1, max: 50_000_000 }),
        ref: fc.integer({ min: 1, max: 999 }),
      })
      .map(({ basis, perShare, total, ref }) => ({
        resolutionNumber: `BR-${day.slice(0, 4)}-${String(ref).padStart(3, '0')}`, resolutionDate: day, recordDate: day,
        basis, amountCents: basis === 'per_share' ? perShare : total,
      }));
  },
};
