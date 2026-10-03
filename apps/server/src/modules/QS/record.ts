/**
 * A counter sale: the quick sale (IR-) and the payment for all of it (COL-), in the caller's transaction (QS-SALE). Used by
 * the Quick Sale screen and the POS (routes.ts) and by the website shop when staff confirm an online payment (SHP).
 */
import { z } from 'zod';
import { AppError, formatPeso, type Issue } from '@moonproject/shared';
import { postDocument, type Actor, type EngineEnv } from '../../engine/documents/lifecycle.ts';
import { collectionDoc, collectionInput, type CollectionInput } from '../COL/public.ts';
import { saleDoc } from './doctypes/sale.ts';

/**
 * How the counter was paid: the collection without its customer and applications, which come from the sale. Built on first
 * use: QS's public contract leads here, and COL reads QS's, so COL may still be loading when this file is.
 */
const makeCounterPayment = () => collectionInput.pick({ crNumber: true, tenders: true, withholding: true, note: true }).strict();
let schema: ReturnType<typeof makeCounterPayment> | undefined;
export const counterPayment = () => (schema ??= makeCounterPayment());
export type CounterPayment = z.infer<ReturnType<typeof makeCounterPayment>>;

/** The collection that pays a quick sale at the counter: all of it, to this sale only (QS-SALE). */
export const collectionFor = (sale: { id: string; customerId: string; totalCents: number }, p: CounterPayment): CollectionInput => ({
  customerId: sale.customerId,
  crNumber: p.crNumber,
  applications: [],
  sales: [{ saleId: sale.id, amountCents: sale.totalCents }],
  tenders: p.tenders,
  ...(p.withholding ? { withholding: p.withholding } : {}),
  ...(p.note ? { note: p.note } : {}),
});

/** A walk-in pays the whole sale at once: change is given back, never kept as a deposit. */
export function receivedIssue(p: CounterPayment, totalCents: number): Issue | null {
  const received = p.tenders.reduce((s, t) => s + t.amountCents, 0) + (p.withholding?.cwtCents ?? 0) + (p.withholding?.vatWithheldCents ?? 0);
  if (received === totalCents) return null;
  const message = `The money received (${formatPeso(received)}) must equal the sale total (${formatPeso(totalCents)}). Give change for the rest.`;
  return { field: 'payment.tenders', code: 'RECEIVED', level: 'error', message };
}

/** Records the sale, then its payment for exactly the sale total; in one transaction, so a refused payment records nothing. */
export function recordCounterSale(env: EngineEnv, actor: Actor, p: CounterPayment, post: (input: unknown) => { id: string; totalCents: number }, saleInput: unknown) {
  const sale = post(saleInput);
  const problem = receivedIssue(p, sale.totalCents);
  if (problem) throw new AppError('VALIDATION', problem.message, 422, [problem]);
  const { customerId } = saleDoc.load(env.db, sale.id);
  const paid = postDocument(env, collectionDoc, actor, { input: collectionFor({ ...sale, customerId }, p), expectedTotalCents: sale.totalCents });
  return { sale, payment: paid };
}

/** The usual way in: post a new quick sale with the total the user confirmed, then its payment. */
export const recordQuickSale = (env: EngineEnv, actor: Actor, saleInput: unknown, p: CounterPayment, expectedTotalCents: number) =>
  recordCounterSale(env, actor, p, (input) => postDocument(env, saleDoc, actor, { input, expectedTotalCents }), saleInput);
