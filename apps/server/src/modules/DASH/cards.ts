/**
 * The home's cards (the owner's request, Oct 2026: laid out like a clinic dashboard): four headline figures, the job
 * orders on the floor, pieces made each day this week, the month's due dates, and the job orders by stage. Each card is
 * there only for those who may see what it reads: the money figures for the owner and the accountant, the job orders for
 * those who see job orders, the floor for those who see production. Composed from the same reads as the reports.
 */
import type { Db } from '../../platform/db/driver.ts';
import type { SessionUser } from '../../engine/security/sessions.ts';
import { activeJobOrders, releasesBetween } from '../JO/public.ts';
import { board, listSteps, piecesByDay } from '../PRD/public.ts';
import { cashPosition, collectionsRegister } from '../RPT/public.ts';
import { salesRegister } from '../TAX/public.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (date: string, n: number) => dateOf(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
const monthEnd = (month: string) => dateOf(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
/** The same days of last month (1st to this day of the month, or its last day), to compare a month so far with. */
function sameDaysLastMonth(date: string): { from: string; to: string } {
  const last = addDays(`${date.slice(0, 7)}-01`, -1);
  const day = Math.min(Number(date.slice(8)), Number(last.slice(8)));
  return { from: `${last.slice(0, 7)}-01`, to: `${last.slice(0, 7)}-${pad(day)}` };
}
const change = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100));

export interface Kpi { key: string; label: string; value: number; money: boolean; changePct?: number | null; note?: string; href: string }
export type JobStatus = 'to_route' | 'in_production' | 'ready' | 'late';
/** `progress`: how far along its items are, 0 to 1 (steps closed over steps on the route; a ready item counts whole). */
export interface JobRow { id: string; number: string; customerName: string; item: string; step: string | null; status: JobStatus; dueDate: string; late: boolean; rush: boolean; progress: number }

export function homeCards(db: Db, date: string, user: SessionUser) {
  const can = (p: string) => user.permissions.has(p);
  const money = can('dash.home.owner') || can('dash.home.accountant');
  const seeJobs = can('jo.view');
  const seeFloor = can('prd.view');
  const active = seeJobs || seeFloor ? activeJobOrders(db).filter((j) => j.stage !== 'released') : [];
  const lines = seeJobs || seeFloor ? board(db) : [];
  const stepName = new Map(listSteps(db).map((s) => [s.id, s.name]));
  const week = seeFloor ? piecesByDay(db, addDays(date, -6), date) : [];
  const piecesToday = week.find((d) => d.date === date);

  // The job orders on the floor, one row each: the step its first unfinished item is at (Rework when every step is closed
  // and rework is still open); late ones first.
  const jobs: JobRow[] = active.map((j) => {
    const mine = lines.filter((l) => l.jobOrderId === j.id);
    const open = mine.find((l) => !l.ready);
    const routed = mine.some((l) => l.steps !== null);
    const late = j.dueDate < date;
    const status: JobStatus = late ? 'late' : !routed && j.stage === 'open' ? 'to_route' : j.stage === 'ready' || j.stage === 'partially_released' ? 'ready' : 'in_production';
    const parts = mine.map((l) => (l.ready ? 1 : l.steps && l.steps.length ? l.steps.filter((x) => x.status === 'completed' || x.status === 'not_needed').length / l.steps.length : 0));
    const progress = parts.length ? Math.round((parts.reduce((n, p) => n + p, 0) / parts.length) * 100) / 100 : 0;
    const item = mine[0] ? `${mine[0].description}${mine.length > 1 ? ` +${mine.length - 1} more` : ''}` : '';
    return { id: j.id, number: j.number, customerName: j.customerName, item, step: open?.currentStepId ? stepName.get(open.currentStepId) ?? null : open?.steps ? 'Rework' : null, status, dueDate: j.dueDate, late, rush: j.priority === 'rush', progress };
  }).sort((a, b) => Number(b.late) - Number(a.late) || a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));

  const count = (s: (j: (typeof active)[number]) => boolean) => active.filter(s).length;
  const inProduction = count((j) => j.stage === 'in_production');
  const ready = count((j) => j.stage === 'ready' || j.stage === 'partially_released');
  const dueThisWeek = active.filter((j) => j.dueDate >= date && j.dueDate <= addDays(date, 6)).length;

  const kpis: Kpi[] = [];
  if (money) {
    const month = { from: `${date.slice(0, 7)}-01`, to: date };
    const before = sameDaysLastMonth(date);
    const sales = salesRegister(db, month.from, month.to).totals.netCents;
    const collections = collectionsRegister(db, month.from, month.to).tenderCents;
    kpis.push(
      { key: 'sales', label: 'Sales this month', value: sales, money: true, changePct: change(sales, salesRegister(db, before.from, before.to).totals.netCents), href: `/tax/sales?from=${month.from}&to=${month.to}` },
      { key: 'collections', label: 'Collections this month', value: collections, money: true, changePct: change(collections, collectionsRegister(db, before.from, before.to).tenderCents), href: `/rpt/collections-register?from=${month.from}&to=${month.to}` },
    );
  }
  if (seeJobs || seeFloor) kpis.push({ key: 'open', label: 'Open job orders', value: active.length, money: false, note: `${dueThisWeek} due this week`, href: '/docs/jo.job_order' });
  if (money) kpis.push({ key: 'cash', label: 'Cash on hand', value: cashPosition(db, date).totalCents, money: true, href: `/rpt/cash-position?asOf=${date}` });
  if (!money && seeFloor) kpis.push(
    { key: 'in_production', label: 'In production', value: inProduction, money: false, href: '/prd/board' },
    { key: 'ready', label: 'Ready to release', value: ready, money: false, href: '/prd/board' },
    { key: 'pieces', label: 'Pieces made today', value: piecesToday?.pieces ?? 0, money: false, note: `${piecesToday?.workers ?? 0} workers`, href: '/prd/board' },
  );

  // This month's due dates: open job orders due each day (late ones are those past today).
  const month = date.slice(0, 7);
  const calendar = seeJobs ? {
    month,
    days: Array.from({ length: Number(monthEnd(month).slice(8)) }, (_, i) => {
      const d = `${month}-${pad(i + 1)}`;
      const due = active.filter((j) => j.dueDate === d).length;
      return { date: d, due, late: d < date && due > 0 };
    }),
  } : null;
  const releasedThisMonth = seeJobs ? new Set(releasesBetween(db, `${month}-01`, date).map((r) => r.jobOrderId)).size : 0;

  return {
    asOf: date,
    kpis: kpis.slice(0, 4),
    jobs: seeJobs || seeFloor ? { total: jobs.length, late: jobs.filter((j) => j.late).length, inProduction, toRoute: jobs.filter((j) => j.status === 'to_route').length, rows: jobs.slice(0, 8) } : null,
    activity: seeFloor ? {
      days: Array.from({ length: 7 }, (_, i) => { const d = addDays(date, i - 6); const w = week.find((x) => x.date === d); return { date: d, pieces: w?.pieces ?? 0, workers: w?.workers ?? 0 }; }),
      today: piecesToday?.pieces ?? 0,
      averagePerDay: week.length ? Math.round(week.reduce((n, d) => n + d.pieces, 0) / week.length) : 0,
      workersToday: piecesToday?.workers ?? 0,
    } : null,
    calendar,
    stages: seeJobs ? [
      { key: 'not_started', label: 'Not started', count: count((j) => j.stage === 'open') },
      { key: 'in_production', label: 'In production', count: inProduction },
      { key: 'ready', label: 'Ready', count: ready },
      { key: 'released', label: 'Released this month', count: releasedThisMonth },
    ] : null,
  };
}
export type HomeCards = ReturnType<typeof homeCards>;
