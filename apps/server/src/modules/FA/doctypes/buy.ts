/**
 * Fixed Asset purchase (FA-, PLAN D5 FA-BUY, E10, golden G-21). Puts one asset in the register and records how it
 * was paid: now from a cash place, on account with the supplier, financed, or a mix of the three.
 *   Dr 15x0 cost (NET with a valid VAT invoice, else G) ; Dr 1401 input VAT / Cr cash place ; Cr 2101 AP ; Cr 2602 financing
 * Capital-goods input VAT is claimed in full now, at the rate in force on the supplier's invoice date (D4.2), for a
 * VAT-registered supplier with the invoice number, date and TIN (D4.7). The FA- document id is the asset's party id,
 * the financing's (until a LOAN- document takes the financing over into the loan register) and the ref of the amount
 * owed, so a preview shows them unnamed. A purchase cancels only after its depreciation, retirement and loan are cancelled.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, isBusinessDate, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { settingAt } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assetClass, assetParty, listClasses } from '../assets.ts';
import { activeSupplierIds, supplier } from '../pur.ts';
import { loansFinancingAsset } from '../../LOAN/public.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
const part = z.number().int().positive().max(MAX_CENTS).optional();

export const buyInput = z
  .object({
    classCode: z.string().trim().min(1).max(20),
    description: z.string().trim().min(3).max(200),
    location: z.string().trim().min(1).max(80).optional(),
    supplierId: z.string().trim().min(1).max(80),
    supplierInvoiceNo: z.string().trim().min(1).max(40).optional(),
    supplierInvoiceDate: z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.').refine((d) => d >= '2000-01-01', 'Check the year.').optional(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // the invoice total, VAT included
    residualCents: z.number().int().min(0).max(MAX_CENTS),
    lifeMonths: z.number().int().min(1).max(600).optional(), // left out: the class's usual life
    cashPlaceId: z.number().int().positive().optional(), // paid now from here ...
    paidCents: part,
    onAccountCents: part, // ... owed to the supplier ...
    financedCents: part, // ... or financed by a lender
    lender: z.string().trim().min(2).max(120).optional(),
  })
  .strict();
export type BuyInput = z.infer<typeof buyInput>;

interface Figures { vatRateBp: number; costCents: number; inputVatCents: number }

/** `life` is lifeMonths, else the class's usual life, else 0 (then it must be typed). */
export interface Buy extends BuyInput, Figures { totalCents: number; className: string; costRole: string; life: number; supplierName: string; vatRegistered: boolean; cashPlaceName: string | null }

/** The names and accounts a purchase shows and posts to, around its figures (worked out in compute, stored for load). */
function withNames(db: Db, input: BuyInput, figures: Figures): Buy {
  const cls = assetClass(db, input.classCode);
  const sup = supplier(db, input.supplierId);
  const cashPlaceName = input.cashPlaceId ? (getCashPlace(db, input.cashPlaceId)?.name ?? '?') : null;
  return {
    ...input, ...figures, totalCents: input.amountCents, className: cls?.name ?? '?', costRole: cls?.costRole ?? '?', life: input.lifeMonths ?? cls?.defaultLifeMonths ?? 0,
    supplierName: sup?.name ?? '?', vatRegistered: sup?.isVatRegistered ?? false, cashPlaceName,
  };
}

export const buyDoc: DocTypeDef<BuyInput, Buy> = {
  key: 'fa.buy',
  module: 'FA',
  title: 'Fixed Asset',
  numbering: { series: { key: 'FA', prefix: 'FA-' } },
  permissions: { view: 'fa.buy.view', create: 'fa.buy.create', post: 'fa.buy.post', cancel: 'fa.buy.cancel' },
  dating: 'system',
  inputSchema: buyInput,

  compute(input, ctx) {
    const sup = supplier(ctx.db, input.supplierId);
    const vatRateBp = settingAt(ctx.db, 'tax.vat_rate_bp', input.supplierInvoiceDate ?? ctx.businessDate);
    const claimed = sup?.isVatRegistered && Boolean(input.supplierInvoiceNo && input.supplierInvoiceDate && sup.tin);
    const { netCents, vatCents } = claimed ? vatFromGross(input.amountCents, vatRateBp) : { netCents: input.amountCents, vatCents: 0 };
    return withNames(ctx.db, input, { vatRateBp, costCents: netCents, inputVatCents: vatCents });
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const cls = assetClass(ctx.db, doc.classCode);
    if (!cls) add('error', 'classCode', 'CLASS', 'Pick the kind of asset.');
    if (!supplier(ctx.db, doc.supplierId)?.isActive) add('error', 'supplierId', 'SUPPLIER', 'Pick an active supplier.');
    if (doc.life === 0) add('error', 'lifeMonths', 'LIFE', 'Type the useful life in months (for leasehold improvements, the lease term).');
    if (doc.residualCents >= doc.costCents) add('error', 'residualCents', 'RESIDUAL', `The residual value must be less than the cost of ${formatPeso(doc.costCents)}.`);
    const paid = doc.paidCents ?? 0, onAccount = doc.onAccountCents ?? 0, financed = doc.financedCents ?? 0;
    if (paid + onAccount + financed !== doc.amountCents) {
      add('error', 'paidCents', 'PAYMENT', `Paid now, on account and financed must add up to the invoice total of ${formatPeso(doc.amountCents)}.`);
    }
    if (Boolean(doc.cashPlaceId) !== paid > 0) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick where the money came from and type how much was paid from it.');
    else if (doc.cashPlaceId && !getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick an active cash place.');
    if (Boolean(doc.lender) !== financed > 0) add('error', 'lender', 'LENDER', 'Type who financed the asset and how much they financed.');
    if (doc.supplierInvoiceDate && doc.supplierInvoiceDate > ctx.businessDate) add('error', 'supplierInvoiceDate', 'INVOICE_DATE', 'The invoice date cannot be after today.');
    if (doc.supplierInvoiceNo) {
      const dup = ctx.db
        .prepare(`SELECT d.number FROM fa_assets a JOIN documents d ON d.id = a.document_id WHERE a.supplier_id = ? AND a.supplier_invoice_no = ? AND d.status = 'posted'`)
        .pluck()
        .get(doc.supplierId, doc.supplierInvoiceNo) as string | undefined;
      if (dup) add('error', 'supplierInvoiceNo', 'DUPLICATE_INVOICE', `Invoice no. ${doc.supplierInvoiceNo} of this supplier is already on ${dup}.`);
    }
    if (doc.vatRegistered && doc.inputVatCents === 0) {
      add('warning', 'supplierInvoiceNo', 'NO_INPUT_VAT', 'No input VAT: that needs the invoice number, its date and the supplier’s TIN. The full amount goes to the cost.');
    }
    if (cls?.defaultLifeMonths && doc.life !== cls.defaultLifeMonths) {
      add('warning', 'lifeMonths', 'LIFE_DIFFERENT', `The usual life of ${cls.name.toLowerCase()} is ${cls.defaultLifeMonths} months. Please check.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO fa_assets (document_id, class_code, description, location, acquired_on, cost_cents, residual_cents, life_months, supplier_id,
         supplier_invoice_no, supplier_invoice_date, gross_cents, vat_rate_bp, input_vat_cents, cash_account_id, paid_cents, on_account_cents, financed_cents, lender)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.classCode, doc.description, doc.location ?? null, h.businessDate, doc.costCents, doc.residualCents, doc.life, doc.supplierId,
      doc.supplierInvoiceNo ?? null, doc.supplierInvoiceDate ?? null, doc.amountCents, doc.vatRateBp, doc.inputVatCents, doc.cashPlaceId ?? null,
      doc.paidCents ?? 0, doc.onAccountCents ?? 0, doc.financedCents ?? 0, doc.lender ?? null,
    );
  },

  journal(doc, _ctx, header) {
    const self = header?.documentId ?? 'this asset';
    const sup = { type: 'supplier', id: doc.supplierId };
    return {
      memo: `${doc.className}: ${doc.description}, from ${doc.supplierName}`,
      lines: [
        { account: { role: doc.costRole }, party: assetParty(self), debitCents: doc.costCents, memo: doc.description },
        { account: { role: 'INPUT_VAT' }, party: sup, debitCents: doc.inputVatCents, memo: `Invoice no. ${doc.supplierInvoiceNo}` },
        ...(doc.cashPlaceId ? [{ account: { cashPlace: doc.cashPlaceId }, creditCents: doc.paidCents }] : []),
        { account: { role: 'AP' }, party: sup, ...(header ? { ref: { documentId: header.documentId } } : {}), creditCents: doc.onAccountCents }, // owed on this FA-
        { account: { role: 'EQUIP_FINANCING' }, party: { type: 'loan', id: self }, creditCents: doc.financedCents, memo: `Financed by ${doc.lender}` },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT class_code AS classCode, description, location, supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo,
           supplier_invoice_date AS supplierInvoiceDate, gross_cents AS amountCents, residual_cents AS residualCents, life_months AS lifeMonths,
           cash_account_id AS cashPlaceId, paid_cents AS paidCents, on_account_cents AS onAccountCents, financed_cents AS financedCents, lender,
           vat_rate_bp AS vatRateBp, cost_cents AS costCents, input_vat_cents AS inputVatCents FROM fa_assets WHERE document_id = ?`,
      )
      .get(documentId) as (Record<string, string | number | null> & Figures) | undefined;
    if (!r) throw new Error(`Fixed asset ${documentId} not found`);
    const { vatRateBp, costCents, inputVatCents, ...stored } = r;
    const input = Object.fromEntries(Object.entries(stored).filter(([k, v]) => v !== null && (v !== 0 || k === 'residualCents'))) as BuyInput;
    return withNames(db, input, { vatRateBp, costCents, inputVatCents });
  },

  toInput: (doc) => Object.fromEntries(Object.keys(buyInput.shape).flatMap((k) => (doc[k as keyof BuyInput] === undefined ? [] : [[k, doc[k as keyof BuyInput]]]))) as BuyInput,

  /** Its depreciation runs and its disposal (a retirement or a sale) are cancelled first, so the asset's accounts come back to zero. */
  dependents(db, documentId) {
    const own = db
      .prepare(
        `SELECT d.id, d.number FROM fa_depreciation_lines l JOIN documents d ON d.id = l.document_id WHERE l.asset_id = @id AND d.status = 'posted'
         UNION
         SELECT d.id, d.number FROM fa_disposals x JOIN documents d ON d.id = x.document_id WHERE x.asset_id = @id AND d.status = 'posted'
         UNION
         SELECT d.id, d.number FROM fa_asset_sales x JOIN documents d ON d.id = x.document_id WHERE x.asset_id = @id AND d.status = 'posted'
         ORDER BY 2`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
    return [...own, ...loansFinancingAsset(db, documentId)];
  },

  summary(doc) {
    const vat = doc.inputVatCents > 0 ? ` (cost ${formatPeso(doc.costCents)}, input VAT ${formatPeso(doc.inputVatCents)})` : '';
    const how = [
      doc.paidCents ? `${formatPeso(doc.paidCents)} paid from ${doc.cashPlaceName}` : '',
      doc.onAccountCents ? `${formatPeso(doc.onAccountCents)} owed to ${doc.supplierName}` : '',
      doc.financedCents ? `${formatPeso(doc.financedCents)} financed by ${doc.lender}` : '',
    ].filter(Boolean);
    return `This will record ${doc.description} (${doc.className.toLowerCase()}) bought from ${doc.supplierName} for ${formatPeso(doc.amountCents)}${vat}: ${how.join(', ')}. It depreciates over ${doc.life} months down to ${formatPeso(doc.residualCents)}.`;
  },

  /** Needs an active supplier on file. Paid from one cash place, on account, financed, or split over the three. */
  arbitrary(db) {
    const pick = <T>(xs: T[]) => fc.constantFrom(...xs);
    return fc
      .tuple(pick(listClasses(db).map((c) => c.code)), pick(activeSupplierIds(db)), pick(listCashPlaces(db).map((c) => c.id)), fc.integer({ min: 100_00, max: 5_000_000_00 }),
        fc.integer({ min: 0, max: 50 }), fc.integer({ min: 1, max: 120 }), fc.option(fc.integer({ min: 1, max: 999_999 }), { nil: undefined }), fc.nat(100), fc.nat(100))
      .map(([classCode, supplierId, cashPlaceId, amountCents, residualPct, lifeMonths, invoiceNo, a, b]): BuyInput => {
        const paid = Math.floor((amountCents * Math.min(a, b)) / 100), onAccount = Math.floor((amountCents * Math.abs(a - b)) / 100);
        const financed = amountCents - paid - onAccount;
        return {
          classCode, description: 'Random asset', supplierId, amountCents, lifeMonths,
          residualCents: Math.floor((amountCents * residualPct) / 200), // under a quarter of the gross, so under the net cost too
          ...(invoiceNo ? { supplierInvoiceNo: `SI-${invoiceNo}`, supplierInvoiceDate: '2026-01-15' } : {}),
          ...(paid > 0 ? { cashPlaceId, paidCents: paid } : {}),
          ...(onAccount > 0 ? { onAccountCents: onAccount } : {}),
          ...(financed > 0 ? { financedCents: financed, lender: 'Sample Leasing Corp.' } : {}),
        };
      });
  },
};
