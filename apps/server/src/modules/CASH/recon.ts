/**
 * Bank reconciliation (PLAN E10), per bank and statement month. Statement lines are typed or pasted as CSV. Each
 * tick-match groups statement lines and the bank's journal lines with equal totals; the marks live in
 * cash_recon_cleared and never touch a journal line. A group may be one-sided when it nets to zero (a cancelled
 * entry and its mirror, a bank error and its correction).
 *
 * The report, for the statement month M of bank B:
 *   book balance      = B's ledger balance at the end of M
 *   outstanding       = B's lines dated in or before M that no reconciliation up to M has cleared
 *                       (deposits in transit, payments the bank has not paid out yet)
 *   recorded after M  = lines dated after M that this statement clears (a bank adjustment made after the month)
 *   difference        = bank balance (the statement's closing balance) - (book - outstanding + recorded after M)
 * Finishing needs every statement line matched and a zero difference. Months go in order per bank: a new month
 * starts after the latest one is finished, and only the latest one is reopened (the accountant, with a reason).
 */
import { z } from 'zod';
import { badRequest, conflict, formatPeso, isBusinessDate, newId, notFound, parsePesos } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { place, type Who } from './places.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard
const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);
const ids = z.array(z.number().int().positive()).max(500);
const statementLine = z
  .object({
    date: z.string().refine(isBusinessDate, 'Use a date like 2026-09-05.'),
    description: z.string().trim().min(1).max(200),
    amountCents: cents.refine((v) => v !== 0, 'A line of zero moves nothing.'),
  })
  .strict();
export const newReconInput = z.object({ bankId: z.number().int().positive(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), endingBalanceCents: cents }).strict();
export const endingInput = z.object({ endingBalanceCents: cents }).strict();
export const linesInput = z.union([z.object({ lines: z.array(statementLine).min(1).max(500) }).strict(), z.object({ csv: z.string().min(1).max(100_000) }).strict()]);
export const matchInput = z.object({ statementLineIds: ids, journalLineIds: ids }).strict();
export const unmatchInput = z.object({ matchNo: z.number().int().positive() }).strict();
export const reopenInput = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export type StatementLine = z.infer<typeof statementLine>;

interface Recon { id: string; accountId: number; month: string; endingBalanceCents: number; status: 'open' | 'finished'; finishedAt: string | null; reopenedAt: string | null; reopenReason: string | null }
const SELECT = `SELECT id, account_id AS accountId, month, ending_balance_cents AS endingBalanceCents, status, finished_at AS finishedAt,
  reopened_at AS reopenedAt, reopen_reason AS reopenReason FROM cash_recons`;

const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

function recon(db: Db, id: string): Recon {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Recon | undefined;
  if (!r) throw notFound('The reconciliation');
  return r;
}
function openRecon(db: Db, id: string): Recon {
  const r = recon(db, id);
  if (r.status !== 'open') throw conflict('LOCKED', `The ${r.month} reconciliation is finished. The accountant reopens it before it changes.`);
  return r;
}
const audit = (db: Db, who: Who, action: string, id: string, data: Record<string, unknown>) => appendAudit(db, { at: who.at, userId: who.userId, action, entityType: 'cash.recon', entityId: id, data });

export const listRecons = (db: Db) =>
  db.prepare(`SELECT r.id, r.account_id AS bankId, a.name AS bankName, r.month, r.status, r.ending_balance_cents AS bankBalanceCents
    FROM cash_recons r JOIN accounts a ON a.id = r.account_id ORDER BY r.month DESC, a.code`).all() as { id: string; bankId: number; bankName: string; month: string; status: string; bankBalanceCents: number }[];

/** Starts the reconciliation of a bank's statement month, after the bank's latest one is finished. Call inside a transaction. */
export function createRecon(db: Db, raw: unknown, who: Who, today: string) {
  const v = newReconInput.parse(raw);
  const p = place(db, v.bankId);
  if (!p?.isActive || p.kind !== 'bank') throw badRequest('NOT_A_BANK', 'Pick the bank account to reconcile.');
  if (v.month > today.slice(0, 7)) throw badRequest('FUTURE_MONTH', 'That month has not started yet.');
  const last = db.prepare('SELECT month, status FROM cash_recons WHERE account_id = ? ORDER BY month DESC LIMIT 1').get(v.bankId) as { month: string; status: string } | undefined;
  if (last && last.month >= v.month) throw conflict('MONTH_TAKEN', `${p.name} already has a reconciliation for ${last.month}. Months go in order.`);
  if (last?.status === 'open') throw conflict('EARLIER_OPEN', `Finish the ${last.month} reconciliation of ${p.name} first.`);
  const id = newId();
  db.prepare('INSERT INTO cash_recons (id, account_id, month, ending_balance_cents, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(id, v.bankId, v.month, v.endingBalanceCents, who.at, who.userId);
  audit(db, who, 'cash.recon.create', id, v);
  return reconReport(db, id);
}

/** Corrects the statement's closing balance while the reconciliation is open. */
export function setEndingBalance(db: Db, id: string, raw: unknown, who: Who) {
  const r = openRecon(db, id);
  const { endingBalanceCents } = endingInput.parse(raw);
  db.prepare('UPDATE cash_recons SET ending_balance_cents = ? WHERE id = ?').run(endingBalanceCents, id);
  audit(db, who, 'cash.recon.ending', id, { before: r.endingBalanceCents, after: endingBalanceCents });
  return reconReport(db, id);
}

/** CSV fields of one line; double quotes allow commas inside a field. */
function csvFields(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (quoted && c === '"' && row[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  return [...out, cur.trim()];
}

/** "date, description, amount" per line, like 2026-09-05,Service charge,-150.00. A header line is skipped. */
export function parseStatementCsv(text: string): StatementLine[] {
  const rows = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const lines = rows.flatMap((row, i) => {
    const f = csvFields(row);
    if (i === 0 && /date/i.test(f[0] ?? '')) return [];
    const fail = (why = 'should be date, description, amount, like 2026-09-05,Service charge,-150.00') => badRequest('BAD_CSV', `Line ${i + 1} ${why}.`);
    // An amount written 12,500.00 without quotes splits in two; refuse it rather than read 500.00.
    if (f.length > 3 && /^[-₱]*\d{1,3}$/.test(f[f.length - 2]!)) throw fail('has an amount with a comma: write 12500.00 or put it in quotes');
    let amountCents = 0;
    try {
      amountCents = parsePesos(f[f.length - 1] ?? '');
    } catch {
      throw fail();
    }
    const line = { date: f[0] ?? '', description: f.slice(1, -1).join(', '), amountCents };
    if (f.length < 3 || !statementLine.safeParse(line).success) throw fail();
    return [line];
  });
  if (lines.length === 0) throw badRequest('BAD_CSV', 'Paste at least one statement line.');
  return lines;
}

/** Adds statement lines (typed, or pasted as CSV). Every line must fall in the statement month. */
export function addLines(db: Db, id: string, raw: unknown, who: Who) {
  const r = openRecon(db, id);
  const v = linesInput.parse(raw);
  const lines = 'csv' in v ? parseStatementCsv(v.csv) : v.lines;
  const bad = lines.findIndex((l) => l.date < `${r.month}-01` || l.date > monthEnd(r.month));
  if (bad >= 0) throw badRequest('OUTSIDE_MONTH', `Line ${bad + 1} is dated ${lines[bad]!.date}, outside the ${r.month} statement.`);
  const ins = db.prepare('INSERT INTO cash_recon_lines (recon_id, line_date, description, amount_cents, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of lines) ins.run(id, l.date, l.description, l.amountCents, who.at, who.userId);
  audit(db, who, 'cash.recon.lines', id, { count: lines.length, totalCents: sum(lines), csv: 'csv' in v });
  return reconReport(db, id);
}

const clearedStatement = (db: Db, lineId: number) => db.prepare('SELECT 1 FROM cash_recon_cleared WHERE statement_line_id = ? AND active = 1').get(lineId) !== undefined;

/** A line typed wrong is voided (kept, left out of the report). */
export function voidLine(db: Db, id: string, lineId: number, who: Who) {
  openRecon(db, id);
  const l = db.prepare('SELECT voided FROM cash_recon_lines WHERE id = ? AND recon_id = ?').get(lineId, id) as { voided: number } | undefined;
  if (!l) throw notFound('The statement line');
  if (l.voided || clearedStatement(db, lineId)) throw conflict('LINE_IN_USE', 'That line is voided or matched already. Unmatch it first.');
  db.prepare('UPDATE cash_recon_lines SET voided = 1 WHERE id = ?').run(lineId);
  audit(db, who, 'cash.recon.void_line', id, { lineId });
  return reconReport(db, id);
}

/** Tick-match: the ticked statement lines and bank journal lines must have equal totals. Returns the match number. */
export function matchLines(db: Db, id: string, raw: unknown, who: Who): number {
  const r = openRecon(db, id);
  const v = matchInput.parse(raw);
  if (v.statementLineIds.length + v.journalLineIds.length === 0) throw badRequest('NOTHING_TICKED', 'Tick the lines to match.');
  if (new Set(v.statementLineIds).size !== v.statementLineIds.length || new Set(v.journalLineIds).size !== v.journalLineIds.length) throw badRequest('TICKED_TWICE', 'A line is ticked twice.');
  const stmt = db.prepare('SELECT amount_cents AS amountCents, voided FROM cash_recon_lines WHERE id = ? AND recon_id = ?');
  const statement = v.statementLineIds.map((s) => stmt.get(s, id) as { amountCents: number; voided: number } | undefined);
  if (statement.some((s, i) => !s || s.voided || clearedStatement(db, v.statementLineIds[i]!))) throw conflict('LINE_TAKEN', 'A ticked statement line is voided, matched already or on another statement. Reload.');
  const gl = db.prepare(`SELECT l.debit_cents - l.credit_cents AS amountCents, EXISTS (SELECT 1 FROM cash_recon_cleared c WHERE c.journal_line_id = l.id AND c.active = 1) AS cleared
    FROM journal_lines l WHERE l.id = ? AND l.account_id = ?`);
  const book = v.journalLineIds.map((j) => gl.get(j, r.accountId) as { amountCents: number; cleared: number } | undefined);
  if (book.some((b) => !b || b.cleared)) throw conflict('LINE_TAKEN', 'A ticked book line is matched already or belongs to another account. Reload.');
  const [s, b] = [sum(statement as { amountCents: number }[]), sum(book as { amountCents: number }[])];
  if (s !== b) throw badRequest('TOTALS_DIFFER', `The statement lines add up to ${formatPeso(s)} but the book lines to ${formatPeso(b)}.`);
  const matchNo = db.prepare('SELECT COALESCE(MAX(match_no), 0) + 1 FROM cash_recon_cleared WHERE recon_id = ?').pluck().get(id) as number;
  const ins = db.prepare('INSERT INTO cash_recon_cleared (recon_id, match_no, statement_line_id, journal_line_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  for (const sl of v.statementLineIds) ins.run(id, matchNo, sl, null, who.at, who.userId);
  for (const jl of v.journalLineIds) ins.run(id, matchNo, null, jl, who.at, who.userId);
  audit(db, who, 'cash.recon.match', id, { matchNo, ...v, totalCents: s });
  return matchNo;
}

/** Matches a bank adjustment just posted from this reconciliation to the statement lines it explains. */
export function matchAdjustment(db: Db, id: string, documentId: string, statementLineIds: number[], who: Who): number {
  const line = db
    .prepare(`SELECT l.id FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = 'original' AND l.account_id = ?`)
    .pluck()
    .get(documentId, recon(db, id).accountId) as number | undefined;
  if (line === undefined) throw badRequest('OTHER_BANK', 'The adjustment must be for the bank of this reconciliation.');
  return matchLines(db, id, { statementLineIds, journalLineIds: [line] }, who);
}

export function unmatch(db: Db, id: string, raw: unknown, who: Who) {
  openRecon(db, id);
  const { matchNo } = unmatchInput.parse(raw);
  const n = db.prepare('UPDATE cash_recon_cleared SET active = 0, undone_at = ?, undone_by = ? WHERE recon_id = ? AND match_no = ? AND active = 1').run(who.at, who.userId, id, matchNo).changes;
  if (n === 0) throw notFound('The match');
  audit(db, who, 'cash.recon.unmatch', id, { matchNo });
  return reconReport(db, id);
}

/** Locks the reconciliation: every statement line matched, difference zero. */
export function finishRecon(db: Db, id: string, who: Who) {
  openRecon(db, id);
  const rep = reconReport(db, id);
  if (rep.unmatchedStatementCount > 0) throw conflict('UNMATCHED', `${rep.unmatchedStatementCount} statement line(s) are not matched yet.`);
  if (rep.differenceCents !== 0) throw conflict('DIFFERENCE', `The difference is ${formatPeso(rep.differenceCents)}. It must be zero to finish.`);
  db.prepare(`UPDATE cash_recons SET status = 'finished', finished_at = ?, finished_by = ? WHERE id = ?`).run(who.at, who.userId, id);
  audit(db, who, 'cash.recon.finish', id, { bookBalanceCents: rep.bookBalanceCents, bankBalanceCents: rep.bankBalanceCents });
  return reconReport(db, id);
}

/** Unlocks the bank's latest reconciliation, with the reason. */
export function reopenRecon(db: Db, id: string, raw: unknown, who: Who) {
  const { reason } = reopenInput.parse(raw);
  const r = recon(db, id);
  if (r.status !== 'finished') throw conflict('NOT_FINISHED', 'This reconciliation is still open.');
  const later = db.prepare('SELECT month FROM cash_recons WHERE account_id = ? AND month > ? ORDER BY month LIMIT 1').pluck().get(r.accountId, r.month) as string | undefined;
  if (later) throw conflict('LATER_MONTH', `Only the latest reconciliation reopens; this bank already has ${later}.`);
  db.prepare(`UPDATE cash_recons SET status = 'open', finished_at = NULL, finished_by = NULL, reopened_at = ?, reopened_by = ?, reopen_reason = ? WHERE id = ?`).run(who.at, who.userId, reason, id);
  audit(db, who, 'cash.recon.reopen', id, { reason });
  return reconReport(db, id);
}

interface BookLine { journalLineId: number; date: string; journalNumber: string; documentNumber: string | null; memo: string; amountCents: number; matchNo: number | null; state: 'cleared' | 'outstanding' | 'later' }
type BookRow = Omit<BookLine, 'state'> & { clearedIn: string | null; clearedMonth: string | null };

/** The reconciliation with its lines and figures (see the top of this file). */
export function reconReport(db: Db, id: string) {
  const r = recon(db, id);
  const end = monthEnd(r.month);
  const statementLines = (
    db.prepare(`SELECT l.id, l.line_date AS date, l.description, l.amount_cents AS amountCents, l.voided,
        (SELECT c.match_no FROM cash_recon_cleared c WHERE c.statement_line_id = l.id AND c.active = 1) AS matchNo
      FROM cash_recon_lines l WHERE l.recon_id = ? ORDER BY l.line_date, l.id`).all(id) as { id: number; date: string; description: string; amountCents: number; voided: number; matchNo: number | null }[]
  ).map((l) => ({ ...l, voided: l.voided === 1 }));
  const rows = db.prepare(`SELECT l.id AS journalLineId, j.business_date AS date, j.number AS journalNumber, d.number AS documentNumber,
      COALESCE(l.memo, j.memo) AS memo, l.debit_cents - l.credit_cents AS amountCents, c.match_no AS matchNo, c.recon_id AS clearedIn, cr.month AS clearedMonth
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id LEFT JOIN documents d ON d.id = j.source_id
      LEFT JOIN cash_recon_cleared c ON c.journal_line_id = l.id AND c.active = 1 LEFT JOIN cash_recons cr ON cr.id = c.recon_id
    WHERE l.account_id = ? ORDER BY j.business_date, j.number, l.line_no`).all(r.accountId) as BookRow[];
  // cleared: by this statement. outstanding: in or before M, not cleared up to M. later: after M, not cleared yet (open only).
  const bookLines = rows.flatMap(({ clearedIn, clearedMonth, ...l }): BookLine[] => {
    if (clearedIn === id) return [{ ...l, state: 'cleared' }];
    if (l.date <= end && (clearedMonth === null || clearedMonth > r.month)) return [{ ...l, matchNo: null, state: 'outstanding' }];
    return r.status === 'open' && clearedMonth === null ? [{ ...l, state: 'later' }] : [];
  });
  const outstanding = bookLines.filter((l) => l.state === 'outstanding');
  const bookBalanceCents = accountBalance(db, r.accountId, { asOf: end });
  const recordedAfterMonthCents = sum(bookLines.filter((l) => l.state === 'cleared' && l.date > end));
  const adjustedBookCents = bookBalanceCents - sum(outstanding) + recordedAfterMonthCents;
  const unmatched = statementLines.filter((l) => !l.voided && l.matchNo === null);
  return {
    id: r.id, bankId: r.accountId, bankName: place(db, r.accountId)?.name ?? '?', month: r.month, status: r.status,
    finishedAt: r.finishedAt, reopenedAt: r.reopenedAt, reopenReason: r.reopenReason, statementLines, bookLines,
    bookBalanceCents,
    depositsInTransitCents: sum(outstanding.filter((l) => l.amountCents > 0)),
    outstandingPaymentsCents: sum(outstanding.filter((l) => l.amountCents < 0)),
    recordedAfterMonthCents, adjustedBookCents, bankBalanceCents: r.endingBalanceCents,
    unmatchedStatementCount: unmatched.length, unmatchedStatementCents: sum(unmatched),
    differenceCents: r.endingBalanceCents - adjustedBookCents,
  };
}
