/**
 * What a dividend declaration reads from the ledger (PLAN D5 DIV, NR-2), and the lists TAX reads through public.ts.
 *   Retained earnings on a date: 3201 retained earnings, plus every income statement account (4xxx to 8xxx) up to that
 *   date (the current year's earnings and any earlier year's not yet closed to 3201, as the balance sheet computes them),
 *   less 3210 dividends declared up to that date. A cancelled declaration's journal and its mirror (dated on the
 *   declaration's own date, cancelOn) net to zero there, so an edit is checked as if the old one had never been.
 *   Final tax withheld in a period: the dividend lines of the declarations still recorded dated in it, per stockholder.
 */
import type { Db } from '../../platform/db/driver.ts';

export interface RetainedEarnings {
  date: string;
  /** 3201 (credit-positive). */
  retainedCents: number;
  /** Income less expenses from 1 January of the date's year to the date. */
  currentYearCents: number;
  /** Income less expenses before that 1 January not yet closed to 3201 (zero once the accountant closes them). */
  earlierYearsCents: number;
  /** 3210 (debit-positive), dividends declared and not yet closed to 3201. */
  declaredCents: number;
  /** retained + current year + earlier years − declared. */
  availableCents: number;
}

/** Credit-positive net of the accounts matching `where` over sealed journals dated from..to. */
function creditNet(db: Db, where: string, from: string | null, to: string): number {
  return db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND (@from IS NULL OR j.business_date >= @from) AND j.business_date <= @to AND ${where}`,
    )
    .pluck()
    .get({ from, to }) as number;
}

export function retainedEarningsAt(db: Db, date: string): RetainedEarnings {
  const yearStart = `${date.slice(0, 4)}-01-01`;
  const income = `substr(a.code, 1, 1) BETWEEN '4' AND '8'`;
  // 3290 is never posted; anything that reached it anyway counts, as on the balance sheet.
  const retainedCents = creditNet(db, `a.role_key IN ('RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS')`, null, date);
  const currentYearCents = creditNet(db, income, yearStart, date);
  const earlierYearsCents = creditNet(db, income, null, `${Number(date.slice(0, 4)) - 1}-12-31`);
  const declaredCents = 0 - creditNet(db, `a.role_key = 'DIVIDENDS_DECLARED'`, null, date);
  return { date, retainedCents, currentYearCents, earlierYearsCents, declaredCents, availableCents: retainedCents + currentYearCents + earlierYearsCents - declaredCents };
}

export interface DividendWithheld {
  documentId: string; number: string; date: string; resolutionNumber: string;
  personId: string; name: string; tin: string | null; holderKind: 'individual' | 'corporation';
  shares: number; grossCents: number; taxRateBp: number; taxCents: number; netCents: number;
}

/** Every stockholder's line of the declarations still recorded dated from..to, oldest first (the 1601-FQ and 1604-F lists). */
export function dividendsWithheld(db: Db, from: string, to: string): DividendWithheld[] {
  return db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.business_date AS date, v.resolution_number AS resolutionNumber, l.person_id AS personId, l.name, l.tin,
         l.holder_kind AS holderKind, l.shares, l.gross_cents AS grossCents, CASE l.holder_kind WHEN 'individual' THEN v.tax_rate_bp ELSE 0 END AS taxRateBp,
         l.tax_cents AS taxCents, l.net_cents AS netCents
       FROM eq_dividend_lines l JOIN eq_dividend_declarations v ON v.document_id = l.document_id JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND d.business_date BETWEEN ? AND ? ORDER BY d.business_date, d.number, l.name, l.person_id`,
    )
    .all(from, to) as DividendWithheld[];
}
