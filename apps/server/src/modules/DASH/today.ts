/**
 * Today (the owner's request, Nov 2026: "a daily list for each role"): one short list at the top of the home of what is
 * waiting on this person today, each with how many and where to deal with it, only what their permissions let them do.
 * Nothing waiting, nothing shown. It reads the same sources as the bell, counted instead of listed one by one.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { Clock } from '../../platform/clock.ts';
import { manilaTimestamp } from '@moonproject/shared';
import { today as todayOf } from '../../platform/clock.ts';
import type { SessionUser } from '../../engine/security/sessions.ts';
import { activeJobOrders } from '../JO/public.ts';
import { newSupportMessages } from '../SUP/public.ts';
import { paymentsToCheck } from '../SHP/public.ts';
import { returnsAwaitingDecision } from '../ALT/public.ts';
import { proofsToRedo, proofsWaiting } from '../PRF/public.ts';
import { lowRatingsSince } from '../FBK/public.ts';
import { arAging } from '../RPT/public.ts';

export interface TodayItem { key: string; label: string; count: number; href: string; tone: 'danger' | 'warning' | 'info'; amountCents?: number }

const plusDays = (date: string, n: number) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const JO_LIST = '/docs/jo.job_order';
/** One job order's page when there is just one, else the list. */
const where = (ids: string[], list: string) => (ids.length === 1 ? `/docs/jo.job_order/${ids[0]}` : list);

export function todayList(db: Db, clock: Clock, user: SessionUser): TodayItem[] {
  const can = (key: string) => user.permissions.has(key);
  const day = todayOf(clock);
  const out: TodayItem[] = [];
  const add = (item: TodayItem) => { if (item.count > 0) out.push(item); };

  if (can('jo.view')) {
    const working = activeJobOrders(db).filter((j) => j.stage === 'open' || j.stage === 'in_production' || j.stage === 'ready');
    const late = working.filter((j) => j.dueDate < day);
    const soon = working.filter((j) => j.stage !== 'ready' && j.dueDate >= day && j.dueDate <= plusDays(day, 2));
    add({ key: 'late', label: late.length === 1 ? 'job order is past its due date' : 'job orders are past their due date', count: late.length, href: where(late.map((j) => j.id), '/prd/board'), tone: 'danger' });
    add({ key: 'due-soon', label: 'due in the next 2 days and not ready yet', count: soon.length, href: where(soon.map((j) => j.id), '/prd/board'), tone: 'warning' });
  }
  if (can('prf.manage')) {
    const redo = proofsToRedo(db);
    add({ key: 'proof-redo', label: redo.length === 1 ? 'design to change: the customer asked for a change' : 'designs to change: the customers asked for changes', count: redo.length, href: where(redo.map((p) => p.jobOrderId), JO_LIST), tone: 'warning' });
    const waiting = proofsWaiting(db, '9999-12-31'); // every design not answered yet
    add({ key: 'proof-waiting', label: waiting.length === 1 ? 'design waiting for the customer\'s answer' : 'designs waiting for the customers\' answers', count: waiting.length, href: where(waiting.map((p) => p.jobOrderId), JO_LIST), tone: 'info' });
  }
  if (can('shp.orders.manage')) {
    const pay = paymentsToCheck(db, clock.now().getTime());
    add({ key: 'online-payments', label: pay.length === 1 ? 'online payment to check in the bank' : 'online payments to check in the bank', count: pay.length, href: '/shp/orders', tone: 'warning' });
  }
  if (can('sup.view')) {
    const m = newSupportMessages(db);
    add({ key: 'support', label: m.length === 1 ? 'new message from the website' : 'new messages from the website', count: m.length, href: '/sup', tone: 'info' });
  }
  if (can('alt.decide')) {
    const r = returnsAwaitingDecision(db);
    add({ key: 'returns', label: r.length === 1 ? 'item brought back, waiting for your decision' : 'items brought back, waiting for your decision', count: r.length, href: '/alt', tone: 'warning' });
  }
  if (can('fbk.view')) {
    const low = lowRatingsSince(db, manilaTimestamp(new Date(clock.now().getTime() - 7 * 86_400_000)));
    add({ key: 'ratings', label: low.length === 1 ? 'low rating this week: call the customer' : 'low ratings this week: call the customers', count: low.length, href: '/fbk', tone: 'danger' });
  }
  if (can('rpt.books.view')) {
    const rows = arAging(db, day).rows.filter((r) => r.totalCents > 0 && r.dueDate);
    const overdue = rows.filter((r) => r.dueDate < day), week = rows.filter((r) => r.dueDate >= day && r.dueDate <= plusDays(day, 7));
    const sum = (list: typeof rows) => list.reduce((n, r) => n + r.totalCents, 0);
    add({ key: 'overdue', label: overdue.length === 1 ? 'amount owed is past due' : 'amounts owed are past due', count: overdue.length, href: '/rpt/ar-aging', tone: 'danger', amountCents: sum(overdue) });
    add({ key: 'due-week', label: week.length === 1 ? 'amount falls due this week' : 'amounts fall due this week', count: week.length, href: '/rpt/ar-aging', tone: 'info', amountCents: sum(week) });
  }
  return out;
}
