/**
 * Costing (the owner's request, Nov 2026): what a piece of a price list item costs to make, and the price to ask for it.
 * - Materials and sublimation: the supplies a piece takes (Purchasing), at each one's latest purchase cost (the newest
 *   supplier bill, else purchase order; AP latestPurchaseCost), or a typed cost per piece.
 * - Labour: the piece rates in force for the sheet's garment type and complexity, step by step (RATE); a set takes its
 *   upper and lower parts. A step with no rate at the complexity takes its standard rate.
 * - Overhead: a percent of that direct cost. Setup: once per order, spread over its pieces.
 * - Price: cost ÷ (1 − margin − commission), rounded up, so the margin wanted and the commission both come out of the
 *   selling price; the margin by quantity tier.
 * Suggestions say what moved since the sheet was saved and where the price list sits against the cost.
 */
import { z } from 'zod';
import { GARMENT_TYPE_MAX, badRequest, divRoundHalfAway, formatPeso, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { latestPurchaseCost } from '../AP/public.ts';
import { catalogItemRef, lookupCatalogPrice, matchCatalogItem } from '../CAT/public.ts';
import { COMPLEXITIES, listSteps, type Complexity } from '../PRD/public.ts';
import { countableSupply } from '../PUR/public.ts';
import { rateAt, type Part } from '../RATE/public.ts';

export interface Who { userId: string; at: string; today: string }
const invalid = (e: z.ZodError, message: string) => badRequest('INVALID_INPUT', message, e.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));

// ---- Rules ----------------------------------------------------------------------------------------------------------
export interface Rules { id: number; overheadBp: number; commissionBp: number; roundToCents: number; tiers: { fromQty: number; marginBp: number }[]; reason: string; createdAt: string; starter: boolean }

export function rulesNow(db: Db): Rules {
  const r = db.prepare('SELECT id, overhead_bp, commission_bp, round_to_cents, reason, created_at, created_by FROM est_rules ORDER BY id DESC LIMIT 1').get() as
    { id: number; overhead_bp: number; commission_bp: number; round_to_cents: number; reason: string; created_at: string; created_by: string | null };
  const tiers = db.prepare('SELECT from_qty AS fromQty, margin_bp AS marginBp FROM est_rule_tiers WHERE rule_id = ? ORDER BY from_qty').all(r.id) as Rules['tiers'];
  return { id: r.id, overheadBp: r.overhead_bp, commissionBp: r.commission_bp, roundToCents: r.round_to_cents, tiers, reason: r.reason, createdAt: r.created_at, starter: r.created_by === null };
}

export const rulesInput = z.object({
  overheadBp: z.number().int().min(0).max(10_000),
  commissionBp: z.number().int().min(0).max(5_000),
  roundToCents: z.union([z.literal(1), z.literal(100), z.literal(500), z.literal(1000)]),
  tiers: z.array(z.object({ fromQty: z.number().int().min(1).max(100_000), marginBp: z.number().int().min(0).max(9_000) }).strict()).min(1).max(10),
  reason: z.string().trim().min(10).max(500),
}).strict();

/** New costing rules, in force from now. Call inside a transaction. */
export function setRules(db: Db, raw: unknown, who: Who): Rules {
  const parsed = rulesInput.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error, 'Fill in the overhead, commission, rounding, the margin of each tier and a reason (10 characters or more).');
  const v = parsed.data;
  const tiers = [...v.tiers].sort((a, b) => a.fromQty - b.fromQty);
  if (tiers[0]!.fromQty !== 1) throw badRequest('TIERS', 'The first tier starts at 1 piece.');
  if (new Set(tiers.map((t) => t.fromQty)).size !== tiers.length) throw badRequest('TIERS', 'Each tier starts at a different quantity.');
  if (tiers.some((t) => t.marginBp + v.commissionBp >= 9_500)) throw badRequest('TOO_HIGH', 'A margin and the commission together must stay under 95% of the price.');
  const id = Number(db.prepare('INSERT INTO est_rules (overhead_bp, commission_bp, round_to_cents, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.overheadBp, v.commissionBp, v.roundToCents, v.reason, who.at, who.userId).lastInsertRowid);
  const tier = db.prepare('INSERT INTO est_rule_tiers (rule_id, from_qty, margin_bp) VALUES (?, ?, ?)');
  for (const t of tiers) tier.run(id, t.fromQty, t.marginBp);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'est.rules', entityType: 'est.rules', entityId: String(id), data: { ...v, tiers } });
  return rulesNow(db);
}

// ---- Cost sheets ----------------------------------------------------------------------------------------------------
const lineInput = z.object({
  kind: z.enum(['materials', 'sublimation']),
  supplyId: z.uuid().optional(),
  description: z.string().trim().min(1).max(200),
  qtyMilli: z.number().int().min(1).max(100_000_000),
  typedCostCents: z.number().int().min(0).max(100_000_000).optional(),
}).strict();
export const sheetInput = z.object({
  itemId: z.uuid(),
  garmentType: z.string().trim().min(1).max(GARMENT_TYPE_MAX),
  complexity: z.enum(COMPLEXITIES),
  isSet: z.boolean(),
  setupCents: z.number().int().min(0).max(100_000_000),
  lines: z.array(lineInput).max(40),
  reason: z.string().trim().min(5).max(500),
}).strict();
export type SheetInput = z.infer<typeof sheetInput>;
type LineInput = SheetInput['lines'][number];

export interface SheetLine extends LineInput { lineNo: number; unit: string; unitCostCents: number; savedCostCents: number; costSource: string; costCents: number }
export interface LabourLine { stepCode: string; stepName: string; part: Part; complexity: Complexity; rateCents: number }
export interface TierPrice { fromQty: number; marginBp: number; costCents: number; priceCents: number; commissionCents: number; profitCents: number; catalogCents: number | null }
export interface Suggestion { code: string; level: 'info' | 'warning'; message: string; priceCents?: number; fromQty?: number }
export interface Costing {
  itemId: string; itemName: string; unit: 'pc' | 'set'; garmentType: string; complexity: Complexity; isSet: boolean; setupCents: number;
  versionId: number | null; reason: string | null; savedAt: string | null;
  lines: SheetLine[]; labour: LabourLine[];
  materialsCents: number; sublimationCents: number; labourCents: number; directCents: number; overheadCents: number;
  tiers: TierPrice[]; rules: Rules; suggestions: Suggestion[];
}

/** A line's unit cost now: the supply's latest purchase cost, or the cost typed on it. */
function unitCostOf(db: Db, line: LineInput, asOf: string): { unit: string; unitCostCents: number; source: string } {
  if (!line.supplyId) return { unit: 'pc', unitCostCents: line.typedCostCents ?? 0, source: 'typed' };
  const supply = countableSupply(db, line.supplyId);
  if (!supply) throw badRequest('SUPPLY', `"${line.description}": that supply is not in Purchasing.`);
  const c = latestPurchaseCost(db, supply, asOf);
  return { unit: supply.unit, unitCostCents: c.unitCostCents, source: c.sourceNumber ? `${c.sourceNumber} (${c.sourceDate})` : 'the supplies list' };
}

/** The labour of a piece: each step's rate at the complexity (else its standard rate); a set's upper and lower parts. */
function labourOf(db: Db, garmentType: string, complexity: Complexity, isSet: boolean, asOf: string): LabourLine[] {
  const parts: Part[] = isSet ? ['upper', 'lower'] : ['whole'];
  return listSteps(db).filter((s) => s.isActive).flatMap((s) => parts.flatMap((part): LabourLine[] => {
    const r = rateAt(db, garmentType, s.code, complexity, asOf, part) ?? (complexity === 'standard' ? undefined : rateAt(db, garmentType, s.code, 'standard', asOf, part));
    return r ? [{ stepCode: s.code, stepName: s.name, part, complexity: r.complexity, rateCents: r.rateCents }] : [];
  }));
}

/** The price for a cost at a margin: cost ÷ (1 − margin − commission), rounded up to the rule's step. */
export function priceFor(costCents: number, marginBp: number, rules: Pick<Rules, 'commissionBp' | 'roundToCents'>): number {
  const raw = Math.ceil((costCents * 10_000) / (10_000 - marginBp - rules.commissionBp));
  return Math.ceil(raw / rules.roundToCents) * rules.roundToCents;
}

/** The cost of a piece and the price of each tier, for a sheet as saved or as being typed. */
export function costSheet(db: Db, v: Omit<SheetInput, 'reason'>, asOf: string, saved?: { versionId: number; reason: string; savedAt: string; savedCosts: number[] }): Costing {
  const item = catalogItemRef(db, v.itemId);
  if (!item) throw notFound('That price list item does not exist.');
  const rules = rulesNow(db);
  const lines = v.lines.map((l, i): SheetLine => {
    const now = unitCostOf(db, l, asOf);
    return { ...l, lineNo: i + 1, unit: now.unit, unitCostCents: now.unitCostCents, savedCostCents: saved?.savedCosts[i] ?? now.unitCostCents, costSource: now.source,
      costCents: divRoundHalfAway(l.qtyMilli * now.unitCostCents, 1000) };
  });
  const labour = labourOf(db, v.garmentType, v.complexity, v.isSet, asOf);
  const setRatesOnly = labour.length === 0 && !v.isSet && labourOf(db, v.garmentType, v.complexity, true, asOf).length > 0;
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const materialsCents = sum(lines.filter((l) => l.kind === 'materials').map((l) => l.costCents));
  const sublimationCents = sum(lines.filter((l) => l.kind === 'sublimation').map((l) => l.costCents));
  const labourCents = sum(labour.map((l) => l.rateCents));
  const directCents = materialsCents + sublimationCents + labourCents;
  const overheadCents = divRoundHalfAway(directCents * rules.overheadBp, 10_000);
  const tiers = rules.tiers.map((t): TierPrice => {
    const costCents = directCents + overheadCents + Math.ceil(v.setupCents / t.fromQty); // setup spread over the tier's fewest pieces
    const priceCents = priceFor(costCents, t.marginBp, rules);
    const commissionCents = divRoundHalfAway(priceCents * rules.commissionBp, 10_000);
    return { fromQty: t.fromQty, marginBp: t.marginBp, costCents, priceCents, commissionCents, profitCents: priceCents - costCents - commissionCents,
      catalogCents: lookupCatalogPrice(db, v.itemId, t.fromQty, asOf)?.unitPriceCents ?? null };
  });
  const c: Costing = {
    itemId: v.itemId, itemName: item.name, unit: item.unit, garmentType: v.garmentType, complexity: v.complexity, isSet: v.isSet, setupCents: v.setupCents,
    versionId: saved?.versionId ?? null, reason: saved?.reason ?? null, savedAt: saved?.savedAt ?? null,
    lines, labour, materialsCents, sublimationCents, labourCents, directCents, overheadCents, tiers, rules, suggestions: [],
  };
  c.suggestions = suggestionsFor({ ...c, setRatesOnly });
  return c;
}

/** What to look at: costs moved since the sheet was saved, labour missing, and price list prices against the cost. */
function suggestionsFor(c: Costing & { setRatesOnly: boolean }): Suggestion[] {
  const out: Suggestion[] = [];
  if (c.rules.starter) out.push({ code: 'STARTER_RULES', level: 'warning', message: 'The overhead, commission and margins are made-up starter numbers. Set your own under Costing rules.' });
  for (const l of c.lines) {
    if (l.supplyId && l.unitCostCents === 0) out.push({ code: 'NO_COST', level: 'warning', message: `${l.description} has no purchase cost yet, so it adds nothing to the cost. Record its purchase, or type its cost instead.` });
    if (!l.supplyId || l.savedCostCents === 0 || l.unitCostCents === l.savedCostCents) continue;
    const pct = Math.round(((l.unitCostCents - l.savedCostCents) * 100) / l.savedCostCents);
    if (Math.abs(pct) >= 5) out.push({ code: pct > 0 ? 'COST_UP' : 'COST_DOWN', level: pct > 0 ? 'warning' : 'info',
      message: `${l.description} now costs ${formatPeso(l.unitCostCents)} a ${l.unit} (${l.costSource}), ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% from ${formatPeso(l.savedCostCents)} when this sheet was saved.` });
  }
  if (c.labour.length === 0) out.push({ code: 'NO_LABOUR', level: 'warning', message: c.setRatesOnly
    ? `${c.garmentType} has piece rates for its upper and lower parts only: tick "A set" to count them.`
    : `The piece-rate table has no rate for ${c.garmentType}, so the cost has no labour in it. Add its rates, or pick the garment type it is made as.` });
  if (c.lines.length === 0) out.push({ code: 'NO_MATERIALS', level: 'warning', message: 'No materials yet: add the fabric and supplies a piece takes.' });
  for (const t of c.tiers) {
    if (t.catalogCents === null) continue;
    const from = `${t.fromQty}+ pcs`;
    if (t.catalogCents < t.costCents) out.push({ code: 'BELOW_COST', level: 'warning', fromQty: t.fromQty, priceCents: t.priceCents,
      message: `At ${from} the price list asks ${formatPeso(t.catalogCents)}, below the cost of ${formatPeso(t.costCents)}: each piece loses ${formatPeso(t.costCents - t.catalogCents)}. Suggested: ${formatPeso(t.priceCents)}.` });
    else if (t.catalogCents < t.priceCents) {
      const marginPct = Math.round(((t.catalogCents - t.costCents - divRoundHalfAway(t.catalogCents * c.rules.commissionBp, 10_000)) * 100) / t.catalogCents);
      out.push({ code: 'BELOW_TARGET', level: 'info', fromQty: t.fromQty, priceCents: t.priceCents,
        message: `At ${from} the price list's ${formatPeso(t.catalogCents)} earns about ${marginPct}%, under the ${t.marginBp / 100}% wanted. Suggested: ${formatPeso(t.priceCents)}.` });
    }
  }
  return out;
}

const VERSION = 'SELECT v.id, v.sheet_id, v.garment_type, v.complexity, v.is_set, v.setup_cents, v.reason, v.created_at FROM est_sheet_versions v';
type VersionRow = { id: number; sheet_id: string; garment_type: string; complexity: Complexity; is_set: number; setup_cents: number; reason: string; created_at: string };

/** An item's cost sheet as last saved, costed today. Undefined when it has none. */
export function sheetOf(db: Db, itemId: string, asOf: string): Costing | undefined {
  const v = db.prepare(`${VERSION} JOIN est_sheets s ON s.id = v.sheet_id WHERE s.item_id = ? ORDER BY v.id DESC LIMIT 1`).get(itemId) as VersionRow | undefined;
  if (!v) return undefined;
  const rows = db.prepare('SELECT * FROM est_sheet_lines WHERE version_id = ? ORDER BY line_no').all(v.id) as
    { kind: 'materials' | 'sublimation'; supply_id: string | null; description: string; qty_milli: number; typed_cost_cents: number | null; saved_cost_cents: number }[];
  const lines = rows.map((r) => ({ kind: r.kind, ...(r.supply_id ? { supplyId: r.supply_id } : { typedCostCents: r.typed_cost_cents! }), description: r.description, qtyMilli: r.qty_milli }));
  return costSheet(db, { itemId, garmentType: v.garment_type, complexity: v.complexity, isSet: v.is_set === 1, setupCents: v.setup_cents, lines }, asOf,
    { versionId: v.id, reason: v.reason, savedAt: v.created_at, savedCosts: rows.map((r) => r.saved_cost_cents) });
}

/** Every cost sheet, by item name, costed today. */
export function sheets(db: Db, asOf: string): Costing[] {
  const items = db.prepare('SELECT item_id FROM est_sheets').pluck().all() as string[];
  return items.flatMap((id) => sheetOf(db, id, asOf) ?? []).sort((a, b) => a.itemName.localeCompare(b.itemName));
}

/** Checks a sheet being typed and costs it (the live figures on the form). */
export function previewSheet(db: Db, raw: unknown, asOf: string): Costing {
  const parsed = sheetInput.omit({ reason: true }).safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error, 'Some fields are missing or not allowed.');
  return costSheet(db, checked(db, parsed.data), asOf);
}

function checked<T extends Omit<SheetInput, 'reason'>>(db: Db, v: T): T {
  const item = catalogItemRef(db, v.itemId);
  if (!item?.isActive) throw badRequest('ITEM', 'Pick an active price list item.');
  v.lines.forEach((l, i) => {
    if (!l.supplyId === (l.typedCostCents === undefined)) throw badRequest('LINE', `Line ${i + 1}: pick a supply, or type a cost per piece (not both).`);
  });
  return v;
}

/** Saves a new version of an item's cost sheet (the first one makes the sheet). Call inside a transaction. */
export function saveSheet(db: Db, raw: unknown, who: Who): Costing {
  const parsed = sheetInput.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error, 'Some fields are missing or not allowed. Say what changed (5 characters or more).');
  const v = checked(db, parsed.data);
  const now = costSheet(db, v, who.today); // the unit costs as saved
  let sheetId = db.prepare('SELECT id FROM est_sheets WHERE item_id = ?').pluck().get(v.itemId) as string | undefined;
  if (!sheetId) {
    sheetId = newId();
    db.prepare('INSERT INTO est_sheets (id, item_id, created_at, created_by) VALUES (?, ?, ?, ?)').run(sheetId, v.itemId, who.at, who.userId);
  }
  const versionId = Number(db.prepare('INSERT INTO est_sheet_versions (sheet_id, garment_type, complexity, is_set, setup_cents, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sheetId, v.garmentType, v.complexity, +v.isSet, v.setupCents, v.reason, who.at, who.userId).lastInsertRowid);
  const line = db.prepare('INSERT INTO est_sheet_lines (version_id, line_no, kind, supply_id, description, qty_milli, typed_cost_cents, saved_cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const l of now.lines) line.run(versionId, l.lineNo, l.kind, l.supplyId ?? null, l.description, l.qtyMilli, l.typedCostCents ?? null, l.unitCostCents);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'est.sheet.save', entityType: 'est.sheet', entityId: sheetId, data: { itemId: v.itemId, versionId, reason: v.reason } });
  return sheetOf(db, v.itemId, who.today)!;
}

/** The garment type an item is made as, by its name (CAT matchCatalogItem), to start a new sheet with. */
export const garmentTypeGuess = (db: Db, itemName: string): string | null => matchCatalogItem(db, itemName)?.garmentType ?? null;

/**
 * A piece of an order of `qty` from a sheet: the cost (the setup spread over this order's pieces, plus any extra), the
 * margin of the tier the quantity falls in, and the price that asks.
 */
export function costAt(c: Costing, qty: number, extraCents = 0): { fromQty: number; marginBp: number; costCents: number; priceCents: number } {
  const tier = [...c.rules.tiers].reverse().find((t) => t.fromQty <= qty) ?? c.rules.tiers[0]!;
  const costCents = c.directCents + c.overheadCents + Math.ceil(c.setupCents / qty) + extraCents;
  return { fromQty: tier.fromQty, marginBp: tier.marginBp, costCents, priceCents: priceFor(costCents, tier.marginBp, c.rules) };
}

/** What someone without est.cost.view sees: the item and the suggested prices, no costs, margins or commission. */
export function pricesOnly(c: Costing) {
  return { itemId: c.itemId, itemName: c.itemName, unit: c.unit, savedAt: c.savedAt, tiers: c.tiers.map((t) => ({ fromQty: t.fromQty, priceCents: t.priceCents, catalogCents: t.catalogCents })) };
}
