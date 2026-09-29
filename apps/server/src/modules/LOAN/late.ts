/**
 * Read-only lists for the loan screens (PLAN E10, H2): one loan's payments as documents, and the instalments past their
 * due date that no recorded payment covers. Nothing here posts anything.
 */
import { notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { loan, loanBalance } from './loans.ts';

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

export interface LateInstalment { loanId: string; loanNumber: string; lender: string; instalmentNo: number; dueDate: string; principalCents: number; interestCents: number; daysLate: number }

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Instalments of recorded loans with principal still owed that were due before `date` and have no recorded payment, oldest first. */
export function lateInstalments(db: Db, date: string): LateInstalment[] {
  const rows = db
    .prepare(
      `SELECT l.document_id AS loanId, d.number AS loanNumber, l.lender, l.kind, s.instalment_no AS instalmentNo, s.due_date AS dueDate,
         s.principal_cents AS principalCents, s.interest_cents AS interestCents
       FROM loan_schedule s JOIN loan_loans l ON l.document_id = s.loan_id JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND s.due_date < ?
         AND NOT EXISTS (SELECT 1 FROM loan_payments p JOIN documents pd ON pd.id = p.document_id
                         WHERE p.loan_id = s.loan_id AND p.instalment_no = s.instalment_no AND pd.status = 'posted')
       ORDER BY s.due_date, d.number, s.instalment_no`,
    )
    .all(date) as (Omit<LateInstalment, 'daysLate'> & { kind: 'loan' | 'equipment' })[];
  const owing = new Map<string, boolean>();
  const stillOwing = (r: { loanId: string; kind: 'loan' | 'equipment' }) => {
    if (!owing.has(r.loanId)) owing.set(r.loanId, loanBalance(db, r.loanId, r.kind) > 0);
    return owing.get(r.loanId)!;
  };
  return rows.filter(stillOwing).map(({ kind: _kind, ...r }) => ({ ...r, daysLate: dayNumber(date) - dayNumber(r.dueDate) }));
}
