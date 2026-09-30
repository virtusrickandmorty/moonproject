/** COL contract for other modules (QS). Callers check their own route permission. */
import type { Db } from '../../platform/db/driver.ts';

export { collectionDoc, collectionInput, type CollectionInput } from './doctypes/collection.ts';
export { creditsOn, invoiceCreditsAt } from './credits.ts';
export {
  MODE_WORDS, depositModeOn, depositVatRowsOf, dpAppliedByInvoice, dpHeld, dpTakenBy, invoiceDeposits, lockedMode, modeKeptIssue, recordDepositVat,
  registerBaseOf, registerBaseSources, settleJobOrder, shareOf, vatRow, depositVatLines, type DepositMode, type DepositVatRow,
} from './doctypes/deposit-vat.ts';

export interface SalePayment { id: string; number: string; status: 'posted' | 'cancelled'; crNumber: string; totalCents: number; paysOnlyThis: boolean }

/**
 * Collections that paid a quick sale, cancelled ones included, oldest first. paysOnlyThis: the sale is all it pays (no job
 * order, no other sale, nothing kept as a deposit), so cancelling the quick sale may cancel it too (E6 "cancel cancels both").
 */
export function salePayments(db: Db, saleId: string): SalePayment[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.number, d.status, c.cr_number AS crNumber, d.total_cents AS totalCents, c.unapplied_cents = 0
         AND NOT EXISTS (SELECT 1 FROM col_applications a WHERE a.document_id = d.id)
         AND NOT EXISTS (SELECT 1 FROM col_sale_applications o WHERE o.document_id = d.id AND o.sale_id <> s.sale_id) AS only
       FROM col_sale_applications s JOIN col_collections c ON c.document_id = s.document_id JOIN documents d ON d.id = s.document_id
       WHERE s.sale_id = ? ORDER BY d.number`,
    )
    .all(saleId) as (Omit<SalePayment, 'paysOnlyThis'> & { only: number })[];
  return rows.map(({ only, ...r }) => ({ ...r, paysOnlyThis: only === 1 }));
}

/** CR booklet numbers collections used between two numbers, cancelled ones included (TAX's booklet usage report). */
export function crNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  return db
    .prepare(`SELECT CAST(c.cr_number AS INTEGER) AS n, d.number, d.status FROM col_collections c JOIN documents d ON d.id = c.document_id
              WHERE CAST(c.cr_number AS INTEGER) BETWEEN ? AND ? ORDER BY 1`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
}

/**
 * What a collection's 2307, or a 2307 received with no cash (CWT-ONLY), says (ATC and whether the certificate is in hand;
 * the latter always is, with the quarter it covers, '2026-Q3'), for the tax registers; undefined if none.
 */
export function withholdingOf(db: Db, documentId: string): { atc: 'WC158' | 'WC160' | 'other'; certificate: 'pending' | 'received'; period?: string } | undefined {
  const r = db.prepare('SELECT cwt_atc AS atc, cert_2307 AS certificate FROM col_collections WHERE document_id = ?').get(documentId) as
    | { atc: 'WC158' | 'WC160' | 'other' | null; certificate: 'pending' | 'received' | null }
    | undefined;
  if (r) return r.atc && r.certificate ? { atc: r.atc, certificate: r.certificate } : undefined;
  const c = db.prepare(`SELECT atc, period_year || '-Q' || period_quarter AS period FROM col_cwt_only WHERE document_id = ?`).get(documentId) as
    | { atc: 'WC158' | 'WC160' | 'other'; period: string }
    | undefined;
  return c && { atc: c.atc, certificate: 'received', period: c.period };
}

/** Posted collections dated on or before `onOrBefore` whose 2307 was recorded as pending, oldest first (TAX knows which came since). */
export function pendingCertificates(db: Db, onOrBefore: string): { id: string; number: string; date: string; customerName: string }[] {
  return db.prepare(`SELECT d.id, d.number, d.business_date AS date, c.customer_name AS customerName
    FROM col_collections c JOIN documents d ON d.id = c.document_id
    WHERE d.status = 'posted' AND c.cwt_cents > 0 AND c.cert_2307 = 'pending' AND d.business_date <= ?
    ORDER BY d.business_date, d.number`).all(onOrBefore) as { id: string; number: string; date: string; customerName: string }[];
}

/** Recorded collections and tenders, including cancellations, for dated read-only registers. */
export function collectionsBetween(db: Db, from: string, to: string) {
  return db.prepare(`SELECT d.id, d.number, d.business_date AS date, d.status, d.total_cents AS totalCents,
    c.customer_id AS customerId, c.customer_name AS customerName, c.cr_number AS crNumber,
    c.cwt_cents AS cwtCents, t.line_no AS tenderLine, t.account_id AS cashPlaceId,
    a.name AS cashPlaceName, t.amount_cents AS tenderCents, d.posted_by AS recordedBy,
    u.display_name AS recordedByName
    FROM col_collections c JOIN documents d ON d.id = c.document_id
    JOIN users u ON u.id = d.posted_by
    LEFT JOIN col_tenders t ON t.document_id = d.id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE d.business_date BETWEEN ? AND ? ORDER BY d.business_date, d.number, t.line_no`)
    .all(from, to) as { id: string; number: string; date: string; status: string; totalCents: number;
      customerId: string; customerName: string; crNumber: string; cwtCents: number; tenderLine: number | null;
      cashPlaceId: number | null; cashPlaceName: string | null; tenderCents: number | null;
      recordedBy: string; recordedByName: string }[];
}
