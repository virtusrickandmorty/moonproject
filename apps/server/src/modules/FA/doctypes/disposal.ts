/**
 * Asset Disposal (FAD-, PLAN D5 FA-DISP, E10): takes an asset off the books, at the ledger's figures on the day.
 * Retirement (nothing received):
 *   Dr 15x1 accumulated depreciation ; Dr 7202 loss on disposal (book value) / Cr 15x0 cost
 * Sale (the manual BIR invoice written for it, paid in full on the spot into one cash place; a bank transfer counts):
 *   Dr cash place (G) ; Dr 15x1 accumulated depreciation / Cr 15x0 cost ; Cr 2301 output VAT(G) ; Cr 7102 gain or
 *   Dr 7202 loss = NET − book value
 * The sale's VAT is the invoice record's (D4.1): VAT on the whole price at the rate in force on the day, NET = G − VAT,
 * and the booklet number is checked like a quick sale's: in a registered booklet and used once, ever, across the IR-
 * series (JO invoice records, downpayment invoices, quick sales and these). The buyer is a customer picked, or a name,
 * address and TIN typed (then the sale itself is the customer party on 2301, and the tax registers read the typed buyer).
 * Run the month's depreciation first: without it that month's charge ends up in the gain or loss (a warning).
 * Cancel mirrors it on the cancel day (D6) and puts the asset back in service; a sale's invoice number stays used and
 * shows as cancelled in the booklet. An opening asset (OBFA-) is disposed of the same way (fa_opening_disposals).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { getCashPlace, listCashPlaces } from '../../../engine/ledger/accounts.ts';
import { settingAt } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { customerRef, customerTaxInfo } from '../../CUS/public.ts';
import { invoiceNumberUsedBy } from '../../JO/public.ts';
import { bookletIssue } from '../../TAX/public.ts';
import { accumulatedCents, asset, assetClass, assetParty, assetsInService, isOpeningAsset, monthsInService, scheduledCents } from '../assets.ts';
import { DISPOSAL_SERIES, assetSale } from '../sales.ts';
import { monthLabel } from './depreciation.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

export const disposalInput = z
  .object({
    assetId: z.string().trim().min(1).max(80),
    kind: z.enum(['retirement', 'sale']),
    reason: z.string().trim().min(5).max(300), // e.g. "Motor burned out, scrapped"
    // A sale only: the buyer (a customer picked, or typed) ...
    customerId: z.uuid().optional(),
    buyerName: z.string().trim().min(2).max(200).optional(),
    buyerAddress: z.string().trim().min(5).max(300).optional(),
    buyerTin: z.string().trim().regex(/^\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?$/, 'Type the TIN like 123-456-789-000.').optional(),
    // ... the number typed from the booklet, never prefilled (TAX, D7) ...
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).').optional(),
    priceCents: z.number().int().positive().max(MAX_CENTS).optional(), // VAT included
    cashPlaceId: z.number().int().positive().optional(), // ... and where the buyer paid it
  })
  .strict();
export type DisposalInput = z.infer<typeof disposalInput>;
const SALE_FIELDS = ['customerId', 'buyerName', 'buyerAddress', 'buyerTin', 'invoiceNumber', 'priceCents', 'cashPlaceId'] as const;

interface Figures { costCents: number; accumulatedCents: number; proceedsCents: number; gainCents: number; lossCents: number }
/** A sale's invoice: "write these on the booklet" (VATable sales, VAT, total) and who it is written to. */
export interface SaleFigures { vatRateBp: number; grossCents: number; vatCents: number; vatableSalesCents: number; buyerName: string; buyerTin: string | null; cashPlaceName: string }
export interface Disposal extends DisposalInput, Figures {
  assetNumber: string; description: string; costRole: string; accumRole: string; bookValueCents: number; sale: SaleFigures | null; totalCents: number;
}

/** The buyer's name and TIN as the invoice shows them: the customer's registered name and TIN, or as typed. */
function buyerOf(db: Db, input: DisposalInput): { buyerName: string; buyerTin: string | null } {
  if (!input.customerId) return { buyerName: input.buyerName ?? '?', buyerTin: input.buyerTin ?? null };
  const tax = customerTaxInfo(db, input.customerId);
  return { buyerName: tax?.registeredName ?? customerRef(db, input.customerId)?.display_name ?? '?', buyerTin: tax?.tin ?? null };
}

/** The asset's number, description and accounts around the figures (worked out in compute, stored for load). */
function withNames(db: Db, input: DisposalInput, figures: Figures, sale: SaleFigures | null): Disposal {
  const a = asset(db, input.assetId);
  const cls = a && assetClass(db, a.classCode);
  return {
    ...input, ...figures, assetNumber: a?.number ?? '?', description: a?.description ?? '?', costRole: cls?.costRole ?? '?', accumRole: cls?.accumRole ?? '?',
    bookValueCents: figures.costCents - figures.accumulatedCents, sale, totalCents: sale ? sale.grossCents : figures.costCents,
  };
}

/** Gain or loss: what the asset brought in (NET of VAT; nothing for a retirement) less its book value. */
function result(costCents: number, acc: number, proceedsCents: number): Figures {
  const net = proceedsCents - (costCents - acc);
  return { costCents, accumulatedCents: acc, proceedsCents, gainCents: Math.max(net, 0), lossCents: Math.max(-net, 0) };
}

const cashPlaceName = (db: Db, id: number | undefined) => (id ? (getCashPlace(db, id)?.name ?? '?') : '?');

export const disposalDoc: DocTypeDef<DisposalInput, Disposal> = {
  key: 'fa.disposal',
  module: 'FA',
  title: 'Asset Disposal',
  numbering: { series: DISPOSAL_SERIES },
  permissions: { view: 'fa.disp.view', create: 'fa.disp.create', post: 'fa.disp.post', cancel: 'fa.disp.cancel' },
  dating: 'system',
  inputSchema: disposalInput,
  externalNumber: (doc) => (doc.kind === 'sale' ? (doc.invoiceNumber ?? null) : null),

  compute(input, ctx) {
    const a = asset(ctx.db, input.assetId);
    const costCents = a?.costCents ?? 0;
    const acc = a ? accumulatedCents(ctx.db, a) : 0;
    if (input.kind !== 'sale') return withNames(ctx.db, input, result(costCents, acc, 0), null);
    const vatRateBp = settingAt(ctx.db, 'tax.vat_rate_bp', ctx.businessDate);
    const grossCents = input.priceCents ?? 0; // none typed: refused in validate
    const { netCents, vatCents } = vatFromGross(grossCents, vatRateBp);
    const sale = { vatRateBp, grossCents, vatCents, vatableSalesCents: netCents, ...buyerOf(ctx.db, input), cashPlaceName: cashPlaceName(ctx.db, input.cashPlaceId) };
    return withNames(ctx.db, input, result(costCents, acc, netCents), sale);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    const a = asset(ctx.db, doc.assetId);
    if (!a || a.docStatus !== 'posted') error('assetId', 'ASSET', 'Pick a recorded asset.');
    else if (a.disposal) error('assetId', 'DISPOSED', `${a.number} is already disposed of on ${a.disposal}.`);
    else {
      const month = ctx.businessDate.slice(0, 7);
      if (monthsInService(a.acquiredOn, month) >= 1 && scheduledCents(a, month) > doc.accumulatedCents) {
        issues.push({
          field: 'assetId', code: 'DEPRECIATION_NOT_RUN', level: 'warning',
          message: `Depreciation for ${monthLabel(month)} is not recorded for ${a.number} yet. Run it first: otherwise that month's charge ends up in the ${doc.kind === 'sale' ? 'gain or loss' : 'loss'}.`,
        });
      }
    }
    if (doc.kind === 'retirement') {
      if (SALE_FIELDS.some((k) => doc[k] !== undefined)) error('kind', 'SALE_ONLY', 'The buyer, invoice number, price and cash place are for a sale. A retirement brings in nothing.');
      return issues;
    }
    const typed = [doc.buyerName, doc.buyerAddress, doc.buyerTin];
    if (doc.customerId) {
      const c = customerRef(ctx.db, doc.customerId);
      if (typed.some((t) => t !== undefined)) error('customerId', 'BUYER', 'Pick the buyer from the customers or type their name, address and TIN, not both.');
      else if (c?.is_active !== 1) error('customerId', 'CUSTOMER', c ? `${c.display_name} is inactive. Pick an active customer.` : 'Pick the buyer from the customers.');
    } else if (typed.some((t) => t === undefined)) {
      error('buyerName', 'BUYER', 'Pick the buyer from the customers, or type their name, address and TIN (all three go on the invoice).');
    }
    if (!doc.invoiceNumber) error('invoiceNumber', 'INVOICE', 'Type the number of the invoice written for this sale (from the booklet).');
    else {
      const used = invoiceNumberUsedBy(ctx.db, doc.invoiceNumber);
      if (used) {
        const how = used.status === 'cancelled' ? ' (cancelled)' : '';
        error('invoiceNumber', 'INVOICE_USED', `Invoice no. ${doc.invoiceNumber} is already used on ${used.number}${how}. Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.`);
      }
      const booklet = bookletIssue(ctx.db, 'SALES_INVOICE', doc.invoiceNumber, 'invoiceNumber');
      if (booklet) issues.push(booklet);
    }
    if (!doc.priceCents) error('priceCents', 'PRICE', 'Type the price the buyer paid, VAT included.');
    else if (doc.proceedsCents <= 0 || doc.sale!.vatCents <= 0) error('priceCents', 'PRICE', 'The price is too small to invoice. Type it like 33,600.00');
    if (!doc.cashPlaceId) error('cashPlaceId', 'CASH_PLACE', 'Pick where the buyer paid (the cash drawer, or the bank for a transfer).');
    else if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) error('cashPlaceId', 'CASH_PLACE', 'Pick an active cash place.');
    return issues;
  },

  persist(db, doc, h) {
    const table = isOpeningAsset(db, doc.assetId) ? 'fa_opening_disposals' : 'fa_disposals';
    db.prepare(
      `INSERT INTO ${table} (document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.assetId, doc.kind, doc.reason, doc.costCents, doc.accumulatedCents, doc.proceedsCents, doc.gainCents, doc.lossCents);
    if (!doc.sale) return;
    db.prepare(
      `INSERT INTO fa_sales (document_id, customer_id, buyer_name, buyer_address, buyer_tin, invoice_number, vat_rate_bp, gross_cents, vat_cents, net_cents, cash_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.customerId ?? null, doc.sale.buyerName, doc.customerId ? null : (doc.buyerAddress ?? null), doc.sale.buyerTin, doc.invoiceNumber,
      doc.sale.vatRateBp, doc.sale.grossCents, doc.sale.vatCents, doc.sale.vatableSalesCents, doc.cashPlaceId,
    );
  },

  journal(doc, _ctx, header) {
    const party = assetParty(doc.assetId);
    const memo = `${doc.assetNumber} ${doc.description}`;
    if (!doc.sale) {
      return {
        memo: `Retirement of ${memo}: ${doc.reason}`,
        lines: [
          { account: { role: doc.accumRole }, party, debitCents: doc.accumulatedCents, memo },
          { account: { role: 'LOSS_ON_DISPOSAL' }, debitCents: doc.lossCents, memo },
          { account: { role: doc.costRole }, party, creditCents: doc.costCents, memo },
          { account: { role: 'GAIN_ON_DISPOSAL' }, creditCents: doc.gainCents, memo },
        ],
      };
    }
    // A typed buyer has no customer record: the sale itself is the party (a preview has no id yet and shows it unnamed).
    const buyer = { type: 'customer', id: doc.customerId ?? header?.documentId ?? 'this sale' };
    const invoice = `Invoice no. ${doc.invoiceNumber}`;
    return {
      memo: `Sale of ${memo} to ${doc.sale.buyerName}, invoice no. ${doc.invoiceNumber}`,
      lines: [
        { account: { cashPlace: doc.cashPlaceId! }, debitCents: doc.sale.grossCents, memo: invoice },
        { account: { role: doc.accumRole }, party, debitCents: doc.accumulatedCents, memo },
        { account: { role: doc.costRole }, party, creditCents: doc.costCents, memo },
        { account: { role: 'OUTPUT_VAT' }, party: buyer, creditCents: doc.sale.vatCents, memo: invoice },
        { account: { role: 'GAIN_ON_DISPOSAL' }, creditCents: doc.gainCents, memo },
        { account: { role: 'LOSS_ON_DISPOSAL' }, debitCents: doc.lossCents, memo },
      ],
    };
  },

  load(db, documentId) {
    const r = db
      .prepare(
        `SELECT asset_id AS assetId, kind, reason, cost_cents AS costCents, accumulated_cents AS accumulatedCents, proceeds_cents AS proceedsCents,
           gain_cents AS gainCents, loss_cents AS lossCents FROM fa_all_disposals WHERE document_id = ?`,
      )
      .get(documentId) as (Pick<DisposalInput, 'assetId' | 'kind' | 'reason'> & Figures) | undefined;
    if (!r) throw new Error(`Disposal ${documentId} not found`);
    const { assetId, kind, reason, ...figures } = r;
    const s = kind === 'sale' ? assetSale(db, documentId) : undefined;
    if (!s) return withNames(db, { assetId, kind, reason }, figures, null);
    const buyer = s.customerId ? { customerId: s.customerId } : { buyerName: s.buyerName, buyerAddress: s.buyerAddress ?? undefined, buyerTin: s.buyerTin ?? undefined };
    const input: DisposalInput = { assetId, kind, reason, ...buyer, invoiceNumber: s.invoiceNumber, priceCents: s.grossCents, cashPlaceId: s.cashPlaceId };
    const sale = {
      vatRateBp: s.vatRateBp, grossCents: s.grossCents, vatCents: s.vatCents, vatableSalesCents: s.netCents, buyerName: s.buyerName, buyerTin: s.buyerTin,
      cashPlaceName: cashPlaceName(db, s.cashPlaceId),
    };
    return withNames(db, input, figures, sale);
  },

  toInput: (doc) => Object.fromEntries(Object.keys(disposalInput.shape).flatMap((k) => (doc[k as keyof DisposalInput] === undefined ? [] : [[k, doc[k as keyof DisposalInput]]]))) as DisposalInput,

  summary(doc) {
    const book = `cost ${formatPeso(doc.costCents)} less ${formatPeso(doc.accumulatedCents)} accumulated depreciation`;
    if (!doc.sale) {
      const loss = doc.lossCents > 0 ? `, a loss of ${formatPeso(doc.lossCents)} (its book value)` : ', with no book value left';
      return `This will retire ${doc.assetNumber} ${doc.description}: ${book}${loss}.`;
    }
    const s = doc.sale;
    const outcome = doc.gainCents > 0 ? `a gain of ${formatPeso(doc.gainCents)}` : doc.lossCents > 0 ? `a loss of ${formatPeso(doc.lossCents)}` : 'no gain or loss';
    return `This will record invoice no. ${doc.invoiceNumber} selling ${doc.assetNumber} ${doc.description} to ${s.buyerName} for ${formatPeso(s.grossCents)} `
      + `(VATable sales ${formatPeso(s.vatableSalesCents)}, VAT ${formatPeso(s.vatCents)}), paid into ${s.cashPlaceName}. Its book value is ${formatPeso(doc.bookValueCents)} (${book}), `
      + `so the sale makes ${outcome}.`;
  },

  /** Retires or sells an asset in service (there must be one); a sale to a typed buyer, paid into any cash place. */
  arbitrary(db) {
    const retire = fc.record({
      assetId: fc.constantFrom(...assetsInService(db).map((a) => a.id)),
      kind: fc.constant('retirement' as const),
      reason: fc.constantFrom('Broken beyond repair', 'Scrapped, no longer used'),
    });
    const sell = fc.record({
      assetId: fc.constantFrom(...assetsInService(db).map((a) => a.id)),
      kind: fc.constant('sale' as const),
      reason: fc.constantFrom('Sold, replaced by a newer one', 'Sold to another shop'),
      buyerName: fc.constantFrom('Sample Buyer Corp.', 'Juan Example'),
      buyerAddress: fc.constant('123 Sample St., Example City'),
      buyerTin: fc.constant('555-666-777-000'),
      invoiceNumber: fc.integer({ min: 1, max: 99_999_999 }).map((n) => String(n).padStart(4, '0')),
      priceCents: fc.integer({ min: 100, max: 20_000_000_00 }),
      cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
    });
    return fc.oneof(retire, sell);
  },
};
