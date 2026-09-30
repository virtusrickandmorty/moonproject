/**
 * Asset Disposal (FAD-, PLAN D5 FA-DISP, E10): takes an asset off the books, retired or sold.
 *   Retirement (nothing received): Dr 15x1 accumulated depreciation ; Dr 7202 loss (book value) / Cr 15x0 cost
 *   Sale (an invoice record, D5 INV-REC, paid in full on the spot into a cash place; a bank transfer counts):
 *     Dr cash place (gross) ; Dr 15x1 accumulated depreciation ; Dr 7202 loss / Cr 15x0 cost ; Cr 2301 output VAT ; Cr 7102 gain
 *   Output VAT is VAT(G) at the rate in force on the sale date (D4.1, 12/112 now); the VATable sales NET = G − VAT, and
 *   the gain or loss is NET less the book value (cost − accumulated depreciation), so 7102 − 7202 = NET − book value.
 * A sale is written on a manual invoice from the booklet: the number is checked against the ATP booklet register
 * (TAX bookletIssue) and used once, ever, with JO and QS invoice records (JO invoiceNumberUsedBy reads asset sales too).
 * The buyer is a customer picked, or a name (address and TIN) typed; 2301 names the customer, or this sale for a typed
 * buyer, whose name and TIN the tax registers read from fa_asset_sales.
 * Run the month's depreciation first; the figures are the ledger's on the day of the disposal, and a warning says when
 * depreciation up to this month is not all recorded. Cancel mirrors it on the cancel day (D6) and puts the asset back
 * in service; a sold asset's invoice number stays used and shows as cancelled in the booklet.
 * An opening asset (OBFA-) is disposed of the same way; its retirement is kept in fa_opening_disposals, and a sale of
 * either kind of asset in fa_asset_sales (migration 0003).
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
import { accumulatedCents, asset, assetClass, assetParty, assetsInService, isOpeningAsset, scheduledCents } from '../assets.ts';
import { monthLabel } from './depreciation.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
const text = (max: number) => z.string().trim().min(1).max(max);

export const disposalInput = z
  .object({
    assetId: z.string().trim().min(1).max(80),
    kind: z.enum(['retirement', 'sale']),
    reason: z.string().trim().min(5).max(300), // e.g. "Motor burned out, scrapped" or "Sold to another shop"
    // A sale only: the booklet invoice, what the buyer paid (VAT included) and where it went, and who bought it.
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).').optional(),
    amountCents: z.number().int().min(100).max(MAX_CENTS).optional(),
    cashPlaceId: z.number().int().positive().optional(),
    customerId: z.uuid().optional(), // a customer picked ...
    buyerName: text(200).optional(), // ... or the buyer typed
    buyerAddress: text(300).optional(),
    buyerTin: z.string().trim().regex(/^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/, 'Type the TIN like 123-456-789-000.').optional(),
  })
  .strict();
export type DisposalInput = z.infer<typeof disposalInput>;

interface Figures { costCents: number; accumulatedCents: number; proceedsCents: number; gainCents: number; lossCents: number }
/** A sale's invoice: VATable sales (NET, the proceeds), VAT, total ("write these on the booklet", D4.4) and the buyer. */
export interface SaleFigures {
  grossCents: number; vatRateBp: number; vatCents: number; vatableSalesCents: number;
  buyerName: string; buyerTin: string | null; cashPlaceName: string;
}
export interface Disposal extends DisposalInput, Figures {
  assetNumber: string; description: string; costRole: string; accumRole: string; bookValueCents: number; sale: SaleFigures | null; totalCents: number;
}

const SALE_FIELDS = ['invoiceNumber', 'amountCents', 'cashPlaceId', 'customerId', 'buyerName', 'buyerAddress', 'buyerTin'] as const;

/** The buyer's name and TIN as the booklet shows them: the customer's registered name and TIN, or as typed. */
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

const splitGainLoss = (proceedsCents: number, costCents: number, acc: number) => {
  const net = proceedsCents - (costCents - acc);
  return { gainCents: Math.max(net, 0), lossCents: Math.max(-net, 0) };
};

export const disposalDoc: DocTypeDef<DisposalInput, Disposal> = {
  key: 'fa.disposal',
  module: 'FA',
  title: 'Asset Disposal',
  numbering: { series: { key: 'FAD', prefix: 'FAD-' } },
  permissions: { view: 'fa.disp.view', create: 'fa.disp.create', post: 'fa.disp.post', cancel: 'fa.disp.cancel' },
  dating: 'system',
  inputSchema: disposalInput,
  externalNumber: (doc) => (doc.kind === 'sale' ? (doc.invoiceNumber ?? null) : null),

  compute(input, ctx) {
    const a = asset(ctx.db, input.assetId);
    const costCents = a?.costCents ?? 0;
    const acc = a ? accumulatedCents(ctx.db, a) : 0;
    if (input.kind !== 'sale') return withNames(ctx.db, input, { costCents, accumulatedCents: acc, proceedsCents: 0, ...splitGainLoss(0, costCents, acc) }, null);
    const grossCents = input.amountCents ?? 0;
    const vatRateBp = settingAt(ctx.db, 'tax.vat_rate_bp', ctx.businessDate);
    const { netCents, vatCents } = vatFromGross(grossCents, vatRateBp);
    const cashPlaceName = input.cashPlaceId ? (getCashPlace(ctx.db, input.cashPlaceId)?.name ?? '?') : '?';
    const sale = { grossCents, vatRateBp, vatCents, vatableSalesCents: netCents, ...buyerOf(ctx.db, input), cashPlaceName };
    return withNames(ctx.db, input, { costCents, accumulatedCents: acc, proceedsCents: netCents, ...splitGainLoss(netCents, costCents, acc) }, sale);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const a = asset(ctx.db, doc.assetId);
    if (!a || a.docStatus !== 'posted') add('error', 'assetId', 'ASSET', 'Pick a recorded asset.');
    else if (a.disposal) add('error', 'assetId', 'DISPOSED', `${a.number} is already disposed of on ${a.disposal}.`);
    else {
      const month = ctx.businessDate.slice(0, 7);
      const dueCents = scheduledCents(a, month) - doc.accumulatedCents;
      if (dueCents > 0) {
        add('warning', 'assetId', 'DEPRECIATION_NOT_RUN',
          `Depreciation of ${a.number} up to ${monthLabel(month)} is not all recorded (${formatPeso(dueCents)} still to charge). Run it first, so the book value is up to date.`);
      }
    }
    if (doc.kind === 'retirement') {
      if (SALE_FIELDS.some((k) => doc[k] !== undefined)) add('error', 'kind', 'NOT_A_SALE', 'A retirement has nothing received: leave the invoice, amount, cash place and buyer empty, or record it as sold.');
      return issues;
    }
    if (!doc.invoiceNumber) add('error', 'invoiceNumber', 'INVOICE', 'Type the number of the invoice written for this sale.');
    else {
      const used = invoiceNumberUsedBy(ctx.db, doc.invoiceNumber);
      if (used) {
        const how = used.status === 'cancelled' ? ' (cancelled)' : '';
        add('error', 'invoiceNumber', 'INVOICE_USED', `Invoice no. ${doc.invoiceNumber} is already used on ${used.number}${how}. Each invoice number is used once: write this sale on a new invoice and keep all copies of a spoiled one.`);
      }
      const booklet = bookletIssue(ctx.db, 'SALES_INVOICE', doc.invoiceNumber, 'invoiceNumber');
      if (booklet) issues.push(booklet);
    }
    if (!doc.amountCents) add('error', 'amountCents', 'AMOUNT', 'Type what the buyer paid, VAT included.');
    if (!doc.cashPlaceId) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick where the buyer’s money went.');
    else if (!getCashPlace(ctx.db, doc.cashPlaceId)?.isActive) add('error', 'cashPlaceId', 'CASH_PLACE', 'Pick an active cash place.');
    if (doc.customerId) {
      const c = customerRef(ctx.db, doc.customerId);
      if (c?.is_active !== 1) add('error', 'customerId', 'CUSTOMER', c ? `${c.display_name} is inactive. Pick an active customer.` : 'Pick a customer.');
      if (doc.buyerName || doc.buyerTin) add('error', 'buyerName', 'BUYER', 'Pick a customer or type the buyer, not both.');
    } else if (!doc.buyerName) add('error', 'buyerName', 'BUYER', 'Pick the customer who bought it, or type the buyer’s name.');
    if (doc.sale && doc.amountCents && !doc.sale.buyerTin) add('warning', 'buyerTin', 'NO_TIN', 'No TIN for the buyer. A VAT-registered buyer needs its TIN on the invoice.');
    return issues;
  },

  persist(db, doc, h) {
    if (doc.kind === 'sale') {
      const s = doc.sale!;
      db.prepare(
        `INSERT INTO fa_asset_sales (document_id, asset_id, reason, cost_cents, accumulated_cents, gross_cents, vat_rate_bp, vat_cents, net_cents, gain_cents, loss_cents,
           cash_account_id, invoice_number, customer_id, buyer_name, buyer_address, buyer_tin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        h.documentId, doc.assetId, doc.reason, doc.costCents, doc.accumulatedCents, s.grossCents, s.vatRateBp, s.vatCents, doc.proceedsCents, doc.gainCents, doc.lossCents,
        doc.cashPlaceId, doc.invoiceNumber, doc.customerId ?? null, s.buyerName, doc.buyerAddress ?? null, s.buyerTin,
      );
      return;
    }
    const table = isOpeningAsset(db, doc.assetId) ? 'fa_opening_disposals' : 'fa_disposals';
    db.prepare(
      `INSERT INTO ${table} (document_id, asset_id, kind, reason, cost_cents, accumulated_cents, proceeds_cents, gain_cents, loss_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.assetId, doc.kind, doc.reason, doc.costCents, doc.accumulatedCents, doc.proceedsCents, doc.gainCents, doc.lossCents);
  },

  journal(doc, _ctx, header) {
    const party = assetParty(doc.assetId);
    const memo = `${doc.assetNumber} ${doc.description}`;
    const off = [
      { account: { role: doc.accumRole }, party, debitCents: doc.accumulatedCents, memo },
      { account: { role: 'LOSS_ON_DISPOSAL' }, debitCents: doc.lossCents, memo },
      { account: { role: doc.costRole }, party, creditCents: doc.costCents, memo },
    ];
    if (doc.kind !== 'sale') return { memo: `Retirement of ${memo}: ${doc.reason}`, lines: [...off, { account: { role: 'GAIN_ON_DISPOSAL' }, creditCents: doc.gainCents, memo }] };
    const s = doc.sale!;
    // 2301 is kept per customer (VAT close); a typed buyer is this sale (a preview has no id yet and shows it unnamed).
    const buyer = { type: 'customer', id: doc.customerId ?? header?.documentId ?? 'this sale' };
    const invoice = `Invoice no. ${doc.invoiceNumber}`;
    return {
      memo: `Sale of ${memo} to ${s.buyerName}, invoice no. ${doc.invoiceNumber}`,
      lines: [
        { account: { cashPlace: doc.cashPlaceId! }, debitCents: s.grossCents, memo: invoice },
        ...off,
        { account: { role: 'OUTPUT_VAT' }, party: buyer, creditCents: s.vatCents, memo: invoice },
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
      .get(documentId) as (Pick<DisposalInput, 'assetId' | 'kind' | 'reason'> & Figures) | undefined;
    if (!r) throw new Error(`Disposal ${documentId} not found`);
    const { assetId, kind, reason, ...figures } = r;
    if (kind !== 'sale') return withNames(db, { assetId, kind, reason }, figures, null);
    const s = db
      .prepare(
        `SELECT invoice_number AS invoiceNumber, gross_cents AS grossCents, vat_rate_bp AS vatRateBp, vat_cents AS vatCents, cash_account_id AS cashPlaceId,
           customer_id AS customerId, buyer_name AS buyerName, buyer_address AS buyerAddress, buyer_tin AS buyerTin FROM fa_asset_sales WHERE document_id = ?`,
      )
      .get(documentId) as { invoiceNumber: string; grossCents: number; vatRateBp: number; vatCents: number; cashPlaceId: number; customerId: string | null; buyerName: string; buyerAddress: string | null; buyerTin: string | null };
    const input: DisposalInput = {
      assetId, kind, reason, invoiceNumber: s.invoiceNumber, amountCents: s.grossCents, cashPlaceId: s.cashPlaceId,
      ...(s.customerId ? { customerId: s.customerId } : { buyerName: s.buyerName, ...(s.buyerTin ? { buyerTin: s.buyerTin } : {}) }),
      ...(s.buyerAddress ? { buyerAddress: s.buyerAddress } : {}),
    };
    const sale: SaleFigures = {
      grossCents: s.grossCents, vatRateBp: s.vatRateBp, vatCents: s.vatCents, vatableSalesCents: figures.proceedsCents, buyerName: s.buyerName, buyerTin: s.buyerTin,
      cashPlaceName: getCashPlace(db, s.cashPlaceId)?.name ?? '?',
    };
    return withNames(db, input, figures, sale);
  },

  toInput: (doc) => Object.fromEntries(Object.keys(disposalInput.shape).flatMap((k) => (doc[k as keyof DisposalInput] === undefined ? [] : [[k, doc[k as keyof DisposalInput]]]))) as DisposalInput,

  summary(doc) {
    const book = `cost ${formatPeso(doc.costCents)} less ${formatPeso(doc.accumulatedCents)} accumulated depreciation`;
    if (doc.kind !== 'sale') {
      const loss = doc.lossCents > 0 ? `, a loss of ${formatPeso(doc.lossCents)} (its book value)` : ', with no book value left';
      return `This will retire ${doc.assetNumber} ${doc.description}: ${book}${loss}.`;
    }
    const s = doc.sale!;
    const result = doc.gainCents > 0 ? `a gain of ${formatPeso(doc.gainCents)}` : doc.lossCents > 0 ? `a loss of ${formatPeso(doc.lossCents)}` : 'no gain or loss';
    return `This will record invoice no. ${doc.invoiceNumber} to ${s.buyerName} for ${doc.assetNumber} ${doc.description}: ${formatPeso(s.grossCents)} into ${s.cashPlaceName} `
      + `(VATable sales ${formatPeso(s.vatableSalesCents)}, VAT ${formatPeso(s.vatCents)}). Its book value is ${formatPeso(doc.bookValueCents)} (${book}), so ${result}.`;
  },

  /** Retires or sells an asset in service (there must be one); a sale is to a typed buyer, paid into a cash place. */
  arbitrary(db) {
    const retirement = fc.record({
      assetId: fc.constantFrom(...assetsInService(db).map((a) => a.id)),
      kind: fc.constant('retirement' as const),
      reason: fc.constantFrom('Broken beyond repair', 'Scrapped, no longer used'),
    });
    const sale = fc
      .record({
        assetId: fc.constantFrom(...assetsInService(db).map((a) => a.id)),
        n: fc.integer({ min: 1, max: 99_999_999 }),
        amountCents: fc.integer({ min: 100, max: 5_000_000_00 }),
        cashPlaceId: fc.constantFrom(...listCashPlaces(db).map((c) => c.id)),
        tin: fc.boolean(),
      })
      .map(({ n, tin, ...r }): DisposalInput => ({
        ...r, kind: 'sale', reason: 'Sold to another shop', invoiceNumber: String(n).padStart(4, '0'), buyerName: 'Sample Buyer Trading',
        ...(tin ? { buyerTin: '123-456-789-000' } : {}),
      }));
    return fc.oneof(retirement, sale);
  },
};
