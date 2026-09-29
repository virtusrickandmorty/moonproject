/**
 * JO contract for other modules (COL, PRD, DASH, CAL, RPT). Callers check their own route permission. Read-only, except
 * productionMove: the stage change PRD makes as production finishes (E7 rule 3).
 */
import { notFound } from "@moonproject/shared";
import type { Db } from "../../platform/db/driver.ts";
import { resolveAccount } from "../../engine/ledger/accounts.ts";
import { accountBalance } from "../../engine/ledger/queries.ts";
import { dpAppliedByInvoice, dpHeld, invoiceCreditsAt } from "../COL/public.ts";
import { JO_DOC_TYPES_SQL } from "./stages.ts";

export {
  abandon,
  currentStage,
  isAbandoned,
  productionMove,
  unabandon,
  STAGES,
  STAGE_LABELS,
  type Stage,
} from "./stages.ts";
export {
  INVOICE_SERIES,
  SALES_CLASSES,
  SALES_ROLE,
  awaitingInvoice,
  invoiceAmounts,
  invoiceNumberUsedBy,
  invoiceNumbersBetween,
  settleLines,
} from "./doctypes/invoice-record.ts";
export { lineState, type LineKind } from "./doctypes/release.ts";
export {
  dpInvoiceNumbersBetween,
  dpInvoiceUsedBy,
} from "./doctypes/dp-invoice.ts";

export interface JoLedgerPart {
  receivableCents: number;
  depositsHeldCents: number;
}

export interface JoRef {
  id: string;
  number: string;
  status: "posted" | "cancelled";
  customerId: string;
  customerName: string;
  dueDate: string;
  priority: "normal" | "rush";
  totalCents: number;
}

const JO_REF = `SELECT d.id, d.number, d.status, o.customer_id AS customerId, o.customer_name AS customerName, o.due_date AS dueDate, o.priority, d.total_cents AS totalCents
  FROM jo_orders o JOIN documents d ON d.id = o.document_id`;

/** One job order's header, for documents that point at it (COL applications, refunds). */
export function jobOrderRef(db: Db, id: string): JoRef | undefined {
  return db.prepare(`${JO_REF} WHERE o.document_id = ?`).get(id) as
    | JoRef
    | undefined;
}

/** Where an edited job order lives on now: JO-1 edited into JO-2, then into JO-3, gives JO-3. Null when the chain ends cancelled. */
export function liveReplacementOf(db: Db, id: string): JoRef | null {
  const next = db
    .prepare(
      `SELECT replaced_by_id FROM documents WHERE id = ? AND ${JO_DOC_TYPES_SQL}`,
    )
    .pluck();
  for (
    let at = next.get(id) as string | null | undefined;
    at;
    at = next.get(at) as string | null | undefined
  ) {
    const jo = jobOrderRef(db, at);
    if (jo?.status === "posted") return jo;
  }
  return null;
}

/**
 * Recorded (not cancelled) job orders of one customer, or of everyone, oldest due first (E5 "default: oldest due first").
 * With includeCancelled, cancelled ones too (their deposits can still be refunded, D6).
 */
export function jobOrdersOf(
  db: Db,
  customerId?: string,
  includeCancelled = false,
): JoRef[] {
  return db
    .prepare(
      `${JO_REF} WHERE (@c IS NULL OR o.customer_id = @c) AND (@all OR d.status = 'posted') ORDER BY o.due_date, d.number`,
    )
    .all({ c: customerId ?? null, all: includeCancelled ? 1 : 0 }) as JoRef[];
}

export function searchJobOrders(
  db: Db,
  compactQuery: string,
  limit = 20,
): JoRef[] {
  return db
    .prepare(
      `${JO_REF} WHERE replace(replace(lower(d.number), '-', ''), ' ', '') LIKE ?
    ORDER BY d.business_date DESC, d.number DESC LIMIT ?`,
    )
    .all(`%${compactQuery}%`, limit) as JoRef[];
}

/** Active orders and their current stages for read-only dashboards, fetched without one query per old order. */
export function activeJobOrders(
  db: Db,
): (JoRef & {
  stage: "open" | "in_production" | "ready" | "partially_released" | "released";
})[] {
  return db
    .prepare(
      `SELECT d.id, d.number, d.status, o.customer_id AS customerId, o.customer_name AS customerName,
      o.due_date AS dueDate, o.priority, d.total_cents AS totalCents, COALESCE(s.to_stage, 'open') AS stage
    FROM jo_orders o JOIN documents d ON d.id = o.document_id
    LEFT JOIN jo_stage_events s ON s.document_id = o.document_id
      AND s.seq = (SELECT MAX(seq) FROM jo_stage_events WHERE document_id = o.document_id)
    WHERE d.status = 'posted' AND COALESCE(s.to_stage, 'open') <> 'closed'
    ORDER BY o.due_date, d.number`,
    )
    .all() as (JoRef & {
    stage:
      | "open"
      | "in_production"
      | "ready"
      | "partially_released"
      | "released";
  })[];
}

/** Recorded release slips in a date range, for the calendar. */
export function releasesBetween(
  db: Db,
  from: string,
  to: string,
): { id: string; number: string; date: string; jobOrderId: string }[] {
  return db
    .prepare(
      `SELECT d.id, d.number, d.business_date AS date, r.job_order_id AS jobOrderId
    FROM jo_releases r JOIN documents d ON d.id = r.document_id
    WHERE d.status = 'posted' AND d.business_date BETWEEN ? AND ? ORDER BY d.business_date, d.number`,
    )
    .all(from, to) as {
    id: string;
    number: string;
    date: string;
    jobOrderId: string;
  }[];
}

/**
 * Balance due (PLAN D3, H3): the un-invoiced part is a memo figure (total − invoiced); the invoiced part is
 * the JO's open AR; money received and not yet applied sits in customer deposits. So
 *   balance due = (total − invoiced) + AR(JO) − deposits held(JO)   and   collected = total − balance due.
 * A cancelled JO owes nothing; a negative balance is money held for the customer.
 */
export function balanceDue(
  p: { totalCents: number; invoicedCents: number } & JoLedgerPart,
) {
  const balanceDueCents =
    p.totalCents - p.invoicedCents + p.receivableCents - p.depositsHeldCents;
  return {
    balanceDueCents,
    collectedCents: p.totalCents - balanceDueCents,
    notInvoicedCents: p.totalCents - p.invoicedCents,
  };
}

/**
 * This JO's AR and deposits, from the journal lines that name the JO as their document reference (NR-2,
 * G-01 "party Test School, JO"). COL and the invoice record tag their AR and deposit lines with the JO.
 * Deposits held are money: in downpayment VAT mode C, 2201 also holds the NET of downpayments invoiced and not yet
 * released (COL dpHeld), which is not money the customer paid in advance but a sale invoiced ahead, so it is left out.
 */
export function joLedger(db: Db, documentId: string): JoLedgerPart {
  const balance = (role: string) =>
    accountBalance(db, resolveAccount(db, { role }).id, {
      refDocId: documentId,
    });
  // Deposits are a credit balance; 0 - x keeps an empty balance at 0 rather than -0.
  return {
    receivableCents: balance("AR_TRADE"),
    depositsHeldCents:
      0 - balance("CUSTOMER_DEPOSITS") - dpHeld(db, documentId).netCents,
  };
}

/**
 * Gross of the JO's recorded (not cancelled) invoice records: its sales so far (D3 "invoiced amount"). An opening job
 * order adds what was invoiced before the cut-over date and not yet paid (its receivable), so its receivable stays
 * within what is invoiced, as every JO's does (settleLines). In mode C it adds the downpayments invoiced and not yet
 * released (a release invoice's gross already counts the downpayment it takes into sales).
 */
export function invoicedCents(db: Db, documentId: string): number {
  const own = db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(i.gross_cents), 0) FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id WHERE i.job_order_id = @jo AND d.status = 'posted')
            + (SELECT COALESCE(SUM(o.receivable_cents), 0) FROM jo_opening_orders o JOIN documents d ON d.id = o.document_id WHERE o.document_id = @jo AND d.status = 'posted')`,
    )
    .pluck()
    .get({ jo: documentId }) as number;
  return own + dpHeld(db, documentId).grossCents;
}

/** The recorded opening job order's number when it brought deposits from the old books (they count as mode A, COL). */
export function openingDepositOn(
  db: Db,
  documentId: string,
): string | undefined {
  return db
    .prepare(
      `SELECT d.number FROM jo_opening_orders o JOIN documents d ON d.id = o.document_id WHERE o.document_id = ? AND o.deposits_cents > 0 AND d.status = 'posted'`,
    )
    .pluck()
    .get(documentId) as string | undefined;
}

export function joMoney(db: Db, documentId: string) {
  const r = db
    .prepare(
      `SELECT d.status, d.total_cents AS totalCents, o.required_dp_cents AS requiredDownpaymentCents
       FROM jo_orders o JOIN documents d ON d.id = o.document_id WHERE o.document_id = ?`,
    )
    .get(documentId) as
    | { status: string; totalCents: number; requiredDownpaymentCents: number }
    | undefined;
  if (!r) throw notFound("The job order");
  const owed = {
    totalCents: r.status === "cancelled" ? 0 : r.totalCents,
    invoicedCents: invoicedCents(db, documentId),
  };
  const ledger = joLedger(db, documentId);
  return {
    ...owed,
    requiredDownpaymentCents: r.requiredDownpaymentCents,
    ...ledger,
    ...balanceDue({ ...owed, ...ledger }),
  };
}

/** A release's invoice record as other documents see it (COL credit memos, write-offs, 2307s received on it). */
export interface InvoiceRecordRef {
  id: string;
  number: string;
  status: "posted" | "cancelled";
  businessDate: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  jobOrderId: string;
  jobOrderNumber: string;
  grossCents: number;
  vatCents: number;
  vatRateBp: number;
  depositAppliedCents: number;
}
const INVOICE_REF = `SELECT d.id, d.number, d.status, d.business_date AS businessDate, i.invoice_number AS invoiceNumber, i.customer_id AS customerId,
  i.customer_name AS customerName, i.job_order_id AS jobOrderId, j.number AS jobOrderNumber, i.gross_cents AS grossCents, i.vat_cents AS vatCents,
  i.vat_rate_bp AS vatRateBp, i.deposit_applied_cents AS depositAppliedCents
  FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id JOIN documents j ON j.id = i.job_order_id`;

export function invoiceRecordRef(
  db: Db,
  id: string,
): InvoiceRecordRef | undefined {
  return db.prepare(`${INVOICE_REF} WHERE i.document_id = ?`).get(id) as
    | InvoiceRecordRef
    | undefined;
}

/** Recorded (not cancelled) invoice records of one job order, of one customer's job orders, or all, oldest first. */
export function invoiceRecordsOf(
  db: Db,
  of: { jobOrderId: string } | { customerId: string } | "all",
): InvoiceRecordRef[] {
  const [where, id] =
    of === "all"
      ? ["1", null]
      : "jobOrderId" in of
        ? ["i.job_order_id = @id", of.jobOrderId]
        : ["i.customer_id = @id", of.customerId];
  return db
    .prepare(
      `${INVOICE_REF} WHERE ${where} AND d.status = 'posted' ORDER BY d.business_date, d.number`,
    )
    .all(id === null ? {} : { id }) as InvoiceRecordRef[];
}

/**
 * Dated invoice records and not-yet-invoiced order amounts for read-only customer reports. An invoice's receivable is
 * its gross less the deposits it applied and what COL credited on it by that date (the part of a credit memo that
 * reduced the receivable, a bad debt write-off, a 2307 received with no cash), so the aging never shows a credited
 * invoice as owing.
 */
export function receivableSourcesAt(
  db: Db,
  asOf: string,
): {
  orders: {
    id: string;
    number: string;
    customerId: string;
    customerName: string;
    dueDate: string;
    notInvoicedCents: number;
  }[];
  invoices: {
    id: string;
    number: string;
    date: string;
    dueDate: string;
    jobOrderId: string;
    customerId: string;
    customerName: string;
    grossCents: number;
    receivableCents: number;
  }[];
} {
  const liveAt =
    "(d.cancelled_at IS NULL OR date(d.cancelled_at, '+8 hours') > @asOf)";
  const orders = db
    .prepare(
      `SELECT d.id, d.number, o.customer_id AS customerId, o.customer_name AS customerName,
    o.due_date AS dueDate, d.total_cents AS totalCents
    FROM jo_orders o JOIN documents d ON d.id = o.document_id
    WHERE d.business_date <= @asOf AND ${liveAt} ORDER BY o.customer_name, d.number`,
    )
    .all({ asOf }) as {
    id: string;
    number: string;
    customerId: string;
    customerName: string;
    dueDate: string;
    totalCents: number;
  }[];
  const invoices = db
    .prepare(
      `SELECT d.id, d.number, d.business_date AS date,
    COALESCE(r.credit_due_date, date(d.business_date, CASE o.payment_terms
      WHEN 'net7' THEN '+7 days' WHEN 'net15' THEN '+15 days' WHEN 'net30' THEN '+30 days' ELSE '+0 days' END)) AS dueDate,
    i.job_order_id AS jobOrderId,
    i.customer_id AS customerId, i.customer_name AS customerName, i.gross_cents AS grossCents,
    i.gross_cents - i.deposit_applied_cents AS receivableCents
    FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id
    JOIN jo_orders o ON o.document_id = i.job_order_id
    JOIN jo_releases r ON r.document_id = i.release_id
    WHERE d.business_date <= @asOf AND ${liveAt} ORDER BY d.business_date, d.number`,
    )
    .all({ asOf }) as {
    id: string;
    number: string;
    date: string;
    dueDate: string;
    jobOrderId: string;
    customerId: string;
    customerName: string;
    grossCents: number;
    receivableCents: number;
  }[];
  const credited = invoiceCreditsAt(db, asOf);
  for (const invoice of invoices)
    invoice.receivableCents = Math.max(
      0,
      invoice.receivableCents - (credited.get(invoice.id) ?? 0),
    );
  const invoicedByOrder = new Map<string, number>();
  for (const invoice of invoices)
    invoicedByOrder.set(
      invoice.jobOrderId,
      (invoicedByOrder.get(invoice.jobOrderId) ?? 0) + invoice.grossCents,
    );
  const openings = db
    .prepare(
      `SELECT o.document_id AS id, o.receivable_cents AS receivableCents
    FROM jo_opening_orders o JOIN documents d ON d.id = o.document_id
    WHERE d.business_date <= @asOf AND ${liveAt}`,
    )
    .all({ asOf }) as { id: string; receivableCents: number }[];
  for (const opening of openings)
    invoicedByOrder.set(
      opening.id,
      (invoicedByOrder.get(opening.id) ?? 0) + opening.receivableCents,
    );
  // Mode C: a downpayment invoice counts as invoiced until the release invoice that takes it into sales, whose gross
  // already includes it. Its receivable stays on the job order's row of the aging, which the collection pays.
  const dpInvoices = db
    .prepare(
      `SELECT i.job_order_id AS id, i.gross_cents AS grossCents
    FROM jo_dp_invoices i JOIN documents d ON d.id = i.document_id
    WHERE d.business_date <= @asOf AND ${liveAt}`,
    )
    .all({ asOf }) as { id: string; grossCents: number }[];
  for (const dp of dpInvoices)
    invoicedByOrder.set(
      dp.id,
      (invoicedByOrder.get(dp.id) ?? 0) + dp.grossCents,
    );
  const dpApplied = dpAppliedByInvoice(db);
  for (const invoice of invoices)
    invoicedByOrder.set(
      invoice.jobOrderId,
      (invoicedByOrder.get(invoice.jobOrderId) ?? 0) -
        (dpApplied.get(invoice.id) ?? 0),
    );
  return {
    orders: orders.map(({ totalCents, ...order }) => ({
      ...order,
      notInvoicedCents: Math.max(
        0,
        balanceDue({
          totalCents,
          invoicedCents: invoicedByOrder.get(order.id) ?? 0,
          receivableCents: 0,
          depositsHeldCents: 0,
        }).notInvoicedCents,
      ),
    })),
    invoices,
  };
}

/** Invoice lines retain the sold descriptions and classes through the release and order. */
export function invoiceSaleLines(db: Db) {
  return db
    .prepare(
      `SELECT i.document_id AS id, i.customer_id AS customerId, i.customer_name AS customerName,
    i.job_order_id AS jobOrderId, l.line_no AS lineNo, o.description, o.kind,
    l.qty, l.amount_cents AS grossCents
    FROM jo_invoice_records i JOIN jo_release_lines l ON l.document_id = i.release_id
    JOIN jo_lines o ON o.document_id = i.job_order_id AND o.line_no = l.line_no
    ORDER BY i.document_id, l.line_no`,
    )
    .all() as {
    id: string;
    customerId: string;
    customerName: string;
    jobOrderId: string;
    lineNo: number;
    description: string;
    kind: string;
    qty: number;
    grossCents: number;
  }[];
}

/** Releases with no invoice record, including the owning order for follow-up. */
export function releasesAwaitingInvoice(db: Db, asOf: string) {
  return db
    .prepare(
      `SELECT r.document_id AS id, d.number, d.business_date AS date,
    r.job_order_id AS jobOrderId, j.number AS jobOrderNumber, o.customer_id AS customerId,
    o.customer_name AS customerName, COALESCE(SUM(l.amount_cents), 0) AS releasedCents
    FROM jo_releases r JOIN documents d ON d.id = r.document_id
    JOIN documents j ON j.id = r.job_order_id JOIN jo_orders o ON o.document_id = j.id
    LEFT JOIN jo_release_lines l ON l.document_id = d.id
    WHERE d.business_date <= ? AND d.status = 'posted'
      AND NOT EXISTS (SELECT 1 FROM jo_invoice_records i JOIN documents x ON x.id = i.document_id
        WHERE i.release_id = d.id AND x.status = 'posted')
    GROUP BY r.document_id ORDER BY d.business_date, d.number`,
    )
    .all(asOf) as {
    id: string;
    number: string;
    date: string;
    jobOrderId: string;
    jobOrderNumber: string;
    customerId: string;
    customerName: string;
    releasedCents: number;
  }[];
}

/** Current stage, open money and released quantity for every live job order. */
export function jobOrderStatusRows(db: Db) {
  return jobOrdersOf(db).map((order) => {
    const stage = db
      .prepare(
        `SELECT to_stage FROM jo_stage_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .pluck()
      .get(order.id) as string | undefined;
    return { ...order, stage: stage ?? "open", ...joMoney(db, order.id) };
  });
}

/** Dates and release state needed by RPT's production timing reports. */
export function productionOrderRows(db: Db) {
  return db
    .prepare(
      `SELECT d.id,d.number,d.business_date AS orderDate,o.customer_name AS customerName,o.due_date AS dueDate,
    COALESCE(s.to_stage,'open') AS stage,MIN(rd.business_date) AS releaseDate
    FROM jo_orders o JOIN documents d ON d.id=o.document_id
    LEFT JOIN jo_stage_events s ON s.document_id=d.id AND s.seq=(SELECT MAX(seq) FROM jo_stage_events WHERE document_id=d.id)
    LEFT JOIN jo_releases r ON r.job_order_id=d.id LEFT JOIN documents rd ON rd.id=r.document_id AND rd.status='posted'
    WHERE d.status='posted' GROUP BY d.id ORDER BY d.number`,
    )
    .all() as Array<Record<string, string | null>>;
}
