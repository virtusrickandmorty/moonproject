import type { Db } from '../../platform/db/driver.ts';
import { trialBalance } from '../../engine/ledger/queries.ts';

export type BookLine = {
  journalId: string; journalNumber: string; businessDate: string; sourceType: string; sourceId: string;
  documentType: string | null; documentNumber: string | null; postingKind: string; journalMemo: string;
  lineNo: number; accountId: number; accountCode: string; accountName: string;
  partyType: string | null; partyId: string | null; memo: string | null;
} & Record<'debitCents' | 'creditCents', number>;

const selectLines = `SELECT j.id AS journalId, j.number AS journalNumber, j.business_date AS businessDate,
  j.source_type AS sourceType, j.source_id AS sourceId, d.doc_type AS documentType,
  d.number AS documentNumber, j.posting_kind AS postingKind, j.memo AS journalMemo,
  l.line_no AS lineNo, a.id AS accountId, a.code AS accountCode, a.name AS accountName,
  l.party_type AS partyType, l.party_id AS partyId, l.debit_cents AS debitCents,
  l.credit_cents AS creditCents, l.memo AS memo
  FROM journal_lines l JOIN journals j ON j.id = l.journal_id
  JOIN accounts a ON a.id = l.account_id LEFT JOIN documents d ON d.id = j.source_id
  WHERE j.sealed = 1`;

export function generalJournal(db: Db, from: string, to: string) {
  const lines = db.prepare(`${selectLines} AND j.business_date BETWEEN @from AND @to
    ORDER BY j.business_date, j.number, l.line_no`).all({ from, to }) as BookLine[];
  const journals: (Omit<BookLine, 'lineNo' | 'accountId' | 'accountCode' | 'accountName' | 'partyType' | 'partyId' | 'debitCents' | 'creditCents' | 'memo'> & {
    lines: Pick<BookLine, 'lineNo' | 'accountId' | 'accountCode' | 'accountName' | 'partyType' | 'partyId' | 'debitCents' | 'creditCents' | 'memo'>[];
    runningDebitCents: number; runningCreditCents: number;
  })[] = [];
  let runningDebitCents = 0;
  let runningCreditCents = 0;
  for (const line of lines) {
    let journal = journals.at(-1);
    if (journal?.journalId !== line.journalId) {
      journal = { journalId: line.journalId, journalNumber: line.journalNumber, businessDate: line.businessDate,
        sourceType: line.sourceType, sourceId: line.sourceId, documentType: line.documentType,
        documentNumber: line.documentNumber, postingKind: line.postingKind, journalMemo: line.journalMemo,
        lines: [], runningDebitCents, runningCreditCents };
      journals.push(journal);
    }
    journal.lines.push(line);
    runningDebitCents += line.debitCents;
    runningCreditCents += line.creditCents;
    journal.runningDebitCents = runningDebitCents;
    journal.runningCreditCents = runningCreditCents;
  }
  return { from, to, journals, totalDebitCents: lines.reduce((n, l) => n + l.debitCents, 0),
    totalCreditCents: lines.reduce((n, l) => n + l.creditCents, 0) };
}

export function ledgerAccounts(db: Db) {
  return db.prepare('SELECT id, code, name, normal_side AS normalSide FROM accounts WHERE is_header = 0 ORDER BY code')
    .all() as { id: number; code: string; name: string; normalSide: 'debit' | 'credit' }[];
}

export function generalLedger(db: Db, from: string, to: string, accountId?: number) {
  const accounts = ledgerAccounts(db).filter((a) => accountId === undefined || a.id === accountId);
  const opening = db.prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS balance
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE j.sealed = 1 AND l.account_id = ? AND j.business_date < ?`);
  const lines = db.prepare(`${selectLines} AND l.account_id = @accountId
    AND j.business_date BETWEEN @from AND @to ORDER BY j.business_date, j.number, l.line_no`);
  return { from, to, accounts: accounts.map((account) => {
    const openingBalanceCents = (opening.get(account.id, from) as { balance: number }).balance;
    let balance = openingBalanceCents;
    const entries = (lines.all({ accountId: account.id, from, to }) as BookLine[]).map((line) => {
      balance += line.debitCents - line.creditCents;
      return { ...line, runningBalanceCents: balance };
    });
    return { ...account, openingBalanceCents, lines: entries, closingBalanceCents: balance };
  }) };
}

export function comparativeTrialBalance(db: Db, asOf: string, compareTo?: string) {
  const current = trialBalance(db, asOf);
  const comparison = compareTo ? trialBalance(db, compareTo) : null;
  const rows = new Map<number, { accountId: number; code: string; name: string;
    compareDebitCents: number; compareCreditCents: number } & Record<'debitCents' | 'creditCents', number>>();
  for (const row of current.rows) rows.set(row.accountId, { ...row, compareDebitCents: 0, compareCreditCents: 0 });
  for (const row of comparison?.rows ?? []) {
    const existing = rows.get(row.accountId);
    if (existing) { existing.compareDebitCents = row.debitCents; existing.compareCreditCents = row.creditCents; }
    else {
      const missing = { ...row, compareDebitCents: row.debitCents, compareCreditCents: row.creditCents };
      missing.debitCents = 0;
      missing.creditCents = 0;
      rows.set(row.accountId, missing);
    }
  }
  return { asOf, compareTo: compareTo ?? null, rows: [...rows.values()].sort((a, b) => a.code.localeCompare(b.code)),
    totalDebitCents: current.totalDebitCents, totalCreditCents: current.totalCreditCents,
    compareTotalDebitCents: comparison?.totalDebitCents ?? null, compareTotalCreditCents: comparison?.totalCreditCents ?? null };
}
