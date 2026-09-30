/**
 * Tax registers (PLAN E12, G "Tax", L6), read from the ledger so each one ties to its GL account by construction:
 * one row per journal that touches the account in the period. A cancelled document's reversal is its own negative row
 * on the cancel date, the way it lands in that period's return, and a journal voucher on the account shows up as an
 * adjustment; the quarterly VAT close, the BIR payments, the opening tax payables (OBTP-), the year-end income tax
 * settlements (ITS-) and the output VAT on uncollected receivables (UVAT-, UVATR-) are left out. Each row
 * names the document, the number on the BIR paper form (sales invoice or CR, from documents.external_number) and the
 * customer's registered name and TIN.
 *   Sales register (2301 output VAT): VATable sales = the journal's revenue credits (for an asset sold, FA: the NET on
 *   its invoice, since only its gain is revenue), VAT, total. With downpayment VAT
 *   modes B and C (PLAN D3) the VAT on a downpayment is booked before the sale: the VATable amount behind it comes with
 *   it (COL registerBaseOf: + on the collection or downpayment invoice, − on the release invoice that books the rest).
 *   Withholding received (1410 CWT and 1404 VAT withheld, the customers' 2307s): ATC and whether the 2307 is in hand.
 *   An opening withholding (OBWT-) is one row per 2307 it brings in, marked as opening, with the quarter it covers.
 */
import type { Db } from '../../platform/db/driver.ts';
import { customerRef, customerTaxInfo } from '../CUS/public.ts';
import { registerBaseOf, registerBaseSources, withholdingOf } from '../COL/public.ts';
import { assetSaleTaxFacts } from '../FA/public.ts';
import { OPENING_WITHHOLDING, openingLines, receivedOn } from './withholding.ts';

export interface RegisterRow {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal';
  documentId: string | null; docType: string | null; documentNumber: string | null; formNumber: string | null; documentStatus: 'posted' | 'cancelled' | null;
  customerId: string | null; customerName: string; tin: string | null;
}
export interface SalesRow extends RegisterRow { netCents: number; vatCents: number; totalCents: number }
export interface WithholdingRow extends RegisterRow {
  atc: string | null; certificate: 'pending' | 'received' | null; cwtCents: number; vatWithheldCents: number;
  /** Which 2307 of the document (the opening's row; 0 for a collection's) and, if it came after it was recorded, when. */
  lineNo: number; receivedOn: string | null;
  /** An opening withholding's 2307, from before the cut-over date; the quarter it or a 2307 received with no cash covers ('2026-Q2'). */
  opening: boolean; period: string | null;
}

export interface Touch {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal'; sourceType: string; sourceId: string;
  docType: string | null; documentNumber: string | null; formNumber: string | null; docStatus: 'posted' | 'cancelled' | null; partyId: string | null; parties: number;
}

/** The quarterly VAT close moves balances between VAT accounts; it is not a sale or a 2307, so no register lists it. */
const NOT_A_CLOSE = `NOT EXISTS (SELECT 1 FROM tax_vat_closes c WHERE c.document_id = j.source_id AND j.source_type = 'document')`;
/** A BIR payment (BIRP-) pays the BIR what the withholdings left payable on 2311; it withholds nothing, so no register lists it either. */
const NOT_A_PAYMENT = `NOT EXISTS (SELECT 1 FROM tax_bir_payments p WHERE p.document_id = j.source_id AND j.source_type = 'document')`;
/**
 * An opening tax payable (OBTP-) is dated the cut-over date but brings in returns of earlier periods, prepared from the
 * old books: it is no tax withheld or VAT of any period here, so no register lists it either.
 */
const NOT_AN_OPENING_PAYABLE = `NOT EXISTS (SELECT 1 FROM tax_opening_payables o WHERE o.document_id = j.source_id AND j.source_type = 'document')`;
/** The year-end income tax settlement (ITS-) applies the 2307s in hand (1410) against the year's tax: no 2307 received, so no register lists it. */
const NOT_A_SETTLEMENT = `NOT EXISTS (SELECT 1 FROM tax_income_tax_settlements s WHERE s.document_id = j.source_id AND j.source_type = 'document')`;
/**
 * Output VAT taken off for an uncollected receivable (UVAT-) and added back when paid (UVATR-) moves no sale: the sale
 * stays in its own quarter's register and SLSP, and the 2550Q shows these on their own lines (vat-return.ts).
 */
const NOT_UNCOLLECTED_VAT = `NOT EXISTS (SELECT 1 FROM tax_uncollected_vat u WHERE u.document_id = j.source_id AND j.source_type = 'document')
  AND NOT EXISTS (SELECT 1 FROM tax_uncollected_vat_recoveries u WHERE u.document_id = j.source_id AND j.source_type = 'document')`;
/**
 * The journals the registers read: all but the VAT closes, the BIR payments, the opening tax payables, the income tax
 * settlements and the output VAT on uncollected receivables (their cancels included).
 */
export const IN_REGISTERS = `${NOT_A_CLOSE} AND ${NOT_A_PAYMENT} AND ${NOT_AN_OPENING_PAYABLE} AND ${NOT_A_SETTLEMENT} AND ${NOT_UNCOLLECTED_VAT}`;

/**
 * Journals in [from, to] with a line on one of `roles`, with per-journal sums of `sums` (column → SQL over j, l and a).
 * Only sealed journals count. The party (customer or supplier) is the one on those lines (several on one JV: the first, flagged).
 * `alsoSources`: journals of these documents are listed too, with no line on `roles` (their party is then the customer on them).
 */
export function touches<K extends string>(db: Db, roles: string[], sums: Record<K, string>, from: string, to: string, alsoSources: string[] = []): (Touch & Record<K, number>)[] {
  const marks = roles.map(() => '?').join(', ');
  const cols = Object.entries<string>(sums).map(([k, expr]) => `SUM(${expr}) AS ${k}`).join(', ');
  return db
    .prepare(
      `SELECT j.id AS journalId, j.number AS journalNumber, j.business_date AS date, j.posting_kind AS posting, j.source_type AS sourceType,
         j.source_id AS sourceId, d.doc_type AS docType, d.number AS documentNumber, d.external_number AS formNumber, d.status AS docStatus,
         COALESCE(MIN(CASE WHEN a.role_key IN (${marks}) THEN l.party_id END), MIN(CASE WHEN l.party_type = 'customer' THEN l.party_id END)) AS partyId,
         COUNT(DISTINCT CASE WHEN a.role_key IN (${marks}) THEN l.party_id END) AS parties, ${cols}
       FROM journals j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN documents d ON d.id = j.source_id AND j.source_type IN ('document', 'document-cancel')
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ? AND ${IN_REGISTERS}
         AND (EXISTS (SELECT 1 FROM journal_lines x JOIN accounts xa ON xa.id = x.account_id WHERE x.journal_id = j.id AND xa.role_key IN (${marks}))
           OR j.source_id IN (SELECT value FROM json_each(?)))
       GROUP BY j.id ORDER BY j.business_date, j.number`,
    )
    .all(...roles, ...roles, from, to, ...roles, JSON.stringify(alsoSources)) as (Touch & Record<K, number>)[];
}

function base(db: Db, t: Touch): RegisterRow {
  const tax = t.partyId ? customerTaxInfo(db, t.partyId) : undefined;
  const name = t.partyId ? (tax?.registeredName ?? customerRef(db, t.partyId)?.display_name ?? '?') : '';
  return {
    journalId: t.journalId, journalNumber: t.journalNumber, date: t.date, posting: t.posting,
    documentId: t.docType ? t.sourceId : null, docType: t.docType, documentNumber: t.documentNumber, formNumber: t.formNumber, documentStatus: t.docStatus,
    customerId: t.partyId, customerName: t.parties > 1 ? `${name} and others` : name, tin: tax?.tin ?? null,
  };
}

/** The GL movement of the accounts with these roles in [from, to] (credit − debit, or debit − credit). */
export function movement(db: Db, roles: string[], from: string, to: string, side: 'credit' | 'debit'): number {
  const sign = side === 'credit' ? 'l.credit_cents - l.debit_cents' : 'l.debit_cents - l.credit_cents';
  return db
    .prepare(
      `SELECT COALESCE(SUM(${sign}), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ? AND ${IN_REGISTERS} AND a.role_key IN (${roles.map(() => '?').join(', ')})`,
    )
    .pluck()
    .get(from, to, ...roles) as number;
}

export const total = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/**
 * An asset sold (FA, fa.disposal of kind 'sale'): its VATable sales are the NET written on the booklet, not the revenue
 * credits of its journal (only the gain is revenue); negative on its mirror. A buyer typed on the sale, not a customer,
 * is named as recorded (2301 then carries the sale itself as its party).
 */
function assetSaleRow(db: Db, t: Touch, asset: NonNullable<ReturnType<typeof assetSaleTaxFacts>>): RegisterRow & { netCents: number } {
  const netCents = (t.posting === 'reversal' ? -1 : 1) * asset.netCents;
  const row = base(db, t);
  return asset.customerId ? { ...row, netCents } : { ...row, customerName: asset.buyerName, tin: asset.buyerTin, netCents };
}

/**
 * Sales register: every journal on 2301 output VAT, with VATable sales (revenue credits), VAT and total. A downpayment's
 * VATable amount whose VAT rounded to nothing (a few centavos) has no 2301 line: its journal is listed too, VAT 0.00.
 */
export function salesRegister(db: Db, from: string, to: string) {
  const rows: SalesRow[] = touches(db, ['OUTPUT_VAT'], {
    vatCents: `CASE WHEN a.role_key = 'OUTPUT_VAT' THEN l.credit_cents - l.debit_cents ELSE 0 END`,
    netCents: `CASE WHEN a.type = 'revenue' THEN l.credit_cents - l.debit_cents ELSE 0 END`,
    vatLines: `CASE WHEN a.role_key = 'OUTPUT_VAT' THEN 1 ELSE 0 END`,
  }, from, to, registerBaseSources(db)).map((t) => {
    const asset = t.docType === 'fa.disposal' ? assetSaleTaxFacts(db, t.sourceId) : undefined;
    const row = asset ? assetSaleRow(db, t, asset) : { ...base(db, t), netCents: t.netCents + registerBaseOf(db, t.sourceType, t.sourceId, t.posting) };
    return { ...row, vatCents: t.vatCents, totalCents: row.netCents + t.vatCents, vatLines: t.vatLines };
  }).filter((r) => r.vatLines > 0 || r.netCents !== 0).map(({ vatLines: _, ...r }) => r);
  const vatCents = total(rows, (r) => r.vatCents);
  return {
    from, to, rows,
    totals: { netCents: total(rows, (r) => r.netCents), vatCents, totalCents: total(rows, (r) => r.totalCents) },
    /** 2301's movement in the period; equal to the VAT total, or the register is missing something. */
    glVatCents: movement(db, ['OUTPUT_VAT'], from, to, 'credit'),
  };
}

/** The 2307's status now: as recorded, or received once a pending one was marked received. */
const status = (recorded: 'pending' | 'received', on: string | null) => (on ? 'received' : recorded);

/**
 * Withholding received: every journal on 1410 CWT or 1404 VAT withheld, with the 2307's ATC and whether it is in hand.
 * An opening withholding's journal is split into its rows, one per 2307 and customer (its reversal the same, negative).
 */
export function withholdingReceivedRegister(db: Db, from: string, to: string) {
  const rows: WithholdingRow[] = touches(db, ['CWT', 'VAT_WITHHELD'], {
    cwtCents: `CASE WHEN a.role_key = 'CWT' THEN l.debit_cents - l.credit_cents ELSE 0 END`,
    vatWithheldCents: `CASE WHEN a.role_key = 'VAT_WITHHELD' THEN l.debit_cents - l.credit_cents ELSE 0 END`,
  }, from, to).flatMap((t): WithholdingRow[] => {
    if (t.docType === OPENING_WITHHOLDING && t.sourceType === 'document') {
      const sign = t.posting === 'reversal' ? -1 : 1;
      return openingLines(db, t.sourceId).map((l) => {
        const on = l.certificate === 'pending' ? receivedOn(db, t.sourceId, l.lineNo) : null;
        return {
          ...base(db, { ...t, partyId: l.customerId, parties: 1 }), atc: l.atc, certificate: status(l.certificate, on),
          cwtCents: sign * l.cwtCents || 0, vatWithheldCents: sign * l.vatWithheldCents || 0,
          lineNo: l.lineNo, receivedOn: on, opening: true, period: `${l.year}-Q${l.quarter}`,
        };
      });
    }
    const w = t.docType === 'col.collection' || t.docType === 'col.cwt_only' ? withholdingOf(db, t.sourceId) : undefined;
    const on = w?.certificate === 'pending' ? receivedOn(db, t.sourceId, 0) : null;
    return [{
      ...base(db, t), atc: w?.atc ?? null, certificate: w ? status(w.certificate, on) : null, cwtCents: t.cwtCents, vatWithheldCents: t.vatWithheldCents,
      lineNo: 0, receivedOn: on, opening: false, period: w?.period ?? null,
    }];
  });
  return {
    from, to, rows,
    totals: { cwtCents: total(rows, (r) => r.cwtCents), vatWithheldCents: total(rows, (r) => r.vatWithheldCents) },
    glCwtCents: movement(db, ['CWT'], from, to, 'debit'),
    glVatWithheldCents: movement(db, ['VAT_WITHHELD'], from, to, 'debit'),
    /** 2307s of collections and openings still standing that are not in hand yet, for the follow-up list. */
    pendingCount: rows.filter((r) => r.posting === 'original' && r.documentStatus === 'posted' && r.certificate === 'pending').length,
  };
}

