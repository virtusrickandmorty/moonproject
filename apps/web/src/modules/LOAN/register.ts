/** The loan register screens' rules (PLAN E10): what is late, what is left, an instalment's state. Pure; the server works out every figure. */
import { formatPeso } from '@moonproject/shared';
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

export type InstalmentState = 'paid' | 'forgiven' | 'late' | 'next' | 'coming';

/**
 * Each instalment of a loan: paid (recorded payments), forgiven (the lender forgave the rest), late (past its due date,
 * not settled), the next one due, or still coming.
 */
export function scheduleStates(schedule: LoanDetail['schedule'], today: string): (LoanDetail['schedule'][number] & { state: InstalmentState })[] {
  const nextNo = schedule.find((r) => !r.paidBy && r.dueDate >= today)?.instalmentNo;
  return schedule.map((r) => ({ ...r, state: r.forgivenBy ? 'forgiven' : r.paidBy ? 'paid' : r.dueDate < today ? 'late' : r.instalmentNo === nextNo ? 'next' : 'coming' }));
}

export const STATE_WORDS: Record<InstalmentState, string> = { paid: 'Paid', forgiven: 'Forgiven', late: 'Late', next: 'Next due', coming: '' };

/** "forgiven, ₱15,000.00": what the lender forgave of an instalment (principal and interest), or '' when nothing was. */
export const forgivenWords = (r: LoanDetail['schedule'][number]) =>
  r.forgivenBy ? `forgiven, ${formatPeso((r.forgivenPrincipalCents ?? 0) + (r.forgivenInterestCents ?? 0))}` : '';

/**
 * The instalment whose rest may be forgiven: the first one not settled (instalments are settled in order), while the
 * loan stands and principal is still owed. Undefined when there is none.
 */
export function forgivableNo(l: Pick<LoanDetail, 'status' | 'balanceCents' | 'schedule'>): number | undefined {
  if (l.status !== 'posted' || l.balanceCents <= 0) return undefined;
  const r = l.schedule.find((x) => !x.paidBy);
  return r && (r.remainingPrincipalCents ?? r.principalCents) + (r.remainingInterestCents ?? r.interestCents) > 0 ? r.instalmentNo : undefined;
}

/** "12" from 1200 basis points. */
export const ratePercent = (bp: number) => `${bp / 100}%`;

/** The document type a loan's number belongs to: an opening loan (OBLN-) or a loan recorded in Virtus (LOAN-). */
export const loanDocType = (number: string) => (number.startsWith('OBLN-') ? 'loan.opening' : 'loan.loan');
