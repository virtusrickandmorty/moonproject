/**
 * Read-only lists for the loan screens (PLAN E10, H2): one loan's payments as documents, and the instalments past their
 * due date that recorded payments (or a forgiveness of the rest) do not settle. Nothing here posts anything.
 */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { loan, loanBalance, schedule } from './loans.ts';

export interface LoanPaymentRow { id: string; number: string; date: string; status: 'posted' | 'cancelled'; instalmentNo: number; principalCents: number; interestCents: number; totalCents: number; note: string | null }

/** A loan's payments (LPAY-), newest first, cancelled ones included. */
export function paymentsOf(db: Db, loanId: string): LoanPaymentRow[] {
  if (!loan(db, loanId)) throw notFound('The loan');
  return db
    .prepare(
      `SELECT d.id, d.number, d.business_date AS date, d.status, p.instalment_no AS instalmentNo, p.principal_cents AS principalCents, p.interest_cents AS interestCents,
         p.principal_cents + p.interest_cents AS totalCents, p.note
       FROM loan_payments p JOIN documents d ON d.id = p.document_id WHERE p.loan_id = ? ORDER BY d.business_date DESC, d.number DESC`,
    )
    .all(loanId) as LoanPaymentRow[];
}

/** `principalCents` and `interestCents` are what is still due on it; `partPaidCents` what part payments already covered. */
export interface LateInstalment { loanId: string; loanNumber: string; lender: string; instalmentNo: number; dueDate: string; principalCents: number; interestCents: number; partPaidCents: number; daysLate: number }

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Instalments of recorded loans with principal still owed that were due before `date` and are not fully paid, oldest
 * first. One paid short (audit A1-002) stays here with what is still due on it, until paid or the rest is forgiven.
 */
export function lateInstalments(db: Db, date: string): LateInstalment[] {
  const loans = db
    .prepare(
      `SELECT DISTINCT l.document_id AS loanId, d.number AS loanNumber, l.lender, l.kind
       FROM loan_schedule s JOIN loan_loans l ON l.document_id = s.loan_id JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND s.due_date < ?`,
    )
    .all(date) as { loanId: string; loanNumber: string; lender: string; kind: 'loan' | 'equipment' }[];
  const late: LateInstalment[] = [];
  for (const l of loans) {
    if (loanBalance(db, l.loanId, l.kind) <= 0) continue;
    for (const r of schedule(db, l.loanId)) {
      if (r.dueDate >= date || r.paidBy) continue;
      late.push({
        loanId: l.loanId, loanNumber: l.loanNumber, lender: l.lender, instalmentNo: r.instalmentNo, dueDate: r.dueDate,
        principalCents: r.remainingPrincipalCents, interestCents: r.remainingInterestCents, partPaidCents: r.paidPrincipalCents + r.paidInterestCents,
        daysLate: dayNumber(date) - dayNumber(r.dueDate),
      });
    }
  }
  return late.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.loanNumber.localeCompare(b.loanNumber) || a.instalmentNo - b.instalmentNo);
}
