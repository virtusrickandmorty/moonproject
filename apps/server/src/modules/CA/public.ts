/** CA contract for other modules (PAY). The CA ledger per employee is GL 1210 read from journals (PLAN D9 L10). */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

/** What the employee still owes on cash advances (debit balance of 1210 for them), optionally up to a business date. */
export const caBalance = (db: Db, employeeId: string, asOf?: string): number =>
  accountBalance(db, resolveAccount(db, { role: 'EMP_ADVANCES' }).id, { party: { type: 'employee', id: employeeId }, ...(asOf ? { asOf } : {}) });

/**
 * What can be deducted on a business date without the balance going negative on that day or any later one: the lowest
 * balance from that date on (a payroll dated earlier than today, PAY-1, must leave later deductions covered).
 */
function owedFrom(db: Db, employeeId: string, asOf: string): number {
  const account = resolveAccount(db, { role: 'EMP_ADVANCES' }).id;
  const later = db
    .prepare(
      `SELECT SUM(l.debit_cents - l.credit_cents) FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND j.sealed = 1 AND l.party_type = 'employee' AND l.party_id = ? AND j.business_date > ? GROUP BY j.business_date ORDER BY j.business_date`,
    )
    .pluck()
    .all(account, employeeId, asOf) as number[];
  let balance = caBalance(db, employeeId, asOf);
  let lowest = balance;
  for (const net of later) lowest = Math.min(lowest, (balance += net));
  return lowest;
}

export interface OpenAdvance { documentId: string; number: string; amountCents: number; installmentCents: number; openCents: number }

/**
 * The payroll deduction plan (E11 "installment plan per run"): repayments settle the oldest advance first, so the open
 * advances are the newest ones that make up the balance. The deduction per run is the sum of their instalments, never
 * more than the balance.
 * A payroll passes its date (PAY-1: the period's last day, maybe before today): advances given after it are not deducted
 * yet, and what is owed is the lowest balance from that day on, so 1210 never goes negative on any day.
 */
export function advanceSchedule(db: Db, employeeId: string, asOf?: string): { outstandingCents: number; installmentCents: number; open: OpenAdvance[] } {
  const outstanding = asOf ? owedFrom(db, employeeId, asOf) : caBalance(db, employeeId);
  const advances = db
    .prepare(
      `SELECT c.document_id AS documentId, d.number, c.amount_cents AS amountCents, c.installment_cents AS installmentCents
       FROM ca_advances c JOIN documents d ON d.id = c.document_id WHERE c.employee_id = @e AND d.status = 'posted' AND (@asOf IS NULL OR d.business_date <= @asOf)
       ORDER BY d.posted_at DESC, d.number DESC`,
    )
    .all({ e: employeeId, asOf: asOf ?? null }) as Omit<OpenAdvance, 'openCents'>[];
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
