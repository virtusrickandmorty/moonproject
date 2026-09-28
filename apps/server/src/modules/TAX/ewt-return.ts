/**
 * 0619-E and 1601-EQ worksheets (PLAN E12, D8): the EWT of a month or a quarter by ATC, from the EWT register, so the
 * worksheets, the 2307s to issue and the ledger always agree; the BIR payments (BIRP-) already made for it; and what is
 * left. The 1601-EQ takes off the 0619-E payments of months 1 and 2 and adds the QAP: per payee the TIN, registered
 * name, ATC, base, rate and EWT withheld, built on the 2307s to issue. A cancelled payment is not counted.
 * The items carry no line numbers: the accountant checks them against the form in use.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { EwtClass } from '../../engine/settings.ts';
import { quarterRange, returnDue, type Quarter } from './calendar.ts';
import { birPaymentsOf, monthsOf, parsePeriod, quarterPeriod, type BirForm } from './payments.ts';
import { certificatesToIssue, ewtRegister } from './purchases.ts';
import { total } from './registers.ts';
import type { WorksheetCheck } from './vat-return.ts';

/** EWT of the period for one ATC (per EWT class while the ATC is to confirm; neither for a journal voucher). */
export interface AtcLine { atc: string | null; ewtClass: EwtClass | null; atcChoices: string[]; baseCents: number; ewtCents: number }
export interface PaymentLine { id: string; number: string; date: string; period: string; reference: string; amountCents: number; penaltyCents: number }

function byAtc(rows: { atc: string | null; ewtClass: EwtClass | null; atcChoices: string[]; baseCents: number | null; ewtCents: number }[]): AtcLine[] {
  const lines = new Map<string, AtcLine>();
  for (const r of rows) {
    const key = JSON.stringify(r.atc ?? r.ewtClass);
    const l = lines.get(key) ?? { atc: r.atc, ewtClass: r.ewtClass, atcChoices: r.atcChoices, baseCents: 0, ewtCents: 0 };
    l.baseCents += r.baseCents ?? 0;
    l.ewtCents += r.ewtCents;
    lines.set(key, l);
  }
  const name = (l: AtcLine) => l.atc ?? l.ewtClass ?? '~';
  return [...lines.values()].filter((l) => l.baseCents !== 0 || l.ewtCents !== 0).sort((a, b) => name(a).localeCompare(name(b)));
}

/** The posted BIR payments of these forms and periods. */
function paid(db: Db, keys: [BirForm, string][]): PaymentLine[] {
  return birPaymentsOf(db, keys)
    .filter((p) => p.status === 'posted')
    .map(({ id, number, date, period, reference, amountCents, penaltyCents }) => ({ id, number, date, period, reference, amountCents, penaltyCents }));
}

/** The checks before filing; `payees` (the QAP) only for the 1601-EQ. */
function checksOf(rows: AtcLine[], register: ReturnType<typeof ewtRegister>, openUntil: string, today: string, what: string, payees: { tin: string | null }[] = []): WorksheetCheck[] {
  const checks: WorksheetCheck[] = [];
  const check = (when: boolean, code: string, level: WorksheetCheck['level'], message: string) => void (when && checks.push({ code, level, message }));
  check(register.totals.ewtCents !== register.glEwtCents, 'EWT_NOT_TIED', 'error', 'The EWT register does not add up to EWT payable in the books. Do not file until this is fixed.');
  check(rows.some((l) => l.atc === null && l.ewtClass !== null), 'ATC_TO_CONFIRM', 'warning', 'Some EWT is of a class that can be an individual or a company: confirm the ATC of each payee before filing.');
  check(rows.some((l) => l.ewtClass === null), 'TO_CLASSIFY', 'warning', 'Some EWT came from journal vouchers: put it under its ATC on the return.');
  check(payees.some((l) => !l.tin), 'NO_TIN', 'warning', 'Some payees have no TIN on file: the QAP needs one for each payee.');
  check(today <= openUntil, 'PERIOD_OPEN', 'info', `${what} has not ended: these figures still change.`);
  return checks;
}

/** The 0619-E worksheet of month 1 or 2 of a quarter (month like 2026-07; the caller refuses a third month). */
export function ewtMonthWorksheet(db: Db, month: string, today: string) {
  const p = parsePeriod(month)!;
  const register = ewtRegister(db, p.from, p.to);
  const atcs = byAtc(register.rows);
  const payments = paid(db, [['0619-E', month]]);
  const dueCents = register.totals.ewtCents;
  const paidCents = total(payments, (x) => x.amountCents);
  return {
    month, label: p.label, from: p.from, to: p.to, returnDue: returnDue(db, '0619-E', month, p.to),
    atcs, totals: { baseCents: register.totals.baseCents, ewtCents: register.totals.ewtCents },
    /** The EWT withheld in the month is what the 0619-E pays. */
    dueCents, payments, paidCents, leftCents: dueCents - paidCents,
    checks: checksOf(atcs, register, p.to, today, p.label),
  };
}
export type EwtMonthWorksheet = ReturnType<typeof ewtMonthWorksheet>;

/** The 1601-EQ worksheet of a quarter, with the QAP. */
export function ewtQuarterWorksheet(db: Db, year: number, quarter: Quarter, today: string) {
  const { from, to } = quarterRange(year, quarter);
  const period = quarterPeriod(year, quarter);
  const certificates = certificatesToIssue(db, year, quarter);
  const atcs = byAtc(certificates.lines);
  const remittances = monthsOf(year, quarter).slice(0, 2).map((month) => {
    const payments = paid(db, [['0619-E', month]]);
    return { month, label: parsePeriod(month)!.label, payments, paidCents: total(payments, (x) => x.amountCents) };
  });
  const remittedCents = total(remittances, (r) => r.paidCents);
  const dueCents = certificates.totals.ewtCents - remittedCents;
  const payments = paid(db, [['1601-EQ', period]]);
  const paidCents = total(payments, (x) => x.amountCents);
  const qap = certificates.lines.map((l) => ({
    supplierId: l.supplierId, tin: l.tin, registeredName: l.supplierName, atc: l.atc, ewtClass: l.ewtClass, atcChoices: l.atcChoices,
    baseCents: l.baseCents, rateBp: l.rateBp, ewtCents: l.ewtCents,
  }));
  const checks = checksOf(atcs, ewtRegister(db, from, to), to, today, `Q${quarter} ${year}`, qap);
  return {
    year, quarter, period, from, to, months: certificates.months, returnDue: returnDue(db, '1601-EQ', period, to),
    atcs, totals: certificates.totals,
    /** The 0619-E payments of months 1 and 2, taken off the quarter's EWT. */
    remittances, remittedCents,
    /** What the 1601-EQ pays: the quarter's EWT less the 0619-E payments; then the 1601-EQ payments made and what is left. */
    dueCents, payments, paidCents, leftCents: dueCents - paidCents,
    qap, checks,
  };
}
export type EwtQuarterWorksheet = ReturnType<typeof ewtQuarterWorksheet>;
