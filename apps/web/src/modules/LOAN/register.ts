/** The loan register screens' rules (PLAN E10): what is late, what is left, an instalment's state. Pure; the server works out every figure. */
import type { LateInstalment, LoanDetail, LoanRow } from '../../api.ts';

export const KIND_WORDS = { loan: 'Loan', equipment: 'Equipment financing' } as const;

/** How many instalments of each loan are late (from GET /api/loan/late). */
export function lateCounts(late: LateInstalment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of late) out.set(l.loanId, (out.get(l.loanId) ?? 0) + 1);
  return out;
}

/** Principal left to pay: the ledger's balance (paid and left add up to the principal). */
export const leftCents = (l: Pick<LoanRow, 'balanceCents' | 'status'>) => (l.status === 'cancelled' ? 0 : l.balanceCents);

export interface RegisterTotals { count: number; principalCents: number; paidCents: number; leftCents: number }
export function loanTotals(rows: LoanRow[]): RegisterTotals {
  const live = rows.filter((r) => r.status === 'posted');
  return { count: live.length, principalCents: live.reduce((s, r) => s + r.principalCents, 0), paidCents: live.reduce((s, r) => s + (r.principalPaidCents ?? 0), 0), leftCents: live.reduce((s, r) => s + r.balanceCents, 0) };
}

export type InstalmentState = 'paid' | 'late' | 'next' | 'coming';

/** Each instalment of a loan: paid (a recorded payment), late (past its due date, unpaid), the next one due, or still coming. */
export function scheduleStates(schedule: LoanDetail['schedule'], today: string): (LoanDetail['schedule'][number] & { state: InstalmentState })[] {
  const nextNo = schedule.find((r) => !r.paidBy && r.dueDate >= today)?.instalmentNo;
  return schedule.map((r) => ({ ...r, state: r.paidBy ? 'paid' : r.dueDate < today ? 'late' : r.instalmentNo === nextNo ? 'next' : 'coming' }));
}

export const STATE_WORDS: Record<InstalmentState, string> = { paid: 'Paid', late: 'Late', next: 'Next due', coming: '' };

/** "12" from 1200 basis points. */
export const ratePercent = (bp: number) => `${bp / 100}%`;

/** The document type a loan's number belongs to: an opening loan (OBLN-) or a loan recorded in Moonproject (LOAN-). */
export const loanDocType = (number: string) => (number.startsWith('OBLN-') ? 'loan.opening' : 'loan.loan');
