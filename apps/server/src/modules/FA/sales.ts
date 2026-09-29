/**
 * Sales of fixed assets (FAD- of kind 'sale', migration 0003) as the invoice records other modules read: JO and QS
 * refuse a booklet invoice number an asset sale used (one booklet, a number used once, ever), TAX lists the numbers in
 * the booklet usage report and the sale in the VAT sales register. Read-only; imports no other module.
 */
import type { Db } from '../../platform/db/driver.ts';

/** The FAD- series an asset sale is numbered in (the booklet report finds the document by it). */
export const ASSET_SALE_SERIES = 'FAD';

/** The asset sale that used a booklet invoice number, cancelled ones included ("0501" and "501" are the same paper). */
export function assetSaleByInvoiceNumber(db: Db, invoiceNumber: string): { number: string; status: string } | undefined {
  return db
    .prepare(`SELECT d.number, d.status FROM fa_asset_sales s JOIN documents d ON d.id = s.document_id WHERE CAST(s.invoice_number AS INTEGER) = CAST(? AS INTEGER)`)
    .get(invoiceNumber) as { number: string; status: string } | undefined;
}

/** Booklet invoice numbers asset sales used between two numbers, cancelled ones included (TAX's booklet usage report). */
export function assetSaleInvoiceNumbersBetween(db: Db, from: number, to: number): { n: number; number: string; status: 'posted' | 'cancelled' }[] {
  return db
    .prepare(`SELECT CAST(s.invoice_number AS INTEGER) AS n, d.number, d.status FROM fa_asset_sales s JOIN documents d ON d.id = s.document_id
              WHERE CAST(s.invoice_number AS INTEGER) BETWEEN ? AND ?`)
    .all(from, to) as { n: number; number: string; status: 'posted' | 'cancelled' }[];
}

/**
 * What the VAT sales register shows for an asset sale: the VATable sales (NET) written on the booklet, which is not a
 * revenue credit on its journal (only the gain is), and the buyer as typed or as the customer read when recorded.
 */
export interface AssetSaleTaxFacts { netCents: number; vatCents: number; vatRateBp: number; gainCents: number; customerId: string | null; buyerName: string; buyerTin: string | null }
export function assetSaleTaxFacts(db: Db, documentId: string): AssetSaleTaxFacts | undefined {
  return db
    .prepare(
      `SELECT net_cents AS netCents, vat_cents AS vatCents, vat_rate_bp AS vatRateBp, gain_cents AS gainCents, customer_id AS customerId,
         buyer_name AS buyerName, buyer_tin AS buyerTin FROM fa_asset_sales WHERE document_id = ?`,
    )
    .get(documentId) as AssetSaleTaxFacts | undefined;
}
