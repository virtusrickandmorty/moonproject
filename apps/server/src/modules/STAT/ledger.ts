/**
 * The statutory payables of a contribution month, read from the ledger (PLAN D1, E11). A payroll run credits SSS,
 * PhilHealth, Pag-IBIG and withholding tax per employee, tagged with its month M (PAY-RUN); a remittance (REM-) debits
 * the same month. So the month's payable per employee is the net of the journals of its runs and its remittances,
 * reversals included: positive is still to remit, negative is remitted more than the payrolls now show (a run cancelled
 * after its month was remitted, PLAN D6).
 * SSS and Pag-IBIG also have a loan part: the runs credit 2404 / 2405 with the month's loan amortizations ("SSS loan
 * 2026-10"), and the same remittance pays them, so an agency's payable is its contributions plus its loans.
 */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { employee } from '../EMP/public.ts';
import { LOAN_ACCOUNT, payrollMonths, runsOfMonth } from '../PAY/public.ts';

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

const sourcesOf = (db: Db, scheme: Scheme, month: string) => [...runsOfMonth(db, month).map((r) => r.id), ...remittancesOf(db, scheme, month).map((r) => r.id)];

/** The month's payable per employee, contributions and loans together (see the top of this file). */
export function payableByEmployee(db: Db, scheme: Scheme, month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of netBySource(db, scheme, sourcesOf(db, scheme, month))) out.set(x.employeeId, (out.get(x.employeeId) ?? 0) + x.cents);
  return out;
}

/** The month's payable per employee and part (contributions, loans), in that order per employee. */
export function payableByPart(db: Db, scheme: Scheme, month: string): { employeeId: string; part: Part; cents: number }[] {
  const out = new Map<string, { employeeId: string; part: Part; cents: number }>();
  for (const x of netBySource(db, scheme, sourcesOf(db, scheme, month))) {
    const key = `${x.employeeId}|${x.part}`;
    out.set(key, { employeeId: x.employeeId, part: x.part, cents: (out.get(key)?.cents ?? 0) + x.cents });
  }
  return [...out.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || (a.part === 'contribution' ? -1 : 1));
}

export interface SchemeCheck {
  scheme: Scheme; label: string;
  /** Payable recorded by the month's payrolls (cancelled runs net to zero), remitted, and what is left (recorded − remitted), loans included. */
  recordedCents: number; remittedCents: number; balanceCents: number;
  /** The loan part of those (SSS and Pag-IBIG loan amortizations; 0 for PhilHealth and the BIR). */
  loanRecordedCents: number; loanRemittedCents: number;
  remittances: { id: string; number: string; amountCents: number }[];
  /** D6: runs of the month cancelled after a remittance of the month was recorded. */
  cancelledAfter: { id: string; number: string; cancelledAt: string }[];
  /** Employees remitted more than the payrolls now show for them, per part. */
  overRemitted: { employeeId: string; name: string; part: Part; cents: number }[];
}

/** The remittance check of a month for one scheme (D5 STAT-REM "payable for month M vs amount paid"). */
export function schemeCheck(db: Db, scheme: Scheme, month: string): SchemeCheck {
  const runs = runsOfMonth(db, month);
  const rems = remittancesOf(db, scheme, month);
  const net = netBySource(db, scheme, [...runs.map((r) => r.id), ...rems.map((r) => r.id)]);
  const runIds = new Set(runs.map((r) => r.id));
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
  return {
    scheme, label: SCHEME[scheme].label, recordedCents: recorded, remittedCents: remitted, balanceCents: recorded - remitted, loanRecordedCents: loanRecorded, loanRemittedCents: loanRemitted,
    remittances: posted.map((r) => ({ id: r.id, number: r.number, amountCents: r.amountCents })),
    cancelledAfter: runs.filter((r) => after.has(r.id)).map((r) => ({ id: r.id, number: r.number, cancelledAt: r.cancelledAt! })),
    overRemitted: [...byEmployee.values()]
      .filter((x) => x.cents < 0)
      .map((x) => ({ employeeId: x.employeeId, name: employee(db, x.employeeId)?.name ?? '?', part: x.part, cents: -x.cents }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.part.localeCompare(b.part)),
  };
}

/**
 * D6: the schemes a recorded payroll run credited whose month is already remitted. Cancelling the run would leave those
 * payables below zero (remitted more than the payrolls then show), so the run's screen warns before the cancel.
 */
export function remittedForRun(db: Db, runId: string, month: string): { scheme: Scheme; label: string; numbers: string[] }[] {
  return SCHEMES.flatMap((scheme) => {
    const numbers = remittancesOf(db, scheme, month).filter((r) => r.status === 'posted').map((r) => r.number);
    const credited = netBySource(db, scheme, [runId]).reduce((s, x) => s + x.cents, 0) > 0;
    return numbers.length && credited ? [{ scheme, label: SCHEME[scheme].label, numbers }] : [];
  });
}

/** Months with payrolls or remittances, newest first. */
export function statMonths(db: Db): string[] {
  const rem = db.prepare('SELECT DISTINCT month FROM stat_remittances').pluck().all() as string[];
  return [...new Set([...payrollMonths(db), ...rem])].sort().reverse();
}
