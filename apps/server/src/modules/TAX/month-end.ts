/**
 * What the month-end checklist (ACC, PLAN D8) reads from TAX: whether the month's EWT return is recorded (the 0619-E
 * in months 1 and 2 of a quarter, the 1601-EQ in the quarter's last month) and whether the quarter's VAT is closed
 * (in the last month of a quarter). A return is "done" when its BIR payment leaves nothing to pay; it is "not needed"
 * when no EWT was withheld. Read-only.
 */
import { formatPeso } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { birPaymentsOf, ewtDue, parsePeriod, quarterPeriod } from './payments.ts';
import { vatCloseOf, vatPosition } from './vat.ts';

export interface ReturnCheck { form: string; period: string; state: 'done' | 'not_done' | 'not_needed'; detail: string }

export function ewtReturnCheck(db: Db, month: string): ReturnCheck {
  const m = parsePeriod(month)!;
  const quarterEnd = m.month! % 3 === 0;
  const form = quarterEnd ? '1601-EQ' : '0619-E';
  const period = quarterEnd ? quarterPeriod(m.year, m.quarter) : month;
  const p = parsePeriod(period)!;
  const base = { form, period };
  const quarterPaid = birPaymentsOf(db, [['1601-EQ', quarterPeriod(m.year, m.quarter)]]).filter((x) => x.status === 'posted');
  const rows = ewtDue(db, form, period, p);
  if (!quarterEnd && quarterPaid.length > 0) return { ...base, state: 'done', detail: `Paid with the quarter's 1601-EQ (${quarterPaid.map((x) => x.number).join(', ')}).` };
  if (rows.length === 0) return { ...base, state: 'not_needed', detail: `No EWT was withheld for ${p.label}.` };
  const left = rows.filter((r) => r.dueCents > 0).reduce((s, r) => s + r.dueCents, 0);
  if (left > 0) return { ...base, state: 'not_done', detail: `${formatPeso(left)} of EWT for ${p.label} is not paid with the ${form} yet.` };
  const paid = birPaymentsOf(db, [[form, period]]).filter((x) => x.status === 'posted');
  return { ...base, state: 'done', detail: paid.length ? `Paid (${paid.map((x) => x.number).join(', ')}).` : `Nothing left to pay for ${p.label}.` };
}

/** The quarter's VAT close, asked in the quarter's last month; other months need none. */
export function vatCloseCheck(db: Db, month: string): ReturnCheck {
  const m = parsePeriod(month)!;
  const period = quarterPeriod(m.year, m.quarter);
  const base = { form: 'VAT close', period };
  if (m.month! % 3 !== 0) return { ...base, state: 'not_needed', detail: 'The VAT is closed in the last month of the quarter.' };
  const close = vatCloseOf(db, m.year, m.quarter);
  if (close) return { ...base, state: 'done', detail: `${period} closed on ${close.number}, dated ${close.date}.` };
  const v = vatPosition(db, m.year, m.quarter);
  if (v.outputVatCents === 0 && v.inputVatCents === 0 && v.vatWithheldCents === 0 && v.carryOverCents === 0) return { ...base, state: 'not_needed', detail: `No VAT to close for ${period}.` };
  return { ...base, state: 'not_done', detail: `The VAT of ${period} is not closed.` };
}
