/**
 * Opening Fixed Asset (OBFA-, PLAN D8 "Cut-over" step 3, E10, MIG-02 part 2): an asset the shop owned before the
 * cut-over date, put in the register with its cost and the accumulated depreciation of the old books on that date.
 *   Dr 15x0 cost (per asset) / Cr 15x1 accumulated depreciation (per asset) ; Cr 3900 opening balance equity (book value)
 * From then on it is like an asset bought: the register shows it with its book value, depreciation runs after the
 * cut-over month charge it (on the straight line when the old books were on it, else what is left spread evenly over the
 * months of life left: assets.ts scheduledCents), and a disposal takes it off. The OBFA- document id is the asset's
 * party id. Like every opening document (ACC/public.ts): accountant only, dated the cut-over date, cancelled on it
 * while the opening is open, and only after its depreciation runs and its disposal are cancelled.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, isBusinessDate, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assertOpeningOpen, cutoverDate, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { assetClass, assetParty, atCutover, listClasses, monthlyChargeCents, monthsInService, straightLine } from '../assets.ts';
import { monthLabel } from './depreciation.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const openingAssetInput = z
  .object({
    classCode: z.string().trim().min(1).max(20),
    description: z.string().trim().min(3).max(200),
    location: z.string().trim().min(1).max(80).optional(),
    acquiredOn: z.string().refine(isBusinessDate, 'Use a date like 2024-03-15.').refine((d) => d >= '1990-01-01', 'Check the year.'),
    costCents: z.number().int().positive().max(MAX_CENTS),
    residualCents: z.number().int().min(0).max(MAX_CENTS),
    lifeMonths: z.number().int().min(1).max(600).optional(), // left out: the class's usual life
    accumulatedCents: z.number().int().min(0).max(MAX_CENTS), // on the cut-over date, from the old books
  })
  .strict();
export type OpeningAssetInput = z.infer<typeof openingAssetInput>;

/**
 * `life` is lifeMonths, else the class's usual life, else 0 (then it must be typed). At the cut-over: its months in
 * service, the straight-line figure for them, what is left to depreciate over the months left, and a month's charge.
 */
export interface OpeningAsset extends OpeningAssetInput {
  totalCents: number; className: string; costRole: string; accumRole: string; life: number; bookValueCents: number;
  monthsInService: number; straightLineCents: number; leftCents: number; monthsLeft: number; monthlyChargeCents: number;
}

/** The names, accounts and figures around the input, as on `cutover` (worked out in compute, again in load). */
function withFigures(db: Db, input: OpeningAssetInput, cutover: string): OpeningAsset {
  const cls = assetClass(db, input.classCode);
  const life = input.lifeMonths ?? cls?.defaultLifeMonths ?? 0;
  const a = { acquiredOn: input.acquiredOn, costCents: input.costCents, residualCents: input.residualCents, lifeMonths: life };
  // Without a life there is no straight line yet; validate asks for one.
  const c = life > 0 ? atCutover(a, cutover, input.accumulatedCents) : { months: monthsInService(input.acquiredOn, cutover.slice(0, 7)), straightLineCents: 0, leftCents: 0, monthsLeft: 0 };
  return {
    ...input, totalCents: input.costCents, className: cls?.name ?? '?', costRole: cls?.costRole ?? '?', accumRole: cls?.accumRole ?? '?', life,
    bookValueCents: input.costCents - input.accumulatedCents, monthsInService: c.months, straightLineCents: c.straightLineCents, leftCents: c.leftCents, monthsLeft: c.monthsLeft,
    monthlyChargeCents: life > 0 ? monthlyChargeCents({ ...a, openedOn: cutover, openingAccumulatedCents: input.accumulatedCents }) : 0,
  };
}

const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

export const openingAssetDoc: DocTypeDef<OpeningAssetInput, OpeningAsset> = {
  key: 'fa.opening',
  module: 'FA',
  title: 'Opening Fixed Asset',
  numbering: { series: { key: 'OBFA', prefix: 'OBFA-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingAssetInput,

  compute(input, ctx) {
    return withFigures(ctx.db, input, ctx.businessDate);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [...openingIssues(ctx.db, ctx.businessDate)];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const cls = assetClass(ctx.db, doc.classCode);
    if (!cls) add('error', 'classCode', 'CLASS', 'Pick the kind of asset.');
    if (doc.acquiredOn > ctx.businessDate) {
      add('error', 'acquiredOn', 'ACQUIRED_AFTER_CUTOVER', `It was acquired after the cut-over date, ${ctx.businessDate}. Record it as a fixed-asset purchase instead.`);
    }
    if (doc.life === 0) add('error', 'lifeMonths', 'LIFE', 'Type the useful life in months (for leasehold improvements, the lease term).');
    const depreciable = doc.costCents - doc.residualCents;
    if (depreciable <= 0) add('error', 'residualCents', 'RESIDUAL', `The residual value must be less than the cost of ${formatPeso(doc.costCents)}.`);
    else if (doc.accumulatedCents > depreciable) {
      add('error', 'accumulatedCents', 'ACCUMULATED', `The accumulated depreciation cannot be more than the cost less the residual value, ${formatPeso(depreciable)}.`);
    }
    if (issues.some((i) => i.level === 'error')) return issues;
    if (cls?.defaultLifeMonths && doc.life !== cls.defaultLifeMonths) {
      add('warning', 'lifeMonths', 'LIFE_DIFFERENT', `The usual life of ${cls.name.toLowerCase()} is ${cls.defaultLifeMonths} months. Please check.`);
    }
    if (doc.leftCents > 0 && doc.monthsInService >= doc.life) {
      add('warning', 'accumulatedCents', 'LIFE_ENDED', `Its ${months(doc.life)} of life ended by the cut-over, so the first depreciation run after ${monthLabel(ctx.businessDate.slice(0, 7))} charges the ${formatPeso(doc.leftCents)} left.`);
    } else if (doc.leftCents > 0 && doc.accumulatedCents !== doc.straightLineCents) {
      add(
        'warning', 'accumulatedCents', 'NOT_STRAIGHT_LINE',
        `The straight line gives ${formatPeso(doc.straightLineCents)} for its ${months(doc.monthsInService)} in service. The ${formatPeso(doc.leftCents)} left is spread evenly over the ${months(doc.monthsLeft)} of life left, about ${formatPeso(doc.monthlyChargeCents)} a month.`,
      );
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO fa_opening_assets (document_id, class_code, description, location, acquired_on, cost_cents, residual_cents, life_months, accumulated_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.classCode, doc.description, doc.location ?? null, doc.acquiredOn, doc.costCents, doc.residualCents, doc.life, doc.accumulatedCents);
  },

  journal(doc, ctx, header) {
    const party = assetParty(header?.documentId ?? 'this asset');
    return {
      memo: `Opening fixed asset, ${doc.className}: ${doc.description}, acquired ${doc.acquiredOn}`,
      lines: [
        { account: { role: doc.costRole }, party, debitCents: doc.costCents, memo: doc.description },
        { account: { role: doc.accumRole }, party, creditCents: doc.accumulatedCents, memo: `Accumulated depreciation to ${ctx.businessDate}` }, // none: dropped
        { account: { role: 'OPENING_EQUITY' }, creditCents: doc.bookValueCents, memo: 'Opening balance equity' },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT o.class_code AS classCode, o.description, o.location, o.acquired_on AS acquiredOn, o.cost_cents AS costCents, o.residual_cents AS residualCents,
           o.life_months AS lifeMonths, o.accumulated_cents AS accumulatedCents, d.business_date AS cutover
         FROM fa_opening_assets o JOIN documents d ON d.id = o.document_id WHERE o.document_id = ?`,
      )
      .get(documentId) as (Omit<OpeningAssetInput, 'location'> & { location: string | null; cutover: string }) | undefined;
    if (!r) throw new Error(`Opening fixed asset ${documentId} not found`);
    const { location, cutover, ...input } = r;
    return withFigures(db, { ...input, ...(location ? { location } : {}) }, cutover);
  },

  toInput: (doc) =>
    Object.fromEntries(Object.keys(openingAssetInput.shape).flatMap((k) => (doc[k as keyof OpeningAssetInput] === undefined ? [] : [[k, doc[k as keyof OpeningAssetInput]]]))) as OpeningAssetInput,

  /** Its depreciation runs and its disposal are cancelled first, so the asset's accounts come back to the opening figures. */
  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM fa_opening_depreciation_lines l JOIN documents d ON d.id = l.document_id WHERE l.asset_id = @id AND d.status = 'posted'
         UNION
         SELECT d.id, d.number FROM fa_opening_disposals x JOIN documents d ON d.id = x.document_id WHERE x.asset_id = @id AND d.status = 'posted'
         UNION
         SELECT d.id, d.number FROM fa_asset_sales x JOIN documents d ON d.id = x.document_id WHERE x.asset_id = @id AND d.status = 'posted'
         ORDER BY 2`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its OBFA- documents. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const after = monthLabel(ctx.businessDate.slice(0, 7));
    const plan =
      doc.life === 0 ? 'Type its useful life to see how it depreciates.'
      : doc.leftCents <= 0 ? 'It is fully depreciated.'
      : doc.accumulatedCents === doc.straightLineCents ? `After ${after} it depreciates on the straight line over the ${months(doc.monthsLeft)} left, down to ${formatPeso(doc.residualCents)}.`
      : `After ${after} the ${formatPeso(doc.leftCents)} left is spread over the ${months(doc.monthsLeft)} left, down to ${formatPeso(doc.residualCents)}.`;
    return `This will record ${doc.description} (${doc.className.toLowerCase()}), acquired ${doc.acquiredOn}, as owned on ${ctx.businessDate}: cost ${formatPeso(doc.costCents)} less ${formatPeso(doc.accumulatedCents)} accumulated depreciation, a book value of ${formatPeso(doc.bookValueCents)} credited to opening balance equity. ${plan}`;
  },

  /**
   * Acquired up to ten years before the cut-over date in force (2026-09-27 when none is set yet), with the old books on
   * the straight line, at nothing, fully depreciated, or anywhere in between.
   */
  arbitrary(db) {
    const cutover = cutoverDate(db) ?? '2026-09-27';
    const [y, m, day] = cutover.split('-').map(Number) as [number, number, number];
    return fc
      .tuple(fc.constantFrom(...listClasses(db).map((c) => c.code)), fc.integer({ min: 0, max: 119 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 100_00, max: 5_000_000_00 }),
        fc.integer({ min: 0, max: 25 }), fc.integer({ min: 1, max: 120 }), fc.oneof(fc.constantFrom('straight line', 'none', 'full'), fc.integer({ min: 0, max: 1000 })))
      .map(([classCode, back, d, costCents, residualPct, lifeMonths, old]): OpeningAssetInput => {
        const n = y * 12 + (m - 1) - back;
        const acquiredOn = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}-${String(back === 0 ? Math.min(d, day) : d).padStart(2, '0')}`;
        const residualCents = Math.floor((costCents * residualPct) / 100);
        const asset = { costCents, residualCents, lifeMonths };
        const depreciable = costCents - residualCents;
        const accumulatedCents =
          old === 'straight line' ? straightLine(asset, monthsInService(acquiredOn, cutover.slice(0, 7)))
          : old === 'none' ? 0
          : old === 'full' ? depreciable
          : Math.floor((depreciable * old) / 1000);
        return { classCode, description: 'Random opening asset', acquiredOn, ...asset, accumulatedCents };
      });
  },
};
