/**
 * Government loans (PLAN D5 PAY-RUN 2404/2405, E11, F3): the register of SSS and Pag-IBIG loans per employee, and where
 * a loan stands in a month for the payroll run. Master data: changed in place with If-Match and an audit row, never
 * deleted; a loan paid off early is stopped from a month with a reason. Payroll runs deduct the monthly amortization once
 * a month (run-calc.ts); what is left of a loan is its amortization times its months, less what recorded runs deducted.
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { employee } from '../EMP/public.ts';

export const LOAN_KINDS = ['SSS_SALARY', 'SSS_CALAMITY', 'HDMF_MPL', 'HDMF_CALAMITY'] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export type Agency = 'SSS' | 'HDMF';
export const KIND_LABEL: Record<LoanKind, string> = {
  SSS_SALARY: 'SSS salary loan', SSS_CALAMITY: 'SSS calamity loan', HDMF_MPL: 'Pag-IBIG multi-purpose loan', HDMF_CALAMITY: 'Pag-IBIG calamity loan',
};
export const agencyOf = (kind: LoanKind): Agency => (kind.startsWith('SSS') ? 'SSS' : 'HDMF');
/** The payable's role and the tag its lines carry ("SSS loan 2026-10"), the way PAY-RUN tags contributions. */
export const LOAN_ACCOUNT: Record<Agency, { role: string; tag: string }> = { SSS: { role: 'SSS_LOAN_PAYABLE', tag: 'SSS loan' }, HDMF: { role: 'HDMF_LOAN_PAYABLE', tag: 'Pag-IBIG loan' } };

const MAX_CENTS = 1_000_000_00;
export const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const month = z.string().refine(isMonth, 'Use a month like 2026-10.');
/** Months from `from` to `to`, both counted (0 if `to` is before `from`). */
export const monthsBetween = (from: string, to: string) => Math.max(0, +to.slice(0, 4) * 12 + +to.slice(5, 7) - (+from.slice(0, 4) * 12 + +from.slice(5, 7)) + 1);

const fields = {
  loanNo: z.string().trim().regex(/^[0-9A-Za-z-]{3,30}$/, 'Type the loan number with letters, digits and dashes only.'),
  amortizationCents: z.number().int().positive().max(MAX_CENTS),
  firstMonth: month,
  lastMonth: month,
  note: z.string().trim().min(1).max(300).nullable(),
};
export const loanInput = z.object({ employeeId: z.uuid(), kind: z.enum(LOAN_KINDS), ...fields }).partial({ note: true }).strict();
export const loanUpdate = z.object(fields).partial().strict();
export const stopInput = z.object({ fromMonth: month, reason: z.string().trim().min(10).max(300) }).strict();

export interface GovLoan {
  id: string; employeeId: string; employeeName: string; employeeCode: string; kind: LoanKind; agency: Agency; loanNo: string; amortizationCents: number;
  firstMonth: string; lastMonth: string; stoppedFrom: string | null; stopReason: string | null; note: string | null; version: number; createdAt: string; updatedAt: string;
}
/** A loan with what recorded payroll runs deducted and what is left. */
export interface LoanRow extends GovLoan {
  scheduledCents: number; deductedCents: number; leftCents: number; lastDeductedMonth: string | null;
  status: 'not_started' | 'running' | 'ended' | 'stopped';
}

const LOAN = `SELECT l.id, l.employee_id AS employeeId, e.full_name AS employeeName, e.code AS employeeCode, l.kind, l.agency, l.loan_no AS loanNo,
  l.amortization_cents AS amortizationCents, l.first_month AS firstMonth, l.last_month AS lastMonth, l.stopped_from AS stoppedFrom, l.stop_reason AS stopReason,
  l.note, l.version, l.created_at AS createdAt, l.updated_at AS updatedAt FROM pay_gov_loans l JOIN emp_employees e ON e.id = l.employee_id`;

export const govLoan = (db: Db, id: string): GovLoan | undefined => db.prepare(`${LOAN} WHERE l.id = ?`).get(id) as GovLoan | undefined;
/** An employee's loans, oldest first. */
export const loansOf = (db: Db, employeeId: string): GovLoan[] => db.prepare(`${LOAN} WHERE l.employee_id = ? ORDER BY l.first_month, l.created_at, l.id`).all(employeeId) as GovLoan[];

const POSTED_DEDUCTIONS = `FROM pay_run_loans x JOIN pay_run_employees e ON e.id = x.run_employee_id JOIN pay_runs r ON r.document_id = e.document_id
  JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND x.loan_id = ?`;

/** What recorded (not cancelled) runs deducted from a loan, and the last month they deducted anything. */
function deducted(db: Db, loanId: string): { cents: number; lastMonth: string | null; firstMonth: string | null } {
  return db
    .prepare(`SELECT COALESCE(SUM(x.amount_cents), 0) AS cents, MAX(CASE WHEN x.amount_cents > 0 THEN r.contribution_month END) AS lastMonth,
      MIN(CASE WHEN x.amount_cents > 0 THEN r.contribution_month END) AS firstMonth ${POSTED_DEDUCTIONS}`)
    .get(loanId) as { cents: number; lastMonth: string | null; firstMonth: string | null };
}

export const scheduledOf = (l: Pick<GovLoan, 'amortizationCents' | 'firstMonth' | 'lastMonth'>) => l.amortizationCents * monthsBetween(l.firstMonth, l.lastMonth);
/** Whether the loan is deducted in a month: between its first and last month, and not stopped before it. */
export function runsIn(l: Pick<GovLoan, 'firstMonth' | 'lastMonth' | 'stoppedFrom'>, m: string): 'running' | 'not_started' | 'ended' | 'stopped' {
  if (l.stoppedFrom && m >= l.stoppedFrom) return 'stopped';
  if (m < l.firstMonth) return 'not_started';
  return m > l.lastMonth ? 'ended' : 'running';
}

export function withTotals(db: Db, l: GovLoan, today: string): LoanRow {
  const d = deducted(db, l.id);
  const scheduledCents = scheduledOf(l);
  const leftCents = Math.max(0, scheduledCents - d.cents);
  const state = runsIn(l, today.slice(0, 7));
  return { ...l, scheduledCents, deductedCents: d.cents, leftCents, lastDeductedMonth: d.lastMonth, status: state === 'running' && leftCents === 0 ? 'ended' : state };
}

export function listLoans(db: Db, q: { employeeId?: string; status?: 'open' | 'all' }, today: string): LoanRow[] {
  const rows = (q.employeeId ? loansOf(db, q.employeeId) : (db.prepare(`${LOAN} ORDER BY e.full_name, l.first_month, l.id`).all() as GovLoan[])).map((l) => withTotals(db, l, today));
  return q.status === 'all' ? rows : rows.filter((r) => r.status === 'running' || r.status === 'not_started');
}

/**
 * Where a loan stands for a payroll of contribution month `m`: whether it runs that month, what is left before this run,
 * and what recorded runs of that month already did with it (a row, even ₱0 skipped, means the month is handled).
 */
export function loanInMonth(db: Db, l: GovLoan, m: string): { state: ReturnType<typeof runsIn>; leftCents: number; handled: boolean; takenBy: string | null } {
  const rows = db.prepare(`SELECT d.number, x.amount_cents AS cents ${POSTED_DEDUCTIONS} AND r.contribution_month = ? ORDER BY d.number`).all(l.id, m) as { number: string; cents: number }[];
  return { state: runsIn(l, m), leftCents: Math.max(0, scheduledOf(l) - deducted(db, l.id).cents), handled: rows.length > 0, takenBy: rows.find((r) => r.cents > 0)?.number ?? null };
}

export interface Who { userId: string; at: string; today: string }

function checkVersion(ifMatch: unknown, version: number) {
  if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Reload this loan before saving.', 428);
  if (Number(ifMatch) !== version) throw conflict('VERSION_CHANGED', 'Someone changed this loan. Reload and check their changes.');
}
function mustGet(db: Db, id: string): GovLoan {
  const l = govLoan(db, id);
  if (!l) throw notFound('The loan');
  return l;
}
function checkMonths(first: string, last: string, today: string) {
  if (last < first) throw badRequest('BAD_MONTH', 'The last month cannot be before the first month.');
  if (last < today.slice(0, 7)) throw badRequest('NO_MONTHS_LEFT', `The last month (${last}) has passed, so nothing is left to deduct. A loan paid off needs no entry here.`);
}
function checkNumber(db: Db, agency: Agency, loanNo: string, except?: string) {
  const other = db.prepare('SELECT id FROM pay_gov_loans WHERE agency = ? AND loan_no = ? AND stopped_from IS NULL AND id IS NOT ?').get(agency, loanNo, except ?? null);
  if (other) throw conflict('DUPLICATE_LOAN', `${agency === 'SSS' ? 'SSS' : 'Pag-IBIG'} loan ${loanNo} is already registered.`);
}

/** Registers a loan. Call inside a transaction. */
export function registerLoan(db: Db, raw: unknown, who: Who): GovLoan {
  const v = loanInput.parse(raw);
  const e = employee(db, v.employeeId);
  if (!e) throw notFound('The employee');
  if (!e.active) throw conflict('SEPARATED', `${e.name} is separated.`);
  checkMonths(v.firstMonth, v.lastMonth, who.today);
  const agency = agencyOf(v.kind);
  checkNumber(db, agency, v.loanNo);
  const id = newId();
  db.prepare(
    `INSERT INTO pay_gov_loans (id, employee_id, kind, agency, loan_no, amortization_cents, first_month, last_month, note, created_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, v.employeeId, v.kind, agency, v.loanNo, v.amortizationCents, v.firstMonth, v.lastMonth, v.note ?? null, who.at, who.userId, who.at);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'pay.gov_loan.register', entityType: 'pay.gov_loan', entityId: id, data: { ...v, agency } });
  return mustGet(db, id);
}

/**
 * Changes a loan (If-Match): number, amortization, months, note. Runs already recorded keep what they deducted, so the
 * months cannot be moved past a month already deducted.
 */
export function updateLoan(db: Db, id: string, ifMatch: unknown, raw: unknown, who: Who): GovLoan {
  const v = loanUpdate.parse(raw);
  const before = mustGet(db, id);
  checkVersion(ifMatch, before.version);
  if (before.stoppedFrom) throw conflict('STOPPED', `This loan was stopped from ${before.stoppedFrom}, so it is kept as it was.`);
  const changes = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && x !== before[k as keyof GovLoan]));
  if (!Object.keys(changes).length) throw badRequest('NO_CHANGES', 'Enter a change before saving.');
  const first = v.firstMonth ?? before.firstMonth;
  const last = v.lastMonth ?? before.lastMonth;
  if (last < first) throw badRequest('BAD_MONTH', 'The last month cannot be before the first month.');
  const d = deducted(db, id);
  if (d.firstMonth && first > d.firstMonth) throw conflict('DEDUCTED', `Payroll deducted this loan in ${d.firstMonth}, so the first month cannot be later.`);
  if (d.lastMonth && last < d.lastMonth) throw conflict('DEDUCTED', `Payroll deducted this loan in ${d.lastMonth}, so the last month cannot be earlier.`);
  if (v.loanNo) checkNumber(db, before.agency, v.loanNo, id);
  db.prepare('UPDATE pay_gov_loans SET loan_no = ?, amortization_cents = ?, first_month = ?, last_month = ?, note = ?, version = version + 1, updated_at = ? WHERE id = ?').run(
    v.loanNo ?? before.loanNo, v.amortizationCents ?? before.amortizationCents, first, last, v.note !== undefined ? v.note : before.note, who.at, id,
  );
  appendAudit(db, {
    at: who.at, userId: who.userId, action: 'pay.gov_loan.update', entityType: 'pay.gov_loan', entityId: id,
    data: { changes: Object.fromEntries(Object.entries(changes).map(([k, x]) => [k, { before: before[k as keyof GovLoan], after: x }])) },
  });
  return mustGet(db, id);
}

/** Stops a loan from a month (paid off early), with a reason (If-Match). Months already deducted stay deducted. */
export function stopLoan(db: Db, id: string, ifMatch: unknown, raw: unknown, who: Who): GovLoan {
  const v = stopInput.parse(raw);
  const l = mustGet(db, id);
  checkVersion(ifMatch, l.version);
  if (l.stoppedFrom) throw conflict('STOPPED', `This loan is already stopped from ${l.stoppedFrom}.`);
  const d = deducted(db, id);
  if (d.lastMonth && v.fromMonth <= d.lastMonth) throw conflict('DEDUCTED', `Payroll deducted this loan in ${d.lastMonth}; stop it from a later month, or cancel that payroll first.`);
  db.prepare('UPDATE pay_gov_loans SET stopped_from = ?, stop_reason = ?, version = version + 1, updated_at = ? WHERE id = ?').run(v.fromMonth, v.reason, who.at, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'pay.gov_loan.stop', entityType: 'pay.gov_loan', entityId: id, data: v });
  return mustGet(db, id);
}
