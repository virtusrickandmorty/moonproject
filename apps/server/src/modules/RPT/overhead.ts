/**
 * Overhead (the owner's request, Nov 2026): what the shop really spends around making its garments, month by month, next to
 * the overhead percent Costing assumes. From sealed journals.
 * - A cancelled entry and its reversal are both left out. The books date a reversal the day of the cancel, so one cancelled in a
 *   later month would inflate its own month and turn the later one negative; a rate needs what really stood. A month here can
 *   so differ from the income statement of that month, which keeps both; across the months they agree.
 * - Direct cost: the cost of sales accounts (5xxx: materials, direct labor, subcontracting), less production depreciation.
 * - Overhead: every operating expense (6xxx) plus production depreciation (5302). The rate is overhead over direct cost, as
 *   Costing applies it.
 * - The average is of the last complete months, so one big bill does not swing it; a month still running is left out.
 * - Pieces are job order pieces released in the month.
 */
import { divRoundHalfAway } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { rulesNow } from '../EST/public.ts';
import { piecesReleasedBetween } from '../JO/public.ts';

const MONTHS_SHOWN = 6;
const AVERAGE_OVER = 3;
/** The average and Costing's percent are far apart past this many points. */
const FAR_APART_BP = 1_000;

const IS_DIRECT = `a.code LIKE '5%' AND COALESCE(a.role_key, '') <> 'DEPR_PRODUCTION'`;
const IS_OVERHEAD = `(a.code LIKE '6%' OR a.role_key = 'DEPR_PRODUCTION')`;
const STOOD = `j.sealed = 1 AND j.reverses_journal_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM journals r WHERE r.reverses_journal_id = j.id AND r.sealed = 1)`;

/** "2026-11" and the months before it, oldest first. */
function monthsTo(month: string, count: number): string[] {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const back = year * 12 + number - 1 - (count - 1 - i);
    return `${Math.floor(back / 12)}-${String((back % 12) + 1).padStart(2, '0')}`;
  });
}
const lastDay = (month: string) => {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
};
/** A part over a whole in basis points; none when there is no whole to measure against. */
const rateBp = (part: number, whole: number) => (whole > 0 ? divRoundHalfAway(part * 10_000, whole) : null);

function monthRow(db: Db, month: string, today: string) {
  const from = `${month}-01`, to = lastDay(month);
  const sums = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN ${IS_DIRECT} THEN l.debit_cents - l.credit_cents END), 0) AS directCents,
      COALESCE(SUM(CASE WHEN ${IS_OVERHEAD} THEN l.debit_cents - l.credit_cents END), 0) AS overheadCents,
      COALESCE(SUM(CASE WHEN a.code LIKE '4%' THEN l.credit_cents - l.debit_cents END), 0) AS salesCents
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE ${STOOD} AND j.business_date BETWEEN ? AND ?`).get(from, to) as { directCents: number; overheadCents: number; salesCents: number };
  const pieces = piecesReleasedBetween(db, from, to);
  return {
    month, ...sums, pieces, finished: to < today,
    overheadRateBp: rateBp(sums.overheadCents, sums.directCents),
    salesRateBp: rateBp(sums.overheadCents, sums.salesCents),
    overheadPerPieceCents: pieces > 0 ? divRoundHalfAway(Math.max(0, sums.overheadCents), pieces) : null,
  };
}

/** A month's overhead by account, biggest first. */
function overheadAccounts(db: Db, month: string) {
  return db.prepare(`SELECT a.code, a.name, SUM(l.debit_cents - l.credit_cents) AS amountCents
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE ${STOOD} AND j.business_date BETWEEN ? AND ? AND ${IS_OVERHEAD}
    GROUP BY a.id HAVING amountCents <> 0 ORDER BY amountCents DESC, a.code`).all(`${month}-01`, lastDay(month)) as { code: string; name: string; amountCents: number }[];
}

/** The months up to `month`, its overhead by account, the average of the last complete ones, and how Costing's percent compares. */
export function overheadReport(db: Db, month: string, today: string) {
  const rows = monthsTo(month, MONTHS_SHOWN).map((m) => monthRow(db, m, today))
    .filter((r) => r.month === month || r.directCents !== 0 || r.overheadCents !== 0 || r.salesCents !== 0);
  const counted = rows.filter((r) => r.finished && (r.directCents !== 0 || r.overheadCents !== 0)).slice(-AVERAGE_OVER);
  const overheadCents = counted.reduce((n, r) => n + r.overheadCents, 0);
  const directCents = counted.reduce((n, r) => n + r.directCents, 0);
  const averageBp = rateBp(overheadCents, directCents);
  const costingBp = rulesNow(db).overheadBp;
  const gapBp = averageBp === null ? null : averageBp - costingBp;
  return {
    month, rows, accounts: overheadAccounts(db, month),
    average: { months: counted.map((r) => r.month), wanted: AVERAGE_OVER, overheadCents, directCents, rateBp: averageBp },
    costing: { rateBp: costingBp, gapBp, farApart: gapBp === null ? null : gapBp >= FAR_APART_BP ? 'above' as const : gapBp <= -FAR_APART_BP ? 'below' as const : null },
  };
}
