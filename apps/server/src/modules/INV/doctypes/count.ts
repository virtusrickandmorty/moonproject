/**
 * Inventory Count (INVC-, PLAN D5 INV-COUNT, E9, golden G-22): one category (materials 1301, ready-made 1302) counted at
 * cost on a month end. Each line is quantity × cost per unit, rounded per line; the cost defaults to the latest purchase
 * cost on the count date (ACC-13, costs.ts) and the counter may change it with a reason. The adjustment is the counted
 * value less the inventory account's balance on the count date:
 *   increase: Dr 1301/1302 / Cr 5109 inventory change        decrease: Dr 5109 / Cr 1301/1302
 * A count dated after the month end is dated the month's last day by the accountant (acc.backdate). One posted count per
 * category and date; a count equal to the books is refused (nothing to adjust). Cancel mirrors it on the count date
 * (cancelOn), so an edit counts against the books as they were without it; only the latest count of a category comes
 * off (D6): cancel later counts first.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { activeSuppliesOf, countableSupply, type SupplyUnit } from '../../PUR/public.ts';
import { CATEGORIES, CATEGORY_LABEL, INVENTORY_ROLE, MILLI_UNITS, defaultCost, lineValue, monthEndOf, previousMonthEnd, type Category, type CostSource } from '../costs.ts';

const MAX_QTY = 10_000_000; // 10,000 yards in milli-units, or ten million pieces
const MAX_UNIT_COST_CENTS = 100_000_000; // ₱1,000,000 a unit
const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

const lineInput = z
  .object({
    supplyId: z.string().trim().min(1).max(80),
    qty: z.number().int().min(0).max(MAX_QTY), // milli-units for yard, meter and kg
    unitCostCents: z.number().int().min(0).max(MAX_UNIT_COST_CENTS).optional(), // left out: the latest purchase cost
    costReason: z.string().trim().min(5).max(200).optional(), // needed when the cost differs from the latest purchase cost
  })
  .strict();

export const countInput = z
  .object({
    category: z.enum(CATEGORIES),
    lines: z.array(lineInput).max(500),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CountInput = z.infer<typeof countInput>;

export interface CountLine {
  supplyId: string; qty: number; unitCostCents: number; costReason?: string;
  name: string; unit: SupplyUnit; defaultCostCents: number; costSource: CostSource; costSourceNumber: string | null; valueCents: number;
}
export interface InvCount {
  category: Category; lines: CountLine[]; note?: string;
  countDate: string; countedCents: number; ledgerCents: number; adjustmentCents: number; totalCents: number;
}

const inventoryAccount = (db: Db, category: Category) => resolveAccount(db, { role: INVENTORY_ROLE[category] });

/** Posted counts of a category, newest first. */
const postedCounts = (db: Db, category: Category) =>
  db
    .prepare(`SELECT d.id, d.number, c.count_date AS countDate FROM inv_counts c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted' AND c.category = ? ORDER BY c.count_date DESC, d.number DESC`)
    .all(category) as { id: string; number: string; countDate: string }[];

export const countDoc: DocTypeDef<CountInput, InvCount> = {
  key: 'inv.count',
  module: 'INV',
  title: 'Inventory Count',
  numbering: { series: { key: 'INVC', prefix: 'INVC-' } },
  permissions: { view: 'inv.count.view', create: 'inv.count.create', post: 'inv.count.post', cancel: 'inv.count.cancel' },
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: countInput,

  compute(input, ctx) {
    const countDate = ctx.businessDate;
    const lines = input.lines.map((l): CountLine => {
      const s = countableSupply(ctx.db, l.supplyId);
      const d = s ? defaultCost(ctx.db, s, countDate) : { unitCostCents: 0, source: 'catalogue' as const, sourceNumber: null };
      const changed = l.unitCostCents !== undefined && l.unitCostCents !== d.unitCostCents;
      const unitCostCents = changed ? l.unitCostCents! : d.unitCostCents;
      const unit = s?.unit ?? 'pc';
      return {
        supplyId: l.supplyId, qty: l.qty, unitCostCents, ...(changed && l.costReason ? { costReason: l.costReason } : {}),
        name: s?.name ?? '?', unit, defaultCostCents: d.unitCostCents, costSource: d.source, costSourceNumber: d.sourceNumber, valueCents: lineValue(l.qty, unitCostCents, unit),
      };
    });
    const countedCents = lines.reduce((s, l) => s + l.valueCents, 0);
    const ledgerCents = accountBalance(ctx.db, inventoryAccount(ctx.db, input.category).id, { asOf: countDate });
    return {
      category: input.category, lines, ...(input.note ? { note: input.note } : {}),
      countDate, countedCents, ledgerCents, adjustmentCents: countedCents - ledgerCents, totalCents: countedCents,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const monthEnd = monthEndOf(doc.countDate);
    if (doc.countDate !== monthEnd) {
      error('businessDate', 'NOT_MONTH_END', `Inventory is counted at a month end. Record this count on ${monthEnd}, or the accountant dates it ${previousMonthEnd(doc.countDate)}.`);
    }
    const seen = new Set<string>();
    doc.lines.forEach((l, i) => {
      const s = countableSupply(ctx.db, l.supplyId);
      if (!s) error(`lines.${i}.supplyId`, 'SUPPLY', 'Pick a supply from the list.');
      else if (s.category !== doc.category) error(`lines.${i}.supplyId`, 'CATEGORY', `${s.name} is not ${CATEGORY_LABEL[doc.category]}: it goes on the other count sheet.`);
      if (seen.has(l.supplyId)) error(`lines.${i}.supplyId`, 'DUPLICATE', `${l.name} is on the count twice: add the quantities on one line.`);
      seen.add(l.supplyId);
      if (l.unitCostCents !== l.defaultCostCents && !l.costReason) {
        error(`lines.${i}.costReason`, 'COST_REASON', `${l.name}: say why the cost is ${formatPeso(l.unitCostCents)} and not the latest purchase cost of ${formatPeso(l.defaultCostCents)}.`);
      }
      if (l.valueCents > MAX_CENTS) error(`lines.${i}.qty`, 'TOO_BIG', `${l.name}: check the quantity and the cost; the value is over ${formatPeso(MAX_CENTS)}.`);
    });
    if (doc.countedCents > MAX_CENTS) error('lines', 'TOO_BIG', `Check the quantities and costs; the count is over ${formatPeso(MAX_CENTS)}.`);
    const counts = postedCounts(ctx.db, doc.category);
    const same = counts.find((c) => c.countDate === doc.countDate);
    if (same) error('businessDate', 'ALREADY_COUNTED', `The ${CATEGORY_LABEL[doc.category]} count of ${doc.countDate} is already recorded on ${same.number}. To correct it, edit ${same.number}.`);
    if (issues.length > 0) return issues;
    if (doc.adjustmentCents === 0) {
      error('lines', 'NO_DIFFERENCE', `The count matches the books (${formatPeso(doc.ledgerCents)}), so there is nothing to adjust.`);
      return issues;
    }
    const later = counts.filter((c) => c.countDate > doc.countDate);
    if (later.length > 0) {
      issues.push({
        field: 'businessDate', code: 'LATER_COUNT', level: 'warning',
        message: `A later ${CATEGORY_LABEL[doc.category]} count is recorded (${later.map((c) => `${c.number} of ${c.countDate}`).join(', ')}). This adjustment also moves the books on ${later.length === 1 ? 'that date' : 'those dates'}, so they will no longer match: edit ${later.map((c) => c.number).join(', ')} after recording this one.`,
      });
    }
    if (doc.countedCents === 0 && doc.ledgerCents > 0) {
      issues.push({ field: 'lines', code: 'NOTHING_COUNTED', level: 'warning', message: `Nothing is counted, so all ${formatPeso(doc.ledgerCents)} of ${CATEGORY_LABEL[doc.category]} in the books is written off.` });
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO inv_counts (document_id, category, count_date, counted_cents, ledger_cents, adjustment_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.category, h.businessDate, doc.countedCents, doc.ledgerCents, doc.adjustmentCents, doc.note ?? null,
    );
    const line = db.prepare(
      `INSERT INTO inv_count_lines (document_id, line_no, supply_id, unit, qty, unit_cost_cents, default_cost_cents, cost_source, cost_source_number, cost_reason, value_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    doc.lines.forEach((l, i) =>
      line.run(h.documentId, i + 1, l.supplyId, l.unit, l.qty, l.unitCostCents, l.defaultCostCents, l.costSource, l.costSourceNumber, l.costReason ?? null, l.valueCents),
    );
  },

  journal(doc) {
    if (doc.adjustmentCents === 0) return null;
    const a = Math.abs(doc.adjustmentCents);
    const memo = `Counted ${formatPeso(doc.countedCents)}, books ${formatPeso(doc.ledgerCents)}`;
    const inventory = { account: { role: INVENTORY_ROLE[doc.category] }, memo };
    const change = { account: { role: 'INVENTORY_CHANGE' }, memo };
    return {
      memo: `Inventory count of ${CATEGORY_LABEL[doc.category]} on ${doc.countDate}: ${formatPeso(a)} ${doc.adjustmentCents > 0 ? 'increase' : 'decrease'}`,
      lines: doc.adjustmentCents > 0 ? [{ ...inventory, debitCents: a }, { ...change, creditCents: a }] : [{ ...change, debitCents: a }, { ...inventory, creditCents: a }],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM inv_counts WHERE document_id = ?').get(documentId) as
      | { category: Category; count_date: string; counted_cents: number; ledger_cents: number; adjustment_cents: number; note: string | null }
      | undefined;
    if (!r) throw new Error(`Inventory count ${documentId} not found`);
    const rows = db.prepare('SELECT * FROM inv_count_lines WHERE document_id = ? ORDER BY line_no').all(documentId) as {
      supply_id: string; unit: SupplyUnit; qty: number; unit_cost_cents: number; default_cost_cents: number; cost_source: CostSource;
      cost_source_number: string | null; cost_reason: string | null; value_cents: number;
    }[];
    const lines = rows.map((l): CountLine => ({
      supplyId: l.supply_id, qty: l.qty, unitCostCents: l.unit_cost_cents, ...(l.cost_reason ? { costReason: l.cost_reason } : {}),
      name: countableSupply(db, l.supply_id)?.name ?? '?', unit: l.unit, defaultCostCents: l.default_cost_cents, costSource: l.cost_source,
      costSourceNumber: l.cost_source_number, valueCents: l.value_cents,
    }));
    return {
      category: r.category, lines, ...(r.note ? { note: r.note } : {}),
      countDate: r.count_date, countedCents: r.counted_cents, ledgerCents: r.ledger_cents, adjustmentCents: r.adjustment_cents, totalCents: r.counted_cents,
    };
  },

  /** A changed cost keeps its reason; a default cost is looked up again, so an edit values it on the count date anew. */
  toInput: ({ category, lines, note }) => ({
    category,
    lines: lines.map((l) => ({ supplyId: l.supplyId, qty: l.qty, ...(l.costReason ? { unitCostCents: l.unitCostCents, costReason: l.costReason } : {}) })),
    ...(note ? { note } : {}),
  }),

  summary(doc) {
    const counted = `This will record ${CATEGORY_LABEL[doc.category]} counted at ${formatPeso(doc.countedCents)} on ${doc.countDate}`;
    if (doc.adjustmentCents === 0) return `${counted}. It matches the books, so there is nothing to adjust.`;
    const a = formatPeso(Math.abs(doc.adjustmentCents));
    return `${counted} against ${formatPeso(doc.ledgerCents)} in the books: ${a} ${doc.adjustmentCents > 0 ? 'more' : 'less'}, posted to inventory change.`;
  },

  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM inv_counts c JOIN documents d ON d.id = c.document_id JOIN inv_counts me ON me.document_id = @id
         WHERE d.status = 'posted' AND c.category = me.category AND c.count_date > me.count_date ORDER BY c.count_date, d.number`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
  },

  /** One category with some of its active supplies, at least a yard (1000 milli-units) or a piece of each; now and then a changed cost with its reason. */
  arbitrary(db) {
    return fc.constantFrom(...CATEGORIES).chain((category): fc.Arbitrary<CountInput> => {
      const supplies = activeSuppliesOf(db, category);
      if (supplies.length === 0) return fc.constant({ category, lines: [] });
      const line = fc.constantFrom(...supplies).chain((s) =>
        fc.record({
          supplyId: fc.constant(s.id),
          qty: MILLI_UNITS.has(s.unit) ? fc.integer({ min: 1_000, max: 500_000 }) : fc.integer({ min: 1, max: 2_000 }),
          cost: fc.option(fc.integer({ min: 100, max: 500_000 }), { nil: undefined }),
        }),
      );
      return fc
        .record({ lines: fc.uniqueArray(line, { selector: (l) => l.supplyId, minLength: 1, maxLength: supplies.length }), note: fc.constantFrom(undefined, 'Year-end count') })
        .map(({ lines, note }) => ({
          category,
          lines: lines.map(({ cost, ...l }) => ({ ...l, ...(cost === undefined ? {} : { unitCostCents: cost, costReason: 'Price went up at the supplier' }) })),
          ...(note ? { note } : {}),
        }));
    });
  },
};
