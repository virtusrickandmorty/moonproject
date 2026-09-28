/**
 * Asset Disposal (FAD-, PLAN D5 FA-DISP, E10): takes an asset off the books.
 *   Dr 15x1 accumulated depreciation ; Dr 7202 loss on disposal (book value) / Cr 15x0 cost
 * Only a retirement for now (nothing received, so no gain): a sale of an asset needs an invoice record for the output
 * VAT (D5), which Moonproject does not record yet, so a sale is refused. Run the month's depreciation first; the
 * figures are the ledger's on the day of the disposal. Cancel mirrors it and puts the asset back in service.
 * An opening asset (OBFA-) is disposed of the same way; its disposal is kept in fa_opening_disposals.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { accumulatedCents, asset, assetClass, assetParty, assetsInService, isOpeningAsset } from '../assets.ts';

export const disposalInput = z
  .object({
    assetId: z.string().trim().min(1).max(80),
    kind: z.enum(['retirement', 'sale']),
    reason: z.string().trim().min(5).max(300), // e.g. "Motor burned out, scrapped"
  })
  .strict();
export type DisposalInput = z.infer<typeof disposalInput>;

interface Figures { costCents: number; accumulatedCents: number; proceedsCents: number; gainCents: number; lossCents: number }
export interface Disposal extends DisposalInput, Figures { assetNumber: string; description: string; costRole: string; accumRole: string; totalCents: number }

/** The asset's number, description and accounts around the figures (worked out in compute, stored for load). */
function withNames(db: Db, input: DisposalInput, figures: Figures): Disposal {
  const a = asset(db, input.assetId);
  const cls = a && assetClass(db, a.classCode);
  return { ...input, ...figures, assetNumber: a?.number ?? '?', description: a?.description ?? '?', costRole: cls?.costRole ?? '?', accumRole: cls?.accumRole ?? '?', totalCents: figures.costCents };
}

export const disposalDoc: DocTypeDef<DisposalInput, Disposal> = {
  key: 'fa.disposal',
  module: 'FA',
  title: 'Asset Disposal',
  numbering: { series: { key: 'FAD', prefix: 'FAD-' } },
  permissions: { view: 'fa.disp.view', create: 'fa.disp.create', post: 'fa.disp.post', cancel: 'fa.disp.cancel' },
  dating: 'system',
  inputSchema: disposalInput,

  compute(input, ctx) {
    const a = asset(ctx.db, input.assetId);
    const costCents = a?.costCents ?? 0;
    const acc = a ? accumulatedCents(ctx.db, a) : 0;
    const proceedsCents = 0; // a retirement; a sale is refused until invoice records exist
    const net = proceedsCents - (costCents - acc);
    return withNames(ctx.db, input, { costCents, accumulatedCents: acc, proceedsCents, gainCents: Math.max(net, 0), lossCents: Math.max(-net, 0) });
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const a = asset(ctx.db, doc.assetId);
    if (doc.kind === 'sale') {
      issues.push({ field: 'kind', code: 'SALE_NEEDS_INVOICE', level: 'error', message: 'Selling an asset needs an invoice record, which cannot be recorded yet. Only a retirement (nothing received) can be recorded now.' });
    }
    if (!a || a.docStatus !== 'posted') issues.push({ field: 'assetId', code: 'ASSET', level: 'error', message: 'Pick a recorded asset.' });
    else if (a.disposal) issues.push({ field: 'assetId', code: 'DISPOSED', level: 'error', message: `${a.number} is already disposed of on ${a.disposal}.` });
    return issues;
  },

  persist(db, doc, h) {
    const table = isOpeningAsset(db, doc.assetId) ? 'fa_opening_disposals' : 'fa_disposals';
    db.prepare(
      `INSERT INTO ${table} (document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.assetId, doc.kind, doc.reason, doc.costCents, doc.accumulatedCents, doc.proceedsCents, doc.gainCents, doc.lossCents);
  },

  journal(doc) {
    const party = assetParty(doc.assetId);
    const memo = `${doc.assetNumber} ${doc.description}`;
    return {
      memo: `Retirement of ${memo}: ${doc.reason}`,
      lines: [
        { account: { role: doc.accumRole }, party, debitCents: doc.accumulatedCents, memo },
        { account: { role: 'LOSS_ON_DISPOSAL' }, debitCents: doc.lossCents, memo },
        { account: { role: doc.costRole }, party, creditCents: doc.costCents, memo },
        { account: { role: 'GAIN_ON_DISPOSAL' }, creditCents: doc.gainCents, memo },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT asset_id AS assetId, kind, reason, cost_cents AS costCents, accumulated_cents AS accumulatedCents, proceeds_cents AS proceedsCents,
           gain_cents AS gainCents, loss_cents AS lossCents FROM fa_all_disposals WHERE document_id = ?`,
      )
      .get(documentId) as (DisposalInput & Figures) | undefined;
    if (!r) throw new Error(`Disposal ${documentId} not found`);
    const { assetId, kind, reason, ...figures } = r;
    return withNames(db, { assetId, kind, reason }, figures);
  },

  toInput: ({ assetId, kind, reason }) => ({ assetId, kind, reason }),

  summary(doc) {
    const loss = doc.lossCents > 0 ? `, a loss of ${formatPeso(doc.lossCents)} (its book value)` : ', with no book value left';
    return `This will retire ${doc.assetNumber} ${doc.description}: cost ${formatPeso(doc.costCents)} less ${formatPeso(doc.accumulatedCents)} accumulated depreciation${loss}.`;
  },

  /** Retires an asset in service (there must be one). */
  arbitrary(db) {
    return fc.record({
      assetId: fc.constantFrom(...assetsInService(db).map((a) => a.id)),
      kind: fc.constant('retirement' as const),
      reason: fc.constantFrom('Broken beyond repair', 'Scrapped, no longer used'),
    });
  },
};
