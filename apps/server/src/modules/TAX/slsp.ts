/**
 * SLSP and SAWT data of a quarter (PLAN E12, G "Tax", D8 "Quarterly", K ACC-25), built on the tax registers so each
 * list ties to its register and to the GL movement of the quarter; the ties are part of the answer, with any difference.
 *   SLSP sales: one row per customer with a TIN, and one line for the walk-in and other customers without one (the BIR
 *   takes those together). VATable sales and output tax come from the sales register (2301). A sale with no output VAT
 *   can only come in on a journal voucher crediting sales: the accountant marks it zero-rated, exempt or not a sale
 *   (tax_sale_classes); until then it is "to classify". Revenue with no VAT on the other-income accounts (interest,
 *   gains, other income) is no sale either. So the list, plus other income, adds up to the revenue accounts' movement.
 *   SLSP purchases: one row per supplier from the purchases register (1401), by class. Purchases with no input VAT are
 *   not tracked, so exempt and zero-rated purchases are nothing.
 *   SAWT: one row per customer, ATC and 2307 status from the 2307s-received register (1410 CWT, 1404 VAT withheld), an
 *   opening 2307 also by the quarter it covers. The income payment is worked back from the tax at the ATC's rate: the
 *   ledger does not carry the base printed on the 2307.
 * Addresses are left blank: the customer and supplier public contracts do not give them yet.
 */
import { z } from 'zod';
import { conflict, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { customerRef, customerTaxInfo } from '../CUS/public.ts';
import { supplierTaxInfo } from '../PUR/public.ts';
import { quarterRange, type Quarter } from './calendar.ts';
import { purchasesRegister, type PurchaseClass } from './purchases.ts';
import { IN_REGISTERS, salesRegister, total, withholdingReceivedRegister } from './registers.ts';
import type { WorksheetCheck } from './vat-return.ts';

export const SALE_CLASSES = ['zero_rated', 'exempt', 'not_a_sale'] as const;
export type SaleClass = (typeof SALE_CLASSES)[number];
/** Revenue accounts that are no sale: their income without VAT stays out of the SLSP. */
const OTHER_INCOME_ROLES = ['INTEREST_INCOME', 'GAIN_ON_DISPOSAL', 'OTHER_INCOME'];

/** One figure of a list against the register or the books it must equal. */
export interface Tie { key: string; label: string; listCents: number; bookCents: number; differenceCents: number }
const tie = (key: string, label: string, listCents: number, bookCents: number): Tie => ({ key, label, listCents, bookCents, differenceCents: listCents - bookCents });

type Check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void;
function checker(): [WorksheetCheck[], Check] {
  const checks: WorksheetCheck[] = [];
  return [checks, (when, code, level, message) => void (when && checks.push({ code, level, message }))];
}
const tiedCheck = (check: Check, ties: Tie[], what: string) =>
  check(ties.some((t) => t.differenceCents !== 0), 'NOT_TIED', 'error', `The ${what} does not add up to the registers and the books: see the differences. Do not file until this is fixed.`);

function customerName(db: Db, id: string): { name: string; tin: string | null; vatRegistered: boolean } {
  const tax = customerTaxInfo(db, id);
  return { name: tax?.registeredName ?? customerRef(db, id)?.display_name ?? '?', tin: tax?.tin ?? null, vatRegistered: tax?.isVatRegistered ?? false };
}

/** A journal with revenue and no output VAT: a sale to class (zero-rated or exempt), or other income. */
export interface NoVatRow {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal';
  documentId: string | null; docType: string | null; documentNumber: string | null; documentStatus: 'posted' | 'cancelled' | null;
  customerId: string | null; customerName: string; tin: string | null;
  /** Revenue credits less debits on the journal. */
  amountCents: number;
  /** A sales account is on it (not only interest, gains or other income). */
  sale: boolean;
  /** The accountant's class of the original journal; null while it is to classify. */
  saleClass: SaleClass | null;
}

/** The latest class the accountant gave the original journal. */
const classOf = (db: Db, journalId: string) =>
  (db.prepare('SELECT vat_class FROM tax_sale_classes WHERE journal_id = ? ORDER BY id DESC LIMIT 1').pluck().get(journalId) as SaleClass | undefined) ?? null;

/** Journals in [from, to] with a revenue line and no 2301 line, the registers' way (sealed, IN_REGISTERS). */
export function revenueWithoutVat(db: Db, from: string, to: string): NoVatRow[] {
  const others = OTHER_INCOME_ROLES.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT j.id AS journalId, j.number AS journalNumber, j.business_date AS date, j.posting_kind AS posting, j.source_type AS sourceType,
         j.source_id AS sourceId, COALESCE(j.reverses_journal_id, j.id) AS originalId, d.doc_type AS docType, d.number AS documentNumber, d.status AS docStatus,
         MIN(CASE WHEN a.type = 'revenue' AND l.party_type = 'customer' THEN l.party_id END) AS partyId,
         SUM(CASE WHEN a.type = 'revenue' THEN l.credit_cents - l.debit_cents ELSE 0 END) AS amountCents,
         MAX(CASE WHEN a.type = 'revenue' AND COALESCE(a.role_key, '') NOT IN (${others}) THEN 1 ELSE 0 END) AS sale
       FROM journals j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN documents d ON d.id = j.source_id AND j.source_type IN ('document', 'document-cancel')
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ? AND ${IN_REGISTERS}
         AND NOT EXISTS (SELECT 1 FROM journal_lines x JOIN accounts xa ON xa.id = x.account_id WHERE x.journal_id = j.id AND xa.role_key = 'OUTPUT_VAT')
       GROUP BY j.id HAVING SUM(CASE WHEN a.type = 'revenue' THEN 1 ELSE 0 END) > 0 ORDER BY j.business_date, j.number`,
    )
    .all(...OTHER_INCOME_ROLES, from, to) as {
      journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal'; sourceType: string; sourceId: string; originalId: string;
      docType: string | null; documentNumber: string | null; docStatus: 'posted' | 'cancelled' | null; partyId: string | null; amountCents: number; sale: number;
    }[];
  return rows.map((r) => {
    const who = r.partyId ? customerName(db, r.partyId) : { name: '', tin: null };
    return {
      journalId: r.journalId, journalNumber: r.journalNumber, date: r.date, posting: r.posting,
      documentId: r.docType ? r.sourceId : null, docType: r.docType, documentNumber: r.documentNumber, documentStatus: r.docStatus,
      customerId: r.partyId, customerName: who.name, tin: who.tin, amountCents: r.amountCents, sale: r.sale === 1, saleClass: classOf(db, r.originalId),
    };
  });
}

/** The movement of every revenue account in [from, to] (credit − debit), the registers' way. */
function revenueMovement(db: Db, from: string, to: string): number {
  return db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ? AND ${IN_REGISTERS} AND a.type = 'revenue'`,
    )
    .pluck()
    .get(from, to) as number;
}

export interface SlspSalesRow {
  /** Null on the line of the customers without a TIN. */
  customerId: string | null; tin: string | null; registeredName: string; address: string | null;
  exemptCents: number; zeroRatedCents: number; vatableCents: number; outputTaxCents: number; grossTaxableCents: number;
  /** Sales with no output VAT the accountant has not classed yet: in no column above. */
  toClassifyCents: number;
  /** How many customers the line takes (more than one only on the line without a TIN). */
  customers: number;
}

export function slspSales(db: Db, year: number, quarter: Quarter, today: string) {
  const { from, to } = quarterRange(year, quarter);
  const register = salesRegister(db, from, to);
  const noVat = revenueWithoutVat(db, from, to);
  const lines = new Map<string, SlspSalesRow>();
  const members = new Map<string, Set<string>>();
  const noTinVatRegistered = new Set<string>();
  // A buyer typed on an asset sale (FA) has no customer record: the register row names them, keyed by their TIN.
  const line = (customerId: string | null, typed?: { name: string; tin: string | null }) => {
    const who = typed ? { ...typed, vatRegistered: false } : customerId ? customerName(db, customerId) : { name: '', tin: null, vatRegistered: false };
    const key = who.tin && (customerId ?? typed) ? (customerId ?? `tin:${who.tin}`) : '';
    if (!who.tin && who.vatRegistered) noTinVatRegistered.add(who.name);
    members.set(key, (members.get(key) ?? new Set()).add(customerId ?? ''));
    const l = lines.get(key) ?? {
      customerId: key && customerId ? customerId : null, tin: key ? who.tin : null, registeredName: key ? who.name : 'Walk-in and other customers without a TIN', address: null,
      exemptCents: 0, zeroRatedCents: 0, vatableCents: 0, outputTaxCents: 0, grossTaxableCents: 0, toClassifyCents: 0, customers: 0,
    };
    lines.set(key, l);
    return l;
  };
  for (const r of register.rows) {
    const l = line(r.customerId, r.docType === 'fa.disposal' && !r.customerId ? { name: r.customerName, tin: r.tin } : undefined);
    l.vatableCents += r.netCents;
    l.outputTaxCents += r.vatCents;
    l.grossTaxableCents += r.totalCents;
  }
  for (const r of noVat.filter((x) => x.sale && x.saleClass !== 'not_a_sale')) {
    const l = line(r.customerId);
    if (r.saleClass === 'zero_rated') l.zeroRatedCents += r.amountCents;
    else if (r.saleClass === 'exempt') l.exemptCents += r.amountCents;
    else l.toClassifyCents += r.amountCents;
  }
  for (const [key, l] of lines) l.customers = members.get(key)!.size;
  const rows = [...lines.values()]
    .filter((l) => l.exemptCents || l.zeroRatedCents || l.vatableCents || l.outputTaxCents || l.toClassifyCents)
    .sort((a, b) => Number(!a.tin) - Number(!b.tin) || a.registeredName.localeCompare(b.registeredName));
  const sum = (f: (r: SlspSalesRow) => number) => total(rows, f);
  const totals = {
    exemptCents: sum((r) => r.exemptCents), zeroRatedCents: sum((r) => r.zeroRatedCents), vatableCents: sum((r) => r.vatableCents),
    outputTaxCents: sum((r) => r.outputTaxCents), grossTaxableCents: sum((r) => r.grossTaxableCents), toClassifyCents: sum((r) => r.toClassifyCents),
  };
  const otherIncomeCents = total(noVat.filter((x) => !x.sale || x.saleClass === 'not_a_sale'), (x) => x.amountCents);
  const ties = [
    tie('vatable', 'VATable sales = sales register', totals.vatableCents, register.totals.netCents),
    tie('output_register', 'Output tax = sales register', totals.outputTaxCents, register.totals.vatCents),
    tie('output_gl', 'Output tax = 2301 output VAT in the books', totals.outputTaxCents, register.glVatCents),
    tie('revenue_gl', 'Sales (all columns and to classify) and other income without VAT = revenue accounts in the books',
      totals.vatableCents + totals.zeroRatedCents + totals.exemptCents + totals.toClassifyCents + otherIncomeCents, revenueMovement(db, from, to) + register.assetSalesNotRevenueCents),
  ];
  const [checks, check] = checker();
  tiedCheck(check, ties, 'SLSP of sales');
  check(totals.toClassifyCents !== 0, 'TO_CLASSIFY', 'warning', 'Some sales carry no output VAT (journal vouchers): mark each zero-rated, exempt or not a sale.');
  check(noTinVatRegistered.size > 0, 'NO_TIN', 'warning',
    `VAT-registered customers with no TIN on file are in the line without a TIN: ${[...noTinVatRegistered].sort().join(', ')}. Add their TIN so they get their own row.`);
  check(rows.some((r) => !r.tin), 'WALK_IN', 'info', 'Customers without a TIN (walk-in sales) are summed on one line with no TIN.');
  check(rows.length > 0, 'NO_ADDRESS', 'info', 'The ERP gives no addresses to the tax lists yet: type each address in the BIR form.');
  check(today <= to, 'PERIOD_OPEN', 'info', 'The quarter has not ended: these figures still change.');
  return { year, quarter, from, to, rows, totals, otherIncomeCents, ties, checks, noVatSales: noVat.filter((x) => x.sale) };
}
export type SlspSales = ReturnType<typeof slspSales>;

export interface SlspPurchasesRow {
  supplierId: string | null; tin: string | null; registeredName: string; address: string | null;
  exemptCents: number; zeroRatedCents: number; servicesCents: number; capitalGoodsCents: number; goodsCents: number;
  /** Input VAT from journal vouchers not in a class yet, and their amount before VAT (in no column above). */
  toClassifyCents: number; inputTaxCents: number; grossTaxableCents: number;
}

const COLUMN: Record<PurchaseClass, 'servicesCents' | 'capitalGoodsCents' | 'goodsCents'> = { services: 'servicesCents', capital_goods: 'capitalGoodsCents', goods: 'goodsCents' };

export function slspPurchases(db: Db, year: number, quarter: Quarter, today: string) {
  const { from, to } = quarterRange(year, quarter);
  const register = purchasesRegister(db, from, to);
  const lines = new Map<string, SlspPurchasesRow>();
  for (const r of register.rows) {
    const key = r.supplierId ?? '';
    const l = lines.get(key) ?? {
      supplierId: r.supplierId, tin: r.tin, registeredName: (r.supplierId ? supplierTaxInfo(db, r.supplierId)?.registeredName : undefined) ?? r.supplierName, address: null,
      exemptCents: 0, zeroRatedCents: 0, servicesCents: 0, capitalGoodsCents: 0, goodsCents: 0, toClassifyCents: 0, inputTaxCents: 0, grossTaxableCents: 0,
    };
    if (r.purchaseClass) l[COLUMN[r.purchaseClass]] += r.netCents;
    else l.toClassifyCents += r.netCents;
    l.inputTaxCents += r.vatCents;
    l.grossTaxableCents += r.totalCents;
    lines.set(key, l);
  }
  const rows = [...lines.values()]
    .filter((l) => l.servicesCents || l.capitalGoodsCents || l.goodsCents || l.toClassifyCents || l.inputTaxCents)
    .sort((a, b) => a.registeredName.localeCompare(b.registeredName) || (a.tin ?? '').localeCompare(b.tin ?? ''));
  const sum = (f: (r: SlspPurchasesRow) => number) => total(rows, f);
  const totals = {
    exemptCents: 0, zeroRatedCents: 0, servicesCents: sum((r) => r.servicesCents), capitalGoodsCents: sum((r) => r.capitalGoodsCents), goodsCents: sum((r) => r.goodsCents),
    toClassifyCents: sum((r) => r.toClassifyCents), inputTaxCents: sum((r) => r.inputTaxCents), grossTaxableCents: sum((r) => r.grossTaxableCents),
  };
  const c = register.byClass;
  const ties = [
    tie('services', 'Services = purchases register', totals.servicesCents, c.services.netCents),
    tie('capital_goods', 'Capital goods = purchases register', totals.capitalGoodsCents, c.capital_goods.netCents),
    tie('goods', 'Goods other than capital goods = purchases register', totals.goodsCents, c.goods.netCents),
    tie('to_classify', 'Still to classify = purchases register', totals.toClassifyCents, c.unclassified.netCents),
    tie('input_register', 'Input tax = purchases register', totals.inputTaxCents, register.totals.vatCents),
    tie('input_gl', 'Input tax = 1401 input VAT in the books', totals.inputTaxCents, register.glVatCents),
  ];
  const noTin = rows.filter((r) => !r.tin);
  const [checks, check] = checker();
  tiedCheck(check, ties, 'SLSP of purchases');
  check(totals.toClassifyCents !== 0 || c.unclassified.vatCents !== 0, 'TO_CLASSIFY', 'warning', 'Some input VAT came from journal vouchers: put each under services, capital goods or other goods.');
  check(noTin.length > 0, 'NO_TIN', 'warning', `Some suppliers have no TIN on file (${noTin.map((r) => r.registeredName || 'journal voucher with no supplier').join(', ')}): input VAT needs the supplier's TIN.`);
  check(true, 'NOT_TRACKED', 'info', 'Purchases with no input VAT are not tracked, so exempt and zero-rated purchases show nothing: add any the accountant reports.');
  check(rows.length > 0, 'NO_ADDRESS', 'info', 'The ERP gives no addresses to the tax lists yet: type each address in the BIR form.');
  check(today <= to, 'PERIOD_OPEN', 'info', 'The quarter has not ended: these figures still change.');
  return { year, quarter, from, to, rows, totals, ties, checks };
}
export type SlspPurchases = ReturnType<typeof slspPurchases>;

/** The rate and nature of income of each ATC a customer withholds at; 'other' has neither. */
const ATC_RATE: Record<string, { rateBp: number; nature: string }> = {
  WC158: { rateBp: 100, nature: 'Goods sold to a top withholding agent' },
  WC160: { rateBp: 200, nature: 'Services to a top withholding agent' },
};
/** The VAT a government buyer withholds: 5% of the amount before VAT (D4.6). */
const VAT_WITHHELD_BP = 500;
/** base × rate = tax, worked back: base = tax ÷ rate, rounded half away from zero. */
const workBack = (taxCents: number, rateBp: number) => Math.sign(taxCents) * Math.round((Math.abs(taxCents) * 10_000) / rateBp);

export interface SawtRow {
  customerId: string | null; tin: string | null; registeredName: string;
  atc: string | null; nature: string | null; rateBp: number | null;
  /** Worked back from the tax at the rate (the 2307 shows the real one); null when the rate is not known. */
  incomePaymentCents: number | null;
  cwtCents: number; vatWithheldCents: number;
  /** In hand, still to come, or null for a journal voucher on 1410 or 1404 (no 2307 recorded). */
  certificate: 'received' | 'pending' | null;
  /** An opening 2307's quarter ('2026-Q2'); null for the quarter's own. */
  period: string | null;
  /** The documents behind the row. */
  documents: string[];
}

export function sawt(db: Db, year: number, quarter: Quarter, today: string) {
  const { from, to } = quarterRange(year, quarter);
  const register = withholdingReceivedRegister(db, from, to);
  const lines = new Map<string, SawtRow>();
  for (const r of register.rows) {
    const period = r.opening ? r.period : null;
    const key = JSON.stringify([r.customerId, r.atc, r.certificate, period]);
    const who = r.customerId ? customerName(db, r.customerId) : { name: r.customerName, tin: r.tin };
    const rate = r.atc ? ATC_RATE[r.atc] : undefined;
    const l = lines.get(key) ?? {
      customerId: r.customerId, tin: who.tin, registeredName: who.name, atc: r.atc, nature: rate?.nature ?? null, rateBp: rate?.rateBp ?? null,
      incomePaymentCents: null, cwtCents: 0, vatWithheldCents: 0, certificate: r.certificate, period, documents: [],
    };
    l.cwtCents += r.cwtCents;
    l.vatWithheldCents += r.vatWithheldCents;
    const doc = r.documentNumber ?? r.journalNumber;
    if (!l.documents.includes(doc)) l.documents.push(doc);
    lines.set(key, l);
  }
  const rows = [...lines.values()]
    .filter((l) => l.cwtCents || l.vatWithheldCents)
    .map((l) => ({
      ...l,
      incomePaymentCents: l.rateBp && l.cwtCents ? workBack(l.cwtCents, l.rateBp) : !l.cwtCents ? workBack(l.vatWithheldCents, VAT_WITHHELD_BP) : null,
    }))
    .sort((a, b) => a.registeredName.localeCompare(b.registeredName) || (a.atc ?? '~').localeCompare(b.atc ?? '~') || (a.period ?? '').localeCompare(b.period ?? '')
      || (a.certificate ?? '~').localeCompare(b.certificate ?? '~'));
  const sums = (of: SawtRow[]) => ({ cwtCents: total(of, (r) => r.cwtCents), vatWithheldCents: total(of, (r) => r.vatWithheldCents) });
  const totals = { ...sums(rows), incomePaymentCents: total(rows, (r) => r.incomePaymentCents ?? 0) };
  const ties = [
    tie('cwt_register', 'CWT = 2307s-received register', totals.cwtCents, register.totals.cwtCents),
    tie('cwt_gl', 'CWT = 1410 creditable withholding tax in the books', totals.cwtCents, register.glCwtCents),
    tie('vat_register', 'VAT withheld = 2307s-received register', totals.vatWithheldCents, register.totals.vatWithheldCents),
    tie('vat_gl', 'VAT withheld = 1404 VAT withheld in the books', totals.vatWithheldCents, register.glVatWithheldCents),
  ];
  const pending = rows.filter((r) => r.certificate === 'pending');
  const [checks, check] = checker();
  tiedCheck(check, ties, 'SAWT');
  check(pending.length > 0, 'PENDING_2307', 'warning', `${pending.length === 1 ? 'One row waits' : `${pending.length} rows wait`} for the customer's 2307: leave them off the SAWT until it is in hand.`);
  check(rows.some((r) => r.certificate === null), 'NO_2307', 'warning', 'Some withholding came from journal vouchers with no 2307 recorded: check each against a 2307 before claiming it.');
  check(rows.some((r) => !r.tin), 'NO_TIN', 'warning', 'Some customers have no TIN on file: the SAWT needs one for each withholding agent.');
  check(rows.some((r) => r.atc === 'other' || r.atc === null), 'ATC_TO_CONFIRM', 'warning', 'Some 2307s have no ATC the ERP knows: type the ATC and rate from the 2307.');
  check(rows.length > 0, 'INCOME_WORKED_BACK', 'info', "The income payment is worked back from the tax at the ATC's rate: check it against each 2307.");
  check(rows.some((r) => r.period !== null), 'OPENING', 'info', 'Some rows are opening 2307s from before the cut-over date, with the quarter each covers.');
  check(today <= to, 'PERIOD_OPEN', 'info', 'The quarter has not ended: these figures still change.');
  return { year, quarter, from, to, rows, totals, inHand: sums(rows.filter((r) => r.certificate === 'received')), pending: sums(pending), ties, checks };
}
export type Sawt = ReturnType<typeof sawt>;

export const saleClassInput = z.object({
  journalId: z.string().trim().min(1).max(80),
  saleClass: z.enum(SALE_CLASSES),
  reason: z.string().trim().min(5).max(500),
}).strict();

/**
 * Marks a sale with no output VAT zero-rated, exempt or not a sale. Only the original journal of a sale with no VAT
 * (its cancel follows it); a new class of the same journal is a new row. Nothing is posted.
 */
export function classifySale(db: Db, body: unknown, who: { userId: string; at: string }) {
  const { journalId, saleClass, reason } = saleClassInput.parse(body);
  const j = db.prepare('SELECT id, number, business_date AS date, posting_kind AS posting, sealed FROM journals WHERE id = ?').get(journalId) as
    | { id: string; number: string; date: string; posting: string; sealed: number }
    | undefined;
  if (!j || j.sealed !== 1) throw notFound('The journal');
  if (j.posting !== 'original') throw conflict('REVERSAL', `${j.number} is a cancel: class the journal it cancels.`);
  const row = revenueWithoutVat(db, j.date, j.date).find((r) => r.journalId === j.id);
  if (!row?.sale) throw conflict('NOT_A_SALE_WITHOUT_VAT', `${j.number} is not a sale without output VAT, so it takes no VAT class here.`);
  if (row.saleClass === saleClass) throw conflict('SAME_CLASS', `${j.number} is already marked that way.`);
  db.prepare('INSERT INTO tax_sale_classes (journal_id, vat_class, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(j.id, saleClass, reason, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tax.sale.class', entityType: 'journal', entityId: j.id, data: { number: j.number, saleClass, before: row.saleClass, reason } });
  return { journalId: j.id, number: j.number, saleClass };
}
