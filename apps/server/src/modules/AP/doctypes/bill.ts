/**
 * Supplier Bill (BILL-, PLAN D5 "BILL-POST", E9; golden G-15). What Virtus owes a supplier on one supplier invoice.
 *   Dr per line: supply 5101/5102, subcontracting 5301, freight-in 5103 or an expense category (NET with input VAT, else G)
 *   Dr 1401 input VAT / Cr 2311 EWT ; Cr 2101 AP (G − EWT), party = the supplier, ref = the bill
 * VAT as on an expense voucher (EXP): from the invoice total at the rate in force on the supplier's invoice date (D4.1,
 * D4.2), spread over the lines by largest remainder, claimed only for a VAT-registered supplier with a TIN on file (the
 * invoice number and date are always typed, D4.7). EWT is credited now, at accrual (D4.8), on NET for a VAT-registered
 * supplier and on G otherwise (D4.5), at the supplier's usual class; only the accountant may pick another.
 * Advances (PLAN D5 SUP-ADV): the bill takes the supplier's open advances (SADV-), oldest first up to what it owes
 * unless it names them, in its own journal: Dr 2101 AP (ref = the bill) / Cr 1230 (ref = the advance) per advance.
 * An advance that withheld EWT covered that part of the income already, so the bill leaves the base it withheld on
 * out of its own EWT base: EWT is never withheld twice on the same payment.
 * What is still owed is read from the ledger, so a bill with payments cancels only after them, and an advance only
 * after the bills that apply it (D6).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { allocate, applyRate, formatPeso, isBusinessDate, manilaDate, vatFromGross, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { EWT_CLASSES, settingAt, type EwtClass } from '../../../engine/settings.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { TWA_ONLY, appliedEwtClass, category, listCategories } from '../../EXP/public.ts';
import { activeSupplierIds, activeSupplyIds, receivingReport, supplier, supply } from '../../PUR/public.ts';
import { advance, openAdvances, openOnAdvance, paymentsOnBill, type AdvanceRow } from '../ledger.ts';

export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
export const EWT_PERMISSION = 'ap.bill.ewt';
const SUPPLY_ROLE = { materials: 'PURCHASES_MATERIALS', ready_made: 'PURCHASES_MERCH' } as const;
const PURCHASE = { subcontract: { role: 'SUBCONTRACT', name: 'Subcontracted production' }, freight_in: { role: 'FREIGHT_IN', name: 'Freight-in' } } as const;

const date = z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.').refine((d) => d >= '2000-01-01', 'Check the year.');
const addDays = (d: string, n: number) => manilaDate(new Date(Date.parse(`${d}T00:00:00+08:00`) + n * 86_400_000));

const lineInput = z
  .object({
    supplyId: z.string().trim().min(1).max(80).optional(), // a supply on file, or ...
    categoryId: z.number().int().positive().optional(), // ... an expense category, or ...
    purchase: z.enum(['subcontract', 'freight_in']).optional(), // ... subcontracted production or freight-in
    description: z.string().trim().min(1).max(200).optional(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // as on the invoice, VAT included
  })
  .strict();
type LineInput = z.infer<typeof lineInput>;

/** An advance applied on the bill: that much of it goes against what the bill owes. */
const advanceApplied = z.object({ advanceId: z.string().trim().min(1).max(80), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();

export const billInput = z
  .object({
    supplierId: z.string().trim().min(1).max(80),
    supplierInvoiceNo: z.string().trim().min(1).max(40),
    supplierInvoiceDate: date,
    dueDate: date.optional(), // left out: the invoice date plus the supplier's payment terms
    receivingReportId: z.string().trim().min(1).max(80).optional(),
    lines: z.array(lineInput).min(1).max(50),
    ewtClass: z.enum([...EWT_CLASSES, 'none']).optional(), // left out: the supplier's usual class
    advances: z.array(advanceApplied).max(20).optional(), // left out: the supplier's open advances, oldest first, up to what the bill owes
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type BillInput = z.infer<typeof billInput>;

export interface BillLine extends LineInput { lineNo: number; name: string; costRole: string | null; accountId: number | null; vatCents: number; costCents: number }
interface Figures { vatRateBp: number; inputVatCents: number; appliedEwtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number; ewtCents: number }
/** An advance applied on the bill, with the part of the bill's EWT base it already withheld on. */
export interface BillAdvance { lineNo: number; advanceId: string; advanceNumber: string; amountCents: number; coveredBaseCents: number }
export interface Bill extends Omit<BillInput, 'lines' | 'advances'>, Figures {
  lines: BillLine[]; dueDate: string; totalCents: number; payableCents: number;
  /** The advances applied, their total, and what the bill still owes after them (never below zero once valid). */
  advances: BillAdvance[]; advanceCents: number; owedCents: number;
  supplierName: string; supplierTin: string | null; vatRegistered: boolean; usualEwtClass: EwtClass | null; receivingReportNumber: string | null;
}

/** The account a line posts to: a role key for supplies, subcontracting and freight, else the category's account. */
function target(db: Db, l: LineInput): Pick<BillLine, 'name' | 'costRole' | 'accountId'> {
  const s = l.supplyId ? supply(db, l.supplyId) : undefined;
  const c = l.categoryId ? category(db, l.categoryId) : undefined;
  if (s) return { name: s.name, costRole: SUPPLY_ROLE[s.category], accountId: null };
  if (c) return { name: c.name, costRole: null, accountId: c.accountId };
  return l.purchase ? { name: PURCHASE[l.purchase].name, costRole: PURCHASE[l.purchase].role, accountId: null } : { name: '?', costRole: null, accountId: null };
}

/**
 * The part of a bill's EWT base that `amountCents` of an advance already withheld on: its share of the advance's own
 * base (none when the advance withheld nothing). BigInt: base × amount can pass 2^53.
 */
export function coveredBase(a: Pick<AdvanceRow, 'amountCents' | 'ewtBaseCents' | 'ewtCents'>, amountCents: number): number {
  if (a.ewtCents === 0) return 0;
  const [base, x, of] = [BigInt(a.ewtBaseCents), BigInt(amountCents), BigInt(a.amountCents)];
  return Number((2n * base * x + of) / (2n * of));
}

type Applied = { advanceId: string; amountCents: number; advance: AdvanceRow | undefined };

/**
 * The EWT and what is owed with these advances applied: the bill's full base (NET or G) less what the advances
 * already withheld on, at the bill's rate. What is owed falls by at most one centavo for each centavo more applied,
 * so the largest amount that keeps it at zero or above can be found by halving.
 */
function withAdvances(G: number, fullBaseCents: number, cls: EwtClass | null, rateBp: number, apps: Applied[]) {
  const covered = apps.map((a) => (a.advance ? coveredBase(a.advance, a.amountCents) : 0));
  const ewtBaseCents = cls ? Math.max(0, fullBaseCents - covered.reduce((s, c) => s + c, 0)) : 0;
  const ewtCents = cls ? applyRate(ewtBaseCents, rateBp) : 0;
  return { covered, ewtBaseCents, ewtCents, owedCents: G - ewtCents - apps.reduce((s, a) => s + a.amountCents, 0) };
}

/** Left out of the input: the supplier's open advances, oldest first, each as far as the bill still owes something. */
function defaultAdvances(db: Db, supplierId: string, G: number, fullBaseCents: number, cls: EwtClass | null, rateBp: number): Applied[] {
  const apps: Applied[] = [];
  for (const a of openAdvances(db, supplierId)) {
    const owedWith = (x: number) => withAdvances(G, fullBaseCents, cls, rateBp, [...apps, { advanceId: a.id, amountCents: x, advance: a }]).owedCents;
    let x = Math.min(a.openCents, G - apps.reduce((s, y) => s + y.amountCents, 0));
    if (x <= 0) break;
    if (owedWith(x) < 0) {
      let [lo, hi] = [0, x]; // owedWith(lo) >= 0 > owedWith(hi)
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (owedWith(mid) >= 0) lo = mid;
        else hi = mid;
      }
      x = lo;
    }
    if (x > 0) apps.push({ advanceId: a.id, amountCents: x, advance: a });
  }
  return apps;
}

/** The names around the figures (worked out in compute, stored for load). */
function withNames(db: Db, input: BillInput, lines: BillLine[], vatRegistered: boolean, f: Figures, advances: BillAdvance[]): Bill {
  const sup = supplier(db, input.supplierId);
  const G = lines.reduce((s, l) => s + l.amountCents, 0);
  const advanceCents = advances.reduce((s, a) => s + a.amountCents, 0);
  return {
    ...input, ...f, lines, totalCents: G, payableCents: G - f.ewtCents, advances, advanceCents, owedCents: G - f.ewtCents - advanceCents,
    dueDate: input.dueDate ?? addDays(input.supplierInvoiceDate, sup?.paymentTermsDays ?? 0),
    supplierName: sup?.name ?? '?', supplierTin: sup?.tin || null, vatRegistered, usualEwtClass: sup?.ewtClass ?? null,
    receivingReportNumber: input.receivingReportId ? (receivingReport(db, input.receivingReportId)?.number ?? '?') : null,
  };
}

const pct = (bp: number) => `${bp / 100}%`;
const dropNulls = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;

export const billDoc: DocTypeDef<BillInput, Bill> = {
  key: 'ap.bill',
  module: 'AP',
  title: 'Supplier Bill',
  numbering: { series: { key: 'BILL', prefix: 'BILL-' } },
  permissions: { view: 'ap.bill.view', create: 'ap.bill.create', post: 'ap.bill.post', cancel: 'ap.bill.cancel' },
  dating: 'system',
  inputSchema: billInput,

  compute(input, ctx) {
    const sup = supplier(ctx.db, input.supplierId);
    const vatRegistered = sup?.isVatRegistered ?? false;
    const vatRateBp = settingAt(ctx.db, 'tax.vat_rate_bp', input.supplierInvoiceDate);
    const G = input.lines.reduce((s, l) => s + l.amountCents, 0);
    const { netCents, vatCents } = vatRegistered ? vatFromGross(G, vatRateBp) : { netCents: G, vatCents: 0 };
    const inputVatCents = vatRegistered && sup?.tin ? vatCents : 0;
    const lineVat = inputVatCents > 0 ? allocate(inputVatCents, input.lines.map((l) => l.amountCents)) : input.lines.map(() => 0);
    const lines = input.lines.map((l, i) => ({ ...l, lineNo: i + 1, ...target(ctx.db, l), vatCents: lineVat[i]!, costCents: l.amountCents - lineVat[i]! }));
    const applied = appliedEwtClass(ctx.db, input.ewtClass, sup?.ewtClass ?? null, ctx.businessDate);
    const ewtRateBp = applied ? settingAt(ctx.db, 'tax.ewt_rates_bp', ctx.businessDate)[applied] : 0; // the rate on the accrual date
    const apps: Applied[] = input.advances
      ? input.advances.map((a) => ({ ...a, advance: advance(ctx.db, a.advanceId) }))
      : sup ? defaultAdvances(ctx.db, sup.id, G, netCents, applied, ewtRateBp) : [];
    const w = withAdvances(G, netCents, applied, ewtRateBp, apps);
    const ewt = { appliedEwtClass: applied, ewtRateBp, ewtBaseCents: w.ewtBaseCents, ewtCents: w.ewtCents };
    const advances = apps.map((a, i) => ({ lineNo: i + 1, advanceId: a.advanceId, advanceNumber: a.advance?.number ?? '?', amountCents: a.amountCents, coveredBaseCents: w.covered[i]! }));
    return withNames(ctx.db, input, lines, vatRegistered, { vatRateBp, inputVatCents, ...ewt }, advances);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const add = (level: Issue['level'], field: string, code: string, message: string) => issues.push({ field, code, level, message });
    if (!supplier(ctx.db, doc.supplierId)?.isActive) add('error', 'supplierId', 'SUPPLIER', 'Pick an active supplier.');
    doc.lines.forEach((l, i) => {
      const at = `Line ${l.lineNo}`;
      if ([l.supplyId, l.categoryId, l.purchase].filter((x) => x !== undefined).length !== 1) add('error', `lines.${i}`, 'LINE', `${at}: pick one supply, expense category or kind of purchase.`);
      else if (l.supplyId && !supply(ctx.db, l.supplyId)?.isActive) add('error', `lines.${i}.supplyId`, 'SUPPLY', `${at}: pick an active supply.`);
      else if (l.categoryId && !category(ctx.db, l.categoryId)?.isActive) add('error', `lines.${i}.categoryId`, 'CATEGORY', `${at}: pick an active expense category.`);
    });
    if (doc.totalCents > MAX_CENTS) add('error', 'lines', 'TOO_LARGE', `A bill cannot be more than ${formatPeso(MAX_CENTS)}.`);
    if (doc.supplierInvoiceDate > ctx.businessDate) add('error', 'supplierInvoiceDate', 'INVOICE_DATE', 'The invoice date cannot be after today.');
    if (doc.dueDate < doc.supplierInvoiceDate) add('error', 'dueDate', 'DUE_DATE', 'The due date cannot be before the invoice date.');
    const dup = ctx.db
      .prepare(`SELECT d.number FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE b.supplier_id = ? AND b.supplier_invoice_no = ? AND d.status = 'posted'`)
      .pluck()
      .get(doc.supplierId, doc.supplierInvoiceNo) as string | undefined;
    if (dup) add('error', 'supplierInvoiceNo', 'DUPLICATE_INVOICE', `Invoice no. ${doc.supplierInvoiceNo} of this supplier is already on ${dup}.`);
    if (doc.receivingReportId) {
      const rr = receivingReport(ctx.db, doc.receivingReportId);
      if (rr?.status !== 'posted') add('error', 'receivingReportId', 'RECEIVING_REPORT', 'Pick a recorded receiving report.');
      else if (rr.supplierId !== doc.supplierId) add('error', 'receivingReportId', 'RR_SUPPLIER', `${rr.number} (${rr.poNumber}) is for another supplier.`);
      else {
        const billed = ctx.db
          .prepare(`SELECT d.number FROM ap_bills b JOIN documents d ON d.id = b.document_id WHERE b.receiving_report_id = ? AND d.status = 'posted'`)
          .pluck()
          .get(rr.id) as string | undefined;
        if (billed) add('warning', 'receivingReportId', 'RR_BILLED', `${rr.number} is already on ${billed}. Check that this is another invoice for it.`);
      }
    }
    const usual = appliedEwtClass(ctx.db, undefined, doc.usualEwtClass, ctx.businessDate);
    if (doc.appliedEwtClass !== usual && !ctx.can(EWT_PERMISSION)) add('error', 'ewtClass', 'EWT_ACCOUNTANT', 'Only the accountant can change the EWT from the supplier’s usual class.');
    if (doc.ewtClass && TWA_ONLY.has(doc.ewtClass) && !settingAt(ctx.db, 'tax.top_withholding_agent', ctx.businessDate)) {
      add('error', 'ewtClass', 'NOT_TWA', 'Virtus is not a Top Withholding Agent, so goods and services from regular suppliers have no EWT.');
    }
    if (doc.appliedEwtClass && !doc.supplierTin) add('error', 'ewtClass', 'TIN_REQUIRED', 'Withholding tax needs the supplier’s TIN on file (for the 2307).');
    if (doc.vatRegistered && !doc.supplierTin) add('warning', 'supplierId', 'NO_INPUT_VAT', 'No input VAT: the supplier has no TIN on file. The full amount goes to the costs.');
    if (doc.appliedEwtClass !== usual) {
      const was = usual ? `${pct(settingAt(ctx.db, 'tax.ewt_rates_bp', ctx.businessDate)[usual])} (${usual})` : 'none';
      add('warning', 'ewtClass', 'EWT_DIFFERENT', `The usual EWT for this supplier is ${was}. Please check.`);
    }
    const seen = new Set<string>();
    doc.advances.forEach((x, i) => {
      const a = advance(ctx.db, x.advanceId);
      const f = `advances.${i}.advanceId`;
      if (!a) return add('error', f, 'ADVANCE', `Advance line ${x.lineNo}: pick a recorded supplier advance.`);
      if (a.supplierId !== doc.supplierId) return add('error', f, 'ADVANCE_SUPPLIER', `${a.number} is an advance to another supplier.`);
      if (a.status !== 'posted') return add('error', f, 'ADVANCE_CANCELLED', `${a.number} was cancelled.`);
      if (seen.has(a.id)) return add('error', f, 'ADVANCE_TWICE', `${a.number} is on this bill twice.`);
      seen.add(a.id);
      const open = openOnAdvance(ctx.db, a.id);
      if (x.amountCents > open) add('error', `advances.${i}.amountCents`, 'ADVANCE_MORE_THAN_OPEN', open > 0 ? `Only ${formatPeso(open)} is still open on ${a.number}.` : `Nothing is open on ${a.number}.`);
    });
    if (doc.owedCents < 0) {
      add('error', 'advances', 'ADVANCES_MORE_THAN_BILL', `The advances applied (${formatPeso(doc.advanceCents)}) are more than this bill leaves owed (${formatPeso(doc.payableCents)}).`);
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO ap_bills (document_id, supplier_id, supplier_invoice_no, supplier_invoice_date, due_date, receiving_report_id, vat_registered, vat_rate_bp,
         gross_cents, input_vat_cents, ewt_class, ewt_rate_bp, ewt_base_cents, ewt_cents, payable_cents, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      h.documentId, doc.supplierId, doc.supplierInvoiceNo, doc.supplierInvoiceDate, doc.dueDate, doc.receivingReportId ?? null, +doc.vatRegistered, doc.vatRateBp,
      doc.totalCents, doc.inputVatCents, doc.appliedEwtClass, doc.ewtRateBp, doc.ewtBaseCents, doc.ewtCents, doc.payableCents, doc.note ?? null,
    );
    const ins = db.prepare(
      `INSERT INTO ap_bill_lines (document_id, line_no, supply_id, category_id, purchase, cost_role, account_id, description, amount_cents, vat_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of doc.lines) {
      ins.run(h.documentId, l.lineNo, l.supplyId ?? null, l.categoryId ?? null, l.purchase ?? null, l.costRole, l.accountId, l.description ?? null, l.amountCents, l.vatCents);
    }
    const adv = db.prepare('INSERT INTO ap_bill_advances (document_id, line_no, advance_id, amount_cents, covered_base_cents) VALUES (?, ?, ?, ?, ?)');
    for (const a of doc.advances) adv.run(h.documentId, a.lineNo, a.advanceId, a.amountCents, a.coveredBaseCents);
  },

  journal(doc, _ctx, header) {
    const party = { type: 'supplier', id: doc.supplierId };
    const bill = header ? { ref: { documentId: header.documentId } } : {};
    return {
      memo: `${doc.supplierName} invoice no. ${doc.supplierInvoiceNo}`,
      lines: [
        ...doc.lines.map((l) => ({ account: l.accountId ? { accountId: l.accountId } : { role: l.costRole! }, debitCents: l.costCents, memo: l.description ?? l.name })),
        { account: { role: 'INPUT_VAT' }, party, debitCents: doc.inputVatCents, memo: `Invoice no. ${doc.supplierInvoiceNo}` },
        { account: { role: 'EWT_PAYABLE' }, party, creditCents: doc.ewtCents, memo: `EWT ${doc.appliedEwtClass}` },
        { account: { role: 'AP' }, party, ...bill, creditCents: doc.payableCents, memo: `Due ${doc.dueDate}` },
        ...doc.advances.flatMap((a) => [
          { account: { role: 'AP' }, party, ...bill, debitCents: a.amountCents, memo: `${a.advanceNumber} applied` },
          { account: { role: 'SUPPLIER_ADVANCES' }, party, ref: { documentId: a.advanceId }, creditCents: a.amountCents, memo: `${a.advanceNumber} applied` },
        ]),
      ],
    };
  },

  load(db, documentId) {
    const b = db
      .prepare(
        `SELECT supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo, supplier_invoice_date AS supplierInvoiceDate, due_date AS dueDate,
           receiving_report_id AS receivingReportId, note, vat_registered AS vatRegistered, vat_rate_bp AS vatRateBp, input_vat_cents AS inputVatCents,
           ewt_class AS appliedEwtClass, ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM ap_bills WHERE document_id = ?`,
      )
      .get(documentId) as (Figures & { vatRegistered: number } & Record<string, string | number | null>) | undefined;
    if (!b) throw new Error(`Supplier bill ${documentId} not found`);
    const lines = (
      db
        .prepare(`SELECT line_no AS lineNo, supply_id AS supplyId, category_id AS categoryId, purchase, description, amount_cents AS amountCents, vat_cents AS vatCents,
            cost_role AS costRole, account_id AS accountId FROM ap_bill_lines WHERE document_id = ? ORDER BY line_no`)
        .all(documentId) as BillLine[]
    ).map(({ costRole, accountId, ...stored }) => {
      const l = dropNulls(stored);
      return { ...l, name: target(db, l).name, costRole, accountId, costCents: l.amountCents - l.vatCents };
    });
    const { vatRegistered, vatRateBp, inputVatCents, appliedEwtClass, ewtRateBp, ewtBaseCents, ewtCents, ...input } = dropNulls(b);
    const figures = { vatRateBp, inputVatCents, appliedEwtClass: b.appliedEwtClass, ewtRateBp, ewtBaseCents, ewtCents };
    const advances = db
      .prepare(`SELECT x.line_no AS lineNo, x.advance_id AS advanceId, d.number AS advanceNumber, x.amount_cents AS amountCents, x.covered_base_cents AS coveredBaseCents
         FROM ap_bill_advances x JOIN documents d ON d.id = x.advance_id WHERE x.document_id = ? ORDER BY x.line_no`)
      .all(documentId) as BillAdvance[];
    const stored: BillInput = { ...(input as unknown as BillInput), ewtClass: (b.appliedEwtClass as EwtClass | null) ?? 'none', advances: advances.map(({ advanceId, amountCents }) => ({ advanceId, amountCents })) };
    return withNames(db, stored, lines, vatRegistered === 1, figures, advances);
  },

  toInput(doc) {
    const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
    const { supplierId, supplierInvoiceNo, supplierInvoiceDate, dueDate, receivingReportId, ewtClass, note } = doc;
    const lines = doc.lines.map(({ supplyId, categoryId, purchase, description, amountCents }) => strip({ supplyId, categoryId, purchase, description, amountCents }));
    const advances = doc.advances.map(({ advanceId, amountCents }) => ({ advanceId, amountCents })); // named, so an edit applies the same ones
    return strip({ supplierId, supplierInvoiceNo, supplierInvoiceDate, dueDate, receivingReportId, lines, ewtClass, advances, note });
  },

  dependents: (db, documentId) => paymentsOnBill(db, documentId),

  summary(doc) {
    const vat = doc.inputVatCents > 0 ? ` with ${formatPeso(doc.inputVatCents)} input VAT` : '';
    const ewt = doc.ewtCents > 0 ? `; ${formatPeso(doc.ewtCents)} is withheld (EWT ${pct(doc.ewtRateBp)}), so ${formatPeso(doc.payableCents)} is owed` : '';
    const adv = doc.advanceCents > 0
      ? `; ${formatPeso(doc.advanceCents)} of ${doc.advances.map((a) => a.advanceNumber).join(', ')} is applied, so ${formatPeso(doc.owedCents)} is still owed`
      : '';
    return `This will record ${formatPeso(doc.totalCents)} billed by ${doc.supplierName} on invoice no. ${doc.supplierInvoiceNo} of ${doc.supplierInvoiceDate}${vat}${ewt}${adv}, due ${doc.dueDate}.`;
  },

  /** Needs active suppliers (each with a TIN) and supplies on file. Invoices dated in 2025; EWT classes that need no TWA status. */
  arbitrary(db) {
    const pick = <T>(xs: readonly T[]) => fc.constantFrom(...xs);
    const line = fc.record({
      to: fc.oneof(
        pick(activeSupplyIds(db)).map((supplyId) => ({ supplyId })),
        pick(listCategories(db).map((c) => c.id)).map((categoryId) => ({ categoryId })),
        pick(['subcontract', 'freight_in'] as const).map((purchase) => ({ purchase })),
      ),
      amountCents: fc.integer({ min: 1, max: 500_000_00 }),
    });
    return fc
      .record({
        supplierId: pick(activeSupplierIds(db)),
        no: fc.integer({ min: 1, max: 999_999_999 }),
        day: fc.integer({ min: 1, max: 28 }),
        lines: fc.array(line, { minLength: 1, maxLength: 4 }),
        ewtClass: pick([undefined, 'none', ...EWT_CLASSES.filter((c) => !TWA_ONLY.has(c))] as const),
      })
      .map(({ supplierId, no, day, lines, ewtClass }): BillInput => ({
        supplierId, supplierInvoiceNo: `SI-${no}`, supplierInvoiceDate: `2025-06-${String(day).padStart(2, '0')}`,
        lines: lines.map(({ to, amountCents }) => ({ ...to, amountCents })), ...(ewtClass ? { ewtClass } : {}),
      }));
  },
};
