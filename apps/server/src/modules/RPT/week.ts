/**
 * The week's summary (the owner's request, Nov 2026: "a Monday summary"): last week, Monday to Sunday, on one page, against
 * the week before: sales and collections, expenses, cash on hand now, job orders in, out and late, designs approved, what
 * customers rated, and the website's visitors and the cities they came from. On Mondays the bell (DASH) points to it, and the
 * phone notification follows the bell (PUSH).
 */
import type { Db } from '../../platform/db/driver.ts';
import { activeJobOrders, releasesBetween } from '../JO/public.ts';
import { ratingsBetween } from '../FBK/public.ts';
import { proofAnswersBetween } from '../PRF/public.ts';
import { insights } from '../SHP/public.ts';
import { cashPosition } from './cash-assets.ts';
import { collectionsRegister } from './sales-collections.ts';
import { incomeStatement } from './statements.ts';

const pad = (n: number) => String(n).padStart(2, '0');
/** A calendar day n days from another (YYYY-MM-DD), no clock involved. */
export const plusDays = (date: string, n: number) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
/** The Monday of the week a day is in. */
export const mondayOf = (date: string) => plusDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
/** The last whole week before a day: its Monday and Sunday. */
export const lastWeek = (today: string) => { const from = plusDays(mondayOf(today), -7); return { from, to: plusDays(from, 6) }; };

function money(db: Db, from: string, to: string) {
  const s = incomeStatement(db, from, to);
  const section = (key: string) => s.sections.find((row) => row.key === key)?.totalCents ?? 0;
  return { salesCents: section('revenue'), expensesCents: section('operatingExpenses'), netIncomeCents: s.netIncomeCents, collectedCents: collectionsRegister(db, from, to).tenderCents };
}

/** Job orders recorded in a week (an edit is not a new order), and their pieces. Engine tables only. */
function jobOrdersIn(db: Db, from: string, to: string) {
  return db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS totalCents FROM documents
    WHERE doc_type = 'jo.job_order' AND status = 'posted' AND replaces_id IS NULL AND business_date BETWEEN ? AND ?`).get(from, to) as { count: number; totalCents: number };
}

/** The summary of the week from Monday `from` to Sunday `to`, with the week before; `today` for what is late now. */
export function weekSummary(db: Db, from: string, to: string, today: string) {
  const beforeFrom = plusDays(from, -7), beforeTo = plusDays(to, -7);
  const site = insights(db, to, 7);
  const ratings = ratingsBetween(db, from, to);
  const late = activeJobOrders(db).filter((j) => j.dueDate < today && (j.stage === 'open' || j.stage === 'in_production' || j.stage === 'ready'));
  return {
    from, to,
    money: money(db, from, to), before: money(db, beforeFrom, beforeTo),
    cashOnHandCents: cashPosition(db, today).totalCents,
    jobOrders: { received: jobOrdersIn(db, from, to), receivedBefore: jobOrdersIn(db, beforeFrom, beforeTo).count,
      released: new Set(releasesBetween(db, from, to).map((r) => r.jobOrderId)).size,
      late: late.length, lateList: late.slice(0, 8).map((j) => ({ id: j.id, number: j.number, customerName: j.customerName, dueDate: j.dueDate })) },
    proofs: proofAnswersBetween(db, from, to),
    ratings: { rated: ratings.rated, average: ratings.average, low: ratings.rows.filter((r) => r.stars <= 3).length },
    website: { visitors: site.visitors, visits: site.visits, orders: site.funnel.order, quotes: site.funnel.quote, cities: site.cities.slice(0, 5) },
  };
}
export type WeekSummary = ReturnType<typeof weekSummary>;
