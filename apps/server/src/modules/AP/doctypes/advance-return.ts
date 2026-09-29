/**
 * Supplier Advance Return (SADR-, PLAN D5 "SUP-ADV"): the supplier gives back an advance, or the part of it no bill
 * used, into one or more cash places.
 *   Dr cash place per tender / Cr 1230 advances to suppliers, party = the supplier, ref = the advance
 * Never more than is still open on the advance, read from the ledger at posting time. The EWT the advance withheld
 * stays: it was due when the advance was paid, so the EWT register, the returns and the 2307s to issue keep counting it,
 * and a warning says so. If the 2307 was never issued, the accountant corrects it with a journal voucher.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { supplier } from '../../PUR/public.ts';
import { advance, openOnAdvance } from '../ledger.ts';
import { tender, type TenderInput } from './advance.ts';

export const advanceReturnInput = z
  .object({
    advanceId: z.string().trim().min(1).max(80),
    tenders: z.array(tender).min(1).max(10), // where the money came back to
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type AdvanceReturnInput = z.infer<typeof advanceReturnInput>;

export interface AdvanceReturn extends Omit<AdvanceReturnInput, 'tenders'> {
  tenders: (TenderInput & { lineNo: number; cashPlaceName: string })[];
  advanceNumber: string; supplierId: string; supplierName: string; advanceEwtCents: number; totalCents: number;
}

function build(db: Db, input: AdvanceReturnInput): AdvanceReturn {
  const a = advance(db, input.advanceId);
  return {
    ...input,
    tenders: input.tenders.map((t, i) => ({ ...t, lineNo: i + 1, cashPlaceName: getCashPlace(db, t.cashPlaceId)?.name ?? '?' })),
    advanceNumber: a?.number ?? '?', supplierId: a?.supplierId ?? '', supplierName: a ? (supplier(db, a.supplierId)?.name ?? '?') : '?',
    advanceEwtCents: a?.ewtCents ?? 0,
    totalCents: input.tenders.reduce((s, t) => s + t.amountCents, 0),
  };
}

export const advanceReturnDoc: DocTypeDef<AdvanceReturnInput, AdvanceReturn> = {
  key: 'ap.advance_return',
  module: 'AP',
  title: 'Supplier Advance Return',
  numbering: { series: { key: 'SADR', prefix: 'SADR-' } },
  permissions: { view: 'ap.adv.view', create: 'ap.adv.create', post: 'ap.adv.post', cancel: 'ap.adv.cancel' },
  dating: 'system',
  inputSchema: advanceReturnInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const a = advance(ctx.db, doc.advanceId);
    if (!a) add('error', 'advanceId', 'ADVANCE', 'Pick a recorded supplier advance.');
    else if (a.status !== 'posted') add('error', 'advanceId', 'ADVANCE_CANCELLED', `${a.number} was cancelled.`);
    else {
      const open = openOnAdvance(ctx.db, a.id);
      if (doc.totalCents > open) add('error', 'tenders', 'MORE_THAN_OPEN', open > 0 ? `Only ${formatPeso(open)} is still open on ${a.number}.` : `Nothing is open on ${a.number}: bills or returns used all of it.`);
      if (a.ewtCents > 0) {
        add('warning', 'advanceId', 'EWT_STAYS', `${a.number} withheld ${formatPeso(a.ewtCents)} EWT. That stays in the EWT register and on the 2307s to issue; if the 2307 was never issued, ask the accountant to correct it with a journal voucher.`);
      }
    }
    doc.tenders.forEach((t, i) => {
      if (!getCashPlace(ctx.db, t.cashPlaceId)?.isActive) add('error', `tenders.${i}.cashPlaceId`, 'CASH_PLACE', 'Pick an active cash place the money went into.');
    });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO ap_advance_returns (document_id, advance_id, note) VALUES (?, ?, ?)').run(h.documentId, doc.advanceId, doc.note ?? null);
    const t = db.prepare('INSERT INTO ap_advance_return_tenders (document_id, line_no, account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)');
    for (const x of doc.tenders) t.run(h.documentId, x.lineNo, x.cashPlaceId, x.amountCents, x.reference ?? null);
  },

  journal(doc) {
    return {
      memo: `${doc.supplierName} returned part of ${doc.advanceNumber}`,
      lines: [
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, debitCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
        { account: { role: 'SUPPLIER_ADVANCES' }, party: { type: 'supplier', id: doc.supplierId }, ref: { documentId: doc.advanceId }, creditCents: doc.totalCents, memo: `${doc.advanceNumber} returned` },
      ],
    };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT advance_id AS advanceId, note FROM ap_advance_returns WHERE document_id = ?').get(documentId) as { advanceId: string; note: string | null } | undefined;
    if (!r) throw new Error(`Supplier advance return ${documentId} not found`);
    const tenders = (
      db.prepare('SELECT account_id AS cashPlaceId, amount_cents AS amountCents, reference FROM ap_advance_return_tenders WHERE document_id = ? ORDER BY line_no').all(documentId) as
        { cashPlaceId: number; amountCents: number; reference: string | null }[]
    ).map(({ reference, ...t }) => ({ ...t, ...(reference ? { reference } : {}) }));
    return build(db, { advanceId: r.advanceId, tenders, ...(r.note ? { note: r.note } : {}) });
  },

  toInput(doc) {
    const tenders = doc.tenders.map(({ cashPlaceId, amountCents, reference }) => ({ cashPlaceId, amountCents, ...(reference ? { reference } : {}) }));
    return { advanceId: doc.advanceId, tenders, ...(doc.note ? { note: doc.note } : {}) };
  },

  summary(doc) {
    const into = doc.tenders.map((t) => `${formatPeso(t.amountCents)} into ${t.cashPlaceName}`).join(' and ');
    const ewt = doc.advanceEwtCents > 0 ? ` The ${formatPeso(doc.advanceEwtCents)} EWT the advance withheld stays.` : '';
    return `This will record ${doc.supplierName} giving back ${formatPeso(doc.totalCents)} of ${doc.advanceNumber}: ${into}.${ewt}`;
  },

  /** Part of an advance open when the generator is made, into one cash place. Once bills or returns used it up, validate refuses (MORE_THAN_OPEN). */
  arbitrary(db) {
    const open = (db.prepare(`SELECT a.document_id AS id FROM ap_advances a JOIN documents d ON d.id = a.document_id WHERE d.status = 'posted'`).pluck().all() as string[])
      .map((id) => ({ id, open: openOnAdvance(db, id) }))
      .filter((a) => a.open > 0);
    return fc
      .record({
        advance: fc.constantFrom(...(open.length > 0 ? open : [{ id: 'no-advance-yet', open: 1 }])),
        share: fc.integer({ min: 1, max: 100 }),
        cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
      })
      .map(({ advance: a, share, cashPlaceId }): AdvanceReturnInput => ({
        advanceId: a.id, tenders: [{ cashPlaceId, amountCents: Math.max(1, Math.floor((a.open * share) / 100)) }],
      }));
  },
};
