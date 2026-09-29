/**
 * What other modules may read from AP (read-only): a supplier bill's and a supplier advance's tax facts, for the TAX
 * registers; a supply's latest billed unit cost, for INV.
 */
import { divRoundHalfAway } from "@moonproject/shared";
import type { Db } from "../../platform/db/driver.ts";
import type { EwtClass } from "../../engine/settings.ts";
import { categoryPurchaseClass, type GoodsOrServices } from "../EXP/public.ts";
import { receivedQty, type PurchaseCost } from "../PUR/public.ts";
export { supplierBalances, supplierLedger } from "./ledger.ts";

export function payableAgingAt(db: Db, asOf: string) {
  return db
    .prepare(
      `SELECT d.id,d.number,d.doc_type AS docType,d.business_date AS date,b.due_date AS dueDate,b.supplier_id AS supplierId,
    SUM(l.credit_cents-l.debit_cents) AS balanceCents FROM ap_bills b JOIN documents d ON d.id=b.document_id
    JOIN journal_lines l ON l.ref_doc_id=d.id JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id AND a.role_key='AP'
    WHERE j.sealed=1 AND j.business_date<=? GROUP BY d.id HAVING balanceCents<>0 ORDER BY b.due_date,d.number`,
    )
    .all(asOf) as {
    id: string;
    number: string;
    docType: string;
    date: string;
    dueDate: string;
    supplierId: string;
    balanceCents: number;
  }[];
}
export function purchasesForReport(db: Db, from: string, to: string) {
  return db
    .prepare(
      `SELECT d.id,d.number,d.business_date AS date,b.supplier_id AS supplierId,a.name AS category,
    SUM(l.debit_cents-l.credit_cents) AS amountCents FROM ap_bills b JOIN documents d ON d.id=b.document_id
    JOIN journals j ON j.source_id=d.id AND j.posting_kind='original' JOIN journal_lines l ON l.journal_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE d.status='posted' AND d.business_date BETWEEN ? AND ? AND l.debit_cents>0 GROUP BY d.id,a.id ORDER BY d.business_date,d.number,a.code`,
    )
    .all(from, to) as {
    id: string;
    number: string;
    date: string;
    supplierId: string;
    category: string;
    amountCents: number;
  }[];
}

/** What a bill line bought: a supply on file, freight-in, subcontracted production, or an expense category. */
export type BillLineKind = "supply" | "freight_in" | "subcontract" | "category";

export interface BillTaxFacts {
  supplierId: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: string;
  ewtClass: EwtClass | null;
  ewtRateBp: number;
  ewtBaseCents: number;
  ewtCents: number;
  /**
   * Per line: what it bought, and whether that is goods or services (supplies and freight-in are goods, subcontracting
   * is a service, an expense category says which), its cost before VAT (what the journal debits) and its share of the input VAT.
   */
  lines: {
    kind: BillLineKind;
    bought: GoodsOrServices;
    costCents: number;
    vatCents: number;
  }[];
}

export function billTaxFacts(
  db: Db,
  documentId: string,
): BillTaxFacts | undefined {
  const b = db
    .prepare(
      `SELECT supplier_id AS supplierId, supplier_invoice_no AS supplierInvoiceNo, supplier_invoice_date AS supplierInvoiceDate, ewt_class AS ewtClass,
         ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM ap_bills WHERE document_id = ?`,
    )
    .get(documentId) as Omit<BillTaxFacts, "lines"> | undefined;
  if (!b) return undefined;
  const rows = db
    .prepare(
      `SELECT CASE WHEN supply_id IS NOT NULL THEN 'supply' WHEN category_id IS NOT NULL THEN 'category' ELSE purchase END AS kind, category_id AS categoryId,
         amount_cents - vat_cents AS costCents, vat_cents AS vatCents FROM ap_bill_lines WHERE document_id = ? ORDER BY line_no`,
    )
    .all(documentId) as (Omit<BillTaxFacts["lines"][number], "bought"> & {
    categoryId: number | null;
  })[];
  const lines = rows.map(({ categoryId, ...l }) => ({
    ...l,
    bought:
      l.kind === "category"
        ? (categoryPurchaseClass(db, categoryId!) ?? "services")
        : l.kind === "subcontract"
          ? ("services" as const)
          : ("goods" as const),
  }));
  return { ...b, lines };
}

/**
 * A supplier advance's EWT (SADV-, PLAN D5 SUP-ADV): withheld when the advance was paid, on its amount (NET for a
 * VAT-registered supplier, else G). No input VAT: that comes with the supplier's invoice, on the bill.
 */
export interface AdvanceTaxFacts {
  supplierId: string;
  ewtClass: EwtClass | null;
  ewtRateBp: number;
  ewtBaseCents: number;
  ewtCents: number;
}

export function advanceTaxFacts(
  db: Db,
  documentId: string,
): AdvanceTaxFacts | undefined {
  return db
    .prepare(
      "SELECT supplier_id AS supplierId, ewt_class AS ewtClass, ewt_rate_bp AS ewtRateBp, ewt_base_cents AS ewtBaseCents, ewt_cents AS ewtCents FROM ap_advances WHERE document_id = ?",
    )
    .get(documentId) as AdvanceTaxFacts | undefined;
}

/**
 * The cost before VAT of one unit of a supply on the newest posted supplier bill that can tell it, invoiced on or before
 * `asOf` (read-only, for the inventory count's default cost, ACC-13). A bill line has no quantity, so the unit cost is the
 * bill's cost for the supply (what the journal debited) over the quantity its receiving report received; a bill without
 * a receiving report of that supply is passed over.
 */
export function latestBillUnitCost(
  db: Db,
  supplyId: string,
  asOf: string,
): PurchaseCost | undefined {
  const bills = db
    .prepare(
      `SELECT b.document_id AS documentId, d.number, b.supplier_invoice_date AS date, b.receiving_report_id AS rrId, SUM(l.amount_cents - l.vat_cents) AS costCents
       FROM ap_bill_lines l JOIN ap_bills b ON b.document_id = l.document_id JOIN documents d ON d.id = b.document_id
       WHERE l.supply_id = ? AND d.status = 'posted' AND b.supplier_invoice_date <= ? AND b.receiving_report_id IS NOT NULL
       GROUP BY b.document_id ORDER BY b.supplier_invoice_date DESC, d.posted_at DESC, d.number DESC`,
    )
    .all(supplyId, asOf) as {
    documentId: string;
    number: string;
    date: string;
    rrId: string;
    costCents: number;
  }[];
  for (const b of bills) {
    const qty = receivedQty(db, b.rrId, supplyId);
    if (qty > 0)
      return {
        unitCostCents: divRoundHalfAway(b.costCents, qty),
        documentId: b.documentId,
        number: b.number,
        date: b.date,
      };
  }
  return undefined;
}
