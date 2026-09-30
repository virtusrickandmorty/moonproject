/**
 * Reversing journal vouchers (PLAN E12, "reversal-on-date option for accruals"). A JV marked "reverse on the first day
 * of next month" shows in "Reversals due" from that day. One button opens a new JV with the same lines, debits and
 * credits swapped, the same parties, dated that day, memo "Reversal of JV-…"; the accountant records it like any JV.
 * A JV is reversed at most once; cancelling the reversal lets it be reversed again; cancelling the original while its
 * reversal stands is refused, naming the reversal (jv.ts dependents). It sits with the JV doc type, since it builds the
 * reversal's lines (the money rule keeps line-building in doctypes).
 */
import type { FastifyInstance } from 'fastify';
import { conflict, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../../app.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { today } from '../../../platform/clock.ts';

/** The first day of the month after a date: 2026-09-30 -> 2026-10-01, 2026-12-15 -> 2027-01-01. */
export function firstOfNextMonth(date: string): string {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export interface ReversibleJv { documentId: string; number: string; status: string; date: string; memo: string; reverseOn: string | null; totalCents: number }

/** A journal voucher by id, with its reversal day if it is marked to reverse; undefined if it is not a JV. */
export function reversibleJv(db: Db, documentId: string): ReversibleJv | undefined {
  return db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.status, d.business_date AS date, v.memo, v.reverse_on AS reverseOn, d.total_cents AS totalCents
       FROM acc_journal_vouchers v JOIN documents d ON d.id = v.document_id WHERE v.document_id = ? AND d.doc_type = 'acc.jv'`,
    )
    .get(documentId) as ReversibleJv | undefined;
}

/** The recorded, not cancelled JV that reverses this one, if any. */
export function standingReversalOf(db: Db, documentId: string): { id: string; number: string } | undefined {
  return db
    .prepare(`SELECT d.id, d.number FROM acc_journal_vouchers v JOIN documents d ON d.id = v.document_id WHERE v.reverses_id = ? AND d.status = 'posted' ORDER BY d.number`)
    .get(documentId) as { id: string; number: string } | undefined;
}

/** JVs marked to reverse whose day has come (reverse_on on or before `asOf`), still standing and not reversed, oldest first. */
export function reversalsDue(db: Db, asOf: string): ReversibleJv[] {
  return db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.status, d.business_date AS date, v.memo, v.reverse_on AS reverseOn, d.total_cents AS totalCents
       FROM acc_journal_vouchers v JOIN documents d ON d.id = v.document_id
       WHERE v.reverse_on IS NOT NULL AND v.reverse_on <= ? AND d.status = 'posted'
         AND NOT EXISTS (SELECT 1 FROM acc_journal_vouchers r JOIN documents rd ON rd.id = r.document_id WHERE r.reverses_id = v.document_id AND rd.status = 'posted')
       ORDER BY v.reverse_on, d.number`,
    )
    .all(asOf) as ReversibleJv[];
}

export interface StoredJvLine { lineNo: number; accountId: number; partyType: string | null; partyId: string | null; debitCents: number; creditCents: number; memo: string | null }

export function storedJvLines(db: Db, documentId: string): StoredJvLine[] {
  return db
    .prepare(
      `SELECT line_no AS lineNo, account_id AS accountId, party_type AS partyType, party_id AS partyId, debit_cents AS debitCents, credit_cents AS creditCents, memo
       FROM acc_jv_lines WHERE document_id = ? ORDER BY line_no`,
    )
    .all(documentId) as StoredJvLine[];
}

/**
 * The form input of a JV's reversal: its lines with debits and credits swapped, the same parties and line memos, and
 * the memo "Reversal of JV-…"; dated the original's reversal day. Refused if it is not due, cancelled or reversed.
 */
export function reversalInput(db: Db, documentId: string, asOf: string) {
  const jv = reversibleJv(db, documentId);
  if (!jv) throw notFound('The journal voucher');
  if (jv.status !== 'posted') throw conflict('CANCELLED', `${jv.number} is cancelled: there is nothing to reverse.`);
  if (!jv.reverseOn) throw conflict('NOT_REVERSING', `${jv.number} is not marked to reverse.`);
  if (jv.reverseOn > asOf) throw conflict('NOT_DUE', `${jv.number} reverses on ${jv.reverseOn}.`);
  const standing = standingReversalOf(db, documentId);
  if (standing) throw conflict('REVERSED', `${jv.number} is already reversed by ${standing.number}. Cancel that one first to reverse it again.`);
  return {
    businessDate: jv.reverseOn,
    original: { documentId: jv.documentId, number: jv.number, date: jv.date },
    input: {
      memo: `Reversal of ${jv.number}`,
      lines: storedJvLines(db, documentId).map((l) => ({
        accountId: l.accountId,
        ...(l.partyType && l.partyId ? { party: { type: l.partyType, id: l.partyId } } : {}),
        ...(l.creditCents ? { debitCents: l.creditCents } : {}),
        ...(l.debitCents ? { creditCents: l.debitCents } : {}),
        ...(l.memo ? { memo: l.memo } : {}),
      })),
      reversalOf: jv.documentId,
    },
  };
}

export function reversalRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  /** "Reversals due": accruals whose reversal day has come and that are not reversed yet. */
  app.get('/api/acc/jv/reversals-due', { config: { permission: 'acc.jv.create' } }, async () => reversalsDue(db, today(clock)));
  /** The prefilled reversal of one JV, for the JV form; nothing is recorded. */
  app.get<{ Params: { id: string } }>('/api/acc/jv/:id/reversal', { config: { permission: 'acc.jv.create' } }, async (req) => reversalInput(db, req.params.id, today(clock)));
}
