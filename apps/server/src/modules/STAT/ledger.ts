/**
 * The statutory payables of a contribution month, read from the ledger (PLAN D1, E11). A payroll run credits SSS,
 * PhilHealth, Pag-IBIG and withholding tax per employee, tagged with its month M (PAY-RUN); an opening statutory
 * payable (OBST-, stat.opening) credits the same accounts for a month on or before the cut-over date; a remittance
 * (REM-) debits the same month. So the month's payable per employee is the net of the journals of its runs, its
 * openings and its remittances, reversals included: positive is still to remit, negative is remitted more than the
 * payrolls and openings now show (a run cancelled after its month was remitted, PLAN D6).
 * SSS and Pag-IBIG also have a loan part: the runs (and openings) credit 2404 / 2405 with the month's loan
 * amortizations ("SSS loan 2026-10"), and the same remittance pays them, so an agency's payable is its contributions
 * plus its loans.
 * A posted 13th-month pay (TH13-, pay.thirteenth) also credits 2310 for its own month M (its document date), on the
 * part of the year's 13th-month pay above the ₱90,000 ceiling; it counts in month M's withholding-tax payable like a
 * run or an opening does.
 * Year-end tax refunds (K23, PLAN F3, BIR RR 11-2018): a year-end run refunds over-withheld tax with Dr 2310 for the
 * employee, so an employee's 2310 for the month can be below zero. For the withholding tax only, the month's payable is
 * the net: tax withheld less year-end refunds (`wtaxPosition`). A refund is the part of an employee's negative that the
 * month's recorded runs refunded and no remittance took off yet; anything below zero beyond it is still remitted more
 * than the payrolls show (D6). When the refunds are more than the month's tax, the month has nothing to remit and the
 * excess is taken off the next month's withholding-tax remittance (`carriedInto`), which settles the earlier month too:
 * its journal debits that month's employees still owing and credits its refunds. Those lines are listed per month
 * settled (stat_remittance_adjustments, migration 0004), so each of them counts in the month it settles.
 */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { employee } from '../EMP/public.ts';
import { LOAN_ACCOUNT, payOfMonth, payrollMonths, runsOfMonth, thirteenthMonths, thirteenthsOfMonth } from '../PAY/public.ts';

export const SCHEMES = ['SSS', 'PHIC', 'HDMF', 'WTAX'] as const;
export type Scheme = (typeof SCHEMES)[number];
/** The payable's role key, its name for staff, the tag PAY-RUN puts on its lines ("SSS 2026-09"), and its loan part. */
export const SCHEME: Record<Scheme, { role: string; label: string; tag: string; loan?: { role: string; tag: string } }> = {
  SSS: { role: 'SSS_PAYABLE', label: 'SSS', tag: 'SSS', loan: LOAN_ACCOUNT.SSS },
  PHIC: { role: 'PHIC_PAYABLE', label: 'PhilHealth', tag: 'PhilHealth' },
  HDMF: { role: 'HDMF_PAYABLE', label: 'Pag-IBIG', tag: 'Pag-IBIG', loan: LOAN_ACCOUNT.HDMF },
  WTAX: { role: 'WTC_PAYABLE', label: 'Withholding tax (1601-C)', tag: 'Withholding tax' },
};
/** The contributions (or tax) part of a scheme's payable, or its loan part (SSS and Pag-IBIG). */
export type Part = 'contribution' | 'loan';
export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Opening statutory payables (OBST-, stat.opening) of a contribution month: their journals credit it like a run's. */
function openingsOfMonth(db: Db, month: string): { id: string }[] {
  return db.prepare('SELECT document_id AS id FROM stat_openings WHERE month = ?').all(month) as { id: string }[];
}

export interface Remittance { id: string; number: string; status: 'posted' | 'cancelled'; postedAt: string; amountCents: number }
/** The remittances of a scheme and month, recorded or cancelled, oldest first. */
export function remittancesOf(db: Db, scheme: Scheme, month: string): Remittance[] {
  return db
    .prepare(
      `SELECT d.id, d.number, d.status, d.posted_at AS postedAt, s.amount_cents AS amountCents FROM stat_remittances s JOIN documents d ON d.id = s.document_id
       WHERE s.scheme = ? AND s.month = ? ORDER BY d.number`,
    )
    .all(scheme, month) as Remittance[];
}

/**
 * The remittances that settle a scheme's month, recorded or cancelled, oldest first: its own, and a later month's
 * withholding-tax remittance that took this month's year-end refunds off (`month` is then that remittance's own month).
 */
export function remittancesFor(db: Db, scheme: Scheme, month: string): (Remittance & { month: string })[] {
  const later =
    scheme === 'WTAX'
      ? (db
          .prepare(
            `SELECT DISTINCT d.id, d.number, d.status, d.posted_at AS postedAt, s.amount_cents AS amountCents, s.month FROM stat_remittance_adjustments a
             JOIN stat_remittances s ON s.document_id = a.document_id JOIN documents d ON d.id = s.document_id WHERE a.month = ? AND s.month <> a.month`,
          )
          .all(month) as (Remittance & { month: string })[])
      : [];
  return [...remittancesOf(db, scheme, month).map((r) => ({ ...r, month })), ...later].sort((a, b) => a.number.localeCompare(b.number));
}

/** The scheme's accounts: its payable, and for SSS and Pag-IBIG the loan payable. */
export function schemeAccounts(db: Db, scheme: Scheme): { id: number; part: Part }[] {
  const loan = SCHEME[scheme].loan;
  return [{ id: resolveAccount(db, { role: SCHEME[scheme].role }).id, part: 'contribution' as Part }, ...(loan ? [{ id: resolveAccount(db, { role: loan.role }).id, part: 'loan' as Part }] : [])];
}

/** Net credit per source document, employee and part on the scheme's accounts, over the given documents' journals. */
function netBySource(db: Db, scheme: Scheme, sourceIds: string[]): { sourceId: string; employeeId: string; part: Part; cents: number }[] {
  if (!sourceIds.length) return [];
  const accounts = schemeAccounts(db, scheme);
  const partOf = new Map(accounts.map((a) => [a.id, a.part]));
  return (
    db
      .prepare(
        `SELECT j.source_id AS sourceId, l.party_id AS employeeId, l.account_id AS accountId, SUM(l.credit_cents - l.debit_cents) AS cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
         WHERE l.account_id IN (SELECT value FROM json_each(?)) AND j.sealed = 1 AND j.source_type = 'document' AND j.source_id IN (SELECT value FROM json_each(?)) GROUP BY 1, 2, 3`,
      )
      .all(JSON.stringify(accounts.map((a) => a.id)), JSON.stringify(sourceIds)) as { sourceId: string; employeeId: string; accountId: number; cents: number }[]
  ).map(({ accountId, ...x }) => ({ ...x, part: partOf.get(accountId)! }));
}

const sourcesOf = (db: Db, scheme: Scheme, month: string) => [
  ...runsOfMonth(db, month).map((r) => r.id),
  ...openingsOfMonth(db, month).map((r) => r.id),
  ...thirteenthsOfMonth(db, month).map((r) => r.id),
  ...remittancesOf(db, scheme, month).map((r) => r.id),
];

/**
 * The month's net credit per source document, employee and part, with a withholding-tax remittance's lines put in the
 * month they settle: the lines of this month's remittances that settle an earlier month are taken out, and the lines of
 * a later month's remittances that settle this month are put in (stat_remittance_adjustments, recorded ones only: a
 * cancelled remittance's journal and its reversal net to zero).
 */
function monthEntries(db: Db, scheme: Scheme, month: string): { sourceId: string; employeeId: string; part: Part; cents: number }[] {
  const entries = netBySource(db, scheme, sourcesOf(db, scheme, month));
  if (scheme !== 'WTAX') return entries;
  const moved = db
    .prepare(
      `SELECT a.document_id AS sourceId, a.employee_id AS employeeId, a.credit_cents - a.debit_cents AS cents, a.month = @m AS settles FROM stat_remittance_adjustments a
       JOIN stat_remittances s ON s.document_id = a.document_id JOIN documents d ON d.id = a.document_id
       WHERE d.status = 'posted' AND a.month <> s.month AND (a.month = @m OR s.month = @m)`,
    )
    .all({ m: month }) as { sourceId: string; employeeId: string; cents: number; settles: 0 | 1 }[];
  return [...entries, ...moved.map((x) => ({ sourceId: x.sourceId, employeeId: x.employeeId, part: 'contribution' as Part, cents: x.settles ? x.cents : -x.cents }))];
}

/** The month's payable per employee, contributions and loans together (see the top of this file). */
export function payableByEmployee(db: Db, scheme: Scheme, month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of monthEntries(db, scheme, month)) out.set(x.employeeId, (out.get(x.employeeId) ?? 0) + x.cents);
  return out;
}

/** The month's payable per employee and part (contributions, loans), in that order per employee. */
export function payableByPart(db: Db, scheme: Scheme, month: string): { employeeId: string; part: Part; cents: number }[] {
  const out = new Map<string, { employeeId: string; part: Part; cents: number }>();
  for (const x of monthEntries(db, scheme, month)) {
    const key = `${x.employeeId}|${x.part}`;
    out.set(key, { employeeId: x.employeeId, part: x.part, cents: (out.get(key)?.cents ?? 0) + x.cents });
  }
  return [...out.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || (a.part === 'contribution' ? -1 : 1));
}

/**
 * One employee's withholding tax for a month: the net on 2310 (`cents`, below zero after a year-end refund), and of a
 * net below zero the year-end refund not yet taken off by a remittance (`refundCents`) and the rest, remitted more than
 * the payrolls now show (`overCents`, D6).
 */
export interface WtaxRow { employeeId: string; cents: number; refundCents: number; overCents: number }
/**
 * A month's withholding tax to remit: the employees still owing (`owingCents`), less the year-end refunds not yet taken
 * off (`refundCents`), is `dueCents` (zero or less when the refunds are more). `touched`: the month has lines on 2310.
 */
export interface WtaxPosition { month: string; rows: WtaxRow[]; owingCents: number; refundCents: number; overCents: number; dueCents: number; touched: boolean }

export function wtaxPosition(db: Db, month: string): WtaxPosition {
  const entries = monthEntries(db, 'WTAX', month);
  const net = new Map<string, number>();
  for (const x of entries) net.set(x.employeeId, (net.get(x.employeeId) ?? 0) + x.cents);
  const refunded = new Map(payOfMonth(db, month).map((p) => [p.employeeId, p.wtaxRefundCents]));
  const taken = new Map(
    db
      .prepare(
        `SELECT a.employee_id, SUM(a.credit_cents) FROM stat_remittance_adjustments a JOIN documents d ON d.id = a.document_id
         WHERE d.status = 'posted' AND a.month = ? GROUP BY 1`,
      )
      .raw()
      .all(month) as [string, number][],
  );
  const rows = [...net]
    .filter(([, cents]) => cents !== 0)
    .map(([employeeId, cents]): WtaxRow => {
      const open = Math.max(0, (refunded.get(employeeId) ?? 0) - (taken.get(employeeId) ?? 0));
      const refundCents = cents < 0 ? Math.min(-cents, open) : 0;
      return { employeeId, cents, refundCents, overCents: cents < 0 ? -cents - refundCents : 0 };
    });
  const total = (f: (r: WtaxRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const owingCents = total((r) => Math.max(0, r.cents));
  const refundCents = total((r) => r.refundCents);
  return { month, rows, owingCents, refundCents, overCents: total((r) => r.overCents), dueCents: owingCents - refundCents, touched: entries.length > 0 };
}

/**
 * The earlier months whose year-end refunds were more than their tax withheld, carried into `month`'s withholding-tax
 * remittance (oldest first), and what they come to (`cents`, zero or less). Walking back over the months with payrolls
 * or remittances (up to 24), a month with no 2310 lines is skipped and one with nothing left on 2310 ends the walk.
 * From the oldest: a month with open refunds (or an excess carried into it) whose net is zero or less carries on to
 * the next; a month left with tax to remit takes the carry off its own remittance and carries nothing on.
 */
export function carriedInto(db: Db, month: string): { months: WtaxPosition[]; cents: number } {
  const walked: WtaxPosition[] = [];
  for (const m of statMonths(db).filter((x) => x < month).slice(0, 24)) {
    const p = wtaxPosition(db, m);
    if (!p.touched) continue;
    if (p.owingCents === 0 && p.refundCents === 0) break;
    walked.push(p);
  }
  let chain: WtaxPosition[] = [];
  let carry = 0;
  for (const p of walked.reverse()) {
    const total = p.dueCents + carry;
    if (total <= 0 && (p.refundCents > 0 || carry < 0)) [chain, carry] = [[...chain, p], total];
    else [chain, carry] = [[], 0];
  }
  return { months: chain, cents: carry };
}

/** What a remittance of the month offers now: every employee still owing (SSS, PhilHealth, Pag-IBIG), or the net withholding tax. */
export function dueOf(db: Db, scheme: Scheme, month: string): number {
  if (scheme !== 'WTAX') return payableByPart(db, scheme, month).reduce((s, p) => s + Math.max(0, p.cents), 0);
  return Math.max(0, wtaxPosition(db, month).dueCents + carriedInto(db, month).cents);
}

export interface SchemeCheck {
  scheme: Scheme; label: string;
  /** Payable recorded by the month's payrolls (cancelled runs net to zero), remitted, and what is left (recorded − remitted), loans included. */
  recordedCents: number; remittedCents: number; balanceCents: number;
  /** The loan part of those (SSS and Pag-IBIG loan amortizations; 0 for PhilHealth and the BIR). */
  loanRecordedCents: number; loanRemittedCents: number;
  /** What a remittance of the month offers now (never below zero): for the withholding tax, the net of year-end refunds. */
  dueCents: number;
  /**
   * Withholding tax only (0 otherwise): the year-end tax refunds of the month's payrolls (recordedCents is net of them)
   * and the part not yet taken off by a remittance; an earlier month's excess refunds to take off this month's
   * remittance (and those months); and this month's excess refunds to take off the next month's remittance.
   */
  refundCents: number; refundOpenCents: number; carriedInCents: number; carriedFrom: string[]; carriedOutCents: number;
  /** The remittances that settle the month; `month` is set on a later month's remittance that took this month's refunds off. */
  remittances: { id: string; number: string; amountCents: number; month?: string }[];
  /** D6: runs of the month cancelled after a remittance of the month was recorded. */
  cancelledAfter: { id: string; number: string; cancelledAt: string }[];
  /** Employees remitted more than the payrolls now show for them, per part (never a year-end tax refund). */
  overRemitted: { employeeId: string; name: string; part: Part; cents: number }[];
}

/** The remittance check of a month for one scheme (D5 STAT-REM "payable for month M vs amount paid"). */
export function schemeCheck(db: Db, scheme: Scheme, month: string): SchemeCheck {
  const runs = runsOfMonth(db, month);
  const openings = openingsOfMonth(db, month);
  const thirteenths = thirteenthsOfMonth(db, month);
  const rems = remittancesFor(db, scheme, month);
  const net = monthEntries(db, scheme, month);
  const runIds = new Set([...runs.map((r) => r.id), ...openings.map((o) => o.id), ...thirteenths.map((t) => t.id)]);
  const sum = (f: (x: (typeof net)[number]) => boolean) => net.filter(f).reduce((s, x) => s + x.cents, 0);
  const recorded = sum((x) => runIds.has(x.sourceId));
  const remitted = 0 - sum((x) => !runIds.has(x.sourceId));
  const loanRecorded = sum((x) => x.part === 'loan' && runIds.has(x.sourceId));
  const loanRemitted = 0 - sum((x) => x.part === 'loan' && !runIds.has(x.sourceId));
  const posted = rems.filter((r) => r.status === 'posted');
  // Runs whose reversal was written after the first recorded remittance (journal order, not the clock), if the run's
  // original journal credited the scheme at all.
  const after = new Set(
    (db
      .prepare(
        `SELECT j.source_id FROM journals j
         WHERE j.source_type = 'document' AND j.posting_kind = 'reversal' AND j.source_id IN (SELECT value FROM json_each(@runs))
           AND j.rowid > (SELECT MIN(r.rowid) FROM journals r WHERE r.source_type = 'document' AND r.posting_kind = 'original' AND r.source_id IN (SELECT value FROM json_each(@rems)))
           AND EXISTS (SELECT 1 FROM journals o JOIN journal_lines l ON l.journal_id = o.id
                       WHERE o.source_type = 'document' AND o.source_id = j.source_id AND o.posting_kind = 'original' AND l.account_id IN (SELECT value FROM json_each(@accounts)) AND l.credit_cents > 0)`,
      )
      .pluck()
      .all({ runs: JSON.stringify(runs.map((r) => r.id)), rems: JSON.stringify(posted.map((r) => r.id)), accounts: JSON.stringify(schemeAccounts(db, scheme).map((a) => a.id)) }) as string[]),
  );
  const byEmployee = new Map<string, { employeeId: string; part: Part; cents: number }>();
  for (const x of net) {
    const key = `${x.employeeId}|${x.part}`;
    byEmployee.set(key, { employeeId: x.employeeId, part: x.part, cents: (byEmployee.get(key)?.cents ?? 0) + x.cents });
  }
  // The withholding tax's negatives are year-end refunds up to what the runs refunded and no remittance took off yet.
  const wtax = scheme === 'WTAX' ? wtaxPosition(db, month) : undefined;
  const carried = wtax ? carriedInto(db, month) : { months: [], cents: 0 };
  const overOf = new Map(wtax?.rows.map((r) => [`${r.employeeId}|contribution`, r.overCents]));
  const refundCents = wtax ? payOfMonth(db, month).reduce((s, p) => s + p.wtaxRefundCents, 0) : 0;
  const netDue = wtax ? wtax.dueCents + carried.cents : 0;
  return {
    scheme, label: SCHEME[scheme].label, recordedCents: recorded, remittedCents: remitted, balanceCents: recorded - remitted, loanRecordedCents: loanRecorded, loanRemittedCents: loanRemitted,
    dueCents: wtax ? Math.max(0, netDue) : [...byEmployee.values()].reduce((s, x) => s + Math.max(0, x.cents), 0),
    refundCents, refundOpenCents: wtax?.refundCents ?? 0, carriedInCents: 0 - carried.cents, carriedFrom: carried.months.map((p) => p.month),
    carriedOutCents: wtax && wtax.refundCents > 0 && netDue < 0 ? -netDue : 0,
    remittances: posted.map((r) => ({ id: r.id, number: r.number, amountCents: r.amountCents, ...(r.month !== month ? { month: r.month } : {}) })),
    cancelledAfter: runs.filter((r) => after.has(r.id)).map((r) => ({ id: r.id, number: r.number, cancelledAt: r.cancelledAt! })),
    overRemitted: [...byEmployee.values()]
      .map((x) => ({ ...x, cents: overOf.get(`${x.employeeId}|${x.part}`) ?? Math.max(0, -x.cents) }))
      .filter((x) => x.cents > 0)
      .map((x) => ({ employeeId: x.employeeId, name: employee(db, x.employeeId)?.name ?? '?', part: x.part, cents: x.cents }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.part.localeCompare(b.part)),
  };
}

/**
 * D6: the schemes a recorded document (a payroll run for its contribution month, or a 13th-month pay for its own
 * document month) credited whose month is already remitted. Cancelling it would leave those payables below zero
 * (remitted more than the payrolls and 13th-month pays then show), so the document's screen warns before the cancel.
 */
export function remittedForRun(db: Db, documentId: string, month: string): { scheme: Scheme; label: string; numbers: string[] }[] {
  return SCHEMES.flatMap((scheme) => {
    const numbers = remittancesFor(db, scheme, month).filter((r) => r.status === 'posted').map((r) => r.number);
    const credited = netBySource(db, scheme, [documentId]).reduce((s, x) => s + x.cents, 0) > 0;
    return numbers.length && credited ? [{ scheme, label: SCHEME[scheme].label, numbers }] : [];
  });
}

/** Months with payrolls, 13th-month pays, opening statutory payables or remittances, newest first. */
export function statMonths(db: Db): string[] {
  const open = db.prepare('SELECT DISTINCT month FROM stat_openings').pluck().all() as string[];
  const rem = db.prepare('SELECT DISTINCT month FROM stat_remittances').pluck().all() as string[];
  return [...new Set([...payrollMonths(db), ...thirteenthMonths(db), ...open, ...rem])].sort().reverse();
}
