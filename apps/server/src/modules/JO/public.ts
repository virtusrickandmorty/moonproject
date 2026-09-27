/**
 * JO contract for other modules (COL, PRD, DASH, CAL, RPT). Callers check their own route permission. Read-only, except
 * productionMove: the stage change PRD makes as production finishes (E7 rule 3).
 */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

export { currentStage, productionMove, STAGES, STAGE_LABELS, type Stage } from './stages.ts';
export { INVOICE_SERIES, SALES_CLASSES, SALES_ROLE, awaitingInvoice, invoiceAmounts, invoiceNumberUsedBy, settleLines } from './doctypes/invoice-record.ts';
export { lineState, type LineKind } from './doctypes/release.ts';

export interface JoLedgerPart { receivableCents: number; depositsHeldCents: number }

export interface JoRef { id: string; number: string; status: 'posted' | 'cancelled'; customerId: string; customerName: string; dueDate: string; priority: 'normal' | 'rush'; totalCents: number }

const JO_REF = `SELECT d.id, d.number, d.status, o.customer_id AS customerId, o.customer_name AS customerName, o.due_date AS dueDate, o.priority, d.total_cents AS totalCents
  FROM jo_orders o JOIN documents d ON d.id = o.document_id`;

/** One job order's header, for documents that point at it (COL applications, refunds). */
export function jobOrderRef(db: Db, id: string): JoRef | undefined {
  return db.prepare(`${JO_REF} WHERE o.document_id = ?`).get(id) as JoRef | undefined;
}

/**
 * Recorded (not cancelled) job orders of one customer, or of everyone, oldest due first (E5 "default: oldest due first").
 * With includeCancelled, cancelled ones too (their deposits can still be refunded, D6).
 */
export function jobOrdersOf(db: Db, customerId?: string, includeCancelled = false): JoRef[] {
  return db
    .prepare(`${JO_REF} WHERE (@c IS NULL OR o.customer_id = @c) AND (@all OR d.status = 'posted') ORDER BY o.due_date, d.number`)
    .all({ c: customerId ?? null, all: includeCancelled ? 1 : 0 }) as JoRef[];
}

/**
 * Balance due (PLAN D3, H3): the un-invoiced part is a memo figure (total − invoiced); the invoiced part is
 * the JO's open AR; money received and not yet applied sits in customer deposits. So
 *   balance due = (total − invoiced) + AR(JO) − deposits held(JO)   and   collected = total − balance due.
 * A cancelled JO owes nothing; a negative balance is money held for the customer.
 */
export function balanceDue(p: { totalCents: number; invoicedCents: number } & JoLedgerPart) {
  const balanceDueCents = p.totalCents - p.invoicedCents + p.receivableCents - p.depositsHeldCents;
  return { balanceDueCents, collectedCents: p.totalCents - balanceDueCents, notInvoicedCents: p.totalCents - p.invoicedCents };
}

/**
 * This JO's AR and deposits, from the journal lines that name the JO as their document reference (NR-2,
 * G-01 "party Test School, JO"). COL and the invoice record tag their AR and deposit lines with the JO.
 */
export function joLedger(db: Db, documentId: string): JoLedgerPart {
  const balance = (role: string) => accountBalance(db, resolveAccount(db, { role }).id, { refDocId: documentId });
  // Deposits are a credit balance; 0 - x keeps an empty balance at 0 rather than -0.
  return { receivableCents: balance('AR_TRADE'), depositsHeldCents: 0 - balance('CUSTOMER_DEPOSITS') };
}

/** Gross of the JO's recorded (not cancelled) invoice records: its sales so far (D3 "invoiced amount"). */
export function invoicedCents(db: Db, documentId: string): number {
  return db
    .prepare(`SELECT COALESCE(SUM(i.gross_cents), 0) FROM jo_invoice_records i JOIN documents d ON d.id = i.document_id WHERE i.job_order_id = ? AND d.status = 'posted'`)
    .pluck()
    .get(documentId) as number;
}

export function joMoney(db: Db, documentId: string) {
  const r = db
    .prepare(
      `SELECT d.status, d.total_cents AS totalCents, o.required_dp_cents AS requiredDownpaymentCents
       FROM jo_orders o JOIN documents d ON d.id = o.document_id WHERE o.document_id = ?`,
    )
    .get(documentId) as { status: string; totalCents: number; requiredDownpaymentCents: number } | undefined;
  if (!r) throw notFound('The job order');
  const owed = { totalCents: r.status === 'cancelled' ? 0 : r.totalCents, invoicedCents: invoicedCents(db, documentId) };
  const ledger = joLedger(db, documentId);
  return { ...owed, requiredDownpaymentCents: r.requiredDownpaymentCents, ...ledger, ...balanceDue({ ...owed, ...ledger }) };
}
