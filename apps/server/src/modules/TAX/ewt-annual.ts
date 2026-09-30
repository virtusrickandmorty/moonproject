/**
 * 1604-E data (PLAN D8 "Yearly", E12): the annual information return of expanded withholding, with its alphalist.
 * Per payee and ATC, the EWT withheld in each quarter and in the year, built from the four quarters' QAP (the 2307s to
 * issue, purchases.ts), which the EWT register makes; so the alphalist, the four 1601-EQ worksheets and the register
 * agree by construction, and the tie-out below shows it: per quarter, the QAP, the 1601-EQ worksheet's EWT, the EWT
 * register and 2311's movement; for the year, the payees' total, the four quarters and the register. Each quarter also
 * shows what its returns paid (the 0619-E of months 1 and 2, the 1601-EQ) and what is left, from the 1601-EQ worksheet.
 * The items carry no line numbers: the accountant checks them against the form and the alphalist layout in use.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from '../../engine/settings.ts';
import { returnDue, type Quarter } from './calendar.ts';
import { ewtQuarterWorksheet } from './ewt-return.ts';
import { ewtRegister } from './purchases.ts';
import { total } from './registers.ts';
import type { WorksheetCheck } from './vat-return.ts';

export interface AnnualPayee {
  supplierId: string | null; tin: string | null; registeredName: string; atc: string | null; ewtClass: EwtClass | null; atcChoices: string[];
  /** The rate withheld at, when every quarter used the same one; else null. */
  rateBp: number | null;
  /** EWT withheld in Q1 to Q4. */
  quarters: [number, number, number, number];
  baseCents: number; ewtCents: number;
}
export interface QuarterTie {
  quarter: Quarter; period: string; from: string; to: string;
  /** The QAP's total, the 1601-EQ worksheet's EWT, the EWT register's total and 2311's movement: all equal when tied. */
  qapCents: number; worksheetCents: number; registerCents: number; glCents: number; tied: boolean;
  /** What the quarter's returns leave to pay: due (EWT and openings), the 0619-E and 1601-EQ payments, and left. */
  dueCents: number; remittedCents: number; paidCents: number; leftCents: number;
}

const QUARTERS = [1, 2, 3, 4] as const;

/** The 1604-E data of a year (GET /api/tax/1604e). */
export function ewtAnnualReturn(db: Db, year: number, today: string) {
  const payees = new Map<string, AnnualPayee>();
  const rates = new Map<string, Set<number | null>>();
  const quarters: QuarterTie[] = QUARTERS.map((quarter, i) => {
    const w = ewtQuarterWorksheet(db, year, quarter, today);
    const register = ewtRegister(db, w.from, w.to);
    for (const l of w.qap) {
      const key = JSON.stringify([l.supplierId, l.atc ?? l.ewtClass]);
      const p = payees.get(key) ?? {
        supplierId: l.supplierId, tin: l.tin, registeredName: l.registeredName, atc: l.atc, ewtClass: l.ewtClass, atcChoices: l.atcChoices, rateBp: null,
        quarters: [0, 0, 0, 0], baseCents: 0, ewtCents: 0,
      };
      p.quarters[i] = p.quarters[i]! + l.ewtCents;
      p.baseCents += l.baseCents;
      p.ewtCents += l.ewtCents;
      payees.set(key, p);
      rates.set(key, (rates.get(key) ?? new Set()).add(l.rateBp));
    }
    const qapCents = total(w.qap, (l) => l.ewtCents);
    const tied = qapCents === w.totals.ewtCents && qapCents === register.totals.ewtCents && register.totals.ewtCents === register.glEwtCents;
    return {
      quarter, period: w.period, from: w.from, to: w.to, qapCents, worksheetCents: w.totals.ewtCents, registerCents: register.totals.ewtCents, glCents: register.glEwtCents, tied,
      dueCents: w.dueCents + w.remittedCents, remittedCents: w.remittedCents, paidCents: w.paidCents, leftCents: w.leftCents,
    };
  });
  for (const [key, p] of payees) {
    const r = rates.get(key)!;
    if (r.size === 1) p.rateBp = [...r][0]!;
  }
  const alphalist = [...payees.values()]
    .filter((p) => p.baseCents !== 0 || p.ewtCents !== 0)
    .sort((a, b) => a.registeredName.localeCompare(b.registeredName) || (a.atc ?? a.ewtClass ?? '').localeCompare(b.atc ?? b.ewtClass ?? ''));
  const register = ewtRegister(db, `${year}-01-01`, `${year}-12-31`);
  const totals = { baseCents: total(alphalist, (p) => p.baseCents), ewtCents: total(alphalist, (p) => p.ewtCents) };
  const quartersCents = total(quarters, (q) => q.qapCents);
  const tied = quarters.every((q) => q.tied) && totals.ewtCents === quartersCents && quartersCents === register.totals.ewtCents && register.totals.ewtCents === register.glEwtCents;

  const checks: WorksheetCheck[] = [];
  const check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void (when && checks.push({ code, level, message }));
  check(!tied, 'NOT_TIED', 'error', 'The alphalist, the four 1601-EQ worksheets, the EWT register and EWT payable in the books do not agree. Do not file until this is fixed.');
  const unpaid = quarters.filter((q) => q.leftCents > 0 && today > q.to);
  check(unpaid.length > 0, 'UNPAID', 'warning', `EWT is still left to pay for ${unpaid.map((q) => `Q${q.quarter}`).join(', ')}: pay it with the 0619-E or 1601-EQ before filing the 1604-E.`);
  check(alphalist.some((p) => p.atc === null && p.ewtClass !== null), 'ATC_TO_CONFIRM', 'warning', 'Some EWT is of a class that can be an individual or a company: confirm the ATC of each payee before filing.');
  check(alphalist.some((p) => p.ewtClass === null), 'TO_CLASSIFY', 'warning', 'Some EWT came from journal vouchers: put it under its payee and ATC on the alphalist.');
  check(alphalist.some((p) => !p.tin), 'NO_TIN', 'warning', 'Some payees have no TIN on file: the alphalist needs one for each payee.');
  check(today <= `${year}-12-31`, 'YEAR_OPEN', 'info', `${year} has not ended: these figures still change.`);
  return {
    year, from: `${year}-01-01`, to: `${year}-12-31`, returnDue: returnDue(db, '1604-E', String(year), `${year}-12-31`),
    alphalist, totals, quarters, quartersCents, registerCents: register.totals.ewtCents, glCents: register.glEwtCents, tied, checks,
  };
}
export type EwtAnnualReturn = ReturnType<typeof ewtAnnualReturn>;
