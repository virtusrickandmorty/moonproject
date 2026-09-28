/**
 * The payroll run algorithm (PLAN F3), server-side and deterministic. For each employee of the pay group in service
 * during the period: earnings from attendance (days × the daily rate of that day, holidays and rest days at the DOLE
 * rates, overtime), the half-month salary of monthly staff, unpaid piece work up to the period end (PRD), and manual
 * lines; then SSS, PhilHealth and Pag-IBIG for the contribution month as a month-to-date true-up, withholding tax for
 * the period, government loan amortizations (once a month, loans.ts), the cash-advance instalment, net pay and the
 * 13th-month accrual. On a year-end run the tax is the year-end adjustment instead (year-end.ts): a deficiency withheld,
 * or an excess refunded (net pay more by it). Warnings go with the result.
 * Unused SIL (F1, Labor Code Art. 95) is paid in cash on an employee's final pay, and on a December run with "Pay unused
 * leave": the days left × the daily rate absences use; de minimis up to 10 days a year (RR 11-2018), taxable above;
 * not 13th-month basic. An employee separated within the period gets their final pay: the unused leave, the year-end
 * tax adjustment whatever the month, and the whole cash advance as far as the pay allows; government loans left are
 * warned, not deducted.
 */
import { divRoundHalfAway, formatPeso, type Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { attendanceBetween, employeesInGroup, holidaysBetween, payProfileAt, silOf, type Employee, type Holiday, type PayGroup, type PayProfile } from '../EMP/public.ts';
import { pieceEarningsByDay, stepById, unpaidAssignments } from '../PRD/public.ts';
import { jobOrderRef } from '../JO/public.ts';
import { advanceSchedule } from '../CA/public.ts';
import { KIND_LABEL, govLoan, loanInMonth, loansOf, runsIn, type Agency, type LoanKind } from './loans.ts';
import { hdmfMonthly, hdmfRateAt, phicDailyBasis, phicMonthly, phicRateAt, rulesAt, sssMonthly, sssRateAt, withholding, wtaxTableAt, type PayRules, type TaxFrequency } from './statutory.ts';
import { addLine, figures, yearParts } from './year-end.ts';

/** 'unused_leave' is unused SIL paid in cash; stored as a 'leave' line marked in pay_run_unused_leave (migration 0005). */
export type LineKind = 'basic' | 'leave' | 'holiday' | 'rest_day' | 'ot' | 'salary' | 'absence' | 'piece' | 'allowance' | 'adjustment' | 'unused_leave';
export interface RunLine {
  lineNo: number; kind: LineKind; description: string; qty: number; rateCents: number; multiplierBp: number; amountCents: number;
  taxable: boolean; thirteenthBase: boolean; assignmentId?: string; jobOrderId?: string; reason?: string; leaveYear?: number;
}
export interface RunEmployee {
  employeeId: string; code: string; name: string; costCentre: 'production' | 'office'; payType: PayProfile['payType']; isMwe: boolean; lines: RunLine[];
  grossCents: number; pieceCents: number; taxableCents: number; sssMscCents: number; sssEeCents: number; sssErCents: number; sssEcCents: number;
  phicBasisCents: number; phicEeCents: number; phicErCents: number; hdmfEeCents: number; hdmfErCents: number; eeShortCents: number;
  wtaxCents: number; loanCents: number; loans: RunLoan[]; caCents: number; caOverrideCents: number | null; thirteenthCents: number; netCents: number;
  /** Tax withheld earlier in the year and refunded on this run (the year-end adjustment's excess); net pay includes it. */
  wtaxRefundCents: number; yearEnd?: YearEnd; final?: FinalPay;
}
/** An employee separated within the run's period: this run is their final pay. What they still owe after it. */
export interface FinalPay { separatedOn: string; caLeftCents: number; loansLeftCents: number }
/**
 * One employee's year-end tax adjustment on a run (year-end.ts): the year's taxable compensation (a previous employer's
 * included) and the part of it from 13th-month pay and other benefits above the ceiling, the annual tax, what the year
 * withheld before this run, and the difference: a deficiency (withheld on this run as far as net pay allows; the rest
 * is `shortCents`) or a refund.
 */
export interface YearEnd {
  year: number; taxableCents: number; benefitsTaxableCents: number; annualTaxCents: number; withheldBeforeCents: number;
  deficiencyCents: number; withheldCents: number; shortCents: number; refundCents: number;
}
/** One government loan's deduction on a run: the plan or the amount typed (with its note), what net pay allowed, what is left. */
export interface RunLoan {
  loanId: string; agency: Agency; kind: LoanKind; loanNo: string; dueCents: number; amountCents: number; overrideCents: number | null; reason?: string; balanceAfterCents: number;
}
export interface LoanOverride { amountCents: number; reason: string }
export interface ManualLine { employeeId: string; kind: 'allowance' | 'adjustment'; amountCents: number; reason: string }

const THIRTEENTH_BASE = new Set<LineKind>(['basic', 'leave', 'salary', 'absence', 'piece']); // basic pay only (PD 851)
const ALWAYS_TAXABLE = new Set<LineKind>(['allowance', 'adjustment']); // an MWE's SMW, holiday pay and overtime are exempt (F1)
export const TAX_FREQUENCY: Record<PayGroup, Exclude<TaxFrequency, 'monthly'>> = { WEEKLY_PIECE: 'weekly', SEMI_DAILY: 'semi_monthly', SEMI_MONTHLY: 'semi_monthly' };

const pct = (bp: number) => `${bp / 100}%`;
/** Monetized unused leave up to 10 days a year is a de minimis benefit (RR 11-2018): not taxable up to that. */
export const DE_MINIMIS_LEAVE_DAYS = 10;
export const addDays = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, day! + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8))) / 86_400_000) + 1;

/** The period a start date opens (F2): Monday to Saturday for the weekly piece group, 1–15 or 16–end otherwise; undefined if it opens none. */
export function periodEndOf(payGroup: PayGroup, start: string): string | undefined {
  if (payGroup === 'WEEKLY_PIECE') return new Date(`${start}T00:00:00Z`).getUTCDay() === 1 ? addDays(start, 5) : undefined;
  const day = start.slice(8);
  if (day === '01') return `${start.slice(0, 8)}15`;
  if (day === '16') return addDays(`${addDays(`${start.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1); // the last day of the month
  return undefined;
}

const DAY = 1000; // a day's quantity (days are stored × 1000)
/** Equivalent daily rate of monthly pay (× 12 ÷ 313 for a 6-day week, ÷ 261 for 5), for absences, premiums and overtime. */
const edr = (p: PayProfile, days6: number, days5: number) => divRoundHalfAway(p.monthlyRateCents! * 12, p.workweekDays === 6 ? days6 : days5);

interface Built { lines: RunLine[]; notes: Issue[]; daysWorked: number }

const WORKED = new Set(['present', 'half_day', 'holiday_worked', 'rest_day_worked']);

/**
 * A piece worker's pay for a regular holiday not worked (F1, DOLE): the average daily earnings of the last 7 workdays
 * before it, not below the minimum wage (payroll Example B). Workdays are days with piece work or attendance marked
 * worked, in the 31 days before; earnings are the work and rework pieces of those days.
 */
function pieceHolidayRate(db: Db, employeeId: string, date: string, minimumWageCents: number): { rateCents: number; days: number } {
  const [from, to] = [addDays(date, -31), addDays(date, -1)];
  const earned = new Map(pieceEarningsByDay(db, employeeId, from, to).map((x) => [x.date, x.amountCents]));
  const worked = attendanceBetween(db, from, to, employeeId).filter((d) => WORKED.has(d.status)).map((d) => d.date);
  const days = [...new Set([...earned.keys(), ...worked])].sort().slice(-7);
  const average = days.length ? divRoundHalfAway(days.reduce((s, d) => s + (earned.get(d) ?? 0), 0), days.length) : 0;
  return { rateCents: Math.max(average, minimumWageCents), days: days.length };
}

/**
 * Unused SIL of the year of `to` paid in cash: the days left once the employee is eligible on `to`, at the daily rate
 * absences use (monthly pay's equivalent daily rate; a piece worker's average daily pay of the last 7 workdays, not
 * below the minimum wage, as for a holiday). The first 10 days of the year paid in cash are de minimis, the rest taxable.
 */
function unusedLeave(db: Db, employeeId: string, to: string, p: PayProfile, factors: { days6: number; days5: number }): RunLine[] {
  const year = +to.slice(0, 4);
  const sil = silOf(db, employeeId, year);
  if (to < sil.eligibleFrom || sil.left === 0) return [];
  let rate = p.dailyRateCents ?? 0;
  let basis = '';
  if (p.payType === 'monthly') rate = edr(p, factors.days6, factors.days5);
  else if (p.payType === 'piece') {
    const min = rulesAt(db, to).minimumWageCents;
    const pay = pieceHolidayRate(db, employeeId, addDays(to, 1), min);
    rate = pay.rateCents;
    basis = pay.rateCents === min ? ' at the minimum wage' : ` at the average of the last ${pay.days} workdays`;
  }
  const exempt = Math.min(sil.left, Math.max(0, DE_MINIMIS_LEAVE_DAYS - sil.paid));
  const line = (days: number, taxable: boolean, more: string): RunLine => ({
    lineNo: 0, kind: 'unused_leave', description: `Unused leave (SIL) ${year}${basis}${more}`, qty: days * DAY, rateCents: rate, multiplierBp: 10_000, amountCents: rate * days,
    taxable, thirteenthBase: false, leaveYear: year,
  });
  return [...(exempt ? [line(exempt, false, '')] : []), ...(sil.left > exempt ? [line(sil.left - exempt, true, `, above the ${DE_MINIMIS_LEAVE_DAYS} de minimis days`)] : [])];
}

/** Earning lines of one employee for the period. */
function earnings(
  db: Db, e: Employee, period: { start: string; end: string }, from: string, to: string, end: PayProfile, holidays: Map<string, Holiday>, manual: ManualLine[], factors: { days6: number; days5: number },
): Built {
  const notes: Issue[] = [];
  const note = (code: string, message: string) => notes.push({ code, message, level: 'warning' });
  const groups = new Map<string, Omit<RunLine, 'lineNo' | 'amountCents'> & { per: number }>();
  let daysWorked = 0;
  const add = (kind: LineKind, description: string, qty: number, rateCents: number, multiplierBp: number, per: number) => {
    const key = `${kind}|${description}|${rateCents}|${multiplierBp}`;
    const g = groups.get(key);
    if (g) g.qty += qty;
    else groups.set(key, { kind, description, qty, rateCents, multiplierBp, per, taxable: ALWAYS_TAXABLE.has(kind) || !end.isMwe, thirteenthBase: THIRTEENTH_BASE.has(kind) });
  };
  const manualNeeded = new Set<string>();

  for (const d of attendanceBetween(db, from, to, e.id)) {
    const p = payProfileAt(db, e.id, d.date);
    if (!p) {
      note('NO_PAY', `${e.name}: no pay is set on ${d.date}, so that day is not paid.`);
      continue;
    }
    const r: PayRules = rulesAt(db, d.date);
    const h = holidays.get(d.date);
    if (WORKED.has(d.status)) daysWorked += d.status === 'half_day' ? 0.5 : 1;
    if (p.payType === 'piece') {
      if (d.otMinutes > 0) manualNeeded.add('overtime');
      if (h?.kind === 'regular' && d.status === 'holiday_off') {
        const pay = pieceHolidayRate(db, e.id, d.date, r.minimumWageCents);
        const basis = pay.rateCents === r.minimumWageCents ? 'the minimum wage' : `average of the last ${pay.days} workdays`;
        add('holiday', `Regular holiday, not worked (${pct(r.regHolidayOffBp)} of ${basis})`, DAY, pay.rateCents, r.regHolidayOffBp, DAY);
      }
      continue;
    }
    const monthly = p.payType === 'monthly';
    const rate = monthly ? edr(p, factors.days6, factors.days5) : p.dailyRateCents!;
    let dayBp = 10_000;
    switch (d.status) {
      case 'present':
        if (!monthly) add('basic', 'Days worked', DAY, rate, 10_000, DAY);
        break;
      case 'half_day':
        if (monthly) add('absence', 'Absent, no work no pay', DAY / 2, rate, -10_000, DAY);
        else add('basic', 'Days worked', DAY / 2, rate, 10_000, DAY);
        break;
      case 'leave':
        if (!monthly) add('leave', 'Paid leave (SIL)', DAY, rate, 10_000, DAY);
        break;
      case 'absent':
      case 'unpaid_leave':
        if (monthly) add('absence', 'Absent, no work no pay', DAY, rate, -10_000, DAY);
        break;
      case 'holiday_off':
        if (h?.kind === 'regular' && !monthly) add('holiday', `Regular holiday, not worked (${pct(r.regHolidayOffBp)})`, DAY, rate, r.regHolidayOffBp, DAY);
        break;
      // A day worked at a premium is a day of basic pay (the 13th-month base, PD 851) plus the premium, which is not
      // (payroll Example A). Monthly pay already covers a holiday itself, so monthly staff get its premium only.
      case 'holiday_worked':
        dayBp = h?.kind === 'regular' ? r.regHolidayWorkedBp : r.specialWorkedBp;
        if (!monthly) add('basic', 'Days worked', DAY, rate, 10_000, DAY);
        add('holiday', `${h?.kind === 'regular' ? 'Regular holiday' : 'Special day'} worked, premium (${pct(dayBp - 10_000)})`, DAY, rate, dayBp - 10_000, DAY);
        break;
      case 'rest_day_worked':
        dayBp = h ? (h.kind === 'regular' ? r.regHolidayRestBp : r.specialRestBp) : r.restDayWorkedBp;
        add('basic', monthly ? 'Rest days worked' : 'Days worked', DAY, rate, 10_000, DAY);
        add(h ? 'holiday' : 'rest_day', `${h ? `Rest day on a ${h.kind === 'regular' ? 'regular holiday' : 'special day'}` : 'Rest day worked'}, premium (${pct(dayBp - 10_000)})`, DAY, rate, dayBp - 10_000, DAY);
        break;
      case 'rest_day':
        break;
    }
    if (d.otMinutes > 0) {
      const otBp = d.status === 'present' ? r.otOrdinaryBp : divRoundHalfAway(dayBp * r.otPremiumBp, 10_000);
      add('ot', `Overtime (${pct(otBp)} of the hourly rate)`, d.otMinutes, rate, otBp, 480); // hourly = daily ÷ 8; qty in minutes
    }
  }
  if (manualNeeded.size) note('ADD_BY_HAND', `${e.name} is paid per piece: add ${[...manualNeeded].join(' and ')} as a manual line.`);

  if (end.payType === 'monthly') {
    const half = divRoundHalfAway(end.monthlyRateCents!, 2);
    const full = daysBetween(period.start, period.end);
    const service = daysBetween(from, to); // from hire, to the last day, within the period
    if (service >= full) add('salary', 'Half-month salary', 1, half, 10_000, 1);
    else {
      add('salary', `Half-month salary, ${service} of ${full} days`, 1, divRoundHalfAway(half * service, full), 10_000, 1);
      note('PRORATED', `${e.name}: the half-month salary is prorated to ${service} of ${full} days of service.`);
    }
  }

  const lines: RunLine[] = [...groups.values()].map(({ per, ...g }) => ({ ...g, lineNo: 0, amountCents: divRoundHalfAway(g.rateCents * g.qty * g.multiplierBp, per * 10_000) }));

  const piecePaid = end.payType === 'piece' || end.payType === 'mixed';
  let heldBack = 0;
  for (const a of unpaidAssignments(db, to, e.id)) {
    if (!piecePaid && a.amountCents !== 0) {
      heldBack += a.amountCents;
      continue;
    }
    const jo = jobOrderRef(db, a.jobOrderId)?.number ?? 'JO';
    const what = a.kind === 'rework' ? 'rework' : a.kind === 'correction' ? 'correction' : 'pcs';
    lines.push({
      lineNo: 0, kind: 'piece', description: `${jo} ${stepById(db, a.stepId)?.name ?? 'step'} ${a.workDate}, ${a.pieces} ${what}`, qty: a.pieces, rateCents: a.rateCents,
      multiplierBp: 10_000, amountCents: a.amountCents, taxable: !end.isMwe, thirteenthBase: true, assignmentId: a.id, jobOrderId: a.jobOrderId,
    });
  }
  if (heldBack) note('PIECE_NOT_PAID', `${e.name} has ${formatPeso(heldBack)} of piece work but is not paid per piece, so it stays unpaid. Change the pay to "daily and per piece" to pay it.`);

  for (const m of manual) {
    lines.push({ lineNo: 0, kind: m.kind, description: m.reason, qty: 1, rateCents: m.amountCents, multiplierBp: 10_000, amountCents: m.amountCents, taxable: true, thirteenthBase: false, reason: m.reason });
  }
  lines.forEach((l, i) => (l.lineNo = i + 1));
  return { lines, notes, daysWorked };
}

/** What was already taken for the contribution month by recorded runs (the true-up base, F3). */
function monthSoFar(db: Db, employeeId: string, month: string) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(e.gross_cents), 0) AS gross, COALESCE(SUM(e.piece_cents), 0) AS piece, COALESCE(SUM(e.sss_ee_cents), 0) AS sssEe, COALESCE(SUM(e.sss_er_cents), 0) AS sssEr,
         COALESCE(SUM(e.sss_ec_cents), 0) AS sssEc, COALESCE(SUM(e.phic_ee_cents), 0) AS phicEe, COALESCE(SUM(e.phic_er_cents), 0) AS phicEr,
         COALESCE(SUM(e.hdmf_ee_cents), 0) AS hdmfEe, COALESCE(SUM(e.hdmf_er_cents), 0) AS hdmfEr
       FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND e.employee_id = ? AND r.contribution_month = ?`,
    )
    .get(employeeId, month) as Record<'gross' | 'piece' | 'sssEe' | 'sssEr' | 'sssEc' | 'phicEe' | 'phicEr' | 'hdmfEe' | 'hdmfEr', number>;
}

export interface RunRequest {
  payGroup: PayGroup; periodStart: string; periodEnd: string; payDate: string; manual: ManualLine[]; caOverrides: Map<string, number>; skipped: Set<string>;
  loanOverrides?: Map<string, LoanOverride>;
  /** The year-end tax adjustment of every employee in the run, instead of the period's table (a period ending in December). */
  yearEnd?: boolean;
  /** Pay every employee's unused SIL days of the year in cash (a period ending in December). */
  unusedLeave?: boolean;
}

/**
 * Government loans are deducted by default on runs whose period ends on or after the 16th of the contribution month:
 * the pay group's first such run takes the month's amortization; a later one only if no recorded run of the month
 * dealt with the loan yet (the employee was left out of the first one, say). A ₱0 typed on a run skips the month.
 */
export const takesLoans = (periodEnd: string) => periodEnd.slice(8) >= '16';

/** Works out the whole run. Employees skipped on purpose are left out; their piece work stays unpaid. */
export function workOut(db: Db, q: RunRequest): { employees: RunEmployee[]; notes: Issue[] } {
  const notes: Issue[] = [];
  const month = q.periodEnd.slice(0, 7);
  const first = `${month}-01`;
  const [sss, phic, hdmf] = [sssRateAt(db, first), phicRateAt(db, first), hdmfRateAt(db, first)];
  const table = wtaxTableAt(db, TAX_FREQUENCY[q.payGroup], q.payDate);
  const holidays = new Map(holidaysBetween(db, q.periodStart, q.periodEnd).map((h) => [h.date, h]));
  const endRules = rulesAt(db, q.periodEnd);
  const employees: RunEmployee[] = [];

  for (const e of employeesInGroup(db, q.payGroup, q.periodStart, q.periodEnd)) {
    if (q.skipped.has(e.id)) continue;
    const from = e.hireDate > q.periodStart ? e.hireDate : q.periodStart;
    const to = e.separatedOn && e.separatedOn < q.periodEnd ? e.separatedOn : q.periodEnd;
    const end = payProfileAt(db, e.id, to)!; // employeesInGroup found it
    const built = earnings(db, e, { start: q.periodStart, end: q.periodEnd }, from, to, end, holidays, q.manual.filter((m) => m.employeeId === e.id), phic);
    notes.push(...built.notes);
    // Separated within the period: this run is the final pay (F3 "separation").
    const final = !!e.separatedOn && e.separatedOn >= q.periodStart && e.separatedOn <= q.periodEnd;
    if (final) notes.push({ code: 'FINAL_PAY', level: 'warning', message: `${e.name} left on ${e.separatedOn}: this is the final pay, with unused leave, the year-end tax adjustment and the cash advance still owed.` });
    if (final || q.unusedLeave) {
      built.lines.push(...unusedLeave(db, e.id, to, end, phic));
      built.lines.forEach((l, i) => (l.lineNo = i + 1));
    }
    const gross = built.lines.reduce((s, l) => s + l.amountCents, 0);
    const piece = built.lines.filter((l) => l.kind === 'piece').reduce((s, l) => s + l.amountCents, 0);

    // Contributions for month M as a true-up: the month's share on month-to-date pay, less what earlier runs took.
    const so = monthSoFar(db, e.id, month);
    const clampNote = (scheme: string, n: number) => (n < 0 && notes.push({ code: 'LESS_THAN_TAKEN', level: 'warning', message: `${e.name}: ${scheme} for ${month} is now less than earlier runs took (${formatPeso(-n)}). Tell the accountant.` }), Math.max(0, n));
    const sssDue = e.statutory.sss ? sssMonthly(sss, so.gross + gross) : { mscCents: 0, ee: 0, er: 0, ec: 0 };
    // PhilHealth basis: the monthly rate; the daily rate × 313/12 (261/12) plus any piece pay; for piece workers the month's
    // piece pay, but at least the minimum wage's monthly equivalent once they earn any (payroll Example B).
    const monthPiece = so.piece + piece;
    const phicBasis =
      end.payType === 'monthly' ? end.monthlyRateCents!
      : end.payType === 'piece' ? (monthPiece > 0 ? Math.max(monthPiece, phicDailyBasis(phic, endRules.minimumWageCents, end.workweekDays)) : 0)
      : phicDailyBasis(phic, end.dailyRateCents!, end.workweekDays) + (end.payType === 'mixed' ? monthPiece : 0);
    const phicDue = e.statutory.phic ? phicMonthly(phic, phicBasis) : { basisCents: 0, ee: 0, er: 0 };
    const hdmfDue = e.statutory.hdmf ? hdmfMonthly(hdmf, so.gross + gross) : { ee: 0, er: 0 };
    const due = { sss: clampNote('SSS', sssDue.ee - so.sssEe), phic: clampNote('PhilHealth', phicDue.ee - so.phicEe), hdmf: clampNote('Pag-IBIG', hdmfDue.ee - so.hdmfEe) };

    // Employee shares first, then tax, then the cash advance (F3 deduction order); never below zero.
    let left = Math.max(0, gross);
    const take = (n: number) => {
      const t = Math.min(n, left);
      left -= t;
      return t;
    };
    const ee = { sss: take(due.sss), phic: take(due.phic), hdmf: take(due.hdmf) };
    const short = due.sss + due.phic + due.hdmf - ee.sss - ee.phic - ee.hdmf;
    if (short > 0) notes.push({ code: 'EE_SHORT', level: 'warning', message: `${e.name}: the pay does not cover ${formatPeso(short)} of government shares; the next run this month takes it.` });
    const taxableLines = built.lines.filter((l) => l.taxable).reduce((s, l) => s + l.amountCents, 0);
    const taxable = Math.max(0, taxableLines - (end.isMwe ? 0 : ee.sss + ee.phic + ee.hdmf));
    let wtax = 0;
    let refund = 0;
    let yearEnd: YearEnd | undefined;
    if (e.statutory.wtax && (q.yearEnd || final)) {
      // Year-end adjustment (RR 11-2018): the annual tax on the year's pay with this run, less what the year withheld
      // before it. A deficiency is withheld here as far as the pay allows (after the shares, before loans and the cash
      // advance, F3); an excess is refunded on this run.
      const year = +q.periodEnd.slice(0, 4);
      const parts = yearParts(db, e.id, year);
      const before = figures(parts, end.isMwe);
      const comp = { ...parts.comp };
      for (const l of built.lines) addLine(comp, l);
      if (!end.isMwe) comp.sharesCents += ee.sss + ee.phic + ee.hdmf;
      const f = figures({ ...parts, comp }, end.isMwe);
      const deficiency = Math.max(0, f.i24TaxDueCents - before.i26WithheldCents);
      wtax = take(deficiency);
      refund = Math.max(0, before.i26WithheldCents - f.i24TaxDueCents);
      yearEnd = {
        year, taxableCents: f.i23GrossTaxableCents, benefitsTaxableCents: f.i48TaxableBenefitsCents, annualTaxCents: f.i24TaxDueCents, withheldBeforeCents: before.i26WithheldCents,
        deficiencyCents: deficiency, withheldCents: wtax, shortCents: deficiency - wtax, refundCents: refund,
      };
      if (wtax < deficiency) {
        notes.push({ code: 'YEAR_END_SHORT', level: 'warning', message: `${e.name}: the pay covers ${formatPeso(wtax)} of the ${formatPeso(deficiency)} tax still due for ${year}; ${formatPeso(deficiency - wtax)} is not withheld. Collect it from ${e.name} and tell the accountant.` });
      }
    } else if (e.statutory.wtax) wtax = take(withholding(table, taxable));
    else if (q.yearEnd || final) notes.push({ code: 'YEAR_END_NO_WTAX', level: 'warning', message: `${e.name}: withholding tax is switched off, so no year-end tax adjustment is worked out.` });
    // Government loans (F3: after tax, before the cash advance): the month's amortization, never more than is left of
    // the loan, nor than the pay left after shares and tax; less is deducted with a warning, the rest stays owed.
    const loans: RunLoan[] = [];
    const typed = new Map([...(q.loanOverrides ?? [])].filter(([id]) => govLoan(db, id)?.employeeId === e.id));
    for (const l of loansOf(db, e.id)) {
      const o = typed.get(l.id);
      const at = loanInMonth(db, l, month);
      const planned = at.state === 'running' && !at.handled && takesLoans(q.periodEnd) ? Math.min(l.amortizationCents, at.leftCents) : 0;
      if (!o && planned === 0) continue;
      const due = o ? o.amountCents : planned;
      const amount = take(Math.min(due, at.leftCents));
      if (amount < due) {
        notes.push({ code: 'LOAN_REDUCED', level: 'warning', message: `${e.name}: the pay covers ${formatPeso(amount)} of the ${formatPeso(due)} due on ${l.agency === 'SSS' ? 'SSS' : 'Pag-IBIG'} loan ${l.loanNo}; the rest stays owed on the loan.` });
      }
      loans.push({
        loanId: l.id, agency: l.agency, kind: l.kind, loanNo: l.loanNo, dueCents: due, amountCents: amount, overrideCents: o ? o.amountCents : null,
        ...(o ? { reason: o.reason } : {}), balanceAfterCents: at.leftCents - amount,
      });
    }
    const loanCents = loans.reduce((s, l) => s + l.amountCents, 0);
    const plan = advanceSchedule(db, e.id, q.payDate);
    const override = q.caOverrides.get(e.id);
    // A final pay deducts all that is owed, down to nothing left of the pay (the minimum net pay is for pay between
    // paydays); the tax refund is not used (pay_run_employees.net_cents, before the refund, stays at least zero).
    const wanted = override ?? (final ? Math.max(0, plan.outstandingCents) : plan.installmentCents);
    const ca = Math.max(0, Math.min(wanted, final ? left : left - endRules.minNetPayCents));
    if (ca < wanted && !final) notes.push({ code: 'CA_REDUCED', level: 'warning', message: `${e.name}: the cash-advance deduction is ${formatPeso(ca)} instead of ${formatPeso(wanted)}, so net pay stays at least ${formatPeso(endRules.minNetPayCents)}.` });
    left -= ca;
    let finalPay: FinalPay | undefined;
    if (final) {
      const caLeft = Math.max(0, plan.outstandingCents - ca);
      if (caLeft > 0) notes.push({ code: 'CA_LEFT', level: 'warning', message: `${e.name}: ${formatPeso(caLeft)} of cash advances is still owed after the final pay. Collect it (cash repayment) or have the accountant write it off.` });
      // Government loans are not deducted beyond the month's amortization: the employee settles the rest with SSS or Pag-IBIG.
      let loansLeft = 0;
      for (const l of loansOf(db, e.id)) {
        if (runsIn(l, month) === 'stopped') continue;
        const owed = loans.find((x) => x.loanId === l.id)?.balanceAfterCents ?? loanInMonth(db, l, month).leftCents;
        if (owed <= 0) continue;
        loansLeft += owed;
        notes.push({ code: 'LOAN_LEFT', level: 'warning', message: `${e.name}: ${formatPeso(owed)} is left of ${KIND_LABEL[l.kind]} ${l.loanNo}, not deducted from the final pay. Tell ${l.agency === 'SSS' ? 'SSS' : 'Pag-IBIG'} of the separation.` });
      }
      finalPay = { separatedOn: e.separatedOn!, caLeftCents: caLeft, loansLeftCents: loansLeft };
    }

    // Minimum wage (ACC-06b default: warn only).
    const smw = endRules.minimumWageCents;
    if (end.dailyRateCents !== null && end.dailyRateCents < smw) notes.push({ code: 'MIN_WAGE', level: 'warning', message: `${e.name}: the daily rate ${formatPeso(end.dailyRateCents)} is below the minimum wage ${formatPeso(smw)}.` });
    if (end.payType === 'piece' && built.daysWorked > 0 && piece < built.daysWorked * smw) {
      notes.push({ code: 'MIN_WAGE', level: 'warning', message: `${e.name}: piece pay ${formatPeso(piece)} for ${built.daysWorked} days worked is below the minimum wage (${formatPeso(Math.round(built.daysWorked * smw))}).` });
    }
    if ((end.payType === 'daily' || end.payType === 'mixed') && !attendanceBetween(db, from, to, e.id).length) notes.push({ code: 'NO_ATTENDANCE', level: 'warning', message: `${e.name}: no attendance is typed for these days.` });

    const base13 = built.lines.filter((l) => l.thirteenthBase).reduce((s, l) => s + l.amountCents, 0);
    employees.push({
      employeeId: e.id, code: e.code, name: e.name, costCentre: e.costCentre, payType: end.payType, isMwe: end.isMwe, lines: built.lines,
      grossCents: gross, pieceCents: piece, taxableCents: taxable, sssMscCents: sssDue.mscCents, sssEeCents: ee.sss,
      sssErCents: clampNote('SSS (employer)', sssDue.er - so.sssEr), sssEcCents: clampNote('SSS EC', sssDue.ec - so.sssEc),
      phicBasisCents: phicDue.basisCents, phicEeCents: ee.phic, phicErCents: clampNote('PhilHealth (employer)', phicDue.er - so.phicEr),
      hdmfEeCents: ee.hdmf, hdmfErCents: clampNote('Pag-IBIG (employer)', hdmfDue.er - so.hdmfEr), eeShortCents: short,
      wtaxCents: wtax, loanCents, loans, caCents: ca, caOverrideCents: override ?? null, thirteenthCents: endRules.accrue13th ? Math.max(0, divRoundHalfAway(base13, 12)) : 0,
      netCents: gross - ee.sss - ee.phic - ee.hdmf - wtax - loanCents - ca + refund, wtaxRefundCents: refund, ...(yearEnd ? { yearEnd } : {}), ...(finalPay ? { final: finalPay } : {}),
    });
  }
  return { employees, notes };
}
