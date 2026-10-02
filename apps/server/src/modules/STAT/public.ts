/**
 * What the month-end checklist (ACC, PLAN D8) reads from STAT: each government remittance of a contribution month
 * (SSS, PhilHealth, Pag-IBIG, and the tax withheld on pay for the BIR's 1601-C), from the ledger check the month's
 * page shows. Read-only.
 */
import { formatPeso } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { SCHEMES, schemeCheck } from './ledger.ts';

/**
 * When a pay month's SSS, PhilHealth and Pag-IBIG are due: the last day of the next month. exposure.ts counts the
 * months late from the same day (monthsLate); DASH reads it here for the due-date reminders.
 */
export function remittanceDueDate(month: string): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface RemittanceCheck { scheme: string; label: string; state: 'done' | 'not_done' | 'not_needed'; detail: string }

export function remittanceChecks(db: Db, month: string): RemittanceCheck[] {
  return SCHEMES.map((scheme): RemittanceCheck => {
    const c = schemeCheck(db, scheme, month);
    const base = { scheme, label: c.label };
    if (c.recordedCents === 0 && c.remittedCents === 0 && c.remittances.length === 0) return { ...base, state: 'not_needed', detail: 'No payroll for this month left anything to remit.' };
    if (c.dueCents > 0) return { ...base, state: 'not_done', detail: `${formatPeso(c.dueCents)} still to remit.` };
    const numbers = c.remittances.map((r) => r.number);
    return { ...base, state: 'done', detail: numbers.length ? `Remitted (${numbers.join(', ')}).` : 'Nothing left to remit.' };
  });
}

/** A withholding-tax remittance (REM-, scheme WTAX): the payment of one month's 1601-C. */
export interface WtaxRemittance { documentId: string; number: string; month: string; paidOn: string; recordedAt: string; recordedBy: string }

/** The recorded, not cancelled 1601-C remittances, oldest recorded first (TAX's filed returns, ACC-22). Read-only. */
export function wtaxRemittances(db: Db): WtaxRemittance[] {
  return db
    .prepare(
      `SELECT d.id AS documentId, d.number, r.month, d.business_date AS paidOn, d.posted_at AS recordedAt, d.posted_by AS recordedBy
       FROM stat_remittances r JOIN documents d ON d.id = r.document_id WHERE r.scheme = 'WTAX' AND d.status = 'posted' ORDER BY d.posted_at, d.number`,
    )
    .all() as WtaxRemittance[];
}
