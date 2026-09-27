/** Read-only JO contract for other modules (COL, PRD, DASH, CAL, RPT). Callers check their own route permission. */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

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
 * This JO's AR and deposits, from the journal lines that name the JO as their document reference (NR-2,
 * G-01 "party Test School, JO"). COL and the invoice record tag their AR and deposit lines with the JO.
 */
export function joLedger(db: Db, documentId: string): JoLedgerPart {
  const balance = (role: string) => accountBalance(db, resolveAccount(db, { role }).id, { refDocId: documentId });
  // Deposits are a credit balance; 0 - x keeps an empty balance at 0 rather than -0.
  return { receivableCents: balance('AR_TRADE'), depositsHeldCents: 0 - balance('CUSTOMER_DEPOSITS') };
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
