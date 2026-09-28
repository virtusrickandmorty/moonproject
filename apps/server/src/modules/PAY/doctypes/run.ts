/**
 * Payroll Run (PAY-, PLAN D5 PAY-RUN, E11, F3): the accrual for one pay group and period. The server works out every
 * line (run-calc.ts); staff pick the group and period and may add manual lines, change a cash-advance deduction or leave
 * someone out, with a reason.
 *   Dr 5201 piece labor (per job order) / 5202 other production pay / 6101 office pay      (gross, by cost centre)
 *   Dr 5203 / 6102 employer shares ; Dr 5204 / 6103 13th-month accrual (ACC-18)
 *   Cr 2401 SSS (EE + ER + EC) ; 2402 PhilHealth ; 2403 Pag-IBIG ; 2310 withholding tax ; 1210 cash advances ;
 *   Cr 2111 13th month ; 2110 net pay                                                          (each per employee)
 * Dated the day recorded, or earlier by someone who may backdate (acc.backdate): the run form dates it the period's last
 * day when that has passed, so a Sep 16–30 run recorded on Oct 1 books September's wages, shares and 13th month in
 * September (PAY-1). The tax table and the cash-advance plan are read on the run's date.
 * Recording marks each piece row paid by its run line (PRD public.ts, F3 "paid once"). Cancel needs the releases, and
 * later runs of the same month, cancelled first; it mirrors the journal and makes the piece rows unpaid again. Cash
 * advances come back by themselves, because the CA ledger is read from the journals (D6).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, isBusinessDate, newId, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { lastAuditAt } from '../../../engine/audit.ts';
import { PAY_GROUPS, employeesInGroup, type PayGroup } from '../../EMP/public.ts';
import { advanceSchedule } from '../../CA/public.ts';
import { clearAssignmentsPaidBy, markAssignmentPaid } from '../../PRD/public.ts';
import { TAX_FREQUENCY, periodEndOf, workOut, type RunEmployee, type RunLine } from '../run-calc.ts';

const MAX_CENTS = 1_000_000_00;
const reason = z.string().trim().min(5).max(200);
export const runInput = z
  .object({
    payGroup: z.enum(PAY_GROUPS),
    periodStart: z.string().refine(isBusinessDate, 'Use a date like 2026-09-16.'), // the period paid, not the document's date
    lines: z
      .array(z.object({ employeeId: z.uuid(), kind: z.enum(['allowance', 'adjustment']), amountCents: z.number().int().min(-MAX_CENTS).max(MAX_CENTS).refine((n) => n !== 0), reason }).strict())
      .max(200)
      .optional(),
    advances: z.array(z.object({ employeeId: z.uuid(), amountCents: z.number().int().min(0).max(MAX_CENTS) }).strict()).max(200).optional(), // this run's cash-advance deduction
    skip: z.array(z.object({ employeeId: z.uuid(), reason }).strict()).max(200).optional(),
  })
  .strict();
export type RunInput = z.infer<typeof runInput>;

export interface Run extends RunInput {
  periodEnd: string; contributionMonth: string; taxFrequency: 'weekly' | 'semi_monthly'; employees: RunEmployee[];
  grossCents: number; netCents: number; totalCents: number;
}

/** Warnings worked out with the run, handed from compute to validate (the same object, in the same request). */
const notesOf = new WeakMap<Run, Issue[]>();
const GROUP_LABEL: Record<PayGroup, string> = { WEEKLY_PIECE: 'weekly piece-rate', SEMI_DAILY: 'semi-monthly daily-paid', SEMI_MONTHLY: 'semi-monthly monthly staff' };
const employee = (id: string) => ({ type: 'employee', id });
// Rows straight from SQLite, read field by field in load().
type DbRow = Record<string, any>;

function recordedRunFor(db: Parameters<typeof employeesInGroup>[0], payGroup: string, periodStart: string) {
  return db
    .prepare(`SELECT d.number FROM pay_runs r JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND r.pay_group = ? AND r.period_start = ?`)
    .pluck()
    .get(payGroup, periodStart) as string | undefined;
}

export const runDoc: DocTypeDef<RunInput, Run> = {
  key: 'pay.run',
  module: 'PAY',
  title: 'Payroll Run',
  numbering: { series: { key: 'PAY', prefix: 'PAY-' } },
  permissions: { view: 'pay.run.view', create: 'pay.run.create', post: 'pay.run.post', cancel: 'pay.run.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: runInput,

  compute(input, ctx) {
    const periodEnd = periodEndOf(input.payGroup, input.periodStart) ?? input.periodStart;
    const base = { ...input, periodEnd, contributionMonth: periodEnd.slice(0, 7), taxFrequency: TAX_FREQUENCY[input.payGroup] };
    let worked: ReturnType<typeof workOut> = { employees: [], notes: [] };
    if (periodEndOf(input.payGroup, input.periodStart) && periodEnd <= ctx.businessDate) {
      try {
        worked = workOut(ctx.db, {
          payGroup: input.payGroup, periodStart: input.periodStart, periodEnd, payDate: ctx.businessDate, manual: input.lines ?? [],
          caOverrides: new Map((input.advances ?? []).map((a) => [a.employeeId, a.amountCents])), skipped: new Set((input.skip ?? []).map((s) => s.employeeId)),
        });
      } catch (e) {
        worked.notes.push({ code: 'SETTINGS', level: 'error', message: (e as Error).message });
      }
    }
    const grossCents = worked.employees.reduce((s, e) => s + e.grossCents, 0);
    const run: Run = { ...base, employees: worked.employees, grossCents, netCents: worked.employees.reduce((s, e) => s + e.netCents, 0), totalCents: grossCents };
    notesOf.set(run, worked.notes);
    return run;
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, message, level: 'error' });
    const periodEnd = periodEndOf(doc.payGroup, doc.periodStart);
    if (!periodEnd) {
      error('periodStart', 'PERIOD', doc.payGroup === 'WEEKLY_PIECE' ? 'A weekly payroll starts on a Monday (Monday to Saturday).' : 'A semi-monthly payroll starts on the 1st or the 16th.');
      return issues;
    }
    if (periodEnd > ctx.businessDate) {
      error('periodStart', 'PERIOD_OPEN', `The period ends on ${periodEnd}. A payroll is worked out and dated on or after that day, once attendance is typed.`);
      return issues;
    }
    if (ctx.businessDate.slice(0, 7) > periodEnd.slice(0, 7)) {
      issues.push({
        field: 'periodStart', code: 'BOOKED_LATER', level: 'warning',
        message: `This payroll is dated ${ctx.businessDate}, so the pay for ${doc.periodStart} to ${periodEnd} is booked in ${ctx.businessDate.slice(0, 7)}, not ${periodEnd.slice(0, 7)}. The accountant can date it ${periodEnd}.`,
      });
    }
    const taken = recordedRunFor(ctx.db, doc.payGroup, doc.periodStart);
    if (taken) error('periodStart', 'DUPLICATE_RUN', `${taken} already pays the ${GROUP_LABEL[doc.payGroup]} group for ${doc.periodStart} to ${periodEnd}. Cancel it first to redo it.`);
    const inGroup = new Set(employeesInGroup(ctx.db, doc.payGroup, doc.periodStart, periodEnd).map((e) => e.id));
    const inRun = new Set(doc.employees.map((e) => e.employeeId));
    (doc.lines ?? []).forEach((l, i) => !inRun.has(l.employeeId) && error(`lines.${i}.employeeId`, 'NOT_IN_RUN', `Line ${i + 1}: that employee is not paid in this run.`));
    (doc.skip ?? []).forEach((s, i) => !inGroup.has(s.employeeId) && error(`skip.${i}.employeeId`, 'NOT_IN_RUN', `Left out ${i + 1}: that employee is not in this pay group.`));
    const seenAdv = new Set<string>();
    (doc.advances ?? []).forEach((a, i) => {
      if (!inRun.has(a.employeeId) || seenAdv.has(a.employeeId)) return error(`advances.${i}.employeeId`, 'NOT_IN_RUN', `Cash advance ${i + 1}: pick an employee paid in this run, once.`);
      seenAdv.add(a.employeeId);
      const owed = advanceSchedule(ctx.db, a.employeeId, ctx.businessDate).outstandingCents;
      if (a.amountCents > owed) error(`advances.${i}.amountCents`, 'CA_OVER', `${doc.employees.find((e) => e.employeeId === a.employeeId)!.name} owes ${formatPeso(Math.max(0, owed))} on cash advances; the deduction cannot be more.`);
    });
    if (new Set((doc.skip ?? []).map((s) => s.employeeId)).size !== (doc.skip ?? []).length) error('skip', 'DUPLICATE', 'Someone is left out twice.');
    if (doc.employees.length === 0 && !taken) error('payGroup', 'NOBODY', 'Nobody in this pay group was in service in the period, or everyone is left out.');
    for (const e of doc.employees) {
      if (e.netCents < 0) error('lines', 'NEGATIVE_PAY', `${e.name}: the pay for the period is ${formatPeso(e.grossCents)}, less than nothing. Leave ${e.name} out this time, or add pay.`);
    }
    return [...issues, ...(notesOf.get(doc) ?? [])];
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO pay_runs (document_id, pay_group, period_start, period_end, contribution_month, tax_frequency, gross_cents, net_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      h.documentId, doc.payGroup, doc.periodStart, doc.periodEnd, doc.contributionMonth, doc.taxFrequency, doc.grossCents, doc.netCents,
    );
    const emp = db.prepare(
      `INSERT INTO pay_run_employees (id, document_id, employee_id, employee_code, employee_name, cost_centre, pay_type, is_mwe, gross_cents, piece_cents, taxable_cents,
         sss_msc_cents, sss_ee_cents, sss_er_cents, sss_ec_cents, phic_basis_cents, phic_ee_cents, phic_er_cents, hdmf_ee_cents, hdmf_er_cents, ee_short_cents,
         wtax_cents, ca_cents, ca_override_cents, thirteenth_cents, net_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const line = db.prepare(
      `INSERT INTO pay_run_lines (id, run_employee_id, line_no, kind, description, qty, rate_cents, multiplier_bp, amount_cents, taxable, thirteenth_base, assignment_id, job_order_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of doc.employees) {
      const id = newId();
      emp.run(id, h.documentId, e.employeeId, e.code, e.name, e.costCentre, e.payType, +e.isMwe, e.grossCents, e.pieceCents, e.taxableCents, e.sssMscCents, e.sssEeCents,
        e.sssErCents, e.sssEcCents, e.phicBasisCents, e.phicEeCents, e.phicErCents, e.hdmfEeCents, e.hdmfErCents, e.eeShortCents, e.wtaxCents, e.caCents, e.caOverrideCents,
        e.thirteenthCents, e.netCents);
      for (const l of e.lines) {
        const lineId = newId();
        line.run(lineId, id, l.lineNo, l.kind, l.description, l.qty, l.rateCents, l.multiplierBp, l.amountCents, +l.taxable, +l.thirteenthBase, l.assignmentId ?? null, l.jobOrderId ?? null, l.reason ?? null);
        if (l.assignmentId) markAssignmentPaid(db, l.assignmentId, lineId);
      }
    }
    const skip = db.prepare('INSERT INTO pay_run_skips (document_id, employee_id, reason) VALUES (?, ?, ?)');
    for (const s of doc.skip ?? []) skip.run(h.documentId, s.employeeId, s.reason);
  },

  journal(doc) {
    const lines: DraftLine[] = [];
    /** An expense line whose amount can be negative (a correction bigger than the pay): a credit then. */
    const expense = (role: string, cents: number, extra: Partial<DraftLine> = {}) => lines.push({ account: { role }, ...(cents >= 0 ? { debitCents: cents } : { creditCents: -cents }), ...extra });
    for (const centre of ['production', 'office'] as const) {
      const staff = doc.employees.filter((e) => e.costCentre === centre);
      const sum = (f: (e: RunEmployee) => number) => staff.reduce((s, e) => s + f(e), 0);
      const pieces = staff.flatMap((e) => e.lines.filter((l) => l.kind === 'piece'));
      if (centre === 'production') {
        const byJo = new Map<string, number>();
        for (const l of pieces) byJo.set(l.jobOrderId!, (byJo.get(l.jobOrderId!) ?? 0) + l.amountCents);
        for (const [jo, cents] of byJo) expense('LABOR_PIECE', cents, { ref: { documentId: jo }, memo: 'Piece-rate labor' });
        expense('LABOR_DAILY', sum((e) => e.grossCents - e.pieceCents), { memo: 'Production pay' });
      } else expense('SALARIES_OFFICE', sum((e) => e.grossCents), { memo: 'Office and sales pay' });
      expense(centre === 'production' ? 'LABOR_ER_CONTRIB' : 'ER_CONTRIB_OFFICE', sum((e) => e.sssErCents + e.sssEcCents + e.phicErCents + e.hdmfErCents), { memo: 'Employer shares' });
      expense(centre === 'production' ? 'LABOR_BENEFITS' : 'BENEFITS_OFFICE', sum((e) => e.thirteenthCents), { memo: '13th-month accrual' });
    }
    const month = doc.contributionMonth;
    for (const e of doc.employees) {
      const credit = (role: string, cents: number, memo: string) => lines.push({ account: { role }, party: employee(e.employeeId), creditCents: cents, memo });
      credit('SSS_PAYABLE', e.sssEeCents + e.sssErCents + e.sssEcCents, `SSS ${month}`);
      credit('PHIC_PAYABLE', e.phicEeCents + e.phicErCents, `PhilHealth ${month}`);
      credit('HDMF_PAYABLE', e.hdmfEeCents + e.hdmfErCents, `Pag-IBIG ${month}`);
      credit('WTC_PAYABLE', e.wtaxCents, `Withholding tax ${month}`);
      credit('EMP_ADVANCES', e.caCents, 'Cash advance deducted');
      credit('THIRTEENTH_PAYABLE', e.thirteenthCents, '13th-month accrual');
      credit('PAYROLL_PAYABLE', e.netCents, 'Net pay');
    }
    // A run that moves no money (only ₱0 progress rows marked paid) posts no journal.
    if (!lines.some((l) => (l.debitCents ?? 0) + (l.creditCents ?? 0) > 0)) return null;
    return { memo: `Payroll ${GROUP_LABEL[doc.payGroup]} ${doc.periodStart} to ${doc.periodEnd}`, lines };
  },

  load(db, documentId) {
    const r = db.prepare('SELECT * FROM pay_runs WHERE document_id = ?').get(documentId) as
      | { pay_group: PayGroup; period_start: string; period_end: string; contribution_month: string; tax_frequency: 'weekly' | 'semi_monthly'; gross_cents: number; net_cents: number }
      | undefined;
    if (!r) throw new Error(`Payroll run ${documentId} not found`);
    const lineRows = db.prepare('SELECT * FROM pay_run_lines WHERE run_employee_id = ? ORDER BY line_no');
    const employees: RunEmployee[] = (db.prepare('SELECT * FROM pay_run_employees WHERE document_id = ? ORDER BY rowid').all(documentId) as DbRow[]).map((e) => ({
      employeeId: e.employee_id, code: e.employee_code, name: e.employee_name, costCentre: e.cost_centre, payType: e.pay_type, isMwe: e.is_mwe === 1,
      lines: (lineRows.all(e.id) as DbRow[]).map(
        (l): RunLine => ({
          lineNo: l.line_no, kind: l.kind, description: l.description, qty: l.qty, rateCents: l.rate_cents, multiplierBp: l.multiplier_bp, amountCents: l.amount_cents,
          taxable: l.taxable === 1, thirteenthBase: l.thirteenth_base === 1,
          ...(l.assignment_id ? { assignmentId: l.assignment_id, jobOrderId: l.job_order_id } : {}), ...(l.reason ? { reason: l.reason } : {}),
        }),
      ),
      grossCents: e.gross_cents, pieceCents: e.piece_cents, taxableCents: e.taxable_cents, sssMscCents: e.sss_msc_cents, sssEeCents: e.sss_ee_cents, sssErCents: e.sss_er_cents,
      sssEcCents: e.sss_ec_cents, phicBasisCents: e.phic_basis_cents, phicEeCents: e.phic_ee_cents, phicErCents: e.phic_er_cents, hdmfEeCents: e.hdmf_ee_cents,
      hdmfErCents: e.hdmf_er_cents, eeShortCents: e.ee_short_cents, wtaxCents: e.wtax_cents, caCents: e.ca_cents, caOverrideCents: e.ca_override_cents,
      thirteenthCents: e.thirteenth_cents, netCents: e.net_cents,
    }));
    const lines = employees.flatMap((e) => e.lines.filter((l) => l.kind === 'allowance' || l.kind === 'adjustment').map((l) => ({ employeeId: e.employeeId, kind: l.kind as 'allowance' | 'adjustment', amountCents: l.amountCents, reason: l.reason! })));
    const advances = employees.filter((e) => e.caOverrideCents !== null).map((e) => ({ employeeId: e.employeeId, amountCents: e.caOverrideCents! }));
    const skip = db.prepare('SELECT employee_id AS employeeId, reason FROM pay_run_skips WHERE document_id = ? ORDER BY rowid').all(documentId) as { employeeId: string; reason: string }[];
    return {
      payGroup: r.pay_group, periodStart: r.period_start, ...(lines.length ? { lines } : {}), ...(advances.length ? { advances } : {}), ...(skip.length ? { skip } : {}),
      periodEnd: r.period_end, contributionMonth: r.contribution_month, taxFrequency: r.tax_frequency, employees, grossCents: r.gross_cents, netCents: r.net_cents, totalCents: r.gross_cents,
    };
  },

  toInput(doc) {
    const { payGroup, periodStart, lines, advances, skip } = doc;
    return { payGroup, periodStart, ...(lines?.length ? { lines } : {}), ...(advances?.length ? { advances } : {}), ...(skip?.length ? { skip } : {}) };
  },

  /**
   * Cancelled first: releases of this run's net pay (D6, G-29), runs recorded after it for the same contribution
   * month that pay any of its employees, because their month-to-date shares were worked out on top of this one, and a
   * 13th-month pay that counted its basic pay and paid its accrual.
   */
  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM pay_releases r JOIN documents d ON d.id = r.document_id WHERE r.run_id = @id AND d.status = 'posted'
         UNION
         SELECT d.id, d.number FROM pay_runs r JOIN documents d ON d.id = r.document_id
         WHERE d.status = 'posted' AND d.id <> @id AND d.number > (SELECT number FROM documents WHERE id = @id)
           AND r.contribution_month = (SELECT contribution_month FROM pay_runs WHERE document_id = @id)
           AND EXISTS (SELECT 1 FROM pay_run_employees a JOIN pay_run_employees b ON b.employee_id = a.employee_id WHERE a.document_id = r.document_id AND b.document_id = @id)
         UNION
         SELECT d.id, d.number FROM pay_thirteenth_basis b JOIN pay_run_employees e ON e.id = b.run_employee_id JOIN pay_thirteenth_employees t ON t.id = b.thirteenth_employee_id
           JOIN documents d ON d.id = t.document_id WHERE e.document_id = @id AND d.status = 'posted'
         ORDER BY 2`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
  },

  /** The piece rows this run paid become unpaid again, for the next run (D6, F3). */
  afterCancel(db, documentId) {
    const ids = db
      .prepare(`SELECT l.id FROM pay_run_lines l JOIN pay_run_employees e ON e.id = l.run_employee_id WHERE e.document_id = ? AND l.assignment_id IS NOT NULL`)
      .pluck()
      .all(documentId) as string[];
    clearAssignmentsPaidBy(db, ids);
    return null;
  },

  summary(doc) {
    const n = doc.employees.length;
    return `This will record the ${GROUP_LABEL[doc.payGroup]} payroll for ${doc.periodStart} to ${doc.periodEnd}: ${n} ${n === 1 ? 'employee' : 'employees'}, gross pay ${formatPeso(doc.grossCents)}, net pay ${formatPeso(doc.netCents)} to be released.`;
  },

  /** A group and period that has ended (by the last recorded activity) with someone to pay, a manual line now and then. */
  arbitrary(db) {
    const lastDay = (lastAuditAt(db) ?? '').slice(0, 10); // audit times carry +08:00, so this is the Manila date
    const days = db
      .prepare(`SELECT work_date FROM emp_attendance UNION SELECT a.work_date FROM prd_assignments a WHERE a.pay_run_line_id IS NULL ORDER BY 1`)
      .pluck()
      .all() as string[];
    const periods: { payGroup: PayGroup; periodStart: string }[] = [];
    for (const payGroup of PAY_GROUPS) {
      for (const d of days) {
        const monday = (() => {
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          const [y, m, day] = d.split('-').map(Number);
          const t = new Date(Date.UTC(y!, m! - 1, day! - ((wd + 6) % 7)));
          return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
        })();
        const start = payGroup === 'WEEKLY_PIECE' ? monday : `${d.slice(0, 8)}${Number(d.slice(8)) <= 15 ? '01' : '16'}`;
        const end = periodEndOf(payGroup, start)!;
        if (end <= lastDay && employeesInGroup(db, payGroup, start, end).length && !recordedRunFor(db, payGroup, start) && !periods.some((p) => p.payGroup === payGroup && p.periodStart === start)) periods.push({ payGroup, periodStart: start });
      }
    }
    if (!periods.length) throw new Error('No period has anyone to pay');
    return fc.constantFrom(...periods).chain((p) => {
      const people = employeesInGroup(db, p.payGroup, p.periodStart, periodEndOf(p.payGroup, p.periodStart)!).map((e) => e.id);
      return fc
        .option(fc.record({ employeeId: fc.constantFrom(...people), amountCents: fc.integer({ min: 1, max: 2_000_00 }) }), { nil: undefined })
        .map((extra) => ({ ...p, ...(extra ? { lines: [{ ...extra, kind: 'allowance' as const, reason: 'Transport allowance (made up)' }] } : {}) }));
    });
  },
};
