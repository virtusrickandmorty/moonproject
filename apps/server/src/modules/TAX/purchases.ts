/**
 * Purchases and EWT registers and the 2307s to issue (PLAN E12, G "Tax"), read from the ledger the way the sales
 * register is (registers.ts): one row per journal that touches the account in the period, a cancel as its own negative
 * row on the cancel date, a journal voucher as an adjustment, the quarterly VAT close left out, so the totals tie to
 * the GL movement by construction. What the ledger does not carry (the supplier's invoice number, what a bill line
 * bought, the EWT class, base and rate) comes from the posting document, through AP, EXP and FA public.ts.
 *   Purchases register (1401 input VAT): amount before VAT, input VAT, total and the class the 2550Q and the SLP need.
 *   A bill with lines of two classes gives one row per class.
 *   EWT register (2311 EWT payable): EWT class, ATC, base, rate and EWT.
 *   2307s to issue for a quarter: per supplier and ATC, the base and EWT of each month.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from '../../engine/settings.ts';
import { billTaxFacts, type BillLineKind, type BillTaxFacts } from '../AP/public.ts';
import { voucherTaxFacts } from '../EXP/public.ts';
import { purchaseTaxFacts } from '../FA/public.ts';
import { supplierTaxInfo } from '../PUR/public.ts';
import { quarterRange, type Quarter } from './calendar.ts';
import { movement, total, touches, type Touch } from './registers.ts';

export type PurchaseClass = 'capital_goods' | 'goods' | 'services';
const CLASSES: readonly PurchaseClass[] = ['capital_goods', 'goods', 'services'];
const BILL_LINE_CLASS: Record<BillLineKind, PurchaseClass> = { supply: 'goods', freight_in: 'goods', subcontract: 'services', category: 'services' };

/**
 * The class of a purchase on the 2550Q and the SLP: capital goods (an asset bought, FA-), goods (supplies and freight-in
 * on a bill), services (subcontracting and expense categories on a bill, and every expense voucher). Null for anything
 * else on 1401, like a journal voucher: the accountant classes it.
 */
export function purchaseClass(docType: string | null, billLine?: BillLineKind): PurchaseClass | null {
  if (docType === 'fa.buy') return 'capital_goods';
  if (docType === 'exp.voucher') return 'services';
  if (docType === 'ap.bill' && billLine) return BILL_LINE_CLASS[billLine];
  return null;
}

/** The ATC of each EWT class for an individual payee (WI) and a company (WC); the professional-fee classes name the payee. */
const ATC: Record<EwtClass, { individual?: string; company?: string }> = {
  rent_5: { individual: 'WI100', company: 'WC100' },
  contractor_2: { individual: 'WI120', company: 'WC120' },
  prof_ind_5: { individual: 'WI010' },
  prof_ind_10: { individual: 'WI011' },
  prof_firm_10: { company: 'WC010' },
  prof_firm_15: { company: 'WC011' },
  goods_1: { individual: 'WI158', company: 'WC158' },
  services_2: { individual: 'WI160', company: 'WC160' },
};

/**
 * The ATC of an EWT class, and the ATCs it can be. A class that does not say whether the payee is an individual or a
 * company takes `payee`; PUR has no such field yet, so those classes come back with no ATC ("ATC to confirm").
 */
export function ewtAtc(cls: EwtClass, payee?: 'individual' | 'company'): { atc: string | null; choices: string[] } {
  const a = ATC[cls];
  const choices = [a.individual, a.company].filter((x): x is string => x !== undefined);
  return { atc: choices.length === 1 ? choices[0]! : payee ? (a[payee] ?? null) : null, choices };
}

export interface SupplierRow {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal';
  documentId: string | null; docType: string | null; documentNumber: string | null; documentStatus: 'posted' | 'cancelled' | null;
  /** The party on the ledger lines: a supplier on file, or `tin:…` for a one-off payee on an expense voucher. */
  supplierId: string | null; supplierName: string; tin: string | null;
}
export interface PurchaseRow extends SupplierRow { supplierInvoiceNo: string | null; purchaseClass: PurchaseClass | null; netCents: number; vatCents: number; totalCents: number }
export interface EwtRow extends SupplierRow { ewtClass: EwtClass | null; atc: string | null; atcChoices: string[]; baseCents: number | null; rateBp: number | null; ewtCents: number }

/** What the posting document says beside the ledger: the payee as registered, the invoice number, a bill's lines, the EWT. */
interface Source {
  name: string; tin: string | null; invoiceNo: string | null;
  lines?: BillTaxFacts['lines'];
  ewt?: { cls: EwtClass | null; rateBp: number; baseCents: number };
}

function registered(db: Db, partyId: string): Pick<Source, 'name' | 'tin'> {
  const s = supplierTaxInfo(db, partyId);
  if (s) return { name: s.registeredName, tin: s.tin };
  const digits = /^tin:(\d{12,14})$/.exec(partyId)?.[1];
  return { name: '?', tin: digits ? digits.replace(/^(\d{3})(\d{3})(\d{3})/, '$1-$2-$3-') : null };
}

function sourceOf(db: Db, t: Touch): Source {
  const ewt = (f: { ewtClass: EwtClass | null; ewtRateBp: number; ewtBaseCents: number }) => ({ cls: f.ewtClass, rateBp: f.ewtRateBp, baseCents: f.ewtBaseCents });
  const bill = t.docType === 'ap.bill' ? billTaxFacts(db, t.sourceId) : undefined;
  if (bill) return { ...registered(db, bill.supplierId), invoiceNo: bill.supplierInvoiceNo, lines: bill.lines, ewt: ewt(bill) };
  const v = t.docType === 'exp.voucher' ? voucherTaxFacts(db, t.sourceId) : undefined;
  if (v) return { ...(v.supplierId ? registered(db, v.supplierId) : { name: v.payeeName, tin: v.payeeTin }), invoiceNo: v.supplierInvoiceNo, ewt: ewt(v) };
  const fa = t.docType === 'fa.buy' ? purchaseTaxFacts(db, t.sourceId) : undefined;
  if (fa) return { ...registered(db, fa.supplierId), invoiceNo: fa.supplierInvoiceNo };
  return { ...(t.partyId ? registered(db, t.partyId) : { name: '', tin: null }), invoiceNo: null };
}

function supplierRow(t: Touch, s: Source): SupplierRow {
  return {
    journalId: t.journalId, journalNumber: t.journalNumber, date: t.date, posting: t.posting,
    documentId: t.docType ? t.sourceId : null, docType: t.docType, documentNumber: t.documentNumber, documentStatus: t.docStatus,
    supplierId: t.partyId, supplierName: t.parties > 1 ? `${s.name} and others` : s.name, tin: s.tin,
  };
}

const sign = (t: Touch) => (t.posting === 'reversal' ? -1 : 1);

/** A journal's amount before VAT and VAT by class: one class, or a bill's lines by class, the last taking what is left so they add up to the journal. */
function byClass(t: Touch & { netCents: number; vatCents: number }, s: Source): { cls: PurchaseClass | null; netCents: number; vatCents: number }[] {
  const lines = s.lines ?? [];
  const classes = CLASSES.filter((c) => lines.some((l) => purchaseClass(t.docType, l.kind) === c));
  if (classes.length < 2) return [{ cls: classes[0] ?? purchaseClass(t.docType), netCents: t.netCents, vatCents: t.vatCents }];
  const parts = classes.map((cls) => {
    const of = lines.filter((l) => purchaseClass(t.docType, l.kind) === cls);
    return { cls, netCents: sign(t) * total(of, (l) => l.costCents), vatCents: sign(t) * total(of, (l) => l.vatCents) };
  });
  const last = parts.at(-1)!, rest = parts.slice(0, -1);
  last.netCents = t.netCents - total(rest, (p) => p.netCents);
  last.vatCents = t.vatCents - total(rest, (p) => p.vatCents);
  return parts;
}

/** Purchases register: every journal on 1401 input VAT, with the amount before VAT (the journal's other debits), VAT, total and class. */
export function purchasesRegister(db: Db, from: string, to: string) {
  const rows: PurchaseRow[] = touches(db, ['INPUT_VAT'], {
    vatCents: `CASE WHEN a.role_key = 'INPUT_VAT' THEN l.debit_cents - l.credit_cents ELSE 0 END`,
    netCents: `CASE WHEN a.role_key = 'INPUT_VAT' THEN 0 WHEN j.posting_kind = 'reversal' THEN -l.credit_cents ELSE l.debit_cents END`,
  }, from, to).flatMap((t) => {
    const s = sourceOf(db, t);
    const row = { ...supplierRow(t, s), supplierInvoiceNo: s.invoiceNo };
    return byClass(t, s).map((p) => ({ ...row, purchaseClass: p.cls, netCents: p.netCents, vatCents: p.vatCents, totalCents: p.netCents + p.vatCents }));
  });
  const sums = (of: PurchaseRow[]) => ({ netCents: total(of, (r) => r.netCents), vatCents: total(of, (r) => r.vatCents), totalCents: total(of, (r) => r.totalCents) });
  return {
    from, to, rows,
    totals: sums(rows),
    /** The 2550Q and SLP figures: capital goods, goods, services, and what is still to classify. */
    byClass: {
      ...(Object.fromEntries(CLASSES.map((c) => [c, sums(rows.filter((r) => r.purchaseClass === c))])) as Record<PurchaseClass, ReturnType<typeof sums>>),
      unclassified: sums(rows.filter((r) => r.purchaseClass === null)),
    },
    /** 1401's movement in the period; equal to the VAT total, or the register is missing something. */
    glVatCents: movement(db, ['INPUT_VAT'], from, to, 'debit'),
  };
}

/** EWT register: every journal on 2311 EWT payable, with the EWT class, its ATC, the base and rate of the document, and the EWT. */
export function ewtRegister(db: Db, from: string, to: string) {
  const rows: EwtRow[] = touches(db, ['EWT_PAYABLE'], {
    ewtCents: `CASE WHEN a.role_key = 'EWT_PAYABLE' THEN l.credit_cents - l.debit_cents ELSE 0 END`,
  }, from, to).map((t) => {
    const s = sourceOf(db, t);
    const cls = s.ewt?.cls ?? null;
    const { atc, choices } = cls ? ewtAtc(cls) : { atc: null, choices: [] };
    return {
      ...supplierRow(t, s), ewtClass: cls, atc, atcChoices: choices,
      baseCents: s.ewt ? sign(t) * s.ewt.baseCents : null, rateBp: s.ewt?.rateBp ?? null, ewtCents: t.ewtCents,
    };
  });
  return {
    from, to, rows,
    totals: { baseCents: total(rows, (r) => r.baseCents ?? 0), ewtCents: total(rows, (r) => r.ewtCents) },
    /** 2311's movement in the period; equal to the EWT total, or the register is missing something. */
    glEwtCents: movement(db, ['EWT_PAYABLE'], from, to, 'credit'),
    /** Rows whose class leaves the ATC open (individual or company): the accountant confirms it. */
    atcToConfirmCount: rows.filter((r) => r.ewtClass !== null && r.atc === null).length,
  };
}

export interface CertificateLine {
  supplierId: string | null; supplierName: string; tin: string | null; ewtClass: EwtClass | null; atc: string | null; atcChoices: string[];
  months: { month: string; baseCents: number; ewtCents: number }[]; baseCents: number; ewtCents: number;
}

/**
 * The 2307s Virtus issues for a quarter: one line per supplier and ATC (per EWT class while the ATC is to confirm),
 * with the base and EWT of each month, from the EWT register. A line that comes to nothing for the quarter (a bill
 * cancelled in the same quarter) is left out.
 */
export function certificatesToIssue(db: Db, year: number, quarter: Quarter) {
  const { from, to } = quarterRange(year, quarter);
  const months = [1, 2, 3].map((i) => `${year}-${String(3 * quarter - 3 + i).padStart(2, '0')}`);
  const lines = new Map<string, CertificateLine>();
  for (const r of ewtRegister(db, from, to).rows) {
    const key = JSON.stringify([r.supplierId, r.atc ?? r.ewtClass]);
    const line = lines.get(key) ?? {
      supplierId: r.supplierId, supplierName: r.supplierName, tin: r.tin, ewtClass: r.ewtClass, atc: r.atc, atcChoices: r.atcChoices,
      months: months.map((month) => ({ month, baseCents: 0, ewtCents: 0 })), baseCents: 0, ewtCents: 0,
    };
    const m = line.months[months.indexOf(r.date.slice(0, 7))]!;
    m.baseCents += r.baseCents ?? 0;
    m.ewtCents += r.ewtCents;
    line.baseCents += r.baseCents ?? 0;
    line.ewtCents += r.ewtCents;
    lines.set(key, line);
  }
  const rows = [...lines.values()]
    .filter((l) => l.baseCents !== 0 || l.ewtCents !== 0)
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName) || (a.atc ?? a.ewtClass ?? '').localeCompare(b.atc ?? b.ewtClass ?? ''));
  return { year, quarter, from, to, months, lines: rows, totals: { baseCents: total(rows, (l) => l.baseCents), ewtCents: total(rows, (l) => l.ewtCents) } };
}
