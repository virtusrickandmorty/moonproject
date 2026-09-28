/**
 * Tax registers (PLAN E12, G "Tax", L6), read from the ledger so each one ties to its GL account by construction:
 * one row per journal that touches the account in the period. A cancelled document's reversal is its own negative row
 * on the cancel date, the way it lands in that period's return, and a journal voucher on the account shows up as an
 * adjustment. Each row names the document, the number on the BIR paper form (sales invoice or CR, from
 * documents.external_number) and the customer's registered name and TIN.
 *   Sales register (2301 output VAT): VATable sales = the journal's revenue credits, VAT, total.
 *   Withholding received (1410 CWT and 1404 VAT withheld, the customers' 2307s): ATC and whether the 2307 is in hand.
 *   VAT summary of a quarter: output, input, withheld and carried-over VAT, and what is payable or carried forward.
 */
import type { Db } from '../../platform/db/driver.ts';
import { customerRef, customerTaxInfo } from '../CUS/public.ts';
import { withholdingOf } from '../COL/public.ts';
import { addDays, quarterRange, vatReturnDue, type Quarter } from './calendar.ts';

export interface RegisterRow {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal';
  documentId: string | null; docType: string | null; documentNumber: string | null; formNumber: string | null; documentStatus: 'posted' | 'cancelled' | null;
  customerId: string | null; customerName: string; tin: string | null;
}
export interface SalesRow extends RegisterRow { netCents: number; vatCents: number; totalCents: number }
export interface WithholdingRow extends RegisterRow { atc: string | null; certificate: 'pending' | 'received' | null; cwtCents: number; vatWithheldCents: number }

interface Touch {
  journalId: string; journalNumber: string; date: string; posting: 'original' | 'reversal'; sourceType: string; sourceId: string;
  docType: string | null; documentNumber: string | null; formNumber: string | null; docStatus: 'posted' | 'cancelled' | null; customerId: string | null; customers: number;
}

/**
 * Journals in [from, to] with a line on one of `roles`, with per-journal sums of `sums` (column → SQL over l and a).
 * Only sealed journals count. The customer is the party on those lines (several on one JV: the first, flagged).
 */
function touches<K extends string>(db: Db, roles: string[], sums: Record<K, string>, from: string, to: string): (Touch & Record<K, number>)[] {
  const marks = roles.map(() => '?').join(', ');
  const cols = Object.entries<string>(sums).map(([k, expr]) => `SUM(${expr}) AS ${k}`).join(', ');
  return db
    .prepare(
      `SELECT j.id AS journalId, j.number AS journalNumber, j.business_date AS date, j.posting_kind AS posting, j.source_type AS sourceType,
         j.source_id AS sourceId, d.doc_type AS docType, d.number AS documentNumber, d.external_number AS formNumber, d.status AS docStatus,
         MIN(CASE WHEN a.role_key IN (${marks}) THEN l.party_id END) AS customerId,
         COUNT(DISTINCT CASE WHEN a.role_key IN (${marks}) THEN l.party_id END) AS customers, ${cols}
       FROM journals j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN documents d ON d.id = j.source_id AND j.source_type IN ('document', 'document-cancel')
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ?
         AND EXISTS (SELECT 1 FROM journal_lines x JOIN accounts xa ON xa.id = x.account_id WHERE x.journal_id = j.id AND xa.role_key IN (${marks}))
       GROUP BY j.id ORDER BY j.business_date, j.number`,
    )
    .all(...roles, ...roles, from, to, ...roles) as (Touch & Record<K, number>)[];
}

function base(db: Db, t: Touch): RegisterRow {
  const tax = t.customerId ? customerTaxInfo(db, t.customerId) : undefined;
  const name = t.customerId ? (tax?.registeredName ?? customerRef(db, t.customerId)?.display_name ?? '?') : '';
  return {
    journalId: t.journalId, journalNumber: t.journalNumber, date: t.date, posting: t.posting,
    documentId: t.docType ? t.sourceId : null, docType: t.docType, documentNumber: t.documentNumber, formNumber: t.formNumber, documentStatus: t.docStatus,
    customerId: t.customerId, customerName: t.customers > 1 ? `${name} and others` : name, tin: tax?.tin ?? null,
  };
}

/** The GL movement of the accounts with these roles in [from, to] (credit − debit, or debit − credit). */
function movement(db: Db, roles: string[], from: string, to: string, side: 'credit' | 'debit'): number {
  const sign = side === 'credit' ? 'l.credit_cents - l.debit_cents' : 'l.debit_cents - l.credit_cents';
  return db
    .prepare(
      `SELECT COALESCE(SUM(${sign}), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ? AND a.role_key IN (${roles.map(() => '?').join(', ')})`,
    )
    .pluck()
    .get(from, to, ...roles) as number;
}

const total = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Sales register: every journal on 2301 output VAT, with VATable sales (revenue credits), VAT and total. */
export function salesRegister(db: Db, from: string, to: string) {
  const rows: SalesRow[] = touches(db, ['OUTPUT_VAT'], {
    vatCents: `CASE WHEN a.role_key = 'OUTPUT_VAT' THEN l.credit_cents - l.debit_cents ELSE 0 END`,
    netCents: `CASE WHEN a.type = 'revenue' THEN l.credit_cents - l.debit_cents ELSE 0 END`,
  }, from, to).map((t) => ({ ...base(db, t), netCents: t.netCents, vatCents: t.vatCents, totalCents: t.netCents + t.vatCents }));
  const vatCents = total(rows, (r) => r.vatCents);
  return {
    from, to, rows,
    totals: { netCents: total(rows, (r) => r.netCents), vatCents, totalCents: total(rows, (r) => r.totalCents) },
    /** 2301's movement in the period; equal to the VAT total, or the register is missing something. */
    glVatCents: movement(db, ['OUTPUT_VAT'], from, to, 'credit'),
  };
}

/** Withholding received: every journal on 1410 CWT or 1404 VAT withheld, with the 2307's ATC and whether it is in hand. */
export function withholdingReceivedRegister(db: Db, from: string, to: string) {
  const rows: WithholdingRow[] = touches(db, ['CWT', 'VAT_WITHHELD'], {
    cwtCents: `CASE WHEN a.role_key = 'CWT' THEN l.debit_cents - l.credit_cents ELSE 0 END`,
    vatWithheldCents: `CASE WHEN a.role_key = 'VAT_WITHHELD' THEN l.debit_cents - l.credit_cents ELSE 0 END`,
  }, from, to).map((t) => {
    const w = t.docType === 'col.collection' ? withholdingOf(db, t.sourceId) : undefined;
    return { ...base(db, t), atc: w?.atc ?? null, certificate: w?.certificate ?? null, cwtCents: t.cwtCents, vatWithheldCents: t.vatWithheldCents };
  });
  return {
    from, to, rows,
    totals: { cwtCents: total(rows, (r) => r.cwtCents), vatWithheldCents: total(rows, (r) => r.vatWithheldCents) },
    glCwtCents: movement(db, ['CWT'], from, to, 'debit'),
    glVatWithheldCents: movement(db, ['VAT_WITHHELD'], from, to, 'debit'),
    /** Collections still standing whose 2307 is not in hand yet, for the follow-up list. */
    pendingCount: rows.filter((r) => r.posting === 'original' && r.documentStatus === 'posted' && r.certificate === 'pending').length,
  };
}

/**
 * VAT for one quarter (the accountant home's "VAT this quarter", PLAN E13; the figures of the quarterly VAT close,
 * research §3.8 R46): output VAT less input VAT, the VAT government buyers withheld and the input VAT carried over from
 * earlier quarters. Positive: payable with the 2550Q; negative: carried over to the next quarter. Read from the ledger,
 * so it is an estimate until the quarter's VAT close is posted. VAT withheld whose 2307 is not in hand yet is shown on
 * its own: it may be claimed only with the certificate.
 */
export function vatSummary(db: Db, year: number, quarter: Quarter) {
  const { from, to } = quarterRange(year, quarter);
  const outputVatCents = movement(db, ['OUTPUT_VAT'], from, to, 'credit');
  const inputVatCents = movement(db, ['INPUT_VAT'], from, to, 'debit');
  const vatWithheldCents = movement(db, ['VAT_WITHHELD'], from, to, 'debit');
  const carryOverCents = movement(db, ['INPUT_VAT_CARRYOVER'], '0000-01-01', addDays(from, -1), 'debit');
  const pending = withholdingReceivedRegister(db, from, to).rows.filter((r) => r.posting === 'original' && r.documentStatus === 'posted' && r.certificate === 'pending');
  const netCents = outputVatCents - inputVatCents - vatWithheldCents - carryOverCents;
  return {
    year, quarter, from, to, returnDue: vatReturnDue(db, year, quarter),
    outputVatCents, inputVatCents, vatWithheldCents, carryOverCents,
    /** VAT withheld on collections still waiting for their 2307, already inside vatWithheldCents. */
    vatWithheldPendingCents: total(pending, (r) => r.vatWithheldCents),
    payableCents: Math.max(netCents, 0),
    carryForwardCents: Math.max(-netCents, 0),
  };
}
