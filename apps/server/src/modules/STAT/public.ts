/**
 * What the month-end checklist (ACC, PLAN D8) reads from STAT: each government remittance of a contribution month
 * (SSS, PhilHealth, Pag-IBIG, and the tax withheld on pay for the BIR's 1601-C), from the ledger check the month's
 * page shows. Read-only.
 */
import { formatPeso } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { SCHEMES, schemeCheck } from './ledger.ts';

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
