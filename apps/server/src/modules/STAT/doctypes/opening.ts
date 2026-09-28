/**
 * Opening Statutory Payable (OBST-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the contributions and withholding tax on
 * compensation of a contribution month on or before the cut-over date that were withheld and not yet remitted, per
 * employee: SSS (employee, employer and EC together), PhilHealth, Pag-IBIG, withholding tax on compensation, and any SSS
 * or Pag-IBIG loan amortizations deducted and not yet remitted.
 *   Dr 3900 opening balance equity / Cr 2401 SSS, 2402 PhilHealth, 2403 Pag-IBIG, 2310 withholding tax, 2404 and 2405
 *   loan amortizations, each line per employee (party = the employee), tagged with the contribution month exactly as a
 *   payroll run's lines.
 * ledger.ts folds its journal into the same month as the payroll runs' (openingsOfMonth), so the month's payable, the
 * remittance check and a remittance (REM-) of that month see it and pay it. One posted per contribution month. The ACC
 * opening contract (ACC/public.ts): dated the cut-over date, cancelled on it too while the opening is open. Cancel is
 * blocked while a remittance stands on a scheme this document credited for its month (ledger.ts remittancesOf).
 * Its SSS and Pag-IBIG loan amortizations (2404, 2405) are the loan part of that month's SSS and Pag-IBIG payable, and
 * the same remittance pays them (ledger.ts schemeAccounts).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assertOpeningOpen, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { activeEmployees, employee } from '../../EMP/public.ts';
import { isMonth, remittancesOf, type Scheme } from '../ledger.ts';

const MAX_CENTS = 5_000_000_00;
const amount = z.number().int().positive().max(MAX_CENTS);

const employeeLine = z
  .object({
    employeeId: z.uuid(),
    sssCents: amount.optional(),
    phicCents: amount.optional(),
    hdmfCents: amount.optional(),
    wtaxCents: amount.optional(),
    sssLoanCents: amount.optional(),
    hdmfLoanCents: amount.optional(),
  })
  .strict();

export const openingStatInput = z
  .object({
    month: z.string().refine(isMonth, 'Use a month like 2026-09.'), // the contribution month, not the document's date
    employees: z.array(employeeLine).min(1).max(300),
  })
  .strict();
export type OpeningStatInput = z.infer<typeof openingStatInput>;
type EmployeeLineInput = z.infer<typeof employeeLine>;

export interface OpeningStatLine {
  employeeId: string; name: string;
  sssCents: number; phicCents: number; hdmfCents: number; wtaxCents: number; sssLoanCents: number; hdmfLoanCents: number; totalCents: number;
}
export interface OpeningStat {
  month: string; lines: OpeningStatLine[];
  sssCents: number; phicCents: number; hdmfCents: number; wtaxCents: number; sssLoanCents: number; hdmfLoanCents: number; totalCents: number;
}

const toLine = (db: Db, e: EmployeeLineInput): OpeningStatLine => {
  const sssCents = e.sssCents ?? 0, phicCents = e.phicCents ?? 0, hdmfCents = e.hdmfCents ?? 0;
  const wtaxCents = e.wtaxCents ?? 0, sssLoanCents = e.sssLoanCents ?? 0, hdmfLoanCents = e.hdmfLoanCents ?? 0;
  return {
    employeeId: e.employeeId, name: employee(db, e.employeeId)?.name ?? '?', sssCents, phicCents, hdmfCents, wtaxCents, sssLoanCents, hdmfLoanCents,
    totalCents: sssCents + phicCents + hdmfCents + wtaxCents + sssLoanCents + hdmfLoanCents,
  };
};

function build(db: Db, input: OpeningStatInput): OpeningStat {
  const lines = input.employees.map((e) => toLine(db, e));
  const sum = (f: (l: OpeningStatLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  return {
    month: input.month, lines,
    sssCents: sum((l) => l.sssCents), phicCents: sum((l) => l.phicCents), hdmfCents: sum((l) => l.hdmfCents), wtaxCents: sum((l) => l.wtaxCents),
    sssLoanCents: sum((l) => l.sssLoanCents), hdmfLoanCents: sum((l) => l.hdmfLoanCents), totalCents: sum((l) => l.totalCents),
  };
}

type LineCents = Pick<OpeningStatLine, 'employeeId' | 'sssCents' | 'phicCents' | 'hdmfCents' | 'wtaxCents' | 'sssLoanCents' | 'hdmfLoanCents'>;
const lineInput = (l: LineCents): EmployeeLineInput => ({
  employeeId: l.employeeId,
  ...(l.sssCents ? { sssCents: l.sssCents } : {}), ...(l.phicCents ? { phicCents: l.phicCents } : {}), ...(l.hdmfCents ? { hdmfCents: l.hdmfCents } : {}),
  ...(l.wtaxCents ? { wtaxCents: l.wtaxCents } : {}), ...(l.sssLoanCents ? { sssLoanCents: l.sssLoanCents } : {}), ...(l.hdmfLoanCents ? { hdmfLoanCents: l.hdmfLoanCents } : {}),
});

export const openingStatDoc: DocTypeDef<OpeningStatInput, OpeningStat> = {
  key: 'stat.opening',
  module: 'STAT',
  title: 'Opening Statutory Payable',
  numbering: { series: { key: 'OBST', prefix: 'OBST-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingStatInput,

  compute(input, ctx) {
    return build(ctx.db, input);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const err = (field: string, code: string, message: string) => issues.push({ field, code, level: 'error', message });
    issues.push(...openingIssues(ctx.db, ctx.businessDate));
    if (`${doc.month}-01` > ctx.businessDate) err('month', 'MONTH_AFTER_CUTOVER', `${doc.month} is after the cut-over date, ${ctx.businessDate}. Opening statutory payables are for a contribution month on or before the cut-over.`);
    const dup = ctx.db.prepare(`SELECT d.number FROM stat_openings s JOIN documents d ON d.id = s.document_id WHERE s.month = ? AND d.status = 'posted'`).pluck().get(doc.month) as string | undefined;
    if (dup) err('month', 'MONTH_TAKEN', `${doc.month} already has an opening statutory payable, ${dup}. Cancel it first to redo it.`);
    const seen = new Set<string>();
    doc.lines.forEach((l, i) => {
      if (seen.has(l.employeeId)) err(`employees.${i}.employeeId`, 'DUPLICATE_EMPLOYEE', `${l.name} is listed twice.`);
      seen.add(l.employeeId);
      if (!employee(ctx.db, l.employeeId)?.active) err(`employees.${i}.employeeId`, 'EMPLOYEE', 'Pick an active employee.');
      if (l.totalCents === 0) err(`employees.${i}`, 'EMPTY_LINE', `${l.name}: type at least one amount still to remit.`);
    });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO stat_openings (document_id, month, sss_cents, phic_cents, hdmf_cents, wtax_cents, sss_loan_cents, hdmf_loan_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(h.documentId, doc.month, doc.sssCents, doc.phicCents, doc.hdmfCents, doc.wtaxCents, doc.sssLoanCents, doc.hdmfLoanCents, doc.totalCents);
    const line = db.prepare(
      `INSERT INTO stat_opening_lines (document_id, employee_id, employee_name, sss_cents, phic_cents, hdmf_cents, wtax_cents, sss_loan_cents, hdmf_loan_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of doc.lines) line.run(h.documentId, l.employeeId, l.name, l.sssCents, l.phicCents, l.hdmfCents, l.wtaxCents, l.sssLoanCents, l.hdmfLoanCents);
  },

  journal(doc) {
    const lines: DraftLine[] = [{ account: { role: 'OPENING_EQUITY' }, debitCents: doc.totalCents, memo: 'Opening balance equity' }];
    const credit = (role: string, cents: number, employeeId: string, memo: string) => {
      if (cents > 0) lines.push({ account: { role }, party: { type: 'employee', id: employeeId }, creditCents: cents, memo });
    };
    for (const l of doc.lines) {
      credit('SSS_PAYABLE', l.sssCents, l.employeeId, `SSS ${doc.month}`);
      credit('PHIC_PAYABLE', l.phicCents, l.employeeId, `PhilHealth ${doc.month}`);
      credit('HDMF_PAYABLE', l.hdmfCents, l.employeeId, `Pag-IBIG ${doc.month}`);
      credit('WTC_PAYABLE', l.wtaxCents, l.employeeId, `Withholding tax ${doc.month}`);
      credit('SSS_LOAN_PAYABLE', l.sssLoanCents, l.employeeId, `SSS loan amortization ${doc.month}`);
      credit('HDMF_LOAN_PAYABLE', l.hdmfLoanCents, l.employeeId, `Pag-IBIG loan amortization ${doc.month}`);
    }
    return { memo: `Opening statutory payable for ${doc.month}`, lines };
  },

  load(db, documentId) {
    const h = db.prepare(`SELECT month FROM stat_openings WHERE document_id = ?`).get(documentId) as { month: string } | undefined;
    if (!h) throw new Error(`Opening statutory payable ${documentId} not found`);
    const rows = db
      .prepare(
        `SELECT employee_id AS employeeId, sss_cents AS sssCents, phic_cents AS phicCents, hdmf_cents AS hdmfCents, wtax_cents AS wtaxCents,
           sss_loan_cents AS sssLoanCents, hdmf_loan_cents AS hdmfLoanCents FROM stat_opening_lines WHERE document_id = ? ORDER BY rowid`,
      )
      .all(documentId) as LineCents[];
    return build(db, { month: h.month, employees: rows.map(lineInput) });
  },

  toInput(doc) {
    return { month: doc.month, employees: doc.lines.map(lineInput) };
  },

  /** Cancel is blocked while a posted remittance stands on a scheme this opening credited, for its month. */
  dependents(db, documentId) {
    const row = db
      .prepare(`SELECT month, sss_cents + sss_loan_cents AS sss, phic_cents AS phic, hdmf_cents + hdmf_loan_cents AS hdmf, wtax_cents AS wtax FROM stat_openings WHERE document_id = ?`)
      .get(documentId) as { month: string; sss: number; phic: number; hdmf: number; wtax: number } | undefined;
    if (!row) return [];
    const credited: Record<Scheme, number> = { SSS: row.sss, PHIC: row.phic, HDMF: row.hdmf, WTAX: row.wtax }; // loans are paid on the agency's remittance
    const schemes = (Object.keys(credited) as Scheme[]).filter((s) => credited[s] > 0);
    return schemes.flatMap((s) => remittancesOf(db, s, row.month).filter((r) => r.status === 'posted').map((r) => ({ id: r.id, number: r.number })));
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back once the opening is closed. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const n = doc.lines.length;
    const loans = doc.sssLoanCents + doc.hdmfLoanCents > 0 ? ' and loan amortizations' : '';
    return `This will record ${formatPeso(doc.totalCents)} still to remit for ${doc.month} (SSS, PhilHealth, Pag-IBIG and withholding tax${loans}) for ${n} ${n === 1 ? 'employee' : 'employees'}, as open on the cut-over date ${ctx.businessDate}.`;
  },

  /** Active employees, a month before the cut-over the tests use, and a random subset of the six amounts per employee. */
  arbitrary(db) {
    const ids = activeEmployees(db).map((e) => e.id);
    if (!ids.length) throw new Error('No active employees');
    const month = fc.tuple(fc.constantFrom('2025', '2026'), fc.integer({ min: 1, max: 8 })).map(([y, m]) => `${y}-${String(m).padStart(2, '0')}`);
    const cents = fc.integer({ min: 1, max: 500_000 });
    const opt = () => fc.option(cents, { nil: undefined });
    const line = fc
      .record({ employeeId: fc.constantFrom(...ids), sssCents: opt(), phicCents: opt(), hdmfCents: opt(), wtaxCents: opt(), sssLoanCents: opt(), hdmfLoanCents: opt() })
      .filter((l) => l.sssCents !== undefined || l.phicCents !== undefined || l.hdmfCents !== undefined || l.wtaxCents !== undefined || l.sssLoanCents !== undefined || l.hdmfLoanCents !== undefined);
    return fc.record({ month, employees: fc.uniqueArray(line, { selector: (l) => l.employeeId, minLength: 1, maxLength: Math.min(4, ids.length) }) });
  },
};
