/**
 * The loan register, repayment schedules and the loan ledger (PLAN E10). A loan is its LOAN- document, or the OBLN- of a
 * loan opened at the cut-over (doctypes/opening.ts): the document id is the loan's id and the party id on 2601/2602
 * (party type loan). A LOAN-'s date is the date received. What is still owed comes from the ledger (NR-2); schedule rows
 * are written once with the loan and never change.
 */
import { allocate, divRoundHalfAway, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { financedPurchases } from '../FA/public.ts';
import { loansFinancingAsset } from './public.ts';

/** Kind of loan → the liability that carries its principal (D5 LOAN-IN: 2601 or 2602). */
export const KINDS = {
  loan: { role: 'LOANS_PAYABLE', label: 'loan' },
  equipment: { role: 'EQUIP_FINANCING', label: 'equipment financing' },
} as const;
export type LoanKind = keyof typeof KINDS;
export const METHODS = ['declining', 'flat', 'typed'] as const;
export type Method = (typeof METHODS)[number];

export interface ScheduleRow { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number }

/** Same day of the month, or the month's last day: 2027-01-31 + 1 month = 2027-02-28. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) + months;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Equal monthly instalments from the first due date. The yearly rate is in basis points; a month's interest is 1/12 of it.
 *   declining: the same payment every month on the declining balance (a bank's amortization table). Interest is the
 *              balance × rate ÷ 12; the rest of the payment is principal; the last row pays off what is left.
 *   flat:      add-on interest, the original principal × rate ÷ 12 every month, with the principal in equal parts.
 * The payment P·i·(1+i)^n / ((1+i)^n − 1) is worked out exactly in BigInt and rounded half away from zero.
 */
export function generateSchedule(principalCents: number, rateBp: number, months: number, method: Exclude<Method, 'typed'>, firstDueDate: string): ScheduleRow[] {
  const row = (i: number, principal: number, interest: number): ScheduleRow => ({ instalmentNo: i + 1, dueDate: addMonths(firstDueDate, i), principalCents: principal, interestCents: interest });
  if (method === 'flat' || rateBp === 0) {
    const interest = divRoundHalfAway(principalCents * rateBp, 120_000);
    return allocate(principalCents, Array<number>(months).fill(1)).map((p, i) => row(i, p, interest));
  }
  const grown = (120_000n + BigInt(rateBp)) ** BigInt(months);
  const base = 120_000n ** BigInt(months);
  const num = BigInt(principalCents) * BigInt(rateBp) * grown;
  const den = 120_000n * (grown - base);
  const payment = Number((2n * num + den) / (2n * den));
  let balance = principalCents;
  return Array.from({ length: months }, (_, i) => {
    const interest = divRoundHalfAway(balance * rateBp, 120_000);
    const principal = i === months - 1 ? balance : Math.min(balance, payment - interest);
    balance -= principal;
    return row(i, principal, interest);
  });
}

export interface LoanRow {
  id: string; number: string; status: 'posted' | 'cancelled'; replacedByNumber: string | null; dateReceived: string;
  lender: string; kind: LoanKind; principalCents: number; feeCents: number; rateBp: number; termMonths: number; schedule: Method; reference: string | null;
  /** The FA- purchase this equipment financing paid for, or null (the proceeds came in cash). */
  assetPurchaseNumber: string | null;
  /**
   * An opening loan (OBLN-, received before the cut-over): the principal still owed on the cut-over date, the date of its
   * document. Null for a LOAN-. Its dateReceived and principalCents are the loan's original ones.
   */
  owedAtCutoverCents: number | null;
}
const LOANS = `SELECT l.document_id AS id, d.number, d.status, r.number AS replacedByNumber, COALESCE(o.date_received, d.business_date) AS dateReceived, l.lender, l.kind,
    COALESCE(o.original_principal_cents, l.principal_cents) AS principalCents, l.fee_cents AS feeCents, l.rate_bp AS rateBp, l.term_months AS termMonths, l.schedule, l.reference,
    fa.number AS assetPurchaseNumber, CASE WHEN o.document_id IS NULL THEN NULL ELSE l.principal_cents END AS owedAtCutoverCents
  FROM loan_loans l JOIN documents d ON d.id = l.document_id LEFT JOIN documents r ON r.id = d.replaced_by_id LEFT JOIN documents fa ON fa.id = l.asset_purchase_id
  LEFT JOIN loan_openings o ON o.document_id = l.document_id`;

export const loan = (db: Db, id: string) => db.prepare(`${LOANS} WHERE l.document_id = ?`).get(id) as LoanRow | undefined;

/** The schedule with the posted payment (if any) of each instalment. */
export function schedule(db: Db, loanId: string): (ScheduleRow & { paidBy: string | null })[] {
  return db
    .prepare(
      `SELECT s.instalment_no AS instalmentNo, s.due_date AS dueDate, s.principal_cents AS principalCents, s.interest_cents AS interestCents,
         (SELECT d.number FROM loan_payments p JOIN documents d ON d.id = p.document_id
          WHERE p.loan_id = s.loan_id AND p.instalment_no = s.instalment_no AND d.status = 'posted') AS paidBy
       FROM loan_schedule s WHERE s.loan_id = ? ORDER BY s.instalment_no`,
    )
    .all(loanId) as (ScheduleRow & { paidBy: string | null })[];
}

/** Principal still owed: the credit balance of the loan's liability account for this loan. */
export function loanBalance(db: Db, loanId: string, kind: LoanKind): number {
  return 0 - accountBalance(db, resolveAccount(db, { role: KINDS[kind].role }).id, { party: { type: 'loan', id: loanId } });
}

/** A register row: principal, paid, balance and the next instalment due (none once cancelled or paid off). */
function position(db: Db, l: LoanRow) {
  const rows = schedule(db, l.id);
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(p.principal_cents), 0) AS principal, COALESCE(SUM(p.interest_cents), 0) AS interest
       FROM loan_payments p JOIN documents d ON d.id = p.document_id WHERE p.loan_id = ? AND d.status = 'posted'`,
    )
    .get(l.id) as { principal: number; interest: number };
  const balanceCents = loanBalance(db, l.id, l.kind);
  const next = l.status === 'posted' && balanceCents > 0 ? rows.find((r) => !r.paidBy) : undefined;
  return {
    ...l,
    instalments: rows.length,
    // An opening loan's principal repaid before the cut-over counts as paid, so balance = principal − paid for both.
    principalPaidCents: paid.principal + (l.owedAtCutoverCents === null ? 0 : l.principalCents - l.owedAtCutoverCents),
    interestPaidCents: paid.interest,
    balanceCents,
    nextDue: next ? { instalmentNo: next.instalmentNo, dueDate: next.dueDate, principalCents: next.principalCents, interestCents: next.interestCents } : null,
    rows,
  };
}

/** The loan register, newest first. */
export function listLoans(db: Db, status?: 'posted' | 'cancelled') {
  const rows = db.prepare(`${LOANS} ${status ? 'WHERE d.status = ?' : ''} ORDER BY d.number DESC`).all(...(status ? [status] : [])) as LoanRow[];
  return rows.map((l) => {
    const { rows: _, ...p } = position(db, l);
    return p;
  });
}

/** One loan: its position, the schedule and the loan ledger (every GL line with this loan as party, running balance owed). */
export function loanLedger(db: Db, id: string) {
  const l = loan(db, id);
  if (!l) throw notFound('The loan');
  const { rows, ...p } = position(db, l);
  const lines = db
    .prepare(
      `SELECT j.business_date AS date, j.number AS journalNumber, d.number AS documentNumber, COALESCE(l.memo, j.memo) AS memo,
         l.credit_cents - l.debit_cents AS amountCents
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id LEFT JOIN documents d ON d.id = j.source_id
       WHERE j.sealed = 1 AND l.party_type = 'loan' AND l.party_id = ? ORDER BY j.business_date, j.number, l.line_no`,
    )
    .all(id) as { date: string; journalNumber: string; documentNumber: string | null; memo: string; amountCents: number }[];
  let owed = 0;
  return { ...p, schedule: rows, ledger: lines.map((x) => ({ ...x, balanceCents: (owed += x.amountCents) })) };
}

/** FA- purchases with a financed part that no posted loan has taken over yet: what "Record the financing" offers. */
export const financingToRecord = (db: Db) => financedPurchases(db).filter((p) => loansFinancingAsset(db, p.id).length === 0);
