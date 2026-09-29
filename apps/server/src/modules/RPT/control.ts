import type { Db } from '../../platform/db/driver.ts';
import { cashReportData } from '../CASH/public.ts';
import { monthlyMiscException } from '../EXP/public.ts';
import { releasesAwaitingInvoice } from '../JO/public.ts';

export interface LateEntryRow {
  id: string;
  number: string;
  docType: string;
  businessDate: string;
  madeAt: string;
  summary: string;
  documentPath: string;
}

interface LateEntrySqlRow extends Omit<LateEntryRow, 'documentPath'> {}

/** Backdated journals and openings, taken from document dates and their immutable posting timestamps. */
export function lateEntries(db: Db): { rows: LateEntryRow[] } {
  const rows = db.prepare(
    `SELECT d.id, d.number, d.doc_type AS docType, d.business_date AS businessDate,
       d.posted_at AS madeAt, d.summary
     FROM documents d
     WHERE d.doc_type IN ('acc.jv', 'acc.opening')
       AND d.business_date < date(d.posted_at, '+8 hours')
     ORDER BY d.posted_at DESC`,
  ).all() as LateEntrySqlRow[];
  return { rows: rows.map((row) => ({ ...row, documentPath: `/docs/${row.docType}/${row.id}` })) };
}

export interface CancellationRow {
  id: string;
  number: string;
  docType: string;
  businessDate: string;
  cancelledAt: string;
  reason: string;
  replacementId: string | null;
  documentPath: string;
  replacementPath: string | null;
}

type CancellationSqlRow = Omit<CancellationRow, 'documentPath' | 'replacementPath'>;

/** Cancelled documents, from lifecycle fields, with links to both the original and any replacement. */
export function cancellations(db: Db): { rows: CancellationRow[] } {
  const rows = db.prepare(
    `SELECT id, number, doc_type AS docType, business_date AS businessDate,
       cancelled_at AS cancelledAt, cancel_reason AS reason, replaced_by_id AS replacementId
     FROM documents
     WHERE status = 'cancelled'
     ORDER BY cancelled_at DESC`,
  ).all() as CancellationSqlRow[];
  return {
    rows: rows.map((row) => ({
      ...row,
      documentPath: `/docs/${row.docType}/${row.id}`,
      replacementPath: row.replacementId ? `/docs/${row.docType}/${row.replacementId}` : null,
    })),
  };
}

export interface ExceptionRow {
  kind: string;
  detail: string;
  amountCents: number | null;
  documentPath: string;
}

interface OldDraftRow { id: string; docType: string; updatedAt: string }

/** Operational exceptions assembled from unreconciled releases, cash-place ledger balances, drafts, and expenses. */
export function exceptions(db: Db, asOf: string): { asOf: string; rows: ExceptionRow[] } {
  const rows: ExceptionRow[] = [];
  for (const release of releasesAwaitingInvoice(db, asOf)) {
    rows.push({
      kind: 'Released without invoice record',
      detail: release.number,
      amountCents: release.releasedCents,
      documentPath: `/docs/jo.release/${release.id}`,
    });
  }
  for (const place of cashReportData(db, asOf).filter((row) => row.balanceCents < 0)) {
    rows.push({ kind: 'Cash place below zero', detail: place.name, amountCents: place.balanceCents, documentPath: '/cash/accounts' });
  }
  const drafts = db.prepare(
    `SELECT id, doc_type AS docType, updated_at AS updatedAt
     FROM drafts
     WHERE status = 'open' AND date(updated_at, '+8 hours') < date(?, '-3 days')`,
  ).all(asOf) as OldDraftRow[];
  for (const draft of drafts) {
    rows.push({
      kind: 'Draft older than 3 days',
      detail: draft.updatedAt,
      amountCents: null,
      documentPath: `/docs/${draft.docType}/drafts/${draft.id}`,
    });
  }
  const spend = monthlyMiscException(db, asOf.slice(0, 7));
  if ((spend.miscCents ?? 0) * 10 > (spend.totalCents ?? 0)) {
    rows.push({
      kind: 'Misc expenses above 10%',
      detail: asOf.slice(0, 7),
      amountCents: spend.miscCents,
      documentPath: '/rpt/purchases',
    });
  }
  return { asOf, rows };
}

export interface SignInRow { at: string; username: string; success: number; ip: string }

/** Owner-only sign-in history, read from the append-only login-attempt records. */
export function signIns(db: Db, from: string, to: string): { from: string; to: string; rows: SignInRow[] } {
  const rows = db.prepare(
    `SELECT l.at, l.username, l.success, l.ip
     FROM login_attempts l
     WHERE date(l.at, '+8 hours') BETWEEN ? AND ?
     ORDER BY l.at DESC`,
  ).all(from, to) as SignInRow[];
  return { from, to, rows };
}
