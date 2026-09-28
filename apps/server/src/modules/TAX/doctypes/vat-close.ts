/**
 * Quarterly VAT close (VATC-, PLAN D7 VAT-CLOSE, research vat-cwt-ewt §3.8 R46), by the accountant when the 2550Q is
 * prepared. It empties the quarter's VAT accounts into what is payable or carried over (vat.ts says what is closed):
 *   Dr 2301 output VAT (per customer) / Cr 1401 input VAT (per supplier); Cr 1404 VAT withheld with the 2307 in hand
 *   (per customer); Cr 1402 carry-over brought forward; Cr 2302 VAT payable = the remainder if positive,
 *   or Dr 1402 carry-over = the remainder if negative.
 * A party whose balance is on the other side (a sale cancelled after its quarter) gets the opposite line.
 * Dated the quarter's last day or later (the accountant may backdate it to that day). Quarters close in order: one
 * posted close per quarter, none before a later quarter's, and cancelling one needs the later ones cancelled first.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { quarterRange, vatReturnDue, type Quarter } from '../calendar.ts';
import { vatPosition, type PartyAmount, type VatPosition } from '../vat.ts';

export const vatCloseInput = z
  .object({
    year: z.number().int().min(2000).max(2999),
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type VatCloseInput = z.infer<typeof vatCloseInput>;
export type VatClose = VatCloseInput & Omit<VatPosition, 'year' | 'quarter'> & { totalCents: number };

type Role = 'OUTPUT_VAT' | 'INPUT_VAT' | 'VAT_WITHHELD' | 'INPUT_VAT_CARRYOVER' | 'VAT_PAYABLE';
/** A balance closed on an account: taken out from its normal side, or put back on the other side if negative. */
function closing(role: Role, normal: 'debit' | 'credit', cents: number, memo: string, party?: PartyAmount): DraftLine {
  const out = normal === 'debit' ? 'creditCents' : 'debitCents';
  const back = normal === 'debit' ? 'debitCents' : 'creditCents';
  return { account: { role }, ...(party ? { party: { type: party.partyType, id: party.partyId } } : {}), [cents >= 0 ? out : back]: Math.abs(cents), memo };
}

function lines(doc: Omit<VatClose, 'totalCents'>): DraftLine[] {
  const q = `Q${doc.quarter} ${doc.year}`;
  return [
    ...doc.output.map((p) => closing('OUTPUT_VAT', 'credit', p.cents, `Output VAT of ${q} closed`, p)),
    ...doc.input.map((p) => closing('INPUT_VAT', 'debit', p.cents, `Input VAT of ${q} closed`, p)),
    ...doc.withheld.map((p) => closing('VAT_WITHHELD', 'debit', p.cents, `VAT withheld claimed in ${q} (2307 in hand)`, p)),
    closing('INPUT_VAT_CARRYOVER', 'debit', doc.carryOverCents, 'Input VAT carried over, applied'),
    { account: { role: 'VAT_PAYABLE' }, creditCents: doc.payableCents, memo: `VAT payable for ${q} (2550Q)` },
    { account: { role: 'INPUT_VAT_CARRYOVER' }, debitCents: doc.carryForwardCents, memo: `Excess input VAT of ${q}, carried over` },
  ];
}

const quarterName = (d: { year: number; quarter: number }) => `Q${d.quarter} ${d.year}`;

export const vatCloseDoc: DocTypeDef<VatCloseInput, VatClose> = {
  key: 'tax.vat_close',
  module: 'TAX',
  title: 'VAT Close',
  numbering: { series: { key: 'VATC', prefix: 'VATC-' } },
  permissions: { view: 'tax.vatc.view', create: 'tax.vatc.post', post: 'tax.vatc.post', cancel: 'tax.vatc.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: vatCloseInput,

  compute(input, ctx) {
    const { year: _y, quarter: _q, ...p } = vatPosition(ctx.db, input.year, input.quarter);
    const doc = { ...input, ...p };
    return { ...doc, totalCents: lines(doc).reduce((s, l) => s + (l.debitCents ?? 0), 0) };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const q = quarterName(doc);
    if (ctx.businessDate < doc.to) {
      issues.push({ field: 'quarter', code: 'QUARTER_OPEN', level: 'error', message: `${q} ends on ${doc.to}. Close it on that day or later.` });
    }
    const closes = ctx.db
      .prepare(
        `SELECT c.year, c.quarter, d.number FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id
         WHERE d.status = 'posted' AND c.year * 4 + c.quarter >= ? ORDER BY c.year, c.quarter`,
      )
      .all(doc.year * 4 + doc.quarter) as { year: number; quarter: number; number: string }[];
    const same = closes.find((c) => c.year === doc.year && c.quarter === doc.quarter);
    const later = closes.find((c) => c !== same);
    if (same) issues.push({ field: 'quarter', code: 'CLOSED_ALREADY', level: 'error', message: `${q} is already closed by ${same.number}. Cancel that one first to close it again.` });
    else if (later) issues.push({ field: 'quarter', code: 'LATER_CLOSED', level: 'error', message: `${quarterName(later)} is already closed (${later.number}). Quarters close in order: cancel it first.` });
    if (doc.totalCents === 0) issues.push({ field: 'quarter', code: 'NOTHING_TO_CLOSE', level: 'error', message: `${q} has no VAT to close.` });
    if (doc.vatWithheldPendingCents > 0) {
      issues.push({ field: 'quarter', code: 'PENDING_2307', level: 'warning', message: `${formatPeso(doc.vatWithheldPendingCents)} of VAT withheld still waits for its 2307. It stays for the quarter the certificate comes.` });
    }
    if (doc.earlierOutputVatCents !== 0 || doc.earlierInputVatCents !== 0) {
      issues.push({
        field: 'quarter', code: 'EARLIER_ITEMS', level: 'warning',
        message: `${formatPeso(doc.earlierOutputVatCents)} output VAT and ${formatPeso(doc.earlierInputVatCents)} input VAT are dated in earlier quarters but were not closed with them. They are included here; the accountant decides whether an earlier return needs amending instead.`,
      });
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO tax_vat_closes (document_id, year, quarter, output_vat_cents, input_vat_cents, vat_withheld_cents, vat_withheld_pending_cents,
         carry_over_cents, payable_cents, carry_forward_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.year, doc.quarter, doc.outputVatCents, doc.inputVatCents, doc.vatWithheldCents, doc.vatWithheldPendingCents,
      doc.carryOverCents, doc.payableCents, doc.carryForwardCents, doc.note ?? null);
    const ins = db.prepare('INSERT INTO tax_vat_close_lines (document_id, line_no, role_key, party_type, party_id, amount_cents) VALUES (?, ?, ?, ?, ?, ?)');
    const parties: [string, PartyAmount][] = [
      ...doc.output.map((p): [string, PartyAmount] => ['OUTPUT_VAT', p]),
      ...doc.input.map((p): [string, PartyAmount] => ['INPUT_VAT', p]),
      ...doc.withheld.map((p): [string, PartyAmount] => ['VAT_WITHHELD', p]),
    ];
    parties.forEach(([role, p], i) => ins.run(h.documentId, i + 1, role, p.partyType, p.partyId, p.cents));
  },

  journal(doc) {
    const due = doc.payableCents > 0 ? `${formatPeso(doc.payableCents)} VAT payable` : `${formatPeso(doc.carryForwardCents)} carried over`;
    return { memo: `VAT close for ${quarterName(doc)}: ${due}`, lines: lines(doc) };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM tax_vat_closes WHERE document_id = ?').get(documentId) as
      | { year: number; quarter: Quarter; output_vat_cents: number; input_vat_cents: number; vat_withheld_cents: number; vat_withheld_pending_cents: number;
          carry_over_cents: number; payable_cents: number; carry_forward_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`VAT close ${documentId} not found`);
    const rows = db.prepare('SELECT role_key, party_type, party_id, amount_cents FROM tax_vat_close_lines WHERE document_id = ? ORDER BY line_no').all(documentId) as
      { role_key: string; party_type: 'customer' | 'supplier'; party_id: string; amount_cents: number }[];
    const of = (role: string) => rows.filter((x) => x.role_key === role).map((x) => ({ partyType: x.party_type, partyId: x.party_id, cents: x.amount_cents }));
    const doc = {
      year: r.year, quarter: r.quarter, ...(r.note ? { note: r.note } : {}), ...quarterRange(r.year, r.quarter),
      output: of('OUTPUT_VAT'), input: of('INPUT_VAT'), withheld: of('VAT_WITHHELD'),
      outputVatCents: r.output_vat_cents, inputVatCents: r.input_vat_cents, vatWithheldCents: r.vat_withheld_cents, vatWithheldPendingCents: r.vat_withheld_pending_cents,
      carryOverCents: r.carry_over_cents, payableCents: r.payable_cents, carryForwardCents: r.carry_forward_cents,
      // Not stored: how much came from earlier quarters is a warning at posting, not part of the entry.
      earlierOutputVatCents: 0, earlierInputVatCents: 0,
    };
    return { ...doc, totalCents: lines(doc).reduce((s, l) => s + (l.debitCents ?? 0), 0) };
  },

  toInput: ({ year, quarter, note }) => ({ year, quarter, ...(note ? { note } : {}) }),

  /** A later quarter's close carried this one's result forward, and a 2550Q payment paid what it made payable: cancel them first. */
  dependents(db, documentId) {
    const r = db.prepare('SELECT year, quarter FROM tax_vat_closes WHERE document_id = ?').get(documentId) as { year: number; quarter: number } | undefined;
    if (!r) return [];
    return db
      .prepare(
        `SELECT d.id, d.number FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id
         WHERE d.status = 'posted' AND c.year * 4 + c.quarter > @key
         UNION ALL
         SELECT d.id, d.number FROM tax_bir_payments p JOIN documents d ON d.id = p.document_id
         WHERE d.status = 'posted' AND p.vat_close_id = @id ORDER BY 2`,
      )
      .all({ key: r.year * 4 + r.quarter, id: documentId }) as { id: string; number: string }[];
  },

  summary(doc, ctx) {
    const parts = [`output ${formatPeso(doc.outputVatCents)}`, `less input ${formatPeso(doc.inputVatCents)}`];
    if (doc.vatWithheldCents) parts.push(`VAT withheld ${formatPeso(doc.vatWithheldCents)}`);
    if (doc.carryOverCents) parts.push(`carry-over ${formatPeso(doc.carryOverCents)}`);
    const result = doc.payableCents > 0
      ? `${formatPeso(doc.payableCents)} VAT payable with the 2550Q, due ${vatReturnDue(ctx.db, doc.year, doc.quarter)}`
      : `${formatPeso(doc.carryForwardCents)} carried over to the next quarter`;
    return `This will close the VAT of ${quarterName(doc)}: ${parts.join(', ')}: ${result}.`;
  },

  arbitrary() {
    return fc
      .record({ year: fc.constant(2026), quarter: fc.constantFrom<Quarter>(1, 2, 3), note: fc.constantFrom(undefined, 'For the 2550Q') })
      .map(({ note, ...r }) => ({ ...r, ...(note ? { note } : {}) }));
  },
};
