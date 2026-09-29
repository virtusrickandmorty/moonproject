import type { Db } from "../../platform/db/driver.ts";
import { payableAgingAt, purchasesForReport } from "../AP/public.ts";
import {
  purchaseOrdersForReport,
  receivedNotBilledForReport,
  supplier,
} from "../PUR/public.ts";
const path = (id: string, type: string) => `/docs/${type}/${id}`;
const age = (asOf: string, due: string) => {
  const n = Math.floor((Date.parse(asOf) - Date.parse(due)) / 86400000);
  return n <= 0
    ? "current"
    : n <= 30
      ? "days1to30"
      : n <= 60
        ? "days31to60"
        : n <= 90
          ? "days61to90"
          : "over90";
};
/** Open supplier bills by due-date age; balances come from sealed AP journal lines. */
export function apAging(db: Db, asOf: string) {
  const rows = payableAgingAt(db, asOf).map((r) => ({
    ...r,
    supplierName: supplier(db, r.supplierId)?.name ?? "Unknown",
    bucket: age(asOf, r.dueDate),
    documentPath: path(r.id, r.docType),
  }));
  return {
    asOf,
    rows,
    totalCents: rows.reduce((n, r) => n + r.balanceCents, 0),
  };
}
/** Purchases by supplier and debited category, taken from posted bill journals. */
export function purchases(db: Db, from: string, to: string) {
  const rows = purchasesForReport(db, from, to).map((r) => ({
    ...r,
    supplierName: supplier(db, r.supplierId)?.name ?? "Unknown",
    documentPath: path(r.id, "ap.bill"),
  }));
  return {
    from,
    to,
    rows,
    totalCents: rows.reduce((n, r) => n + r.amountCents, 0),
  };
}
/** Purchase-order status and value, taken from recorded PUR documents. */
export function purchaseOrders(db: Db) {
  return {
    rows: purchaseOrdersForReport(db).map((r) => ({
      ...r,
      supplierName: supplier(db, r.supplierId)?.name ?? "Unknown",
      documentPath: path(r.id, "pur.po"),
    })),
  };
}
/** Posted receiving reports with no posted AP bill, taken from PUR and AP records. */
export function receivedNotBilled(db: Db) {
  const rows = receivedNotBilledForReport(db).map((r) => ({
    ...r,
    supplierName: supplier(db, r.supplierId)?.name ?? "Unknown",
    documentPath: path(r.id, "pur.receiving"),
  }));
  return { rows, totalCents: rows.reduce((n, r) => n + r.totalCents, 0) };
}
