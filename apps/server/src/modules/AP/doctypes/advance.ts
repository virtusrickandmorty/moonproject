/**
 * Supplier Advance (SADV-, PLAN D5 "SUP-ADV", E9). Money paid to a supplier before its bill: a downpayment on a
 * purchase order, a deposit for a service. Paid from one or more cash places, optionally on a purchase order.
 *   Dr 1230 advances to suppliers (the whole advance), party = the supplier, ref = the advance
 *   Cr 2311 EWT withheld on it, party = the supplier ; Cr cash place per tender (the advance less the EWT)
 * EWT is due when the income is paid or accrued, whichever comes first: so when the supplier's EWT class withholds
 * (rent, contractors, professionals; goods and services only for a Top Withholding Agent) the advance withholds on its
 * amount now, on NET for a VAT-registered supplier and on G otherwise (D4.5), at today's rate (D4.8), and the EWT
 * register, the 0619-E and 1601-EQ and the 2307s to issue count it in the advance's month. Only the accountant may
 * pick another class than the supplier's usual one. There is no input VAT here: it comes with the supplier's invoice,
 * on the bill.
 * A bill of the supplier applies the advance (Dr 2101 / Cr 1230, in the bill's journal, bill.ts) and leaves the part
 * the advance already withheld on out of its own EWT; an unused advance comes back on a Supplier Advance Return
 * (advance-return.ts). What is still open is read from the ledger, so an advance cancels only after those (D6).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { applyRate, formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { EWT_CLASSES, settingAt, type EwtClass } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { TWA_ONLY, appliedEwtClass } from '../../EXP/public.ts';
import { activeSupplierIds, purchaseOrder, supplier } from '../../PUR/public.ts';
import { usesOfAdvance } from '../ledger.ts';
import { EWT_PERMISSION, MAX_CENTS } from './bill.ts';

export const tender = z
  .object({
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    reference: z.string().trim().min(1).max(80).optional(), // check number, bank or GCash reference
  })
  .strict();
export type TenderInput = z.infer<typeof tender>;

export const advanceInput = z
  .object({
    supplierId: z.string().trim().min(1).max(80),
    purchaseOrderId: z.string().trim().min(1).max(80).optional(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // the whole advance, before any EWT
    tenders: z.array(tender).min(1).max(10), // what leaves the cash places: the advance less the EWT
    ewtClass: z.enum([...EWT_CLASSES, 'none']).optional(), // left out: the supplier's usual class
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type AdvanceInput = z.infer<typeof advanceInput>;

export interface AdvanceEwt { vatRegistered: boolean; vatRateBp: number; appliedEwtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number }
export interface Advance extends Omit<AdvanceInput, 'tenders'>, AdvanceEwt {
  tenders: (TenderInput & { lineNo: number; cashPlaceName: string })[];
  supplierName: string; supplierTin: string | null; usualEwtClass: EwtClass | null; purchaseOrderNumber: string | null;
  cashCents: number; totalCents: number;
}

/** The EWT an advance of `amountCents` withholds on `date` (the rates and VAT rate in force then). */
export function advanceEwt(db: Db, supplierId: string, amountCents: number, picked: AdvanceInput['ewtClass'], date: string): AdvanceEwt {
  const sup = supplier(db, supplierId);
  const vatRegistered = sup?.isVatRegistered ?? false;
  const vatRateBp = settingAt(db, 'tax.vat_rate_bp', date);
  const applied = appliedEwtClass(db, picked, sup?.ewtClass ?? null, date);
  const ewtRateBp = applied ? settingAt(db, 'tax.ewt_rates_bp', date)[applied] : 0;
  const ewtBaseCents = applied ? (vatRegistered ? vatFromGross(amountCents, vatRateBp).netCents : amountCents) : 0;
  return { vatRegistered, vatRateBp, appliedEwtClass: applied, ewtRateBp, ewtBaseCents, ewtCents: applied ? applyRate(ewtBaseCents, ewtRateBp) : 0 };
}

function build(db: Db, input: AdvanceInput, ewt: AdvanceEwt): Advance {
  const sup = supplier(db, input.supplierId);
  return {
    ...input, ...ewt,
    tenders: input.tenders.map((t, i) => ({ ...t, lineNo: i + 1, cashPlaceName: getCashPlace(db, t.cashPlaceId)?.name ?? '?' })),
    supplierName: sup?.name ?? '?', supplierTin: sup?.tin || null, usualEwtClass: sup?.ewtClass ?? null,
    purchaseOrderNumber: input.purchaseOrderId ? (purchaseOrder(db, input.purchaseOrderId)?.number ?? '?') : null,
    cashCents: input.amountCents - ewt.ewtCents,
    totalCents: input.amountCents,
  };
}

const pct = (bp: number) => `${bp / 100}%`;
const sum = (xs: readonly { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

export const advanceDoc: DocTypeDef<AdvanceInput, Advance> = {
  key: 'ap.advance',
  module: 'AP',
  title: 'Supplier Advance',
  numbering: { series: { key: 'SADV', prefix: 'SADV-' } },
  permissions: { view: 'ap.adv.view', create: 'ap.adv.create', post: 'ap.adv.post', cancel: 'ap.adv.cancel' },
  dating: 'system',
  inputSchema: advanceInput,

  compute(input, ctx) {
    return build(ctx.db, input, advanceEwt(ctx.db, input.supplierId, input.amountCents, input.ewtClass, ctx.businessDate));
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!supplier(ctx.db, doc.supplierId)?.isActive) add('error', 'supplierId', 'SUPPLIER', 'Pick an active supplier.');
    if (doc.purchaseOrderId) {
      const po = purchaseOrder(ctx.db, doc.purchaseOrderId);
      if (po?.status !== 'posted') add('error', 'purchaseOrderId', 'PURCHASE_ORDER', 'Pick a recorded purchase order.');
      else if (po.supplierId !== doc.supplierId) add('error', 'purchaseOrderId', 'PO_SUPPLIER', `${po.number} is for another supplier.`);
    }
    doc.tenders.forEach((t, i) => {
      if (!getCashPlace(ctx.db, t.cashPlaceId)?.isActive) add('error', `tenders.${i}.cashPlaceId`, 'CASH_PLACE', 'Pick an active cash place the money came from.');
    });
    const paid = sum(doc.tenders);
    if (paid !== doc.cashCents) {
      const ewt = doc.ewtCents > 0 ? ` (the advance of ${formatPeso(doc.amountCents)} less ${formatPeso(doc.ewtCents)} EWT)` : '';
      add('error', 'tenders', 'TENDERS', `The money paid out (${formatPeso(paid)}) must be ${formatPeso(doc.cashCents)}${ewt}.`);
    }
    const usual = appliedEwtClass(ctx.db, undefined, doc.usualEwtClass, ctx.businessDate);
    if (doc.appliedEwtClass !== usual && !ctx.can(EWT_PERMISSION)) add('error', 'ewtClass', 'EWT_ACCOUNTANT', 'Only the accountant can change the EWT from the supplier’s usual class.');
    if (doc.ewtClass && TWA_ONLY.has(doc.ewtClass) && !settingAt(ctx.db, 'tax.top_withholding_agent', ctx.businessDate)) {
      add('error', 'ewtClass', 'NOT_TWA', 'Virtus is not a Top Withholding Agent, so goods and services from regular suppliers have no EWT.');
    }
    if (doc.appliedEwtClass && !doc.supplierTin) add('error', 'ewtClass', 'TIN_REQUIRED', 'Withholding tax needs the supplier’s TIN on file (for the 2307).');
    if (doc.appliedEwtClass !== usual) {
      const was = usual ? `${pct(settingAt(ctx.db, 'tax.ewt_rates_bp', ctx.businessDate)[usual])} (${usual})` : 'none';
      add('warning', 'ewtClass', 'EWT_DIFFERENT', `The usual EWT for this supplier is ${was}. Please check.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO ap_advances (document_id, supplier_id, purchase_order_id, vat_registered, vat_rate_bp, amount_cents, ewt_class, ewt_rate_bp, ewt_base_cents, ewt_cents, cash_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.supplierId, doc.purchaseOrderId ?? null, +doc.vatRegistered, doc.vatRateBp, doc.amountCents,
      doc.appliedEwtClass, doc.ewtRateBp, doc.ewtBaseCents, doc.ewtCents, doc.cashCents, doc.note ?? null,
    );
    const t = db.prepare('INSERT INTO ap_advance_tenders (document_id, line_no, account_id, amount_cents, reference) VALUES (?, ?, ?, ?, ?)');
    for (const x of doc.tenders) t.run(h.documentId, x.lineNo, x.cashPlaceId, x.amountCents, x.reference ?? null);
  },

  journal(doc, _ctx, header) {
    const party = { type: 'supplier', id: doc.supplierId };
    const on = doc.purchaseOrderNumber ? ` on ${doc.purchaseOrderNumber}` : '';
    return {
      memo: `Advance to ${doc.supplierName}${on}`,
      lines: [
        { account: { role: 'SUPPLIER_ADVANCES' }, party, ...(header ? { ref: { documentId: header.documentId } } : {}), debitCents: doc.amountCents, memo: `Advance${on}` },
        { account: { role: 'EWT_PAYABLE' }, party, creditCents: doc.ewtCents, memo: `EWT ${doc.appliedEwtClass} on an advance` },
        ...doc.tenders.map((t) => ({ account: { cashPlace: t.cashPlaceId }, creditCents: t.amountCents, ...(t.reference ? { memo: t.reference } : {}) })),
      ],
    };
  },

  load(db, documentId) {
    const a = db
      .prepare(
        `SELECT supplier_id AS supplierId, purchase_order_id AS purchaseOrderId, amount_cents AS amountCents, note, vat_registered AS vatRegistered, vat_rate_bp AS vatRateBp,
           ewt_class AS appliedEwtClass, ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM ap_advances WHERE document_id = ?`,
      )
      .get(documentId) as
      | { supplierId: string; purchaseOrderId: string | null; amountCents: number; note: string | null; vatRegistered: number; vatRateBp: number; appliedEwtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number }
      | undefined;
    if (!a) throw new Error(`Supplier advance ${documentId} not found`);
    const tenders = (
      db.prepare('SELECT account_id AS cashPlaceId, amount_cents AS amountCents, reference FROM ap_advance_tenders WHERE document_id = ? ORDER BY line_no').all(documentId) as
        { cashPlaceId: number; amountCents: number; reference: string | null }[]
    ).map(({ reference, ...t }) => ({ ...t, ...(reference ? { reference } : {}) }));
    const input: AdvanceInput = {
      supplierId: a.supplierId, ...(a.purchaseOrderId ? { purchaseOrderId: a.purchaseOrderId } : {}), amountCents: a.amountCents, tenders,
      ewtClass: a.appliedEwtClass ?? 'none', ...(a.note ? { note: a.note } : {}),
    };
    const { vatRateBp, appliedEwtClass, ewtRateBp, ewtBaseCents, ewtCents } = a;
    return build(db, input, { vatRegistered: a.vatRegistered === 1, vatRateBp, appliedEwtClass, ewtRateBp, ewtBaseCents, ewtCents });
  },

  toInput(doc) {
    const { supplierId, purchaseOrderId, amountCents, ewtClass, note } = doc;
    const tenders = doc.tenders.map(({ cashPlaceId, amountCents: a, reference }) => ({ cashPlaceId, amountCents: a, ...(reference ? { reference } : {}) }));
    return { supplierId, ...(purchaseOrderId ? { purchaseOrderId } : {}), amountCents, tenders, ...(ewtClass ? { ewtClass } : {}), ...(note ? { note } : {}) };
  },

  dependents: (db, documentId) => usesOfAdvance(db, documentId),

  summary(doc) {
    const on = doc.purchaseOrderNumber ? ` on ${doc.purchaseOrderNumber}` : '';
    const ewt = doc.ewtCents > 0 ? `; ${formatPeso(doc.ewtCents)} is withheld now (EWT ${pct(doc.ewtRateBp)}), so ${formatPeso(doc.cashCents)} is paid out` : '';
    const from = doc.tenders.map((t) => `${formatPeso(t.amountCents)} from ${t.cashPlaceName}`).join(' and ');
    return `This will record an advance of ${formatPeso(doc.amountCents)} to ${doc.supplierName}${on}${ewt}: ${from}.`;
  },

  /**
   * Needs active suppliers (each with a TIN) on file: an advance at the supplier's usual class, from one or two cash
   * places. The EWT is worked out at the newest rates on file (the tests have no rate dated after today).
   */
  arbitrary(db) {
    const places = listCashPlaces(db).map((c) => c.id);
    return fc
      .record({
        supplierId: fc.constantFrom(...activeSupplierIds(db)),
        amountCents: fc.integer({ min: 100, max: 2_000_000_00 }),
        places: fc.tuple(fc.constantFrom(...places), fc.constantFrom(...places)),
        split: fc.boolean(),
      })
      .map(({ supplierId, amountCents, places: [a, b], split }): AdvanceInput => {
        const out = amountCents - advanceEwt(db, supplierId, amountCents, undefined, '9999-12-31').ewtCents;
        const first = split && out > 1 ? Math.floor(out / 2) : out;
        const tenders = [{ cashPlaceId: a, amountCents: first }, ...(first < out ? [{ cashPlaceId: b, amountCents: out - first, reference: 'CHK-0002' }] : [])];
        return { supplierId, amountCents, tenders };
      });
  },
};
