/** CA contract for other modules (PAY). The CA ledger per employee is GL 1210 read from journals (PLAN D9 L10). */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

/** What the employee still owes on cash advances (debit balance of 1210 for them). */
export const caBalance = (db: Db, employeeId: string): number =>
  accountBalance(db, resolveAccount(db, { role: 'EMP_ADVANCES' }).id, { party: { type: 'employee', id: employeeId } });

export interface OpenAdvance { documentId: string; number: string; amountCents: number; installmentCents: number; openCents: number }

/**
 * The payroll deduction plan (E11 "installment plan per run"): repayments settle the oldest advance first, so the open
 * advances are the newest ones that make up the balance. The deduction per run is the sum of their instalments, never
 * more than the balance.
 */
export function advanceSchedule(db: Db, employeeId: string): { outstandingCents: number; installmentCents: number; open: OpenAdvance[] } {
  const outstanding = caBalance(db, employeeId);
  const advances = db
    .prepare(
      `SELECT c.document_id AS documentId, d.number, c.amount_cents AS amountCents, c.installment_cents AS installmentCents
       FROM ca_advances c JOIN documents d ON d.id = c.document_id WHERE c.employee_id = ? AND d.status = 'posted' ORDER BY d.posted_at DESC, d.number DESC`,
    )
    .all(employeeId) as Omit<OpenAdvance, 'openCents'>[];
  const open: OpenAdvance[] = [];
  let left = outstanding;
  for (const a of advances) {
    if (left <= 0) break;
    const openCents = Math.min(a.amountCents, left);
    open.push({ ...a, openCents });
    left -= openCents;
  }
  const planned = open.reduce((s, a) => s + a.installmentCents, 0);
  return { outstandingCents: outstanding, installmentCents: Math.min(planned, Math.max(0, outstanding)), open };
}
