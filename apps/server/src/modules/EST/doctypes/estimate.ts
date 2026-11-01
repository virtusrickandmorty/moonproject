/**
 * A cost estimate (the owner's request, Nov 2026): an order priced from the cost sheets. Each line takes its item's sheet
 * as it is today, the setup spread over the order's pieces, any extra cost (a special print, say), and the margin of the
 * tier its quantity falls in; the price asked is the suggested one unless another is typed, with a reason. It records
 * what it took, so its figures stay as they were. Not money: no journal.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { divRoundHalfAway, formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { customerRef } from '../../CUS/public.ts';
import { catalogItemRef, lookupCatalogPrice } from '../../CAT/public.ts';
import { costAt, rulesNow, sheetOf } from '../costing.ts';

const MAX_UNIT_CENTS = 100_000_00;
const MAX_TOTAL_CENTS = 100_000_000_00;
const text = (max: number) => z.string().trim().min(1).max(max);

const lineInput = z.object({
  itemId: z.uuid(),
  description: text(200),
  qty: z.number().int().min(1).max(10_000),
  extraCostCents: z.number().int().min(1).max(MAX_UNIT_CENTS).optional(),
  extraReason: text(200).optional(),
  unitPriceCents: z.number().int().min(0).max(MAX_UNIT_CENTS).optional(),
  priceReason: text(500).optional(),
}).strict();

export const estimateInput = z.object({
  customerId: z.uuid().optional(),
  prospectName: text(200).optional(),
  contact: text(200).optional(),
  notes: text(2000).optional(),
  lines: z.array(lineInput).min(1).max(30),
}).strict().refine((v) => Boolean(v.customerId) !== Boolean(v.prospectName), {
  path: ['customerId'], message: 'Pick a customer or enter a prospect name, but not both.',
});
export type EstimateInput = z.infer<typeof estimateInput>;
type InputLine = EstimateInput['lines'][number];

export interface EstimateLine extends InputLine {
  lineNo: number; unit: 'pc' | 'set'; sheetVersionId: number | null; tierFromQty: number; marginBp: number;
  unitCostCents: number; suggestedCents: number; priceCents: number; commissionCents: number; profitCents: number;
  catalogCents: number | null; lineTotalCents: number;
}
export interface Estimate extends Omit<EstimateInput, 'lines'> {
  customerName: string; rulesId: number; commissionBp: number; lines: EstimateLine[];
  totalCents: number; costCents: number; commissionTotalCents: number; profitCents: number; marginBp: number;
}

const issue = (field: string, code: string, message: string, level: Issue['level'] = 'error'): Issue => ({ field, code, message, level });

/** The order's totals from its lines. */
function totals(lines: EstimateLine[]) {
  const totalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const costCents = lines.reduce((s, l) => s + l.qty * l.unitCostCents, 0);
  const commissionTotalCents = lines.reduce((s, l) => s + l.qty * l.commissionCents, 0);
  const profitCents = totalCents - costCents - commissionTotalCents;
  return { totalCents, costCents, commissionTotalCents, profitCents, marginBp: totalCents > 0 ? Math.round((profitCents * 10_000) / totalCents) : 0 };
}

export const estimateDoc: DocTypeDef<EstimateInput, Estimate> = {
  key: 'est.estimate',
  module: 'EST',
  title: 'Cost Estimate',
  numbering: { series: { key: 'EST', prefix: 'EST-' } },
  permissions: { view: 'est.estimate.view', create: 'est.estimate.create', post: 'est.estimate.post', cancel: 'est.estimate.cancel' },
  dating: 'system',
  inputSchema: estimateInput,

  compute(input, ctx) {
    const rules = rulesNow(ctx.db);
    const lines = input.lines.map((line, i): EstimateLine => {
      const sheet = sheetOf(ctx.db, line.itemId, ctx.businessDate);
      const unit = catalogItemRef(ctx.db, line.itemId)?.unit ?? 'pc';
      const catalogCents = lookupCatalogPrice(ctx.db, line.itemId, line.qty, ctx.businessDate)?.unitPriceCents ?? null;
      const at = sheet ? costAt(sheet, line.qty, line.extraCostCents ?? 0) : { fromQty: 1, marginBp: 0, costCents: 0, priceCents: 0 };
      const priceCents = line.unitPriceCents ?? at.priceCents;
      const commissionCents = divRoundHalfAway(priceCents * rules.commissionBp, 10_000);
      return {
        ...line, lineNo: i + 1, unit, sheetVersionId: sheet?.versionId ?? null, tierFromQty: at.fromQty, marginBp: at.marginBp,
        unitCostCents: at.costCents, suggestedCents: at.priceCents, priceCents, commissionCents, profitCents: priceCents - at.costCents - commissionCents,
        catalogCents, lineTotalCents: line.qty * priceCents,
      };
    });
    return {
      ...input,
      customerName: input.customerId ? customerRef(ctx.db, input.customerId)?.display_name ?? '?' : input.prospectName!,
      rulesId: rules.id, commissionBp: rules.commissionBp, lines, ...totals(lines),
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    if (doc.customerId) {
      const customer = customerRef(ctx.db, doc.customerId);
      if (!customer || !customer.is_active || customer.merged_into_id) issues.push(issue('customerId', 'CUSTOMER', 'Pick an active customer.'));
    }
    for (const l of doc.lines) {
      const field = `lines.${l.lineNo - 1}`;
      const item = catalogItemRef(ctx.db, l.itemId);
      if (!item?.isActive) issues.push(issue(`${field}.itemId`, 'ITEM', `Line ${l.lineNo}: pick an active price list item.`));
      else if (l.sheetVersionId === null) issues.push(issue(`${field}.itemId`, 'NO_SHEET', `${item.name} has no cost sheet yet. Make one under Sales › Costing first.`));
      if (l.extraCostCents !== undefined && !l.extraReason) issues.push(issue(`${field}.extraReason`, 'EXTRA_REASON', `Line ${l.lineNo}: say what the extra cost is for.`));
      if (l.extraCostCents === undefined && l.extraReason) issues.push(issue(`${field}.extraReason`, 'NO_EXTRA', `Line ${l.lineNo}: remove the extra cost's reason, or type the extra cost.`));
      if (l.unitPriceCents !== undefined && l.unitPriceCents === l.suggestedCents) issues.push(issue(`${field}.unitPriceCents`, 'SAME_PRICE', `Line ${l.lineNo}: that is the suggested price; leave the price empty.`));
      else if (l.unitPriceCents !== undefined && (l.priceReason ?? '').length < 3) issues.push(issue(`${field}.priceReason`, 'PRICE_REASON', `Line ${l.lineNo}: say why the price differs from the suggested ${formatPeso(l.suggestedCents)}.`));
      else if (l.unitPriceCents === undefined && l.priceReason) issues.push(issue(`${field}.priceReason`, 'NO_PRICE', `Line ${l.lineNo}: remove the price reason, or type the price.`));
      if (l.sheetVersionId !== null && l.priceCents < l.unitCostCents + l.commissionCents) {
        issues.push(issue(`${field}.unitPriceCents`, 'BELOW_COST', `Line ${l.lineNo}: ${formatPeso(l.priceCents)} is below the cost of ${formatPeso(l.unitCostCents + l.commissionCents)} a piece; the order loses ${formatPeso(l.qty * (l.unitCostCents + l.commissionCents - l.priceCents))}.`, 'warning'));
      }
    }
    if (doc.totalCents > MAX_TOTAL_CENTS || !Number.isSafeInteger(doc.totalCents)) issues.push(issue('lines', 'TOTAL_TOO_HIGH', 'The estimate is over the allowed total. Check its quantities and prices.'));
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO est_estimates (document_id, customer_id, customer_name, prospect_name, contact, notes, rules_id, commission_bp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(h.documentId, doc.customerId ?? null, doc.customerName, doc.prospectName ?? null, doc.contact ?? null, doc.notes ?? null, doc.rulesId, doc.commissionBp);
    const line = db.prepare(`INSERT INTO est_estimate_lines (document_id, line_no, item_id, description, unit, qty, sheet_version_id, tier_from_qty, margin_bp,
      extra_cost_cents, extra_reason, unit_cost_cents, suggested_cents, unit_price_cents, price_reason, commission_cents, catalog_cents, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of doc.lines) {
      line.run(h.documentId, l.lineNo, l.itemId, l.description, l.unit, l.qty, l.sheetVersionId, l.tierFromQty, l.marginBp, l.extraCostCents ?? 0, l.extraReason ?? null,
        l.unitCostCents, l.suggestedCents, l.priceCents, l.unitPriceCents === undefined ? null : l.priceReason!, l.commissionCents, l.catalogCents, l.lineTotalCents);
    }
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM est_estimates WHERE document_id = ?').get(documentId) as
      | { customer_id: string | null; customer_name: string; prospect_name: string | null; contact: string | null; notes: string | null; rules_id: number; commission_bp: number }
      | undefined;
    if (!r) throw new Error(`Estimate ${documentId} not found`);
    const rows = db.prepare('SELECT * FROM est_estimate_lines WHERE document_id = ? ORDER BY line_no').all(documentId) as {
      line_no: number; item_id: string; description: string; unit: 'pc' | 'set'; qty: number; sheet_version_id: number; tier_from_qty: number; margin_bp: number;
      extra_cost_cents: number; extra_reason: string | null; unit_cost_cents: number; suggested_cents: number; unit_price_cents: number; price_reason: string | null;
      commission_cents: number; catalog_cents: number | null; line_total_cents: number;
    }[];
    const lines = rows.map((l): EstimateLine => ({
      lineNo: l.line_no, itemId: l.item_id, description: l.description, unit: l.unit, qty: l.qty,
      ...(l.extra_cost_cents ? { extraCostCents: l.extra_cost_cents, extraReason: l.extra_reason! } : {}),
      ...(l.price_reason !== null ? { unitPriceCents: l.unit_price_cents, priceReason: l.price_reason } : {}),
      sheetVersionId: l.sheet_version_id, tierFromQty: l.tier_from_qty, marginBp: l.margin_bp, unitCostCents: l.unit_cost_cents, suggestedCents: l.suggested_cents,
      priceCents: l.unit_price_cents, commissionCents: l.commission_cents, profitCents: l.unit_price_cents - l.unit_cost_cents - l.commission_cents,
      catalogCents: l.catalog_cents, lineTotalCents: l.line_total_cents,
    }));
    return {
      ...(r.customer_id ? { customerId: r.customer_id } : { prospectName: r.prospect_name! }), ...(r.contact ? { contact: r.contact } : {}), ...(r.notes ? { notes: r.notes } : {}),
      customerName: r.customer_name, rulesId: r.rules_id, commissionBp: r.commission_bp, lines, ...totals(lines),
    };
  },

  toInput(doc) {
    return {
      ...(doc.customerId ? { customerId: doc.customerId } : { prospectName: doc.prospectName }), ...(doc.contact ? { contact: doc.contact } : {}), ...(doc.notes ? { notes: doc.notes } : {}),
      lines: doc.lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: l.qty,
        ...(l.extraCostCents !== undefined ? { extraCostCents: l.extraCostCents, extraReason: l.extraReason } : {}),
        ...(l.unitPriceCents !== undefined ? { unitPriceCents: l.unitPriceCents, priceReason: l.priceReason } : {}) })),
    };
  },

  summary(doc) {
    const n = doc.lines.length;
    return `This will record a cost estimate for ${doc.customerName}: ${n} item${n === 1 ? '' : 's'} totalling ${formatPeso(doc.totalCents)}, a profit of ${formatPeso(doc.profitCents)} (${doc.marginBp / 100}%).`;
  },

  arbitrary() {
    return fc.record({
      prospectName: fc.constant('Made-up Prospect'),
      lines: fc.array(fc.record({ itemId: fc.uuid(), description: fc.constant('Sample garment'), qty: fc.integer({ min: 1, max: 200 }) }), { minLength: 1, maxLength: 4 }),
    });
  },
};
