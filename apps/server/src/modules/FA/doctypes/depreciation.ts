/**
 * Depreciation Run (DEPR-, PLAN D5 FA-DEP, E10, golden G-21): one month, one line per asset in service.
 *   Dr 5302 (production class) or 6210 (other classes) / Cr 15x1 accumulated depreciation (per asset)
 * Straight line: after n months in service an asset's accumulated depreciation is (cost − residual) × n ÷ life
 * (assets.ts straightLine), so a month's charge is (cost − residual) ÷ life to the centavo, a missed month is caught up,
 * and the asset stops at its residual value. Runs go month by month, one per month (unique per asset and month).
 * An opening asset (OBFA-) is not charged up to the last month the old books charged (assets.ts lastMonthCharged: the
 * month before a cut-over dated the 1st, else the cut-over month); after it, what the old books left is charged
 * (assets.ts scheduledCents), and its lines are kept in fa_opening_depreciation_lines.
 * Cancel needs later runs of its assets, and their disposals, cancelled first: only the latest charge comes off.
 * A run is dated in the month it depreciates, so the charge falls in that month's books: run it by the month's last
 * day, or after month end the accountant dates it the month's last day (acc.backdate).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { accumulatedCents, assetClass, assetParty, assetsInService, isOpeningAsset, monthsInService, scheduledCents } from '../assets.ts';

export const depreciationInput = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-09.') }) // the month depreciated, not the document's date
  .strict();
export type DepreciationInput = z.infer<typeof depreciationInput>;

/** One asset's charge; `accumulatedCents` is its accumulated depreciation after this charge. */
export interface DepreciationLine {
  assetId: string; assetNumber: string; description: string; expenseRole: string; accumRole: string; monthsElapsed: number; chargeCents: number; accumulatedCents: number;
}
export interface Depreciation extends DepreciationInput { lines: DepreciationLine[]; totalCents: number }

/** "2026-02" -> "2026-02-28". */
export const lastDayOf = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** "2026-09" -> "September 2026". */
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const depreciationDoc: DocTypeDef<DepreciationInput, Depreciation> = {
  key: 'fa.depreciation',
  module: 'FA',
  title: 'Depreciation Run',
  numbering: { series: { key: 'DEPR', prefix: 'DEPR-' } },
  permissions: { view: 'fa.depr.view', create: 'fa.depr.create', post: 'fa.depr.post', cancel: 'fa.depr.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: depreciationInput,

  compute(input, ctx) {
    const lines: DepreciationLine[] = [];
    for (const a of assetsInService(ctx.db)) {
      const monthsElapsed = monthsInService(a.acquiredOn, input.month);
      const target = scheduledCents(a, input.month);
      const chargeCents = target - accumulatedCents(ctx.db, a);
      if (monthsElapsed < 1 || chargeCents <= 0) continue;
      const cls = assetClass(ctx.db, a.classCode)!;
      lines.push({ assetId: a.id, assetNumber: a.number, description: a.description, expenseRole: cls.expenseRole, accumRole: cls.accumRole, monthsElapsed, chargeCents, accumulatedCents: target });
    }
    return { ...input, lines, totalCents: lines.reduce((s, l) => s + l.chargeCents, 0) };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (code: string, message: string) => issues.push({ field: 'month', code, level: 'error', message });
    const latest = ctx.db
      .prepare(`SELECT d.number, r.month FROM fa_depreciation_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' ORDER BY r.month DESC LIMIT 1`)
      .get() as { number: string; month: string } | undefined;
    if (doc.month > ctx.businessDate.slice(0, 7)) error('FUTURE_MONTH', 'Depreciation runs for this month or an earlier one.');
    else if (latest && latest.month === doc.month) error('ALREADY_RUN', `Depreciation for ${monthLabel(doc.month)} is already recorded on ${latest.number}.`);
    else if (latest && latest.month > doc.month) error('OUT_OF_ORDER', `Depreciation already ran for ${monthLabel(latest.month)} (${latest.number}). Runs go month by month.`);
    else if (ctx.businessDate.slice(0, 7) !== doc.month) {
      error('WRONG_MONTH', `The charge for ${monthLabel(doc.month)} belongs in ${monthLabel(doc.month)}. The accountant dates this run ${lastDayOf(doc.month)}.`);
    }
    else if (doc.lines.length === 0) error('NOTHING_TO_CHARGE', `No asset has depreciation to charge for ${monthLabel(doc.month)}.`);
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO fa_depreciation_runs (document_id, month) VALUES (?, ?)').run(h.documentId, doc.month);
    const insert = (table: string) => db.prepare(`INSERT INTO ${table} (document_id, asset_id, month, months_elapsed, charge_cents, accumulated_cents) VALUES (?, ?, ?, ?, ?, ?)`);
    const [line, openingLine] = [insert('fa_depreciation_lines'), insert('fa_opening_depreciation_lines')];
    for (const l of doc.lines) (isOpeningAsset(db, l.assetId) ? openingLine : line).run(h.documentId, l.assetId, doc.month, l.monthsElapsed, l.chargeCents, l.accumulatedCents);
  },

  journal(doc) {
    return {
      memo: `Depreciation for ${monthLabel(doc.month)}`,
      lines: doc.lines.flatMap((l) => [
        { account: { role: l.expenseRole }, debitCents: l.chargeCents, memo: `${l.assetNumber} ${l.description}` },
        { account: { role: l.accumRole }, party: assetParty(l.assetId), creditCents: l.chargeCents, memo: `${l.assetNumber} ${l.description}` },
      ]),
    };
  },

  load(db, documentId) {
    const month = db.prepare('SELECT month FROM fa_depreciation_runs WHERE document_id = ?').pluck().get(documentId) as string | undefined;
    if (!month) throw new Error(`Depreciation run ${documentId} not found`);
    const lines = db
      .prepare(
        `SELECT l.asset_id AS assetId, d.number AS assetNumber, a.description, c.expense_role AS expenseRole, c.accum_role AS accumRole,
           l.months_elapsed AS monthsElapsed, l.charge_cents AS chargeCents, l.accumulated_cents AS accumulatedCents
         FROM fa_all_depreciation_lines l JOIN fa_all_assets a ON a.document_id = l.asset_id JOIN documents d ON d.id = a.document_id
         JOIN fa_classes c ON c.code = a.class_code WHERE l.document_id = ? ORDER BY a.acquired_on, d.number`,
      )
      .all(documentId) as DepreciationLine[];
    return { month, lines, totalCents: lines.reduce((s, l) => s + l.chargeCents, 0) };
  },

  toInput: ({ month }) => ({ month }),

  summary(doc) {
    const n = doc.lines.length;
    return `This will charge ${formatPeso(doc.totalCents)} depreciation for ${monthLabel(doc.month)} on ${n} asset${n === 1 ? '' : 's'}.`;
  },

  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM fa_depreciation_runs r JOIN documents d ON d.id = r.document_id
         WHERE d.status = 'posted' AND r.month > (SELECT month FROM fa_depreciation_runs WHERE document_id = @id)
           AND EXISTS (SELECT 1 FROM fa_all_depreciation_lines a JOIN fa_all_depreciation_lines b ON b.asset_id = a.asset_id WHERE a.document_id = r.document_id AND b.document_id = @id)
         UNION
         SELECT d.id, d.number FROM fa_all_disposals x JOIN documents d ON d.id = x.document_id
         WHERE d.status = 'posted' AND x.asset_id IN (SELECT asset_id FROM fa_all_depreciation_lines WHERE document_id = @id)
         ORDER BY 2`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
  },

  /** A month of 2026; whether it may run depends on the runs before it. */
  arbitrary() {
    return fc.integer({ min: 1, max: 12 }).map((m) => ({ month: `2026-${String(m).padStart(2, '0')}` }));
  },
};
