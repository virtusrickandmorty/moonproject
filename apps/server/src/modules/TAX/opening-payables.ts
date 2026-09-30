/**
 * Opening tax payables (OBTP-, doctypes/opening-payable.ts) as the BIR payments and the EWT worksheets read them: what
 * the old books left to pay with a return of a period before the cut-over date, read from the posted openings' rows.
 * A 2550Q, 0619-E or 1601-EQ is then paid with a BIR payment like any other (payments.ts adds these to what the period
 * leaves to pay); a 1702Q and a 1702 too, from 2320 (income-tax.ts, the BIR payment's form 1702). The opening's
 * journal is dated the cut-over date but is no tax withheld or VAT of that date's period: the registers leave it out
 * (registers.ts IN_REGISTERS), so the worksheets, the QAP and the 2307s to issue never count it.
 */
import type { Db } from '../../platform/db/driver.ts';

export const OPENING_PAYABLE = 'tax.payable.opening';

/** The returns an opening may carry: the three a BIR payment pays, and the income tax returns (quarterly, annual). */
export const OPENING_FORMS = ['2550Q', '0619-E', '1601-EQ', '1702Q', '1702'] as const;
export type OpeningForm = (typeof OPENING_FORMS)[number];

const keysJson = (keys: [string, string][]) => JSON.stringify(keys.map(([f, p]) => `${f} ${p}`));

/** Per party (the supplier; '' for a return with no payee), what the posted openings left to pay with these returns. */
export function openedByParty(db: Db, keys: [string, string][]): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT COALESCE(l.supplier_id, '') AS partyId, SUM(l.amount_cents) AS cents
       FROM tax_opening_payable_lines l JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND l.form || ' ' || l.period IN (SELECT value FROM json_each(?)) GROUP BY 1`,
    )
    .all(keysJson(keys)) as { partyId: string; cents: number }[];
  return new Map(rows.map((r) => [r.partyId, r.cents]));
}

export interface OpeningRef { documentId: string; number: string; date: string; form: OpeningForm; period: string }

/** The posted openings with a row for these returns, one entry per return, by number. */
export function openingsOf(db: Db, keys: [string, string][]): OpeningRef[] {
  return db
    .prepare(
      `SELECT DISTINCT d.id AS documentId, d.number, d.business_date AS date, l.form, l.period
       FROM tax_opening_payable_lines l JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND l.form || ' ' || l.period IN (SELECT value FROM json_each(?)) ORDER BY d.number, l.form, l.period`,
    )
    .all(keysJson(keys)) as OpeningRef[];
}

/** Every return the posted openings carry, oldest period first. */
export function openedReturns(db: Db): { form: OpeningForm; period: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT l.form, l.period FROM tax_opening_payable_lines l JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' ORDER BY l.period, l.form`,
    )
    .all() as { form: OpeningForm; period: string }[];
}
