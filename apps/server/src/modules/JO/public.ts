/** Read-only JO contract for other modules (COL, PRD, DASH, CAL, RPT). Callers check their own route permission. */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';

export { currentStage, STAGES, STAGE_LABELS, type Stage } from './stages.ts';

export interface JoLedgerPart { receivableCents: number; depositsHeldCents: number }

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
 * This JO's AR and deposits, from journal lines (NR-2).
 * ENGINE REQUEST (see the JO PR): a journal line names only a customer, not a JO (G-01 wants "party Test
 * School, JO"). No document posts money for a JO before COL and the invoice record exist, so the JO's part
 * of the ledger is zero until the engine can tag a line with its JO; then this becomes one query.
 */
export function joLedger(_db: Db, _documentId: string): JoLedgerPart {
  return { receivableCents: 0, depositsHeldCents: 0 };
}

export function joMoney(db: Db, documentId: string) {
  const r = db
    .prepare(
      `SELECT d.status, d.total_cents AS totalCents, o.required_dp_cents AS requiredDownpaymentCents
       FROM jo_orders o JOIN documents d ON d.id = o.document_id WHERE o.document_id = ?`,
    )
    .get(documentId) as { status: string; totalCents: number; requiredDownpaymentCents: number } | undefined;
  if (!r) throw notFound('The job order');
  const owed = { totalCents: r.status === 'cancelled' ? 0 : r.totalCents, invoicedCents: 0 }; // invoice records: JO part 2
  const ledger = joLedger(db, documentId);
  return { ...owed, requiredDownpaymentCents: r.requiredDownpaymentCents, ...ledger, ...balanceDue({ ...owed, ...ledger }) };
}
