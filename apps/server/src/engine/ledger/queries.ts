/** Balances are always computed from journal lines (NR-2). */
import type { Db } from '../../platform/db/driver.ts';

/** Debit-positive balance of one account, optionally up to a date and for one party. */
export function accountBalance(db: Db, accountId: number, opts: { asOf?: string; party?: { type: string; id: string } } = {}): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS bal
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       WHERE l.account_id = @acc AND j.sealed = 1
         AND (@asOf IS NULL OR j.business_date <= @asOf)
         AND (@pt IS NULL OR (l.party_type = @pt AND l.party_id = @pid))`,
    )
    .get({ acc: accountId, asOf: opts.asOf ?? null, pt: opts.party?.type ?? null, pid: opts.party?.id ?? null }) as { bal: number };
  return r.bal;
}

export interface TbRow {
  accountId: number;
  code: string;
  name: string;
  debitCents: number;
  creditCents: number;
}

export function trialBalance(db: Db, asOf?: string): { rows: TbRow[]; totalDebitCents: number; totalCreditCents: number } {
  const rows = (
    db
      .prepare(
        `SELECT a.id, a.code, a.name, SUM(l.debit_cents - l.credit_cents) AS bal
         FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
         WHERE j.sealed = 1 AND (@asOf IS NULL OR j.business_date <= @asOf)
         GROUP BY a.id HAVING bal <> 0 ORDER BY a.code`,
      )
      .all({ asOf: asOf ?? null }) as { id: number; code: string; name: string; bal: number }[]
  ).map((r) => ({
    accountId: r.id,
    code: r.code,
    name: r.name,
    debitCents: r.bal > 0 ? r.bal : 0,
    creditCents: r.bal < 0 ? -r.bal : 0,
  }));
  return {
    rows,
    totalDebitCents: rows.reduce((s, r) => s + r.debitCents, 0),
    totalCreditCents: rows.reduce((s, r) => s + r.creditCents, 0),
  };
}

export interface JournalView {
  id: string;
  number: string;
  businessDate: string;
  postingKind: 'original' | 'reversal';
  memo: string;
  lines: { lineNo: number; accountCode: string; accountName: string; partyType: string | null; partyId: string | null; debitCents: number; creditCents: number; memo: string | null }[];
}

export function journalsForSource(db: Db, sourceType: string, sourceId: string): JournalView[] {
  const js = db
    .prepare('SELECT id, number, business_date, posting_kind, memo FROM journals WHERE source_type = ? AND source_id = ? ORDER BY created_at, number')
    .all(sourceType, sourceId) as { id: string; number: string; business_date: string; posting_kind: 'original' | 'reversal'; memo: string }[];
  const lineStmt = db.prepare(
    `SELECT l.line_no, a.code, a.name, l.party_type, l.party_id, l.debit_cents, l.credit_cents, l.memo
     FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY l.line_no`,
  );
  return js.map((j) => ({
    id: j.id,
    number: j.number,
    businessDate: j.business_date,
    postingKind: j.posting_kind,
    memo: j.memo,
    lines: (lineStmt.all(j.id) as { line_no: number; code: string; name: string; party_type: string | null; party_id: string | null; debit_cents: number; credit_cents: number; memo: string | null }[]).map((l) => ({
      lineNo: l.line_no,
      accountCode: l.code,
      accountName: l.name,
      partyType: l.party_type,
      partyId: l.party_id,
      debitCents: l.debit_cents,
      creditCents: l.credit_cents,
      memo: l.memo,
    })),
  }));
}
