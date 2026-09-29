/**
 * The statutory exposure report (PLAN E11, ACC-05, R-11): for the past months since the cut-over date, per employee and
 * scheme (SSS, PhilHealth, Pag-IBIG), the months in which the employee was paid but no contribution was recorded (the
 * statutory switch was off, or the payroll never took one), with what the shares would have been at the rates dated
 * that month and the penalty on them at the rate in force today, for the accountant's catch-up decision. It posts
 * nothing, and it does not decide who bears the employee share: both shares are shown.
 *
 * Estimates, not a bill: the shares are worked out on the month's pay (gross) as the payrolls recorded it, and the
 * penalty is simple interest, `monthly_bp` a month, for each whole month after the month the contribution was due (the
 * end of the month after the pay month). The agencies' own assessments decide. Months with no payroll recorded are not
 * covered (there is no pay to work from), nor is the withholding tax (the BIR's surcharge and interest are different).
 */
import { applyRate } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { cutoverDate } from '../ACC/public.ts';
import { employee } from '../EMP/public.ts';
import { hdmfMonthly, hdmfRateAt, payOfMonth, payrollMonths, phicMonthly, phicRateAt, sssMonthly, sssRateAt, type MonthPay } from '../PAY/public.ts';
import { UPLOAD, UPLOAD_SCHEMES, type UploadScheme } from './agency.ts';

export interface ExposureMonth { month: string; grossCents: number; eeCents: number; erCents: number; ecCents: number; totalCents: number; monthsLate: number; penaltyCents: number }
export interface ExposureLine {
  employeeId: string; code: string; name: string; scheme: UploadScheme; label: string;
  /** The employee's statutory switch for the scheme is off (with the reason the accountant was given, OWN-07). */
  switchedOff: boolean;
  months: ExposureMonth[]; eeCents: number; erCents: number; ecCents: number; totalCents: number; penaltyCents: number;
}
export interface ExposureTotal { scheme: UploadScheme; label: string; employees: number; months: number; eeCents: number; erCents: number; ecCents: number; totalCents: number; penaltyCents: number }
export interface Exposure {
  asOf: string; cutoverDate: string | null;
  /** The first and last month looked at: the cut-over month, and the month before this one. */
  from: string | null; to: string | null;
  /** The penalty rate in force on `asOf` per scheme, in basis points a month (null: none is set, so no penalty is estimated). */
  rates: { scheme: UploadScheme; label: string; monthlyBp: number | null; source: string | null }[];
  lines: ExposureLine[]; totals: ExposureTotal[]; notes: string[];
}

const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthOf = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** Whole months after the month the contribution was due (the end of the month after `month`), as of `asOf`. */
export const monthsLate = (month: string, asOf: string) => Math.max(0, index(asOf.slice(0, 7)) - index(month) - 1);

function penaltyRateAt(db: Db, scheme: UploadScheme, date: string): { monthlyBp: number; source: string } | null {
  const r = db.prepare('SELECT monthly_bp AS monthlyBp, source FROM stat_penalty_rates WHERE scheme = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(scheme, date) as
    | { monthlyBp: number; source: string }
    | undefined;
  return r ?? null;
}

/** What the scheme would have taken for the month's pay, at the rates dated that month; null if the pay gives nothing. */
function estimate(db: Db, scheme: UploadScheme, month: string, p: MonthPay): { ee: number; er: number; ec: number } | null {
  const date = `${month}-01`;
  const e =
    scheme === 'SSS'
      ? sssMonthly(sssRateAt(db, date), p.grossCents)
      : scheme === 'PHIC'
        ? { ...phicMonthly(phicRateAt(db, date), p.grossCents), ec: 0 }
        : { ...hdmfMonthly(hdmfRateAt(db, date), p.grossCents), ec: 0 };
  return e.ee + e.er + e.ec > 0 ? { ee: e.ee, er: e.er, ec: e.ec } : null;
}

const recorded = (scheme: UploadScheme, p: MonthPay) =>
  scheme === 'SSS' ? p.sssEeCents + p.sssErCents + p.sssEcCents : scheme === 'PHIC' ? p.phicEeCents + p.phicErCents : p.hdmfEeCents + p.hdmfErCents;
const switchKey = { SSS: 'sss', PHIC: 'phic', HDMF: 'hdmf' } as const;

export function exposureReport(db: Db, asOf: string): Exposure {
  const cutover = cutoverDate(db);
  const rates = UPLOAD_SCHEMES.map((scheme) => {
    const r = penaltyRateAt(db, scheme, asOf);
    return { scheme, label: UPLOAD[scheme].label, monthlyBp: r?.monthlyBp ?? null, source: r?.source ?? null };
  });
  const notes = [
    'These are estimates for the accountant\'s catch-up decision (ACC-05). Nothing is posted, and it is not decided who bears the employee shares.',
    'Shares are worked out on each month\'s recorded pay at the rates dated that month. The penalty is simple interest at the rate in force today for each whole month after the month the contribution was due (the end of the month after the pay month).',
    'Months with no payroll recorded are not covered, and neither is the withholding tax.',
    ...rates.filter((r) => r.monthlyBp === null).map((r) => `No late-payment rate is set for ${r.label}, so no penalty is estimated for it.`),
  ];
  const to = monthOf(index(asOf.slice(0, 7)) - 1);
  if (!cutover) return { asOf, cutoverDate: null, from: null, to: null, rates, lines: [], totals: [], notes: ['Set the cut-over date first: the report looks at the months since it.', ...notes] };
  const from = cutover.slice(0, 7);
  const lines = new Map<string, ExposureLine>();
  for (const month of payrollMonths(db).filter((m) => m >= from && m <= to).sort()) {
    for (const p of payOfMonth(db, month)) {
      if (p.grossCents <= 0) continue;
      for (const scheme of UPLOAD_SCHEMES) {
        if (recorded(scheme, p) > 0) continue;
        const e = estimate(db, scheme, month, p);
        if (!e) continue;
        const total = e.ee + e.er + e.ec;
        const late = monthsLate(month, asOf);
        const rate = rates.find((r) => r.scheme === scheme)!.monthlyBp;
        const m: ExposureMonth = { month, grossCents: p.grossCents, eeCents: e.ee, erCents: e.er, ecCents: e.ec, totalCents: total, monthsLate: late, penaltyCents: rate === null ? 0 : applyRate(total, rate * late) };
        const key = `${p.employeeId}|${scheme}`;
        const line = lines.get(key) ?? {
          employeeId: p.employeeId, code: p.code, name: p.name, scheme, label: UPLOAD[scheme].label, switchedOff: employee(db, p.employeeId)?.statutory[switchKey[scheme]] === false,
          months: [], eeCents: 0, erCents: 0, ecCents: 0, totalCents: 0, penaltyCents: 0,
        };
        lines.set(key, {
          ...line, months: [...line.months, m], eeCents: line.eeCents + m.eeCents, erCents: line.erCents + m.erCents, ecCents: line.ecCents + m.ecCents,
          totalCents: line.totalCents + m.totalCents, penaltyCents: line.penaltyCents + m.penaltyCents,
        });
      }
    }
  }
  const all = [...lines.values()].sort((a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId) || UPLOAD_SCHEMES.indexOf(a.scheme) - UPLOAD_SCHEMES.indexOf(b.scheme));
  const totals = UPLOAD_SCHEMES.map((scheme): ExposureTotal => {
    const own = all.filter((l) => l.scheme === scheme);
    const sum = (f: (l: ExposureLine) => number) => own.reduce((s, l) => s + f(l), 0);
    return { scheme, label: UPLOAD[scheme].label, employees: own.length, months: sum((l) => l.months.length), eeCents: sum((l) => l.eeCents), erCents: sum((l) => l.erCents), ecCents: sum((l) => l.ecCents), totalCents: sum((l) => l.totalCents), penaltyCents: sum((l) => l.penaltyCents) };
  });
  return { asOf, cutoverDate: cutover, from, to, rates, lines: all, totals, notes };
}
