/**
 * Expense Voucher (PLAN D5 "EXP-PAY", E9; goldens G-13, G-14, G-16). Something paid now from one cash place.
 *   Dr category account (NET with a valid VAT receipt, else G) ; Dr 1401 input VAT / Cr 2311 EWT ; Cr cash place (G − EWT)
 * VAT comes from the gross at the rate in force on the receipt date (D4.1, D4.2), claimed only for a VAT-registered payee
 * with the receipt number, date and TIN (D4.7). EWT is withheld now, at accrual (D4.8), on NET for a VAT-registered payee
 * and on G otherwise (D4.5). The class is the one staff pick, else the supplier's, else the category's usual one.
 * Petty cash expenses simply pick the petty cash fund.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { applyRate, formatPeso, isBusinessDate, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { EWT_CLASSES, settingAt, type EwtClass } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { category, listCategories } from '../categories.ts';
import { supplier } from '../pur.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export type { EwtClass };
/** Withheld only when Virtus is a published Top Withholding Agent (setting tax.top_withholding_agent). */
const TWA_ONLY: ReadonlySet<string> = new Set(['goods_1', 'services_2']);

const tin = z.string().trim().regex(/^\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?$/, 'Type the TIN like 123-456-789-000.');
const receiptDate = z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.').refine((d) => d >= '2000-01-01', 'Check the year.');

export const voucherInput = z
  .object({
    categoryId: z.number().int().positive(),
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // what the receipt says, VAT included
    description: z.string().trim().min(3).max(200),
    supplierId: z.string().trim().min(1).max(80).optional(), // a supplier on file, or ...
    payeeName: z.string().trim().min(2).max(120).optional(), // ... a one-off payee, with:
    payeeVatRegistered: z.boolean().optional(),
    payeeTin: tin.optional(),
    supplierInvoiceNo: z.string().trim().min(1).max(40).optional(), // the VAT receipt: number, date (and the TIN)
    supplierInvoiceDate: receiptDate.optional(),
    ewtClass: z.enum([...EWT_CLASSES, 'none']).optional(), // left out: the usual class of the supplier or category
  })
  .strict();
export type VoucherInput = z.infer<typeof voucherInput>;

export interface Voucher extends VoucherInput {
  totalCents: number;
  categoryName: string;
  expenseAccountId: number;
  cashPlaceName: string;
  payee: { name: string; tin: string | null; vatRegistered: boolean; taxPartyId: string | null };
  usualEwtClass: EwtClass | null;
  vatRateBp: number;
  vatClaimed: boolean;
  expenseCents: number;
  inputVatCents: number;
  appliedEwtClass: EwtClass | null;
  ewtRateBp: number;
  ewtBaseCents: number;
  ewtCents: number;
  cashCents: number;
}

function computeVoucher(db: Db, input: VoucherInput, businessDate: string): Voucher {
  const G = input.amountCents;
  const cat = category(db, input.categoryId);
  const sup = input.supplierId ? supplier(db, input.supplierId) : undefined;
  const vatRegistered = sup ? sup.isVatRegistered : input.payeeVatRegistered === true;
  const payeeTin = sup ? sup.tin : (input.payeeTin ?? null);
  const taxPartyId = sup ? sup.id : payeeTin ? `tin:${payeeTin.replace(/-/g, '')}` : null;
  const vatRateBp = settingAt(db, 'tax.vat_rate_bp', input.supplierInvoiceDate ?? businessDate);
  const { netCents, vatCents } = vatRegistered ? vatFromGross(G, vatRateBp) : { netCents: G, vatCents: 0 };
  const vatClaimed = vatRegistered && Boolean(input.supplierInvoiceNo && input.supplierInvoiceDate && payeeTin);
  const usual = sup?.ewtClass ?? cat?.defaultEwtClass ?? null;
  const twa = settingAt(db, 'tax.top_withholding_agent', businessDate);
  const applied = input.ewtClass === 'none' ? null : (input.ewtClass ?? (usual && (twa || !TWA_ONLY.has(usual)) ? usual : null));
  const ewtRateBp = applied ? settingAt(db, 'tax.ewt_rates_bp', businessDate)[applied] : 0; // the rate in force on the payment date
  const ewtCents = applied ? applyRate(netCents, ewtRateBp) : 0;
  return {
    ...input,
    totalCents: G,
    categoryName: cat?.name ?? '?',
    expenseAccountId: cat?.accountId ?? 0,
    cashPlaceName: getCashPlace(db, input.cashPlaceId)?.name ?? '?',
    payee: { name: sup?.name ?? input.payeeName ?? '?', tin: payeeTin, vatRegistered, taxPartyId },
    usualEwtClass: usual,
    vatRateBp,
    vatClaimed,
    expenseCents: vatClaimed ? netCents : G,
    inputVatCents: vatClaimed ? vatCents : 0,
    appliedEwtClass: applied,
    ewtRateBp,
    ewtBaseCents: applied ? netCents : 0,
    ewtCents,
    cashCents: G - ewtCents,
  };
}

const pct = (bp: number) => `${bp / 100}%`;

export const voucherDoc: DocTypeDef<VoucherInput, Voucher> = {
  key: 'exp.voucher',
  module: 'EXP',
  title: 'Expense Voucher',
  numbering: { series: { key: 'EXP', prefix: 'EXP-' } },
  permissions: { view: 'exp.voucher.view', create: 'exp.voucher.create', post: 'exp.voucher.post', cancel: 'exp.voucher.cancel' },
  dating: 'system',
  inputSchema: voucherInput,

  compute(input, ctx) {
    return computeVoucher(ctx.db, input, ctx.businessDate);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!category(ctx.db, doc.categoryId)?.isActive) add('error', 'categoryId', 'CATEGORY', 'Pick what the money was spent on.');
    if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick where the money came from.');
    if (Boolean(doc.supplierId) === Boolean(doc.payeeName)) add('error', 'payeeName', 'PAYEE', 'Pick a supplier on file or type the payee’s name (one, not both).');
    if (doc.supplierId && !supplier(ctx.db, doc.supplierId)?.isActive) add('error', 'supplierId', 'SUPPLIER', 'Pick an active supplier.');
    if (doc.supplierId && (doc.payeeTin || doc.payeeVatRegistered)) {
      add('error', 'payeeTin', 'FROM_SUPPLIER', 'The supplier’s TIN and VAT registration come from the supplier record. Clear them here.');
    }
    if (doc.supplierInvoiceDate && doc.supplierInvoiceDate > ctx.businessDate) add('error', 'supplierInvoiceDate', 'RECEIPT_DATE', 'The receipt date cannot be after today.');
    if (doc.ewtClass && TWA_ONLY.has(doc.ewtClass) && !settingAt(ctx.db, 'tax.top_withholding_agent', ctx.businessDate)) {
      add('error', 'ewtClass', 'NOT_TWA', 'Virtus is not a Top Withholding Agent, so goods and services from regular suppliers have no EWT.');
    }
    if (doc.appliedEwtClass && !doc.payee.tin) add('error', 'payeeTin', 'TIN_REQUIRED', 'Withholding tax needs the payee’s TIN (for the 2307).');
    if (doc.supplierInvoiceNo && doc.payee.taxPartyId) {
      const dup = ctx.db
        .prepare(`SELECT d.number FROM exp_vouchers v JOIN documents d ON d.id = v.document_id WHERE v.tax_party_id = ? AND v.supplier_invoice_no = ? AND d.status = 'posted'`)
        .pluck()
        .get(doc.payee.taxPartyId, doc.supplierInvoiceNo) as string | undefined;
      if (dup) add('error', 'supplierInvoiceNo', 'DUPLICATE_RECEIPT', `Receipt no. ${doc.supplierInvoiceNo} of this payee is already on ${dup}.`);
    }
    if (doc.payee.vatRegistered && !doc.vatClaimed) {
      add('warning', 'supplierInvoiceNo', 'NO_INPUT_VAT', 'No input VAT: that needs the receipt number, its date and the payee’s TIN. The full amount goes to the expense.');
    }
    if (doc.ewtClass !== undefined && doc.usualEwtClass && doc.appliedEwtClass !== doc.usualEwtClass) {
      add('warning', 'ewtClass', 'EWT_DIFFERENT', `The usual EWT here is ${pct(settingAt(ctx.db, 'tax.ewt_rates_bp', ctx.businessDate)[doc.usualEwtClass])} (${doc.usualEwtClass}). Please check.`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO exp_vouchers (document_id, category_id, expense_account_id, cash_account_id, supplier_id, payee_name, payee_tin, payee_vat_registered,
         tax_party_id, description, supplier_invoice_no, supplier_invoice_date, gross_cents, vat_rate_bp, expense_cents, input_vat_cents,
         ewt_class, ewt_rate_bp, ewt_base_cents, ewt_cents, cash_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.categoryId, doc.expenseAccountId, doc.cashPlaceId, doc.supplierId ?? null, doc.payee.name, doc.payee.tin, +doc.payee.vatRegistered,
      doc.payee.taxPartyId, doc.description, doc.supplierInvoiceNo ?? null, doc.supplierInvoiceDate ?? null, doc.amountCents, doc.vatRateBp, doc.expenseCents,
      doc.inputVatCents, doc.appliedEwtClass, doc.ewtRateBp, doc.ewtBaseCents, doc.ewtCents, doc.cashCents,
    );
  },

  journal(doc) {
    const party = doc.payee.taxPartyId ? { type: 'supplier', id: doc.payee.taxPartyId } : undefined;
    const lines: DraftLine[] = [{ account: { accountId: doc.expenseAccountId }, debitCents: doc.expenseCents, memo: doc.description }];
    if (party && doc.inputVatCents > 0) lines.push({ account: { role: 'INPUT_VAT' }, party, debitCents: doc.inputVatCents, memo: `Receipt no. ${doc.supplierInvoiceNo}` });
    if (party && doc.ewtCents > 0) lines.push({ account: { role: 'EWT_PAYABLE' }, party, creditCents: doc.ewtCents, memo: `EWT ${doc.appliedEwtClass}` });
    lines.push({ account: { cashPlace: doc.cashPlaceId }, creditCents: doc.cashCents });
    return { memo: `${doc.categoryName}: ${doc.payee.name}`, lines };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM exp_vouchers WHERE document_id = ?').get(documentId) as Record<string, string | number | null> | undefined;
    if (!r) throw new Error(`Expense voucher ${documentId} not found`);
    const s = (k: string) => r[k] as string | null;
    const n = (k: string) => r[k] as number;
    const input: VoucherInput = {
      categoryId: n('category_id'),
      cashPlaceId: n('cash_account_id'),
      amountCents: n('gross_cents'),
      description: s('description')!,
      ...(s('supplier_id') ? { supplierId: s('supplier_id')! } : { payeeName: s('payee_name')!, payeeVatRegistered: n('payee_vat_registered') === 1, ...(s('payee_tin') ? { payeeTin: s('payee_tin')! } : {}) }),
      ...(s('supplier_invoice_no') ? { supplierInvoiceNo: s('supplier_invoice_no')! } : {}),
      ...(s('supplier_invoice_date') ? { supplierInvoiceDate: s('supplier_invoice_date')! } : {}),
      ewtClass: (s('ewt_class') as EwtClass | null) ?? 'none',
    };
    const cat = category(db, input.categoryId);
    return {
      ...input,
      totalCents: input.amountCents,
      categoryName: cat?.name ?? '?',
      expenseAccountId: n('expense_account_id'),
      cashPlaceName: getCashPlace(db, input.cashPlaceId)?.name ?? '?',
      payee: { name: s('payee_name')!, tin: s('payee_tin'), vatRegistered: n('payee_vat_registered') === 1, taxPartyId: s('tax_party_id') },
      usualEwtClass: (input.supplierId ? supplier(db, input.supplierId)?.ewtClass : null) ?? cat?.defaultEwtClass ?? null,
      vatRateBp: n('vat_rate_bp'),
      vatClaimed: n('input_vat_cents') > 0,
      expenseCents: n('expense_cents'),
      inputVatCents: n('input_vat_cents'),
      appliedEwtClass: s('ewt_class') as EwtClass | null,
      ewtRateBp: n('ewt_rate_bp'),
      ewtBaseCents: n('ewt_base_cents'),
      ewtCents: n('ewt_cents'),
      cashCents: n('cash_cents'),
    };
  },

  toInput(doc) {
    const { categoryId, cashPlaceId, amountCents, description, supplierId, payeeName, payeeVatRegistered, payeeTin, supplierInvoiceNo, supplierInvoiceDate, ewtClass } = doc;
    const payee = supplierId ? { supplierId } : { payeeName, payeeVatRegistered, payeeTin };
    const input = { categoryId, cashPlaceId, amountCents, description, ...payee, supplierInvoiceNo, supplierInvoiceDate, ewtClass };
    return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as VoucherInput;
  },

  summary(doc) {
    const vat = doc.inputVatCents > 0 ? `, with ${formatPeso(doc.inputVatCents)} input VAT` : '';
    const ewt = doc.ewtCents > 0 ? `; ${formatPeso(doc.ewtCents)} is withheld (EWT ${pct(doc.ewtRateBp)}), so ${formatPeso(doc.cashCents)} is paid out` : '';
    return `This will record ${formatPeso(doc.amountCents)} for ${doc.categoryName} paid to ${doc.payee.name} from ${doc.cashPlaceName}${vat}${ewt}.`;
  },

  /** One-off payees with a TIN; EWT classes that need no Top Withholding Agent status; receipts dated in 2025. */
  arbitrary(db) {
    const noTwa = [undefined, 'none', ...EWT_CLASSES.filter((c) => !TWA_ONLY.has(c))] as const;
    return fc
      .record({
        categoryId: fc.constantFrom(...listCategories(db).map((c) => c.id)),
        cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
        amountCents: fc.integer({ min: 1, max: 5_000_000_00 }),
        payeeVatRegistered: fc.boolean(),
        payeeTin: fc.constantFrom('111-222-333-000', '444-555-666-00000', '777-888-999-001'),
        receipt: fc.option(fc.record({ no: fc.integer({ min: 1, max: 999_999_999 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) }), { nil: undefined }),
        ewtClass: fc.constantFrom(...noTwa),
      })
      .map(({ receipt, ewtClass, ...r }): VoucherInput => ({
        ...r,
        description: 'Random expense',
        payeeName: 'Sample Payee',
        ...(receipt ? { supplierInvoiceNo: String(receipt.no), supplierInvoiceDate: `2025-${String(receipt.month).padStart(2, '0')}-${String(receipt.day).padStart(2, '0')}` } : {}),
        ...(ewtClass ? { ewtClass } : {}),
      }));
  },
};
