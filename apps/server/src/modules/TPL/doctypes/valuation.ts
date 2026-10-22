/**
 * TPL stock value (TPLV-, the owner's request, 22 Oct 2026): the pieces held for the TPL clients are Virtus's own
 * finished goods until delivered, so at a month end the accountant values them at cost, like the materials count (PLAN
 * D5 INV-COUNT). The pieces on hand on the value date come from the stock itself (put in and counted, less recorded
 * deliveries, each by its business date); the accountant gives each item's cost per piece (materials and labor), the
 * last value's cost offered. The adjustment is the value less 1303's balance on the date:
 *   increase: Dr 1303 / Cr 5109 inventory change        decrease: Dr 5109 / Cr 1303
 * One posted value per date; one equal to the books is refused (nothing to adjust). Cancel mirrors it on the value date
 * (cancelOn), so an edit values against the books as they were without it.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import type { Db } from '../../../platform/db/driver.ts';

const MAX_UNIT_COST_CENTS = 10_000_000; // ₱100,000 a piece: a typo guard
const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
const STOCK_ROLE = 'INV_TPL_STOCK';

export const valuationInput = z.object({
  lines: z.array(z.object({ itemId: z.uuid(), unitCostCents: z.number().int().min(0).max(MAX_UNIT_COST_CENTS) }).strict()).max(1000),
  note: z.string().trim().min(1).max(500).optional(),
}).strict();
export type ValuationInput = z.infer<typeof valuationInput>;

export interface ValuationLine { itemId: string; customerName: string; description: string; size: string; qty: number; unitCostCents: number; valueCents: number }
export interface Valuation {
  lines: ValuationLine[]; note?: string;
  valueDate: string; valuedCents: number; ledgerCents: number; adjustmentCents: number; totalCents: number;
}

/** The last day of a date's month: "2026-10-14" -> "2026-10-31". */
export function monthEndOf(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
/** The last month end before a date: "2026-10-14" -> "2026-09-30". */
export function previousMonthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface SheetItem { itemId: string; customerName: string; description: string; size: string; qty: number; lastCostCents: number | null }

/** Every item with pieces on hand on a date, for the value sheet: by client, then item; with the cost of its last value. */
export function valuationSheet(db: Db, date: string): SheetItem[] {
  return db.prepare(`SELECT i.id AS itemId, c.display_name AS customerName, i.description, i.size,
      COALESCE((SELECT SUM(m.qty) FROM tpl_stock_moves m WHERE m.item_id = i.id AND m.business_date <= @date), 0)
      - COALESCE((SELECT SUM(l.qty) FROM tpl_delivery_lines l JOIN documents d ON d.id = l.document_id
                  WHERE l.item_id = i.id AND d.status = 'posted' AND d.business_date <= @date), 0) AS qty,
      (SELECT vl.unit_cost_cents FROM tpl_valuation_lines vl JOIN tpl_valuations v ON v.document_id = vl.document_id JOIN documents d ON d.id = v.document_id
        WHERE vl.item_id = i.id AND d.status = 'posted' AND v.value_date <= @date ORDER BY v.value_date DESC, d.number DESC LIMIT 1) AS lastCostCents
    FROM tpl_items i JOIN tpl_programs p ON p.id = i.program_id JOIN cus_customers c ON c.id = p.customer_id
    ORDER BY c.display_name COLLATE NOCASE, i.description COLLATE NOCASE, i.size`).all({ date })
    .filter((r) => (r as SheetItem).qty > 0) as SheetItem[];
}

const stockAccount = (db: Db) => resolveAccount(db, { role: STOCK_ROLE });
const postedValues = (db: Db) => db.prepare(`SELECT d.number, v.value_date AS valueDate FROM tpl_valuations v JOIN documents d ON d.id = v.document_id
  WHERE d.status = 'posted' ORDER BY v.value_date DESC, d.number DESC`).all() as { number: string; valueDate: string }[];

export const valuationDoc: DocTypeDef<ValuationInput, Valuation> = {
  key: 'tpl.valuation',
  module: 'TPL',
  title: 'TPL Stock Value',
  numbering: { series: { key: 'TPLV', prefix: 'TPLV-' } },
  permissions: { view: 'tpl.view', create: 'tpl.value', post: 'tpl.value', cancel: 'tpl.value' },
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: valuationInput,

  compute(input, ctx) {
    const valueDate = ctx.businessDate;
    const sheet = new Map(valuationSheet(ctx.db, valueDate).map((s) => [s.itemId, s]));
    const lines = input.lines.map((l): ValuationLine => {
      const s = sheet.get(l.itemId);
      const qty = s?.qty ?? 0;
      return { itemId: l.itemId, customerName: s?.customerName ?? '?', description: s?.description ?? '?', size: s?.size ?? '', qty, unitCostCents: l.unitCostCents, valueCents: qty * l.unitCostCents };
    });
    const valuedCents = lines.reduce((s, l) => s + l.valueCents, 0);
    const ledgerCents = accountBalance(ctx.db, stockAccount(ctx.db).id, { asOf: valueDate });
    return { lines, ...(input.note ? { note: input.note } : {}), valueDate, valuedCents, ledgerCents, adjustmentCents: valuedCents - ledgerCents, totalCents: valuedCents };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const monthEnd = monthEndOf(doc.valueDate);
    if (doc.valueDate !== monthEnd) {
      error('businessDate', 'NOT_MONTH_END', `TPL stock is valued at a month end. Record this on ${monthEnd}, or the accountant dates it ${previousMonthEnd(doc.valueDate)}.`);
    }
    const sheet = valuationSheet(ctx.db, doc.valueDate);
    const seen = new Set<string>();
    doc.lines.forEach((l, i) => {
      if (l.qty <= 0) error(`lines.${i}.itemId`, 'NOT_ON_HAND', `Line ${i + 1}: that item has no pieces on hand on ${doc.valueDate}.`);
      if (seen.has(l.itemId)) error(`lines.${i}.itemId`, 'DUPLICATE', `${l.description} is on the value twice.`);
      seen.add(l.itemId);
    });
    const missing = sheet.filter((s) => !seen.has(s.itemId));
    if (missing.length > 0) error('lines', 'MISSING', `Give the cost per piece of every item on hand: ${missing.slice(0, 3).map((s) => `${s.customerName}'s ${s.description}${s.size ? ` (${s.size})` : ''}`).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`);
    if (doc.valuedCents > MAX_CENTS) error('lines', 'TOO_BIG', `Check the costs; the value is over ${formatPeso(MAX_CENTS)}.`);
    const values = postedValues(ctx.db);
    const same = values.find((v) => v.valueDate === doc.valueDate);
    if (same) error('businessDate', 'ALREADY_VALUED', `The TPL stock of ${doc.valueDate} is already valued on ${same.number}. To correct it, edit ${same.number}.`);
    if (issues.length > 0) return issues;
    if (doc.adjustmentCents === 0) return [{ field: 'lines', code: 'NO_DIFFERENCE', level: 'error', message: `The value matches the books (${formatPeso(doc.ledgerCents)}), so there is nothing to adjust.` }];
    const later = values.filter((v) => v.valueDate > doc.valueDate);
    if (later.length > 0) {
      issues.push({ field: 'businessDate', code: 'LATER_VALUE', level: 'warning',
        message: `A later TPL stock value is recorded (${later.map((v) => `${v.number} of ${v.valueDate}`).join(', ')}). This adjustment also moves the books on ${later.length === 1 ? 'that date' : 'those dates'}: edit ${later.map((v) => v.number).join(', ')} after recording this one.` });
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO tpl_valuations (document_id, value_date, valued_cents, ledger_cents, adjustment_cents, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(h.documentId, h.businessDate, doc.valuedCents, doc.ledgerCents, doc.adjustmentCents, doc.note ?? null);
    const line = db.prepare(`INSERT INTO tpl_valuation_lines (document_id, line_no, item_id, customer_name, description, size, qty, unit_cost_cents, value_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    doc.lines.forEach((l, i) => line.run(h.documentId, i + 1, l.itemId, l.customerName, l.description, l.size, l.qty, l.unitCostCents, l.valueCents));
  },

  journal(doc) {
    if (doc.adjustmentCents === 0) return null;
    const a = Math.abs(doc.adjustmentCents);
    const memo = `Valued ${formatPeso(doc.valuedCents)}, books ${formatPeso(doc.ledgerCents)}`;
    const stock = { account: { role: STOCK_ROLE }, memo };
    const change = { account: { role: 'INVENTORY_CHANGE' }, memo };
    return {
      memo: `TPL clients' stock valued on ${doc.valueDate}: ${formatPeso(a)} ${doc.adjustmentCents > 0 ? 'increase' : 'decrease'}`,
      lines: doc.adjustmentCents > 0 ? [{ ...stock, debitCents: a }, { ...change, creditCents: a }] : [{ ...change, debitCents: a }, { ...stock, creditCents: a }],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT value_date, valued_cents, ledger_cents, adjustment_cents, note FROM tpl_valuations WHERE document_id = ?').get(documentId) as
      { value_date: string; valued_cents: number; ledger_cents: number; adjustment_cents: number; note: string | null } | undefined;
    if (!r) throw new Error(`TPL stock value ${documentId} not found`);
    const lines = db.prepare(`SELECT item_id AS itemId, customer_name AS customerName, description, size, qty, unit_cost_cents AS unitCostCents, value_cents AS valueCents
      FROM tpl_valuation_lines WHERE document_id = ? ORDER BY line_no`).all(documentId) as ValuationLine[];
    return { lines, ...(r.note ? { note: r.note } : {}), valueDate: r.value_date, valuedCents: r.valued_cents, ledgerCents: r.ledger_cents, adjustmentCents: r.adjustment_cents, totalCents: r.valued_cents };
  },

  toInput: ({ lines, note }) => ({ lines: lines.map(({ itemId, unitCostCents }) => ({ itemId, unitCostCents })), ...(note ? { note } : {}) }),

  summary(doc) {
    const pieces = doc.lines.reduce((s, l) => s + l.qty, 0);
    const a = Math.abs(doc.adjustmentCents);
    return `This will value the ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} held for the TPL clients on ${doc.valueDate} at ${formatPeso(doc.valuedCents)}. The books show ${formatPeso(doc.ledgerCents)}, so the stock goes ${doc.adjustmentCents >= 0 ? 'up' : 'down'} by ${formatPeso(a)} against the inventory change in cost of sales.`;
  },

  arbitrary(db) {
    const items = db.prepare('SELECT id FROM tpl_items WHERE is_active = 1').pluck().all() as string[];
    if (items.length === 0) throw new Error('tpl.valuation.arbitrary needs a TPL item');
    return fc.record({ lines: fc.subarray(items, { minLength: 1 }).chain((ids) => fc.tuple(...ids.map((itemId) => fc.integer({ min: 1, max: 100_000 }).map((unitCostCents) => ({ itemId, unitCostCents }))))) });
  },
};
