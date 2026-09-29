/**
 * Bank reconciliation screen logic (PLAN E10), pure so it is tested without a browser. The server works out every
 * figure and checks every rule again; these functions only let the screen show the same figures while the user ticks.
 *
 * The screen ticks cash book items that cleared the bank. The server clears a book line by matching it to a statement
 * line of equal amount, so saving a tick adds one statement line for the item ("Cleared: BDO ...") and matches the pair;
 * unticking unmatches it and voids that line. Statement lines typed elsewhere are never touched.
 */
import { isBusinessDate, parsePesos } from '@moonproject/shared';
import type { ReconBookLine, ReconReport, ReconRow, ReconStatementLine } from '../../api.ts';

/** Start of the description of a statement line this screen made for a ticked book item. */
export const CLEARED_MARK = 'Cleared: ';

export const monthOf = (date: string) => date.slice(0, 7);

/** The last day of a month like 2026-09 (the server reconciles the whole month). */
export const monthEnd = (month: string) => `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

const sum = (xs: readonly { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

export interface ReconFigures {
  bookBalanceCents: number;
  /** Money in the books the bank has not received yet (unticked, positive). */
  depositsInTransitCents: number;
  /** Money out of the books the bank has not paid yet (unticked, negative). */
  outstandingPaymentsCents: number;
  /** Items dated after the month that the statement already shows (ticked). */
  recordedAfterMonthCents: number;
  adjustedBookCents: number;
  bankBalanceCents: number;
  differenceCents: number;
}

/**
 * The figures for the ticks so far, as the server counts them once they are saved: an unticked item dated in or before the
 * month is outstanding, a ticked item dated after the month is recorded after it.
 * difference = statement balance - (book balance - outstanding + recorded after the month).
 */
export function reconFigures(month: string, bookBalanceCents: number, bankBalanceCents: number, lines: readonly ReconBookLine[], ticked: ReadonlySet<number>): ReconFigures {
  const end = monthEnd(month);
  const outstanding = lines.filter((l) => !ticked.has(l.journalLineId) && l.date <= end);
  const recordedAfterMonthCents = sum(lines.filter((l) => ticked.has(l.journalLineId) && l.date > end));
  const adjustedBookCents = bookBalanceCents - sum(outstanding) + recordedAfterMonthCents;
  return {
    bookBalanceCents,
    depositsInTransitCents: sum(outstanding.filter((l) => l.amountCents > 0)),
    outstandingPaymentsCents: sum(outstanding.filter((l) => l.amountCents < 0)),
    recordedAfterMonthCents,
    adjustedBookCents,
    bankBalanceCents,
    differenceCents: bankBalanceCents - adjustedBookCents,
  };
}

export const figuresOf = (r: ReconReport, ticked: ReadonlySet<number>) => reconFigures(r.month, r.bookBalanceCents, r.bankBalanceCents, r.bookLines, ticked);

/** What the server has already cleared: the ticks a saved reconciliation starts with. */
export const savedTicks = (lines: readonly ReconBookLine[]): Set<number> => new Set(lines.filter((l) => l.state === 'cleared').map((l) => l.journalLineId));

/** The statement line made for a ticked item. Its date stays inside the statement month, whatever the item's date. */
export function statementLineFor(line: ReconBookLine, month: string): { date: string; description: string; amountCents: number } {
  const [first, last] = [`${month}-01`, monthEnd(month)];
  const date = line.date < first ? first : line.date > last ? last : line.date;
  const what = [line.documentNumber ?? line.journalNumber, line.date, line.memo].filter(Boolean).join(' · ');
  return { date, description: `${CLEARED_MARK}${what}`.slice(0, 200), amountCents: line.amountCents };
}

/** A cleared item this screen can untick: its match is one book line and one statement line that this screen made. */
export function ownMatch(report: Pick<ReconReport, 'statementLines' | 'bookLines'>, line: ReconBookLine): ReconStatementLine | null {
  if (line.state !== 'cleared' || line.matchNo === null) return null;
  const statement = report.statementLines.filter((s) => s.matchNo === line.matchNo);
  const books = report.bookLines.filter((b) => b.matchNo === line.matchNo);
  const only = statement[0];
  return statement.length === 1 && books.length === 1 && only!.description.startsWith(CLEARED_MARK) ? only! : null;
}

export interface TickPlan {
  /** Newly ticked items: get a statement line and a match. */
  tick: ReconBookLine[];
  /** Unticked items that were cleared: their match is undone. */
  untick: ReconBookLine[];
  /** Statement lines this screen made earlier that were left unmatched by a save that stopped half way. */
  leftovers: ReconStatementLine[];
}

export function tickPlan(report: ReconReport, ticked: ReadonlySet<number>): TickPlan {
  return {
    tick: report.bookLines.filter((l) => ticked.has(l.journalLineId) && l.state !== 'cleared' && l.amountCents !== 0),
    untick: report.bookLines.filter((l) => !ticked.has(l.journalLineId) && l.state === 'cleared'),
    leftovers: report.statementLines.filter((s) => !s.voided && s.matchNo === null && s.description.startsWith(CLEARED_MARK)),
  };
}

export const hasChanges = (report: ReconReport, ticked: ReadonlySet<number>) => {
  const plan = tickPlan(report, ticked);
  return plan.tick.length + plan.untick.length > 0;
};

/** Why the reconciliation cannot be finished yet; empty when it can. */
export function finishBlockers(report: ReconReport, figures: ReconFigures, ticked: ReadonlySet<number>): string[] {
  const out: string[] = [];
  if (report.status !== 'open') out.push('This reconciliation is finished.');
  if (hasChanges(report, ticked)) out.push('Save your ticks first.');
  else if (report.unmatchedStatementCount > 0) out.push(`${report.unmatchedStatementCount} statement line(s) typed outside this screen are not matched yet.`);
  if (figures.differenceCents !== 0) out.push('The difference must be zero.');
  return out;
}

/** The statement's ending balance as typed ("12,345.67", "-500"); undefined when it cannot be read. Blank is not zero. */
export function readBalance(text: string): number | undefined {
  if (!text.trim()) return undefined;
  try {
    const c = parsePesos(text);
    return Math.abs(c) <= 100_000_000_00 ? c : undefined;
  } catch {
    return undefined;
  }
}

export interface StartInput { bankId: string; date: string; balance: string; recons: readonly ReconRow[]; today: string; bankName?: string }
export interface StartCheck { errors: string[]; month?: string; endingBalanceCents?: number; bankId?: number }

/** The checks before a reconciliation is started, in the server's words: a real month, not in the future, after the bank's latest one. */
export function startCheck(i: StartInput): StartCheck {
  const errors: string[] = [];
  if (!i.bankId) errors.push('Pick the bank account.');
  if (!isBusinessDate(i.date)) errors.push('Type the statement date like 2026-09-30.');
  const balance = readBalance(i.balance);
  if (balance === undefined) errors.push("Type the statement's ending balance like 125,000.00 (use a minus sign if overdrawn).");
  const month = isBusinessDate(i.date) ? monthOf(i.date) : undefined;
  if (month && month > monthOf(i.today)) errors.push('That month has not started yet.');
  const latest = i.bankId ? latestOf(i.recons, Number(i.bankId)) : undefined;
  const name = i.bankName ?? latest?.bankName ?? 'This bank';
  if (month && latest?.status === 'open') errors.push(`Finish the ${latest.month} reconciliation of ${name} first.`);
  else if (month && latest && latest.month >= month) errors.push(`${name} already has a reconciliation for ${latest.month}. Months go in order.`);
  return errors.length > 0 ? { errors } : { errors, month: month!, endingBalanceCents: balance!, bankId: Number(i.bankId) };
}

/** The bank's latest reconciliation by month. */
export const latestOf = (recons: readonly ReconRow[], bankId: number): ReconRow | undefined =>
  recons.filter((r) => r.bankId === bankId).sort((a, b) => (a.month < b.month ? 1 : -1))[0];

/** Past reconciliations per bank (banks by name, newest month first) for the list. */
export function byBank(recons: readonly ReconRow[]): { bankId: number; bankName: string; rows: ReconRow[] }[] {
  const banks = new Map<number, { bankId: number; bankName: string; rows: ReconRow[] }>();
  for (const r of recons) {
    const b = banks.get(r.bankId) ?? { bankId: r.bankId, bankName: r.bankName, rows: [] };
    b.rows.push(r);
    banks.set(r.bankId, b);
  }
  return [...banks.values()].map((b) => ({ ...b, rows: b.rows.sort((x, y) => (x.month < y.month ? 1 : -1)) })).sort((a, b) => a.bankName.localeCompare(b.bankName));
}

/** The bank adjustment form opened from a reconciliation: the bank, the reconciliation to come back to, and the statement day (or today, if the month is not over). */
export function adjustmentLink(recon: Pick<ReconReport, 'id' | 'bankId' | 'month'>, today: string): string {
  const end = monthEnd(recon.month);
  const q = new URLSearchParams({ bank: String(recon.bankId), recon: recon.id, date: end < today ? end : today });
  return `/docs/cash.bank_adj/new?${q}`;
}
