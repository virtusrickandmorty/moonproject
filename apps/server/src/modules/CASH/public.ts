/** Read-only CASH contract for other modules. Visibility is enforced by placesFor. */
export { placesFor } from "./places.ts";
export {
  bankReconChecks,
  cashCountChecks,
  type PlaceCheck,
} from "./month-end.ts";

import type { Db } from "../../platform/db/driver.ts";
export interface CashReportRow {
  id: number;
  name: string;
  balanceCents: number;
}

export interface TransferReportRow {
  id: string;
  number: string;
  date: string;
  status: string;
  fromPlace: string;
  toPlace: string;
  sentCents: number;
  receivedCents: number;
  feeCents: number;
}

export interface CountReportRow {
  id: string;
  number: string;
  date: string;
  status: string;
  cashPlace: string;
  countedCents: number;
  ledgerCents: number;
  differenceCents: number;
}

export function cashReportData(db: Db, asOf: string) {
  return db
    .prepare(
      `SELECT a.id,a.name,COALESCE(SUM(CASE WHEN j.business_date<=? THEN l.debit_cents-l.credit_cents ELSE 0 END),0) AS balanceCents FROM cash_place_settings p JOIN accounts a ON a.id=p.account_id AND a.is_cash_place=1 LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journals j ON j.id=l.journal_id AND j.sealed=1 GROUP BY a.id ORDER BY a.code`,
    )
    .all(asOf) as CashReportRow[];
}
export function transfersForReport(db: Db, from: string, to: string) {
  return db
    .prepare(
      `SELECT d.id,d.number,d.business_date AS date,d.status,f.name AS fromPlace,t.name AS toPlace,x.amount_sent_cents AS sentCents,x.amount_received_cents AS receivedCents,x.fee_cents AS feeCents FROM cash_transfers x JOIN documents d ON d.id=x.document_id JOIN accounts f ON f.id=x.from_account_id JOIN accounts t ON t.id=x.to_account_id WHERE d.business_date BETWEEN ? AND ? ORDER BY d.business_date,d.number`,
    )
    .all(from, to) as TransferReportRow[];
}
export function countsForReport(db: Db, from: string, to: string) {
  return db
    .prepare(
      `SELECT d.id,d.number,d.business_date AS date,d.status,a.name AS cashPlace,c.counted_cents AS countedCents,c.ledger_cents AS ledgerCents,c.difference_cents AS differenceCents FROM cash_counts c JOIN documents d ON d.id=c.document_id JOIN accounts a ON a.id=c.cash_account_id WHERE d.business_date BETWEEN ? AND ? ORDER BY d.business_date,d.number`,
    )
    .all(from, to) as CountReportRow[];
}
