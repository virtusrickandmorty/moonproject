/**
 * The only code that writes journals (PLAN D1). One document -> one journal, in the caller's transaction.
 */
import { AppError, isCents, newId, yearOf } from '@virtus/shared';
import type { Db } from '../../platform/db/driver.ts';
import { ensureSeries, allocateNumber } from '../numbering.ts';
import { resolveAccount, type Account, type AccountRef } from './accounts.ts';

export interface Party {
  type: string;
  id: string;
}

export interface DraftLine {
  account: AccountRef;
  party?: Party;
  debitCents?: number;
  creditCents?: number;
  memo?: string;
}

export interface JournalDraft {
  memo: string;
  lines: DraftLine[];
}

export interface PostContext {
  sourceType: string;
  sourceId: string;
  businessDate: string;
  userId: string;
  at: string;
}

export interface ResolvedLine {
  account: Account;
  party: Party | null;
  debitCents: number;
  creditCents: number;
  memo: string | null;
}

/** Resolves accounts and checks every rule we can check before writing (the DB triggers check again). */
export function resolveDraft(db: Db, draft: JournalDraft): ResolvedLine[] {
  const lines: ResolvedLine[] = [];
  for (const l of draft.lines) {
    const debit = l.debitCents ?? 0;
    const credit = l.creditCents ?? 0;
    if (!isCents(debit) || !isCents(credit) || debit < 0 || credit < 0) {
      throw new AppError('BAD_LINE', 'Journal amounts must be non-negative whole centavos.', 500);
    }
    if (debit > 0 && credit > 0) throw new AppError('BAD_LINE', 'A journal line cannot have both a debit and a credit.', 500);
    if (debit === 0 && credit === 0) continue; // zero lines (e.g. no fee) are dropped
    const account = resolveAccount(db, l.account);
    if (account.is_header || !account.is_postable) throw new AppError('BAD_ACCOUNT', `${account.code} ${account.name} cannot be posted to.`, 500);
    if (!account.is_active) throw new AppError('ACCOUNT_INACTIVE', `${account.name} is inactive.`, 400);
    const party = l.party ?? null;
    if (account.party_type && account.party_type !== 'free') {
      if (!party || party.type !== account.party_type) {
        throw new AppError('PARTY_REQUIRED', `${account.name} needs a ${account.party_type} on every line.`, 500);
      }
    } else if (!account.party_type && party) {
      throw new AppError('PARTY_NOT_ALLOWED', `${account.name} does not take a party.`, 500);
    }
    lines.push({ account, party, debitCents: debit, creditCents: credit, memo: l.memo ?? null });
  }
  const dr = lines.reduce((s, l) => s + l.debitCents, 0);
  const cr = lines.reduce((s, l) => s + l.creditCents, 0);
  if (lines.length < 2 || dr !== cr) {
    throw new AppError('UNBALANCED', `Journal does not balance (debits ${dr}, credits ${cr}).`, 500);
  }
  return lines;
}

function insertJournal(
  db: Db,
  ctx: PostContext,
  kind: 'original' | 'reversal',
  memo: string,
  lines: { accountId: number; party: Party | null; debitCents: number; creditCents: number; memo: string | null }[],
  reversesId: string | null,
): { journalId: string; number: string } {
  if (!db.inTransaction) throw new Error('Journals are posted only inside a transaction');
  const series = `JE-${yearOf(ctx.businessDate)}`;
  ensureSeries(db, { key: series, prefix: `${series}-`, pad: 6 });
  const number = allocateNumber(db, series);
  const journalId = newId();
  db.prepare(
    `INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, reverses_journal_id, memo, sealed, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(journalId, number, ctx.businessDate, ctx.sourceType, ctx.sourceId, kind, reversesId, memo, ctx.at, ctx.userId);
  const ins = db.prepare(
    `INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) => ins.run(journalId, i + 1, l.accountId, l.party?.type ?? null, l.party?.id ?? null, l.debitCents, l.creditCents, l.memo));
  db.prepare('UPDATE journals SET sealed = 1 WHERE id = ?').run(journalId); // trigger checks balance
  return { journalId, number };
}

export function postJournal(db: Db, draft: JournalDraft, ctx: PostContext): { journalId: string; number: string } {
  const lines = resolveDraft(db, draft);
  return insertJournal(
    db,
    ctx,
    'original',
    draft.memo,
    lines.map((l) => ({ accountId: l.account.id, party: l.party, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo })),
    null,
  );
}

/**
 * Mirror of the stored lines, never recomputed (PLAN C4, D4.10), dated the cancel date (ACC-09 default).
 * Returns null when the source has no journal (non-posting documents).
 */
export function reverseJournalOf(db: Db, sourceType: string, sourceId: string, ctx: PostContext, memo: string) {
  const j = db
    .prepare(`SELECT id, number FROM journals WHERE source_type = ? AND source_id = ? AND posting_kind = 'original'`)
    .get(sourceType, sourceId) as { id: string; number: string } | undefined;
  if (!j) return null;
  const stored = db
    .prepare('SELECT account_id, party_type, party_id, debit_cents, credit_cents, memo FROM journal_lines WHERE journal_id = ? ORDER BY line_no')
    .all(j.id) as { account_id: number; party_type: string | null; party_id: string | null; debit_cents: number; credit_cents: number; memo: string | null }[];
  return insertJournal(
    db,
    ctx,
    'reversal',
    memo,
    stored.map((l) => ({
      accountId: l.account_id,
      party: l.party_type ? { type: l.party_type, id: l.party_id! } : null,
      debitCents: l.credit_cents,
      creditCents: l.debit_cents,
      memo: l.memo,
    })),
    j.id,
  );
}
