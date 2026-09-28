/**
 * 13th-Month Pay (TH13-, PLAN D5 TH13-PAY, E11, F1): the year's 13th-month payout for one pay group, run by the
 * accountant, one recorded per group and year. Per employee the server works out one twelfth of the basic pay of the
 * recorded payroll runs of the year up to today (PD 851), beside what the runs accrued on 2111 for them (ACC-18).
 *   Dr 2111 13th-month payable (what was accrued, per employee)
 *   Dr 5204 / 6103 13th month and benefits, by cost centre: the true-up (paid − accrued; a credit when accrued more)
 *   Cr 2110 net pay (per employee; paid out with a payroll release, POUT-)
 *   Cr 2310 withholding tax on the part above the ₱90,000 ceiling of the year's 13th-month pay and other benefits
 * No SSS, PhilHealth or Pag-IBIG. Basic pay is the run lines marked as the 13th-month base (run-calc.ts THIRTEENTH_BASE:
 * days worked, paid leave, salary less absences, piece work); holiday pay, premiums, overtime, allowances and
 * adjustments are not (F1). Runs of earlier years that no 13th-month pay counted yet (a late-December run recorded after
 * that year's payout) are counted too, so their accrual is paid, not written back. Staff may leave someone out or
 * change an amount, with a reason, as a payroll run allows. Dated the day recorded. Cancel needs its releases cancelled
 * first; payroll runs it counted wait for it (run.ts dependents).
 */
import { z } from 'zod';
import fc from 'fast-check';
import { divRoundHalfAway, formatPeso, newId, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import { lastAuditAt } from '../../../engine/audit.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { PAY_GROUPS, employeesInGroup, type PayGroup } from '../../EMP/public.ts';
import { benefitCeilingAt, withholding, wtaxTableAt } from '../statutory.ts';
import { yearEndDoneBy } from '../year-end.ts';

const MAX_CENTS = 10_000_000_00;
const reason = z.string().trim().min(5).max(200);
export const thirteenthInput = z
  .object({
    payGroup: z.enum(PAY_GROUPS),
    year: z.number().int().min(2000).max(2100), // the year paid (this year, or last year early in January)
    amounts: z.array(z.object({ employeeId: z.uuid(), amountCents: z.number().int().min(0).max(MAX_CENTS), reason }).strict()).max(200).optional(),
    skip: z.array(z.object({ employeeId: z.uuid(), reason }).strict()).max(200).optional(),
  })
  .strict();
export type ThirteenthInput = z.infer<typeof thirteenthInput>;

export interface ThirteenthEmployee {
  employeeId: string; code: string; name: string; costCentre: 'production' | 'office';
  /** Basic pay of the runs counted, and the part of it from runs of earlier years. */
  basicCents: number; earlierBasicCents: number;
  /** One twelfth of the basic pay; what the runs accrued on 2111 (the balance today); what is paid (the due, or changed with a reason). */
  dueCents: number; accruedCents: number; amountCents: number; reason?: string;
  /** 13th-month pay already recorded for this employee this calendar year; the part of this one above the ceiling; its tax. */
  otherBenefitsCents: number; taxableCents: number; wtaxCents: number; netCents: number;
  /** The payroll-run rows (pay_run_employees ids) whose basic pay is counted. */
  basis: string[];
}
export interface Thirteenth extends ThirteenthInput { employees: ThirteenthEmployee[]; netCents: number; totalCents: number }

const notesOf = new WeakMap<Thirteenth, Issue[]>();
const GROUP_LABEL: Record<PayGroup, string> = { WEEKLY_PIECE: 'weekly piece-rate', SEMI_DAILY: 'semi-monthly daily-paid', SEMI_MONTHLY: 'semi-monthly monthly staff' };
const employee = (id: string) => ({ type: 'employee', id });
type DbRow = Record<string, any>;

/** The recorded 13th-month pay of a group and year, if any. */
function recordedFor(db: Db, payGroup: string, year: number) {
  return db
    .prepare(`SELECT d.number FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted' AND t.pay_group = ? AND t.year = ?`)
    .pluck()
    .get(payGroup, year) as string | undefined;
}

/** Recorded payroll-run rows of an employee up to a date that no recorded 13th-month pay counted yet, with their basic pay. */
function uncounted(db: Db, employeeId: string, upTo: string) {
  return db
    .prepare(
      `SELECT e.id, r.period_end AS periodEnd,
         (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_run_lines l WHERE l.run_employee_id = e.id AND l.thirteenth_base = 1) AS basic
       FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND e.employee_id = ? AND r.period_end <= ?
         AND NOT EXISTS (SELECT 1 FROM pay_thirteenth_basis b JOIN pay_thirteenth_employees t ON t.id = b.thirteenth_employee_id JOIN documents x ON x.id = t.document_id
                         WHERE b.run_employee_id = e.id AND x.status = 'posted')
       ORDER BY r.period_end, d.number`,
    )
    .all(employeeId, upTo) as { id: string; periodEnd: string; basic: number }[];
}

/** What an employee's recorded runs of periods ending after a date accrued on 2111. */
const accruedAfter = (db: Db, employeeId: string, after: string) =>
  db
    .prepare(
      `SELECT COALESCE(SUM(e.thirteenth_cents), 0) FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND e.employee_id = ? AND r.period_end > ?`,
    )
    .pluck()
    .get(employeeId, after) as number;

/** The taxable compensation of an employee's recorded runs of a contribution month (the regular pay the tax is stacked on). */
const taxableOfMonth = (db: Db, employeeId: string, month: string) =>
  db
    .prepare(
      `SELECT COALESCE(SUM(e.taxable_cents), 0) FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND e.employee_id = ? AND r.contribution_month = ?`,
    )
    .pluck()
    .get(employeeId, month) as number;

/** 13th-month pay recorded for an employee in documents dated in a calendar year (the "other benefits" toward the ceiling). */
const paidInYear = (db: Db, employeeId: string, year: string) =>
  db
    .prepare(
      `SELECT COALESCE(SUM(t.amount_cents), 0) FROM pay_thirteenth_employees t JOIN documents d ON d.id = t.document_id
       WHERE d.status = 'posted' AND t.employee_id = ? AND substr(d.business_date, 1, 4) = ?`,
    )
    .pluck()
    .get(employeeId, year) as number;

const yearOk = (year: number, businessDate: string) => year === +businessDate.slice(0, 4) || year === +businessDate.slice(0, 4) - 1;

export const thirteenthDoc: DocTypeDef<ThirteenthInput, Thirteenth> = {
  key: 'pay.thirteenth',
  module: 'PAY',
  title: '13th-Month Pay',
  numbering: { series: { key: 'TH13', prefix: 'TH13-' } },
  permissions: { view: 'pay.thirteenth.view', create: 'pay.thirteenth.create', post: 'pay.thirteenth.post', cancel: 'pay.thirteenth.cancel' },
  dating: 'system',
  inputSchema: thirteenthInput,

  compute(input, ctx) {
    const notes: Issue[] = [];
    const employees: ThirteenthEmployee[] = [];
    if (yearOk(input.year, ctx.businessDate)) {
      try {
        const upTo = `${input.year}-12-31` < ctx.businessDate ? `${input.year}-12-31` : ctx.businessDate;
        const skipped = new Set((input.skip ?? []).map((s) => s.employeeId));
        const changed = new Map((input.amounts ?? []).map((a) => [a.employeeId, a]));
        const payable = resolveAccount(ctx.db, { role: 'THIRTEENTH_PAYABLE' }).id;
        const ceiling = benefitCeilingAt(ctx.db, ctx.businessDate);
        const month = ctx.businessDate.slice(0, 7);
        for (const e of employeesInGroup(ctx.db, input.payGroup, `${input.year}-01-01`, upTo)) {
          if (skipped.has(e.id)) continue;
          const rows = uncounted(ctx.db, e.id, upTo);
          const basic = rows.reduce((s, r) => s + r.basic, 0);
          const earlier = rows.filter((r) => r.periodEnd < `${input.year}-01-01`).reduce((s, r) => s + r.basic, 0);
          // 2111 today, less what runs of periods after the year (a week into January) accrued: that belongs to next year's.
          const accrued = Math.max(0, -accountBalance(ctx.db, payable, { asOf: ctx.businessDate, party: employee(e.id) }) - accruedAfter(ctx.db, e.id, upTo));
          const change = changed.get(e.id);
          if (!rows.length && accrued === 0 && !change) continue;
          const due = Math.max(0, divRoundHalfAway(basic, 12));
          const amount = change?.amountCents ?? due;
          const other = paidInYear(ctx.db, e.id, ctx.businessDate.slice(0, 4));
          const taxable = Math.max(0, amount - Math.max(0, ceiling - other));
          // The taxable part is supplementary pay: the monthly table on this month's regular taxable pay plus it, less the table on the regular pay alone.
          let wtax = 0;
          if (taxable > 0 && e.statutory.wtax) {
            const table = wtaxTableAt(ctx.db, 'monthly', ctx.businessDate);
            const regular = taxableOfMonth(ctx.db, e.id, month);
            wtax = withholding(table, regular + taxable) - withholding(table, regular);
          }
          if (earlier > 0) notes.push({ code: 'EARLIER_BASIC', level: 'warning', message: `${e.name}: ${formatPeso(earlier)} of basic pay from runs before ${input.year} that no 13th-month pay counted is included.` });
          employees.push({
            employeeId: e.id, code: e.code, name: e.name, costCentre: e.costCentre, basicCents: basic, earlierBasicCents: earlier, dueCents: due, accruedCents: accrued,
            amountCents: amount, ...(change ? { reason: change.reason } : {}), otherBenefitsCents: other, taxableCents: taxable, wtaxCents: wtax, netCents: amount - wtax,
            basis: rows.map((r) => r.id),
          });
        }
      } catch (err) {
        notes.push({ code: 'SETTINGS', level: 'error', message: (err as Error).message });
      }
    }
    const totalCents = employees.reduce((s, e) => s + e.amountCents, 0);
    const doc: Thirteenth = { ...input, employees, netCents: employees.reduce((s, e) => s + e.netCents, 0), totalCents };
    notesOf.set(doc, notes);
    return doc;
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    const error = (field: string, code: string, message: string) => issues.push({ field, code, message, level: 'error' });
    if (!yearOk(doc.year, ctx.businessDate)) {
      error('year', 'YEAR', `Pay the 13th month of ${ctx.businessDate.slice(0, 4)}, or of ${+ctx.businessDate.slice(0, 4) - 1} early in the new year.`);
      return issues;
    }
    const taken = recordedFor(ctx.db, doc.payGroup, doc.year);
    if (taken) error('year', 'DUPLICATE', `${taken} already pays the ${doc.year} 13th month of the ${GROUP_LABEL[doc.payGroup]} group. Cancel it first to redo it.`);
    const inGroup = new Set(employeesInGroup(ctx.db, doc.payGroup, `${doc.year}-01-01`, `${doc.year}-12-31` < ctx.businessDate ? `${doc.year}-12-31` : ctx.businessDate).map((e) => e.id));
    const skipped = new Set<string>();
    (doc.skip ?? []).forEach((s, i) => {
      if (!inGroup.has(s.employeeId) || skipped.has(s.employeeId)) error(`skip.${i}.employeeId`, 'NOT_IN_RUN', `Left out ${i + 1}: pick someone in this pay group, once.`);
      skipped.add(s.employeeId);
    });
    const seen = new Set<string>();
    (doc.amounts ?? []).forEach((a, i) => {
      if (!inGroup.has(a.employeeId) || seen.has(a.employeeId) || skipped.has(a.employeeId)) error(`amounts.${i}.employeeId`, 'NOT_IN_RUN', `Changed amount ${i + 1}: pick someone paid in this 13th-month pay, once.`);
      seen.add(a.employeeId);
    });
    if (doc.employees.length === 0 && !taken) error('payGroup', 'NOBODY', `Nobody in this pay group has basic pay or a 13th-month accrual to pay for ${doc.year}, or everyone is left out.`);
    if (doc.totalCents === 0 && doc.employees.length > 0) error('amounts', 'NOTHING', 'The 13th-month pay adds up to nothing.');
    for (const e of doc.employees) {
      if (e.amountCents < e.dueCents) {
        issues.push({ field: 'amounts', code: 'BELOW_DUE', level: 'warning', message: `${e.name}: ${formatPeso(e.amountCents)} is less than one twelfth of the basic pay, ${formatPeso(e.dueCents)} (PD 851).` });
      }
    }
    for (const e of doc.employees) {
      const done = yearEndDoneBy(ctx.db, e.employeeId, +ctx.businessDate.slice(0, 4));
      if (done) issues.push({ field: 'year', code: 'AFTER_YEAR_END', level: 'warning', message: `${done} already did ${e.name}'s year-end tax adjustment without this 13th-month pay. Cancel ${done} and work it out again after this.` });
    }
    if (ctx.businessDate > `${doc.year}-12-24`) issues.push({ field: 'year', code: 'LATE', level: 'warning', message: `The 13th month is due by ${doc.year}-12-24 (PD 851).` });
    return [...issues, ...(notesOf.get(doc) ?? [])];
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO pay_thirteenths (document_id, pay_group, year, total_cents, net_cents) VALUES (?, ?, ?, ?, ?)').run(h.documentId, doc.payGroup, doc.year, doc.totalCents, doc.netCents);
    const emp = db.prepare(
      `INSERT INTO pay_thirteenth_employees (id, document_id, employee_id, employee_code, employee_name, cost_centre, basic_cents, earlier_basic_cents, due_cents, accrued_cents,
         amount_cents, reason, other_benefits_cents, taxable_cents, wtax_cents, net_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const basis = db.prepare('INSERT INTO pay_thirteenth_basis (thirteenth_employee_id, run_employee_id) VALUES (?, ?)');
    for (const e of doc.employees) {
      const id = newId();
      emp.run(id, h.documentId, e.employeeId, e.code, e.name, e.costCentre, e.basicCents, e.earlierBasicCents, e.dueCents, e.accruedCents, e.amountCents, e.reason ?? null,
        e.otherBenefitsCents, e.taxableCents, e.wtaxCents, e.netCents);
      for (const r of e.basis) basis.run(id, r);
    }
    const skip = db.prepare('INSERT INTO pay_thirteenth_skips (document_id, employee_id, reason) VALUES (?, ?, ?)');
    for (const s of doc.skip ?? []) skip.run(h.documentId, s.employeeId, s.reason);
  },

  journal(doc, ctx) {
    const lines: DraftLine[] = [];
    for (const centre of ['production', 'office'] as const) {
      const trueUp = doc.employees.filter((e) => e.costCentre === centre).reduce((s, e) => s + e.amountCents - e.accruedCents, 0);
      const role = centre === 'production' ? 'LABOR_BENEFITS' : 'BENEFITS_OFFICE';
      lines.push({ account: { role }, ...(trueUp >= 0 ? { debitCents: trueUp } : { creditCents: -trueUp }), memo: '13th-month pay less the accrual' });
    }
    const month = ctx.businessDate.slice(0, 7);
    for (const e of doc.employees) {
      lines.push({ account: { role: 'THIRTEENTH_PAYABLE' }, party: employee(e.employeeId), debitCents: e.accruedCents, memo: '13th-month accrual paid' });
      lines.push({ account: { role: 'WTC_PAYABLE' }, party: employee(e.employeeId), creditCents: e.wtaxCents, memo: `Withholding tax ${month}` });
      lines.push({ account: { role: 'PAYROLL_PAYABLE' }, party: employee(e.employeeId), creditCents: e.netCents, memo: `13th-month pay ${doc.year}` });
    }
    if (!lines.some((l) => (l.debitCents ?? 0) + (l.creditCents ?? 0) > 0)) return null;
    return { memo: `13th-month pay ${doc.year}, ${GROUP_LABEL[doc.payGroup]}`, lines };
  },

  load(db, documentId) {
    const t = db.prepare('SELECT * FROM pay_thirteenths WHERE document_id = ?').get(documentId) as { pay_group: PayGroup; year: number; total_cents: number; net_cents: number } | undefined;
    if (!t) throw new Error(`13th-month pay ${documentId} not found`);
    const basis = db.prepare('SELECT run_employee_id FROM pay_thirteenth_basis WHERE thirteenth_employee_id = ? ORDER BY rowid').pluck();
    const employees: ThirteenthEmployee[] = (db.prepare('SELECT * FROM pay_thirteenth_employees WHERE document_id = ? ORDER BY rowid').all(documentId) as DbRow[]).map((e) => ({
      employeeId: e.employee_id, code: e.employee_code, name: e.employee_name, costCentre: e.cost_centre, basicCents: e.basic_cents, earlierBasicCents: e.earlier_basic_cents,
      dueCents: e.due_cents, accruedCents: e.accrued_cents, amountCents: e.amount_cents, ...(e.reason ? { reason: e.reason } : {}), otherBenefitsCents: e.other_benefits_cents,
      taxableCents: e.taxable_cents, wtaxCents: e.wtax_cents, netCents: e.net_cents, basis: basis.all(e.id) as string[],
    }));
    const amounts = employees.filter((e) => e.reason).map((e) => ({ employeeId: e.employeeId, amountCents: e.amountCents, reason: e.reason! }));
    const skip = db.prepare('SELECT employee_id AS employeeId, reason FROM pay_thirteenth_skips WHERE document_id = ? ORDER BY rowid').all(documentId) as { employeeId: string; reason: string }[];
    return { payGroup: t.pay_group, year: t.year, ...(amounts.length ? { amounts } : {}), ...(skip.length ? { skip } : {}), employees, netCents: t.net_cents, totalCents: t.total_cents };
  },

  toInput(doc) {
    const { payGroup, year, amounts, skip } = doc;
    return { payGroup, year, ...(amounts?.length ? { amounts } : {}), ...(skip?.length ? { skip } : {}) };
  },

  /** Its releases are cancelled first (D6, G-29), and year-end runs recorded after it that counted it in an employee's year. */
  dependents(db, documentId) {
    return db
      .prepare(
        `SELECT d.id, d.number FROM pay_thirteenth_releases r JOIN documents d ON d.id = r.document_id WHERE r.thirteenth_id = @id AND d.status = 'posted'
         UNION
         SELECT d.id, d.number FROM pay_run_year_end y JOIN pay_run_employees e ON e.id = y.run_employee_id JOIN documents d ON d.id = e.document_id
           JOIN documents t ON t.id = @id
         WHERE d.status = 'posted' AND d.rowid > t.rowid AND y.year = CAST(substr(t.business_date, 1, 4) AS INTEGER)
           AND EXISTS (SELECT 1 FROM pay_thirteenth_employees x WHERE x.document_id = @id AND x.employee_id = e.employee_id)
         ORDER BY 2`,
      )
      .all({ id: documentId }) as { id: string; number: string }[];
  },

  summary(doc) {
    const n = doc.employees.length;
    return `This will record the ${doc.year} 13th-month pay of the ${GROUP_LABEL[doc.payGroup]} group: ${n} ${n === 1 ? 'employee' : 'employees'}, ${formatPeso(doc.totalCents)}, net pay ${formatPeso(doc.netCents)} to be released.`;
  },

  /** A pay group with someone in it this year and no 13th-month pay recorded yet; now and then someone left out or an amount changed. */
  arbitrary(db) {
    const year = +((lastAuditAt(db) ?? '').slice(0, 4) || '2026');
    const groups = PAY_GROUPS.filter((g) => !recordedFor(db, g, year) && employeesInGroup(db, g, `${year}-01-01`, `${year}-12-31`).length);
    if (!groups.length) throw new Error('No 13th-month pay to work out');
    return fc.constantFrom(...groups).chain((payGroup) => {
      const people = employeesInGroup(db, payGroup, `${year}-01-01`, `${year}-12-31`).map((e) => e.id);
      return fc
        .record({
          change: fc.option(fc.record({ employeeId: fc.constantFrom(...people), amountCents: fc.integer({ min: 0, max: 50_000_00 }) }), { nil: undefined }),
          leaveOut: fc.option(fc.constantFrom(...people), { nil: undefined }),
        })
        .map(({ change, leaveOut }) => ({
          payGroup, year,
          ...(change && change.employeeId !== leaveOut ? { amounts: [{ ...change, reason: 'Agreed with the employee (made up)' }] } : {}),
          ...(leaveOut ? { skip: [{ employeeId: leaveOut, reason: 'Paid on separation earlier (made up)' }] } : {}),
        }));
    });
  },
};
