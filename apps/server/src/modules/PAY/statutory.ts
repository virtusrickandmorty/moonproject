/**
 * Statutory contributions, withholding tax and pay rules (PLAN F1). The calculators are pure and work on one month (or
 * one pay period for tax) in integer centavos; the versions come from PAY's effective-dated tables.
 */
import { AppError, applyRate, divRoundHalfAway } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';

export interface SssRate { mscMinCents: number; mscMaxCents: number; mscStepCents: number; regularMaxCents: number; eeBp: number; erBp: number; ecLowCents: number; ecHighCents: number; ecLowMaxMscCents: number }
export interface PhicRate { rateBp: number; floorCents: number; ceilingCents: number; days6: number; days5: number }
export interface HdmfRate { eeBp: number; eeLowBp: number; lowMaxCents: number; erBp: number; capCents: number }
export interface Bracket { overCents: number; baseCents: number; rateBp: number }
export interface PayRules {
  minimumWageCents: number; regHolidayOffBp: number; regHolidayWorkedBp: number; regHolidayRestBp: number; specialWorkedBp: number; specialRestBp: number;
  restDayWorkedBp: number; otOrdinaryBp: number; otPremiumBp: number; accrue13th: boolean; minNetPayCents: number;
}
export type TaxFrequency = 'weekly' | 'semi_monthly' | 'monthly';
export interface Share { ee: number; er: number }

/**
 * SSS for a month's compensation: the MSC is the compensation rounded to the ₱500 step (₱5,250 → ₱5,500), from ₱5,000
 * to ₱35,000; EE 5% and ER 10% of the MSC (regular SS up to ₱20,000, MPF above, same rates); EC ₱10 up to ₱14,500, else ₱30.
 */
export function sssMonthly(r: SssRate, compCents: number): Share & { ec: number; mscCents: number; mpfMscCents: number } {
  if (compCents <= 0) return { mscCents: 0, mpfMscCents: 0, ee: 0, er: 0, ec: 0 };
  const msc = Math.min(r.mscMaxCents, Math.max(r.mscMinCents, r.mscStepCents * Math.floor((compCents + r.mscStepCents / 2) / r.mscStepCents)));
  return { mscCents: msc, mpfMscCents: Math.max(0, msc - r.regularMaxCents), ee: applyRate(msc, r.eeBp), er: applyRate(msc, r.erBp), ec: msc <= r.ecLowMaxMscCents ? r.ecLowCents : r.ecHighCents };
}

/** PhilHealth for a month: the premium rate on the basis held between floor and ceiling, split equally. */
export function phicMonthly(r: PhicRate, basisCents: number): Share & { basisCents: number } {
  if (basisCents <= 0) return { basisCents: 0, ee: 0, er: 0 };
  const b = Math.min(r.ceilingCents, Math.max(r.floorCents, basisCents));
  const half = divRoundHalfAway(b * r.rateBp, 20_000);
  return { basisCents: b, ee: half, er: half };
}

/** The monthly basis PhilHealth uses for a daily rate: × 313/12 for a 6-day week, × 261/12 for 5 days. */
export const phicDailyBasis = (r: PhicRate, dailyCents: number, workweekDays: 5 | 6) => divRoundHalfAway(dailyCents * (workweekDays === 6 ? r.days6 : r.days5), 12);

/** Pag-IBIG for a month's compensation: EE 2% (1% up to ₱1,500), ER 2%, on compensation up to the cap. */
export function hdmfMonthly(r: HdmfRate, compCents: number): Share {
  if (compCents <= 0) return { ee: 0, er: 0 };
  const base = Math.min(compCents, r.capCents);
  return { ee: applyRate(base, compCents <= r.lowMaxCents ? r.eeLowBp : r.eeBp), er: applyRate(base, r.erBp) };
}

/** Withholding tax for one pay period: the bracket with the highest "over" not above the taxable pay. */
export function withholding(brackets: Bracket[], taxableCents: number): number {
  if (taxableCents <= 0) return 0;
  const b = [...brackets].sort((x, y) => y.overCents - x.overCents).find((x) => x.overCents <= taxableCents);
  return b ? b.baseCents + applyRate(taxableCents - b.overCents, b.rateBp) : 0;
}

const latest = (table: string, extra = '') => `SELECT * FROM ${table} WHERE effective_from <= @d ${extra} ORDER BY effective_from DESC, id DESC LIMIT 1`;
function need<T>(row: T | undefined, what: string, date: string): T {
  if (!row) throw new AppError('PAY_SETTING_MISSING', `No ${what} applies on ${date}. Ask the accountant to set it up.`, 422);
  return row;
}
type Row = Record<string, number | string>;

export function sssRateAt(db: Db, date: string): SssRate {
  const r = need(db.prepare(latest('pay_sss_rates')).get({ d: date }) as Row | undefined, 'SSS table', date);
  return { mscMinCents: +r.msc_min_cents!, mscMaxCents: +r.msc_max_cents!, mscStepCents: +r.msc_step_cents!, regularMaxCents: +r.regular_max_cents!, eeBp: +r.ee_bp!, erBp: +r.er_bp!, ecLowCents: +r.ec_low_cents!, ecHighCents: +r.ec_high_cents!, ecLowMaxMscCents: +r.ec_low_max_msc_cents! };
}
export function phicRateAt(db: Db, date: string): PhicRate {
  const r = need(db.prepare(latest('pay_phic_rates')).get({ d: date }) as Row | undefined, 'PhilHealth rate', date);
  return { rateBp: +r.rate_bp!, floorCents: +r.floor_cents!, ceilingCents: +r.ceiling_cents!, days6: +r.days_6!, days5: +r.days_5! };
}
export function hdmfRateAt(db: Db, date: string): HdmfRate {
  const r = need(db.prepare(latest('pay_hdmf_rates')).get({ d: date }) as Row | undefined, 'Pag-IBIG rate', date);
  return { eeBp: +r.ee_bp!, eeLowBp: +r.ee_low_bp!, lowMaxCents: +r.low_max_cents!, erBp: +r.er_bp!, capCents: +r.cap_cents! };
}
/** The tax table in force on the pay date for a frequency (all brackets of the latest version). */
export function wtaxTableAt(db: Db, frequency: TaxFrequency, date: string): Bracket[] {
  const from = db.prepare('SELECT MAX(effective_from) FROM pay_wtax_brackets WHERE frequency = ? AND effective_from <= ?').pluck().get(frequency, date) as string | null;
  need(from ?? undefined, `${frequency.replace('_', '-')} tax table`, date);
  return db
    .prepare('SELECT over_cents AS overCents, base_cents AS baseCents, rate_bp AS rateBp FROM pay_wtax_brackets WHERE frequency = ? AND effective_from = ? ORDER BY over_cents')
    .all(frequency, from) as Bracket[];
}
export function payRulesAt(db: Db, date: string): PayRules | undefined {
  const r = db.prepare(latest('pay_rules')).get({ d: date }) as Row | undefined;
  if (!r) return undefined;
  return {
    minimumWageCents: +r.minimum_wage_cents!, regHolidayOffBp: +r.reg_holiday_off_bp!, regHolidayWorkedBp: +r.reg_holiday_worked_bp!, regHolidayRestBp: +r.reg_holiday_rest_bp!,
    specialWorkedBp: +r.special_worked_bp!, specialRestBp: +r.special_rest_bp!, restDayWorkedBp: +r.rest_day_worked_bp!, otOrdinaryBp: +r.ot_ordinary_bp!, otPremiumBp: +r.ot_premium_bp!,
    accrue13th: r.accrue_13th === 1, minNetPayCents: +r.min_net_pay_cents!,
  };
}
export const rulesAt = (db: Db, date: string): PayRules => need(payRulesAt(db, date), 'pay rules (minimum wage, holiday rates)', date);
/** The yearly ceiling of tax-exempt 13th-month pay and other benefits in force on a date (F1, RR 11-2018: ₱90,000). */
export function benefitCeilingAt(db: Db, date: string): number {
  const r = need(db.prepare(latest('pay_benefit_ceilings')).get({ d: date }) as Row | undefined, 'ceiling of tax-exempt 13th-month pay', date);
  return +r.ceiling_cents!;
}
