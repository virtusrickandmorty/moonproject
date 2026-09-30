/**
 * Opening Withholding (OBWT-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the customers' 2307s for sales before the
 * cut-over date whose tax withheld was not yet used on a return. One row per 2307: the customer, the quarter it covers,
 * the ATC, the creditable withholding tax and the VAT withheld (government buyers), and whether it is in hand.
 *   Dr 1410 CWT and Dr 1404 VAT withheld per row, party = the customer (as a collection's) / Cr 3900 opening balance equity
 * After posting each row is a 2307 like a collection's (withholding.ts): the 2307s-received register lists it, marked as
 * opening, with its ATC and status; a pending one is marked received the same way; and the VAT close claims its VAT
 * withheld once the 2307 is in hand. The ACC opening contract (ACC/public.ts): dated the cut-over date, cancelled on it
 * too while the opening is open, and not while a VAT close stands on its VAT withheld.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assertOpeningOpen, duplicateOpeningIssue, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { activeCustomers, customerRef } from '../../CUS/public.ts';
import { quarterOf, quarterRange, type Quarter } from '../calendar.ts';
import { ATCS, OPENING_WITHHOLDING, openingLines, receivedOn, type OpeningLine } from '../withholding.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

const row = z
  .object({
    customerId: z.uuid(),
    year: z.number().int().min(2000).max(2999),
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), // the quarter the 2307 covers
    atc: z.enum(ATCS),
    cwtCents: z.number().int().min(0).max(MAX_CENTS), // 1410, as on the 2307
    vatWithheldCents: z.number().int().min(0).max(MAX_CENTS), // 1404, government buyers (D4.6)
    certificate: z.enum(['pending', 'received']),
  })
  .strict();

export const openingWithholdingInput = z
  .object({
    rows: z.array(row).min(1).max(200),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type OpeningWithholdingInput = z.infer<typeof openingWithholdingInput>;

/** A row as recorded; `receivedOn` when a pending 2307 was marked received afterwards. */
export interface OpeningWithholdingRow extends OpeningLine { receivedOn?: string }
export interface OpeningWithholding {
  rows: OpeningWithholdingRow[];
  note?: string;
  cwtCents: number;
  vatWithheldCents: number;
  totalCents: number;
}

const sum = (rows: OpeningLine[], f: (r: OpeningLine) => number) => rows.reduce((s, r) => s + f(r), 0);
const quarterName = (r: { year: number; quarter: number }) => `Q${r.quarter} ${r.year}`;

function build(rows: OpeningWithholdingRow[], note: string | null | undefined): OpeningWithholding {
  const cwtCents = sum(rows, (r) => r.cwtCents);
  const vatWithheldCents = sum(rows, (r) => r.vatWithheldCents);
  return { rows, ...(note ? { note } : {}), cwtCents, vatWithheldCents, totalCents: cwtCents + vatWithheldCents };
}

/** Posted VAT closes that claimed or held back this document's VAT withheld: those of the quarter of its date and later. */
function vatClosesOn(db: Db, documentId: string): { id: string; number: string }[] {
  const d = db
    .prepare('SELECT d.business_date AS date, SUM(l.vat_withheld_cents) AS vatw FROM documents d JOIN tax_opening_lines l ON l.document_id = d.id WHERE d.id = ? GROUP BY d.id')
    .get(documentId) as { date: string; vatw: number } | undefined;
  if (!d || d.vatw === 0) return [];
  const q = quarterOf(d.date);
  return db
    .prepare(
      `SELECT d.id, d.number FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id
       WHERE d.status = 'posted' AND c.year * 4 + c.quarter >= ? ORDER BY c.year, c.quarter`,
    )
    .all(q.year * 4 + q.quarter) as { id: string; number: string }[];
}

export const openingWithholdingDoc: DocTypeDef<OpeningWithholdingInput, OpeningWithholding> = {
  key: OPENING_WITHHOLDING,
  module: 'TAX',
  title: 'Opening Withholding',
  numbering: { series: { key: 'OBWT', prefix: 'OBWT-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingWithholdingInput,

  compute(input, ctx) {
    const rows = input.rows.map((r, i) => ({ lineNo: i + 1, ...r, customerName: customerRef(ctx.db, r.customerId)?.display_name ?? '?' }));
    return build(rows, input.note);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [...openingIssues(ctx.db, ctx.businessDate)];
    const add = (level: 'error' | 'warning', field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const earlier = ctx.db.prepare(
      `SELECT d.number FROM tax_opening_lines l JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND l.customer_id = ? AND l.year = ? AND l.quarter = ? AND l.atc = ? ORDER BY d.number LIMIT 1`,
    );
    // The same customer, quarter and amounts as a 2307 already opened: typed twice, or two certificates that look alike.
    const same = ctx.db
      .prepare(
        `SELECT d.number FROM tax_opening_lines l JOIN documents d ON d.id = l.document_id
         WHERE d.status = 'posted' AND l.customer_id = ? AND l.year = ? AND l.quarter = ? AND l.cwt_cents = ? AND l.vat_withheld_cents = ? ORDER BY d.number LIMIT 1`,
      )
      .pluck();
    const seen = new Set<string>();
    doc.rows.forEach((r, i) => {
      const n = `Row ${r.lineNo}`;
      const c = customerRef(ctx.db, r.customerId);
      if (!c || c.is_active !== 1 || c.merged_into_id) add('error', `rows.${i}.customerId`, 'CUSTOMER', `${n}: pick an active customer.`);
      if (r.cwtCents + r.vatWithheldCents === 0) {
        add('error', `rows.${i}.cwtCents`, 'NOTHING_WITHHELD', `${n}: type the tax withheld on the 2307 (creditable withholding tax, VAT withheld or both).`);
      }
      if (quarterRange(r.year, r.quarter).from > ctx.businessDate) {
        add('error', `rows.${i}.quarter`, 'QUARTER_AFTER_CUTOVER', `${n}: ${quarterName(r)} begins after the cut-over date, ${ctx.businessDate}. Tax withheld after it comes in with the collections.`);
      }
      // A customer may give several 2307s for one quarter (one per payment), so the same one twice is only a warning.
      const key = `${r.customerId} ${r.year} ${r.quarter} ${r.atc}`;
      const on = seen.has(key) ? 'this opening' : (earlier.pluck().get(r.customerId, r.year, r.quarter, r.atc) as string | undefined);
      if (on) add('warning', `rows.${i}.customerId`, 'SAME_2307', `${n}: ${r.customerName} has a ${r.atc} 2307 for ${quarterName(r)} on ${on} already. Record each certificate once.`);
      seen.add(key);
      const dup = same.get(r.customerId, r.year, r.quarter, r.cwtCents, r.vatWithheldCents) as string | undefined;
      issues.push(...duplicateOpeningIssue(ctx.db, `rows.${i}.customerId`, dup, `this 2307 (${r.customerName}, ${quarterName(r)}, ${formatPeso(r.cwtCents + r.vatWithheldCents)})`));
    });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO tax_openings (document_id, note) VALUES (?, ?)').run(h.documentId, doc.note ?? null);
    const ins = db.prepare(
      `INSERT INTO tax_opening_lines (document_id, line_no, customer_id, customer_name, year, quarter, atc, cwt_cents, vat_withheld_cents, cert_2307)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of doc.rows) ins.run(h.documentId, r.lineNo, r.customerId, r.customerName, r.year, r.quarter, r.atc, r.cwtCents, r.vatWithheldCents, r.certificate);
  },

  journal(doc) {
    const lines: DraftLine[] = doc.rows.flatMap((r) => {
      const party = { type: 'customer', id: r.customerId };
      return [
        { account: { role: 'CWT' }, party, debitCents: r.cwtCents, memo: `2307 ${r.atc} ${quarterName(r)}` },
        { account: { role: 'VAT_WITHHELD' }, party, debitCents: r.vatWithheldCents, memo: `2307 VAT withheld ${quarterName(r)}` },
      ];
    });
    lines.push({ account: { role: 'OPENING_EQUITY' }, creditCents: doc.totalCents, memo: 'Opening balance equity' });
    const n = doc.rows.length;
    return { memo: `Opening: ${n === 1 ? 'a 2307' : `${n} 2307s`} of customers not yet used on a return`, lines };
  },

  load(db, documentId) {
    const h = db.prepare('SELECT note FROM tax_openings WHERE document_id = ?').get(documentId) as { note: string | null } | undefined;
    if (!h) throw new Error(`Opening withholding ${documentId} not found`);
    const rows = openingLines(db, documentId).map((r) => {
      const on = r.certificate === 'pending' ? receivedOn(db, documentId, r.lineNo) : null;
      return on ? { ...r, receivedOn: on } : r;
    });
    return build(rows, h.note);
  },

  /** An edit keeps a 2307 marked received after posting as in hand. */
  toInput(doc) {
    return {
      rows: doc.rows.map((r) => ({
        customerId: r.customerId, year: r.year, quarter: r.quarter, atc: r.atc, cwtCents: r.cwtCents, vatWithheldCents: r.vatWithheldCents,
        certificate: r.receivedOn ? 'received' : r.certificate,
      })),
      ...(doc.note ? { note: doc.note } : {}),
    };
  },

  /** A VAT close of the cut-over's quarter or later took its VAT withheld into account: cancel that close first. */
  dependents: (db, documentId) => vatClosesOn(db, documentId),

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its 2307s. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const n = doc.rows.length;
    const pending = doc.rows.filter((r) => r.certificate === 'pending').length;
    const hand = pending === 0 ? 'all in hand' : pending === n ? (n === 1 ? 'still to come' : 'all still to come') : `${n - pending} in hand, ${pending} still to come`;
    const amounts = [
      ...(doc.cwtCents ? [`${formatPeso(doc.cwtCents)} creditable withholding tax`] : []),
      ...(doc.vatWithheldCents ? [`${formatPeso(doc.vatWithheldCents)} VAT withheld`] : []),
    ].join(' and ');
    return `This will record ${n === 1 ? 'a 2307' : `${n} 2307s`} of customers not yet used on a return (${hand}) as open on the cut-over date ${ctx.businessDate}: ${amounts || formatPeso(0)}.`;
  },

  /** Needs active customers on file. 2307s of 2025 and of 2026 up to Q3 (the tests' cut-over is in Q3 2026). */
  arbitrary(db) {
    const customers = activeCustomers(db).map((c) => c.id);
    const quarters: [number, Quarter][] = [[2025, 1], [2025, 2], [2025, 3], [2025, 4], [2026, 1], [2026, 2], [2026, 3]];
    const one = fc
      .record({
        customerId: fc.constantFrom(...customers),
        period: fc.constantFrom(...quarters),
        atc: fc.constantFrom(...ATCS),
        cwtCents: fc.integer({ min: 0, max: 2_000_000 }),
        vatWithheldCents: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 5_000_000 })),
        certificate: fc.constantFrom('pending' as const, 'received' as const),
      })
      .map(({ period: [year, quarter], cwtCents, vatWithheldCents, ...r }) => ({
        ...r, year, quarter, cwtCents: cwtCents + vatWithheldCents === 0 ? 1 : cwtCents, vatWithheldCents,
      }));
    return fc
      .record({ rows: fc.array(one, { minLength: 1, maxLength: 4 }), note: fc.option(fc.constantFrom('From the 2307 folder at the cut-over', 'SAWT of Q2 not yet filed'), { nil: undefined }) })
      .map(({ rows, note }) => ({ rows, ...(note ? { note } : {}) }));
  },
};
