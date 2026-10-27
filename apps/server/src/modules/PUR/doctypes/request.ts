/**
 * Purchase Request (PRQ-, the owner's request, 26 Oct 2026): staff ask for supplies or something to buy before anything
 * is ordered or paid: what for, by when, from whom if they know, and each thing with its quantity and an estimated cost of
 * one unit (a supply on file, or something described only). No journal: nothing is owed or paid yet. The owner or the
 * accountant then approves or rejects it (requests.ts, routes.ts); an approved request goes on to a purchase order or an
 * expense voucher, which names it. It cannot be cancelled once used by one (dependents); an edit (cancel and reissue)
 * waits for a new decision.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { requestUsedBy } from '../requests.ts';
import { lineCents, qtySchema, toHundredths } from '../qty.ts';

const MAX_CENTS = 100_000_000_00;

export const requestLineInput = z.object({
  supplyId: z.string().trim().min(1).max(80).optional(), // a supply on file, or left out for something described only
  description: z.string().trim().min(2).max(200),
  qty: qtySchema, // up to 2 decimal places (Oct 27, 2026)
  unitCostCents: z.number().int().nonnegative().max(MAX_CENTS), // an estimate
}).strict();

export const requestInput = z.object({
  purpose: z.string().trim().min(5).max(300),
  neededBy: z.string().trim().refine(isBusinessDate, 'Pick a real date.').optional(),
  supplierId: z.string().trim().min(1).max(80).optional(),
  lines: z.array(requestLineInput).min(1).max(50),
  note: z.string().trim().min(1).max(500).optional(),
}).strict();
export type RequestInput = z.infer<typeof requestInput>;

export interface PurchaseRequest extends RequestInput {
  lines: (z.infer<typeof requestLineInput> & { lineNo: number; lineTotalCents: number })[];
  supplierName: string | null;
  totalCents: number;
}

export const purchaseRequestDoc: DocTypeDef<RequestInput, PurchaseRequest> = {
  key: 'pur.request',
  module: 'PUR',
  title: 'Purchase Request',
  numbering: { series: { key: 'PRQ', prefix: 'PRQ-' } },
  permissions: { view: 'pur.request.view', create: 'pur.request.create', post: 'pur.request.create', cancel: 'pur.request.cancel' },
  dating: 'system',
  inputSchema: requestInput,

  compute(input, ctx) {
    const lines = input.lines.map((l, i) => ({ ...l, lineNo: i + 1, lineTotalCents: lineCents(toHundredths(l.qty), l.unitCostCents) }));
    const supplierName = input.supplierId ? ((ctx.db.prepare('SELECT name FROM pur_suppliers WHERE id = ?').pluck().get(input.supplierId) as string | undefined) ?? '?') : null;
    return { ...input, lines, supplierName, totalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0) };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    if (doc.neededBy && doc.neededBy < ctx.businessDate) add('neededBy', 'PAST_DATE', 'The date it is needed by cannot be in the past.');
    if (doc.supplierId) {
      const s = ctx.db.prepare('SELECT is_active FROM pur_suppliers WHERE id = ?').get(doc.supplierId) as { is_active: number } | undefined;
      if (!s?.is_active) add('supplierId', 'SUPPLIER', 'Pick an active supplier, or leave it empty.');
    }
    const supply = ctx.db.prepare('SELECT is_active FROM pur_supplies WHERE id = ?');
    doc.lines.forEach((l, i) => {
      if (l.supplyId && !(supply.get(l.supplyId) as { is_active: number } | undefined)?.is_active) add(`lines.${i}.supplyId`, 'SUPPLY', `Line ${i + 1}: pick an active supply, or describe it only.`);
    });
    if (doc.totalCents > MAX_CENTS) add('lines', 'TOO_BIG', `Check the costs; the request is over ${formatPeso(MAX_CENTS)}.`);
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO pur_requests (document_id, purpose, needed_by, supplier_id, note) VALUES (?, ?, ?, ?, ?)')
      .run(h.documentId, doc.purpose, doc.neededBy ?? null, doc.supplierId ?? null, doc.note ?? null);
    const line = db.prepare('INSERT INTO pur_request_lines (document_id, line_no, supply_id, description, qty_hundredths, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of doc.lines) line.run(h.documentId, l.lineNo, l.supplyId ?? null, l.description, toHundredths(l.qty), l.unitCostCents);
  },

  load(db, documentId) {
    const r = db.prepare(`SELECT r.purpose, r.needed_by AS neededBy, r.supplier_id AS supplierId, s.name AS supplierName, r.note
      FROM pur_requests r LEFT JOIN pur_suppliers s ON s.id = r.supplier_id WHERE r.document_id = ?`).get(documentId) as
      { purpose: string; neededBy: string | null; supplierId: string | null; supplierName: string | null; note: string | null } | undefined;
    if (!r) throw new Error(`Purchase request ${documentId} not found`);
    const lines = (db.prepare('SELECT line_no AS lineNo, supply_id AS supplyId, description, qty_hundredths / 100.0 AS qty, unit_cost_cents AS unitCostCents FROM pur_request_lines WHERE document_id = ? ORDER BY line_no')
      .all(documentId) as { lineNo: number; supplyId: string | null; description: string; qty: number; unitCostCents: number }[])
      .map(({ supplyId, ...l }) => ({ ...l, ...(supplyId ? { supplyId } : {}), lineTotalCents: lineCents(toHundredths(l.qty), l.unitCostCents) }));
    return {
      purpose: r.purpose, ...(r.neededBy ? { neededBy: r.neededBy } : {}), ...(r.supplierId ? { supplierId: r.supplierId } : {}), ...(r.note ? { note: r.note } : {}),
      supplierName: r.supplierName, lines, totalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
    };
  },

  toInput: ({ purpose, neededBy, supplierId, note, lines }) => ({
    purpose, ...(neededBy ? { neededBy } : {}), ...(supplierId ? { supplierId } : {}), ...(note ? { note } : {}),
    lines: lines.map(({ supplyId, description, qty, unitCostCents }) => ({ ...(supplyId ? { supplyId } : {}), description, qty, unitCostCents })),
  }),

  /** The purchase order or expense voucher that used it: cancel that first. */
  dependents(db, documentId) {
    const used = requestUsedBy(db, documentId);
    return used ? [{ id: used.id, number: used.number }] : [];
  },

  summary(doc) {
    const n = doc.lines.length;
    return `This will ask to buy ${n} ${n === 1 ? 'thing' : 'things'} for ${doc.purpose.replace(/[.\s]+$/, '')}, about ${formatPeso(doc.totalCents)}${doc.supplierName ? ` from ${doc.supplierName}` : ''}${doc.neededBy ? `, needed by ${doc.neededBy}` : ''}. The owner or the accountant approves it before it is ordered or paid.`;
  },

  arbitrary(db) {
    const supplies = db.prepare('SELECT id FROM pur_supplies WHERE is_active = 1').pluck().all() as string[];
    const line = fc.record({
      description: fc.constantFrom('Cotton twill', 'Thread', 'Printer ink', 'Packaging bags'),
      qty: fc.integer({ min: 1, max: 500 }),
      unitCostCents: fc.integer({ min: 0, max: 500_000 }),
    }).chain((l) => (supplies.length ? fc.option(fc.constantFrom(...supplies), { nil: undefined }) : fc.constant(undefined)).map((supplyId) => ({ ...l, ...(supplyId ? { supplyId } : {}) })));
    return fc.record({ purpose: fc.constantFrom('Materials for the October orders', 'Restock of shop supplies'), lines: fc.array(line, { minLength: 1, maxLength: 4 }) });
  },
};
