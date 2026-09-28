import type { FastifyInstance } from 'fastify';
import { AppError } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { comparativeTrialBalance, generalJournal, generalLedger, ledgerAccounts } from './books.ts';

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('BAD_DATE', 'Use a date in YYYY-MM-DD format.', 400);
  const d = new Date(`${value}T00:00:00Z`);
  const [year, month, day] = value.split('-').map(Number);
  if (Number.isNaN(d.valueOf()) || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day)
    throw new AppError('BAD_DATE', 'Enter a valid calendar date.', 400);
  return value;
}
function range(q: Record<string, unknown>) {
  const from = date(q.from);
  const to = date(q.to);
  if (from > to) throw new AppError('BAD_RANGE', 'The first date must be on or before the last date.', 400);
  return { from, to };
}
function csv(rows: (string | number | null)[][]): string {
  return '\uFEFF' + rows.map((row) => row.map((cell) => {
    const value = String(cell ?? '');
    const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}
function pesos(cents: number | null): string { return cents === null ? '' : (cents / 100).toFixed(2); }
function sendCsv(reply: { header: (name: string, value: string) => unknown; type: (value: string) => unknown }, name: string, rows: (string | number | null)[][]) {
  reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
  reply.type('text/csv; charset=utf-8');
  return csv(rows);
}

export function rptRoutes(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/rpt/accounts', { config: { permission: 'rpt.books.view' } }, async () => ledgerAccounts(db));
  app.get('/api/rpt/journal', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    const result = generalJournal(db, from, to);
    if (q.format !== 'csv') return result;
    const rows: (string | number | null)[][] = [['Date', 'Journal', 'Document type', 'Document', 'Posting', 'Account', 'Account name', 'Party type', 'Party ID', 'Debit PHP', 'Credit PHP', 'Memo']];
    for (const j of result.journals) for (const l of j.lines) rows.push([j.businessDate, j.journalNumber, j.documentType, j.documentNumber,
      j.postingKind, l.accountCode, l.accountName, l.partyType, l.partyId, pesos(l.debitCents), pesos(l.creditCents), l.memo ?? j.journalMemo]);
    rows.push(['TOTAL', '', '', '', '', '', '', '', '', pesos(result.totalDebitCents), pesos(result.totalCreditCents), '']);
    return sendCsv(reply, `general-journal-${result.from}-${result.to}`, rows);
  });
  app.get('/api/rpt/ledger', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    const id = q.accountId === undefined ? undefined : Number(q.accountId);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0 || !ledgerAccounts(db).some((a) => a.id === id)))
      throw new AppError('BAD_ACCOUNT', 'Choose an account from the list.', 400);
    const result = generalLedger(db, from, to, id);
    if (q.format !== 'csv') return result;
    const rows: (string | number | null)[][] = [['Account', 'Account name', 'Date', 'Journal', 'Document type', 'Document', 'Party type', 'Party ID', 'Debit PHP', 'Credit PHP', 'Balance PHP', 'Memo']];
    for (const a of result.accounts) {
      rows.push([a.code, a.name, from, '', '', '', '', '', '', '', pesos(a.openingBalanceCents), 'Opening balance']);
      for (const l of a.lines) rows.push([a.code, a.name, l.businessDate, l.journalNumber, l.documentType, l.documentNumber,
        l.partyType, l.partyId, pesos(l.debitCents), pesos(l.creditCents), pesos(l.runningBalanceCents), l.memo ?? l.journalMemo]);
      rows.push([a.code, a.name, to, '', '', '', '', '', '', '', pesos(a.closingBalanceCents), 'Closing balance']);
    }
    return sendCsv(reply, `general-ledger-${from}-${to}`, rows);
  });
  app.get('/api/rpt/trial-balance', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const asOf = date(q.asOf);
    const compareTo = q.compareTo === undefined || q.compareTo === '' ? undefined : date(q.compareTo);
    const result = comparativeTrialBalance(db, asOf, compareTo);
    if (q.format !== 'csv') return result;
    const rows: (string | number | null)[][] = [['Account', 'Account name', `Debit PHP ${asOf}`, `Credit PHP ${asOf}`,
      `Debit PHP ${compareTo ?? ''}`, `Credit PHP ${compareTo ?? ''}`]];
    for (const a of result.rows) rows.push([a.code, a.name, pesos(a.debitCents), pesos(a.creditCents),
      compareTo ? pesos(a.compareDebitCents) : '', compareTo ? pesos(a.compareCreditCents) : '']);
    rows.push(['TOTAL', '', pesos(result.totalDebitCents), pesos(result.totalCreditCents), pesos(result.compareTotalDebitCents), pesos(result.compareTotalCreditCents)]);
    return sendCsv(reply, `trial-balance-${asOf}`, rows);
  });
}
