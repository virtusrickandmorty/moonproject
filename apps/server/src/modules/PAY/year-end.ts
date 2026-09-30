/**
 * The year's compensation and tax of an employee (PLAN F3 year-end adjustment, F4 2316 and 1604-C; BIR RR 11-2018,
 * RMC 21-2010): pay before Moonproject and a previous employer's (prior.ts), every recorded payroll run whose period ends
 * in the year, and the 13th-month pay recorded in the year (TH13-), put in the parts of BIR Form 2316 (IV-A, IV-B).
 *   annual taxable = taxable compensation + (13th-month pay and other benefits above the ceiling) − employee shares
 *   annual tax     = the annual table (statutory.ts) on it; the adjustment = annual tax − tax withheld in the year
 * A minimum wage earner's minimum wage and its holiday, rest-day and overtime pay are exempt (their run lines are not
 * taxable); only other pay is taxed. As in the payroll run and the 1601-C, an MWE's shares are not taken off taxable pay.
 * The payroll run works out the adjustment with `figures` over `yearParts` plus the run itself (run-calc.ts).
 */
import { divRoundHalfAway } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { employee, governmentIds, payProfileAt, type Employee } from '../EMP/public.ts';
import { annualTableAt, benefitCeilingAt, phicRateAt, rulesAt, withholding, type Bracket } from './statutory.ts';

export interface PriorPay {
  id: string; employeeId: string; employeeName: string; year: number; source: 'before' | 'previous'; employerName: string | null; employerTin: string | null;
  grossCents: number; benefitsCents: number; deMinimisCents: number; sssCents: number; phicCents: number; hdmfCents: number; otherNontaxCents: number;
  taxableCents: number; wtaxCents: number; note: string | null; version: number; createdAt: string; updatedAt: string;
}
const PRIOR = `SELECT p.id, p.employee_id AS employeeId, e.full_name AS employeeName, p.year, p.source, p.employer_name AS employerName, p.employer_tin AS employerTin,
  p.gross_cents AS grossCents, p.benefits_cents AS benefitsCents, p.de_minimis_cents AS deMinimisCents, p.sss_cents AS sssCents, p.phic_cents AS phicCents,
  p.hdmf_cents AS hdmfCents, p.other_nontax_cents AS otherNontaxCents, p.taxable_cents AS taxableCents, p.wtax_cents AS wtaxCents, p.note, p.version,
  p.created_at AS createdAt, p.updated_at AS updatedAt FROM pay_prior_pay p JOIN emp_employees e ON e.id = p.employee_id`;

/** Pay before Moonproject rows, newest year first, 'before' before 'previous'. */
export function priorRows(db: Db, q: { id?: string; employeeId?: string; year?: number; source?: 'before' | 'previous' }): PriorPay[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  for (const [k, col] of [['id', 'p.id'], ['employeeId', 'p.employee_id'], ['year', 'p.year'], ['source', 'p.source']] as const) {
    if (q[k] !== undefined) (where.push(`${col} = ?`), args.push(q[k]!));
  }
  return db.prepare(`${PRIOR} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.year DESC, p.source, e.full_name`).all(...args) as PriorPay[];
}

/** The recorded payroll run that did an employee's year-end adjustment for a year, if one stands. */
export const yearEndDoneBy = (db: Db, employeeId: string, year: number) =>
  db
    .prepare(
      `SELECT d.number FROM pay_run_year_end y JOIN pay_run_employees e ON e.id = y.run_employee_id JOIN documents d ON d.id = e.document_id
       WHERE d.status = 'posted' AND e.employee_id = ? AND y.year = ?`,
    )
    .pluck()
    .get(employeeId, year) as string | undefined;

/**
 * Payroll pay by 2316 part. Taxable lines: basic pay (with holiday and rest-day pay), overtime, other (allowances,
 * adjustments, night differential, and unused leave paid in cash above the de minimis days); an MWE's exempt lines:
 * minimum wage, holiday and rest-day pay, overtime, night differential (item 32); de minimis: unused leave paid in cash up to 10 days a year (anyone's). Shares: a non-MWE's
 * employee shares (they come off taxable pay). Tax: withheld, refunded, and the part withheld on December payrolls.
 */
export interface Comp {
  grossCents: number; mweBasicCents: number; mweHolidayCents: number; mweOtCents: number; mweNightCents: number; basicCents: number; otCents: number; otherCents: number;
  deMinimisCents: number; sharesCents: number; wtaxCents: number; refundCents: number; decWtaxCents: number;
}
export const noComp = (): Comp => ({
  grossCents: 0, mweBasicCents: 0, mweHolidayCents: 0, mweOtCents: 0, mweNightCents: 0, basicCents: 0, otCents: 0, otherCents: 0, deMinimisCents: 0, sharesCents: 0, wtaxCents: 0, refundCents: 0, decWtaxCents: 0,
});

/** Adds one run line of an employee to their year. */
export function addLine(c: Comp, l: { kind: string; taxable: boolean; amountCents: number }): void {
  c.grossCents += l.amountCents;
  if (l.kind === 'unused_leave') {
    c[l.taxable ? 'otherCents' : 'deMinimisCents'] += l.amountCents;
    return;
  }
  if (l.kind === 'night') {
    c[l.taxable ? 'otherCents' : 'mweNightCents'] += l.amountCents;
    return;
  }
  const ot = l.kind === 'ot';
  if (l.taxable) c[ot ? 'otCents' : l.kind === 'allowance' || l.kind === 'adjustment' ? 'otherCents' : 'basicCents'] += l.amountCents;
  else c[ot ? 'mweOtCents' : l.kind === 'holiday' || l.kind === 'rest_day' ? 'mweHolidayCents' : 'mweBasicCents'] += l.amountCents; // an MWE's allowances are taxable
}

/** The employee's recorded payroll runs of periods ending in the year, and whether the latest was as an MWE. */
function runsOfYear(db: Db, employeeId: string, year: number): { comp: Comp; runs: number; lastIsMwe: boolean | null } {
  const comp = noComp();
  const rows = db
    .prepare(
      `SELECT e.id, e.is_mwe AS isMwe, e.sss_ee_cents + e.phic_ee_cents + e.hdmf_ee_cents AS shares, e.wtax_cents AS wtax, e.wtax_refund_cents AS refund, r.period_end AS periodEnd
       FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
       WHERE d.status = 'posted' AND e.employee_id = ? AND substr(r.period_end, 1, 4) = ? ORDER BY r.period_end, d.number`,
    )
    .all(employeeId, String(year)) as { id: string; isMwe: 0 | 1; shares: number; wtax: number; refund: number; periodEnd: string }[];
  const lines = db.prepare(
    `SELECT CASE WHEN u.run_line_id IS NOT NULL THEN 'unused_leave' WHEN n.run_line_id IS NOT NULL THEN 'night' ELSE l.kind END AS kind, l.taxable, l.amount_cents AS amountCents
     FROM pay_run_lines l LEFT JOIN pay_run_unused_leave u ON u.run_line_id = l.id LEFT JOIN pay_run_night_diff n ON n.run_line_id = l.id WHERE l.run_employee_id = ?`,
  );
  for (const r of rows) {
    for (const l of lines.all(r.id) as { kind: string; taxable: 0 | 1; amountCents: number }[]) addLine(comp, { ...l, taxable: l.taxable === 1 });
    if (!r.isMwe) comp.sharesCents += r.shares;
    comp.wtaxCents += r.wtax;
    comp.refundCents += r.refund;
    if (r.periodEnd >= `${year}-12-01`) comp.decWtaxCents += r.wtax;
  }
  return { comp, runs: rows.length, lastIsMwe: rows.length ? rows[rows.length - 1]!.isMwe === 1 : null };
}

/** 13th-month pay recorded for the employee in documents dated in the year, its tax, and the part of that tax in December. */
function thirteenthOfYear(db: Db, employeeId: string, year: number) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(t.amount_cents), 0) AS amountCents, COALESCE(SUM(t.wtax_cents), 0) AS wtaxCents,
         COALESCE(SUM(CASE WHEN d.business_date >= ? THEN t.wtax_cents ELSE 0 END), 0) AS decWtaxCents
       FROM pay_thirteenth_employees t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted' AND t.employee_id = ? AND substr(d.business_date, 1, 4) = ?`,
    )
    .get(`${year}-12-01`, employeeId, String(year)) as { amountCents: number; wtaxCents: number; decWtaxCents: number };
}

/** Everything the year's tax is worked out on, for one employee. */
export interface YearParts {
  year: number; comp: Comp; runs: number; lastIsMwe: boolean | null; thirteenth: { amountCents: number; wtaxCents: number; decWtaxCents: number };
  before: PriorPay | null; previous: PriorPay | null; ceilingCents: number; table: Bracket[];
}
export function yearParts(db: Db, employeeId: string, year: number): YearParts {
  const prior = priorRows(db, { employeeId, year });
  const r = runsOfYear(db, employeeId, year);
  return {
    year, ...r, thirteenth: thirteenthOfYear(db, employeeId, year), before: prior.find((p) => p.source === 'before') ?? null, previous: prior.find((p) => p.source === 'previous') ?? null,
    ceilingCents: benefitCeilingAt(db, `${year}-12-31`), table: annualTableAt(db, `${year}-12-31`),
  };
}

/** The 2316's figures (IV-A items 19–28, IV-B items 29–52; the January 2018 form's numbering). */
export interface Figures {
  /** IV-B A. Non-taxable / exempt compensation (present employer). */
  i29BasicSmwCents: number; i30HolidayMweCents: number; i31OvertimeMweCents: number; i32NightMweCents: number; i33HazardMweCents: number;
  i34BenefitsCents: number; i35DeMinimisCents: number; i36SharesCents: number; i37OtherNonTaxableCents: number; i38NonTaxableCents: number;
  /** IV-B B. Taxable compensation (present employer). */
  i39BasicCents: number; i48TaxableBenefitsCents: number; i50OvertimeCents: number; i51OtherCents: number; i52TaxableCents: number;
  /** IV-A summary. */
  i19GrossCents: number; i20NonTaxableCents: number; i21TaxableCents: number; i22PreviousTaxableCents: number; i23GrossTaxableCents: number; i24TaxDueCents: number;
  i25aPresentWithheldCents: number; i25bPreviousWithheldCents: number; i26WithheldCents: number;
  /** Present employer's tax withheld January to November, and in December (the year-end adjustment's month), and refunded. */
  withheldJanNovCents: number; withheldDecemberCents: number; refundedCents: number;
}

/** Works out the 2316's figures of a year (pure). `isMwe`: the employee is a minimum wage earner at the end of the year. */
export function figures(p: Omit<YearParts, 'runs' | 'lastIsMwe'>, isMwe: boolean): Figures {
  const z = { benefitsCents: 0, deMinimisCents: 0, sssCents: 0, phicCents: 0, hdmfCents: 0, otherNontaxCents: 0, taxableCents: 0, wtaxCents: 0 };
  const before = p.before ?? z;
  const previous = p.previous ?? z;
  const c = p.comp;
  // The ceiling covers the year's 13th-month pay and other benefits from every employer; a previous employer's exempt
  // part counts first, and what goes over it is taxed here.
  const benefits = before.benefitsCents + p.thirteenth.amountCents;
  const benefitsTaxable = Math.min(benefits, Math.max(0, previous.benefitsCents + benefits - p.ceilingCents));
  const f = {
    i29BasicSmwCents: c.mweBasicCents + (isMwe ? before.otherNontaxCents : 0), i30HolidayMweCents: c.mweHolidayCents, i31OvertimeMweCents: c.mweOtCents,
    i32NightMweCents: c.mweNightCents, i33HazardMweCents: 0, i34BenefitsCents: benefits - benefitsTaxable, i35DeMinimisCents: before.deMinimisCents + c.deMinimisCents,
    i36SharesCents: c.sharesCents + before.sssCents + before.phicCents + before.hdmfCents, i37OtherNonTaxableCents: isMwe ? 0 : before.otherNontaxCents,
    i39BasicCents: c.basicCents - c.sharesCents + before.taxableCents, i48TaxableBenefitsCents: benefitsTaxable, i50OvertimeCents: c.otCents, i51OtherCents: c.otherCents,
  };
  const i38 = f.i29BasicSmwCents + f.i30HolidayMweCents + f.i31OvertimeMweCents + f.i32NightMweCents + f.i33HazardMweCents + f.i34BenefitsCents + f.i35DeMinimisCents + f.i36SharesCents + f.i37OtherNonTaxableCents;
  const i52 = f.i39BasicCents + f.i48TaxableBenefitsCents + f.i50OvertimeCents + f.i51OtherCents;
  const i23 = i52 + previous.taxableCents;
  const present = c.wtaxCents - c.refundCents + p.thirteenth.wtaxCents + before.wtaxCents;
  const december = c.decWtaxCents + p.thirteenth.decWtaxCents;
  return {
    ...f, i38NonTaxableCents: i38, i52TaxableCents: i52, i19GrossCents: i38 + i52, i20NonTaxableCents: i38, i21TaxableCents: i52, i22PreviousTaxableCents: previous.taxableCents,
    i23GrossTaxableCents: i23, i24TaxDueCents: withholding(p.table, i23), i25aPresentWithheldCents: present, i25bPreviousWithheldCents: previous.wtaxCents,
    i26WithheldCents: present + previous.wtaxCents, withheldJanNovCents: present - december + c.refundCents, withheldDecemberCents: december, refundedCents: c.refundCents,
  };
}

/** One employee's 2316 data for a year: who, the period of employment, the figures, the year-end adjustment and substituted filing. */
export interface Data2316 {
  year: number; employeeId: string; code: string; name: string; tin: string | null; isMwe: boolean; periodFrom: string; periodTo: string; separatedOn: string | null;
  /** An MWE's statutory minimum wage (the 2316's items 10–11): per day, the factor (days a year) and per month. */
  smw: { perDayCents: number; factor: number; perMonthCents: number; perYearCents: number } | null;
  previousEmployer: { name: string | null; tin: string | null } | null;
  figures: Figures;
  yearEnd: { number: string; id: string; deficiencyCents: number; withheldCents: number; refundCents: number } | null;
  /** Substituted filing (RR 2-2015, RR 11-2018): one employer the whole year and the tax withheld equals the tax due. */
  substitutedFiling: boolean; runs: number;
}

function yearEndOf(db: Db, employeeId: string, year: number) {
  return (
    (db
      .prepare(
        `SELECT d.number, d.id, y.deficiency_cents AS deficiencyCents, y.withheld_cents AS withheldCents, y.refund_cents AS refundCents
         FROM pay_run_year_end y JOIN pay_run_employees e ON e.id = y.run_employee_id JOIN documents d ON d.id = e.document_id
         WHERE d.status = 'posted' AND e.employee_id = ? AND y.year = ?`,
      )
      .get(employeeId, year) as Data2316['yearEnd'] | undefined) ?? null
  );
}

/** The employee's 2316 data for a year. TINs only for `canSeeIds`. */
export function data2316(db: Db, e: Employee, year: number, canSeeIds: boolean): Data2316 {
  const parts = yearParts(db, e.id, year);
  const last = e.separatedOn && e.separatedOn < `${year}-12-31` ? e.separatedOn : `${year}-12-31`;
  const pay = payProfileAt(db, e.id, last);
  const isMwe = parts.lastIsMwe ?? pay?.isMwe ?? false;
  let smw: Data2316['smw'] = null;
  if (isMwe) {
    const perDay = pay?.dailyRateCents ?? rulesAt(db, last).minimumWageCents;
    const phic = phicRateAt(db, last);
    const factor = pay?.workweekDays === 5 ? phic.days5 : phic.days6;
    smw = { perDayCents: perDay, factor, perMonthCents: divRoundHalfAway(perDay * factor, 12), perYearCents: perDay * factor };
  }
  const f = figures(parts, isMwe);
  const previous = parts.previous && parts.previous.grossCents + parts.previous.wtaxCents > 0 ? parts.previous : null;
  return {
    year, employeeId: e.id, code: e.code, name: e.name, tin: canSeeIds ? (governmentIds(db, [e.id]).get(e.id)?.tin ?? null) : null, isMwe,
    periodFrom: e.hireDate > `${year}-01-01` ? e.hireDate : `${year}-01-01`, periodTo: last, separatedOn: e.separatedOn && e.separatedOn <= `${year}-12-31` ? e.separatedOn : null,
    smw, previousEmployer: previous && { name: previous.employerName, tin: canSeeIds ? previous.employerTin : null }, figures: f,
    yearEnd: yearEndOf(db, e.id, year), substitutedFiling: !previous && f.i24TaxDueCents === f.i26WithheldCents, runs: parts.runs,
  };
}

/** Employees with pay in a year: a recorded run of a period ending in it, 13th-month pay dated in it, or pay before Moonproject. */
export function employeesPaidIn(db: Db, year: number): Employee[] {
  const ids = db
    .prepare(
      `SELECT e.employee_id FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' AND substr(r.period_end, 1, 4) = @y
       UNION SELECT t.employee_id FROM pay_thirteenth_employees t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted' AND substr(d.business_date, 1, 4) = @y
       UNION SELECT employee_id FROM pay_prior_pay WHERE year = CAST(@y AS INTEGER)`,
    )
    .pluck()
    .all({ y: String(year) }) as string[];
  return ids.map((id) => employee(db, id)!).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
