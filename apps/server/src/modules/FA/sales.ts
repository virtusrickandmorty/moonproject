/**
 * The invoices of asset sales (fa_sales, PLAN D5 FA-DISP, D7): read by the disposal itself and, through public.ts, by
 * the IR- series check and the booklet report (JO) and the tax registers (TAX). Read-only.
 */
import type { Db } from '../../platform/db/driver.ts';

/** The disposal's own series; a sale's booklet number is its external number, used once across the IR- series. */
export const DISPOSAL_SERIES = { key: 'FAD', prefix: 'FAD-' };

export interface AssetSale {
  id: string; number: string; status: 'posted' | 'cancelled'; customerId: string | null; buyerName: string; buyerAddress: string | null; buyerTin: string | null;
  invoiceNumber: string; vatRateBp: number; grossCents: number; vatCents: number; netCents: number; cashPlaceId: number;
}

const SELECT = `SELECT d.id, d.number, d.status, s.customer_id AS customerId, s.buyer_name AS buyerName, s.buyer_address AS buyerAddress, s.buyer_tin AS buyerTin,
  s.invoice_number AS invoiceNumber, s.vat_rate_bp AS vatRateBp, s.gross_cents AS grossCents, s.vat_cents AS vatCents, s.net_cents AS netCents,
  s.cash_account_id AS cashPlaceId FROM fa_sales s JOIN documents d ON d.id = s.document_id`;

/** The sale of a disposal, or undefined for a retirement. */
export const assetSale = (db: Db, documentId: string): AssetSale | undefined => db.prepare(`${SELECT} WHERE s.document_id = ?`).get(documentId) as AssetSale | undefined;

/** The asset sale that used a booklet invoice number, cancelled ones included ("0501" and "501" are the same paper). */
export function assetSaleByInvoiceNumber(db: Db, invoiceNumber: string): { number: string; status: string } | undefined {
  return db.prepare(`${SELECT} WHERE CAST(s.invoice_number AS INTEGER) = CAST(? AS INTEGER)`).get(invoiceNumber) as AssetSale | undefined;
}

/** Booklet invoice numbers asset sales used between two numbers, cancelled ones included (TAX's booklet usage report). */
export function assetSaleInvoiceNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  return db
    .prepare(`SELECT CAST(s.invoice_number AS INTEGER) AS n, d.number, d.status FROM fa_sales s JOIN documents d ON d.id = s.document_id
              WHERE CAST(s.invoice_number AS INTEGER) BETWEEN ? AND ?`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
}
