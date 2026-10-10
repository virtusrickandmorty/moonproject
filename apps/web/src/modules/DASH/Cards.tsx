/**
 * The home's cards (the owner's request, Oct 2026, after a clinic dashboard): a strip of four headline figures; the job
 * orders on the floor beside pieces made each day this week; then the month's due dates (a dark calendar), the job orders
 * by stage (bubbles) and what needs attention. Every card is there only for those who may see it (GET /api/dash/cards).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type DashCards } from '../../api.ts';
import { Link } from '../../router.tsx';
import { CARD_TITLE, SURFACE, peso } from '../../components/ui.tsx';

/** Outline icons (Heroicons, MIT). */
const PATHS = {
  sales: 'M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z',
  money: 'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  jobs: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z',
  cash: 'M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  floor: 'M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  stages: 'M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z',
  check: 'm4.5 12.75 6 6 9-13.5',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  chart: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  trend: 'M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941',
  tax: 'M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185ZM9.75 9h.008v.008H9.75V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm4.125 4.5h.008v.008h-.008V13.5Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  alert: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  draft: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10',
  undo: 'M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3',
  inbox: 'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
};
export type IconName = keyof typeof PATHS;
const KPI_ICON: Record<string, IconName> = { sales: 'sales', collections: 'money', open: 'jobs', cash: 'cash', in_production: 'floor', ready: 'jobs', pieces: 'clock' };

function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}><path d={PATHS[name]} /></svg>;
}

/**
 * A card: a dark icon tile, the title, a small count, and a link to the full screen (the ⋯ of the picture). Every card of
 * the home uses it (the owner's request, Oct 2026); `tone="danger"` is a warning card (red ring and icon tile).
 */
export function Card({ icon, title, count, note, href, dark = false, tone, children }: { icon: IconName; title: string; count?: number; note?: string; href?: string; dark?: boolean; tone?: 'danger'; children: ReactNode }) {
  // Calm (the owner: not too colourful): grey icon tiles on white; red only for a warning.
  const look = tone === 'danger' ? 'rounded-xl bg-white shadow-sm ring-1 ring-red-200' : SURFACE;
  return <section className={`flex min-w-0 flex-col gap-4 p-5 ${look}`}>
    <header className="flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700'}`}><Icon name={icon} /></span>
      <h2 className={CARD_TITLE}>{title}</h2>
      {count !== undefined && <span className="rounded-md bg-slate-100 px-1.5 text-xs font-medium tabular-nums text-slate-600">{count}</span>}
      {note && <span className="hidden truncate text-xs text-slate-500 sm:inline">{note}</span>}
      {href && <Link to={href} aria-label={`Open ${title.toLowerCase()}`} className="ml-auto rounded-md px-2 text-lg leading-none text-slate-500 hover:bg-slate-100">⋯</Link>}
    </header>
    {children}
  </section>;
}

export function KpiStrip({ kpis }: { kpis: DashCards['kpis'] }) {
  if (kpis.length === 0) return null;
  return <section aria-label="Headline figures" className={`grid sm:grid-cols-2 lg:grid-cols-4 ${SURFACE}`}>
    {kpis.map((k, i) => <Link key={k.key} to={k.href} className={`flex items-center gap-3 p-4 hover:bg-slate-50 ${i > 0 ? 'border-t border-slate-100 sm:border-t-0 lg:border-l' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
      <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-600"><Icon name={KPI_ICON[k.key] ?? 'jobs'} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-slate-500">{k.label}</span>
        <span className="flex items-baseline gap-2">
          <strong className="text-xl font-semibold tabular-nums">{k.money ? peso(k.value) : k.value.toLocaleString('en-PH')}</strong>
          {k.note && <span className="truncate text-xs text-slate-500">{k.note}</span>}
        </span>
      </span>
      {k.changePct !== undefined && k.changePct !== null && <span title="Against the same days last month"
        className={`text-xs font-semibold tabular-nums ${k.changePct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{k.changePct >= 0 ? '+' : ''}{k.changePct}%</span>}
    </Link>)}
  </section>;
}

const STATUS: Record<NonNullable<DashCards['jobs']>['rows'][number]['status'], [string, string]> = {
  to_route: ['To route', 'bg-slate-100 text-slate-600'],
  in_production: ['In production', 'bg-slate-100 text-slate-800'],
  ready: ['Ready', 'bg-emerald-50 text-emerald-700'],
  late: ['Late', 'bg-red-50 text-red-700'],
};
const AVATAR = ['bg-slate-200 text-slate-700'];
const shortDate = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function JobsCard({ jobs }: { jobs: NonNullable<DashCards['jobs']> }) {
  const note = [jobs.inProduction && `${jobs.inProduction} in production`, jobs.toRoute && `${jobs.toRoute} to route`, jobs.late && `${jobs.late} late`].filter(Boolean).join(', ');
  return <Card icon="floor" title="Job orders on the floor" count={jobs.total} note={note} href="/prd/board">
    {jobs.rows.length === 0 ? <p className="text-sm text-slate-500">No job order is open.</p> : <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="px-1 pb-2 font-normal">Job order</th><th className="px-1 pb-2 font-normal">Item</th><th className="px-1 pb-2 font-normal">Step</th><th className="px-1 pb-2 font-normal">Status</th><th className="px-1 pb-2 text-right font-normal">Due</th></tr></thead>
        <tbody>{jobs.rows.map((j, i) => <tr key={j.id} className="border-t border-slate-50">
          <td className="px-1 py-2"><Link to={`/docs/jo.job_order/${j.id}`} className="flex items-center gap-2 hover:underline">
            <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${AVATAR[i % AVATAR.length]}`}>{j.customerName.trim().charAt(0).toUpperCase() || '?'}</span>
            <span className="min-w-0"><span className="block font-medium">{j.number}{j.rush && <span className="ml-1 rounded px-1 text-[10px] font-semibold uppercase text-red-600 ring-1 ring-red-200">Rush</span>}</span><span className="block max-w-[10rem] truncate text-xs text-slate-500">{j.customerName}</span></span>
          </Link></td>
          <td className="max-w-[12rem] truncate px-1 py-2 text-slate-700" title={j.item}>{j.item}</td>
          <td className="px-1 py-2 text-slate-700">{j.step ?? '—'}</td>
          <td className="px-1 py-2"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS[j.status][1]}`}>{STATUS[j.status][0]}</span></td>
          <td className={`px-1 py-2 text-right tabular-nums ${j.late ? 'font-semibold text-red-700' : 'text-slate-700'}`}>{shortDate(j.dueDate)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {jobs.total > jobs.rows.length && <Link to="/prd/board" className="text-sm text-indigo-700 hover:underline">See all {jobs.total} on the production board</Link>}
  </Card>;
}

const weekday = (date: string) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function ActivityCard({ activity }: { activity: NonNullable<DashCards['activity']> }) {
  const max = Math.max(1, ...activity.days.map((d) => d.pieces));
  const best = activity.days.reduce((b, d) => (d.pieces > b.pieces ? d : b), activity.days[0]!);
  const stat = (value: number, label: string) => <div className="rounded-xl p-2 text-center ring-1 ring-slate-100">
    <p className="text-lg font-semibold tabular-nums text-slate-900">{value.toLocaleString('en-PH')}</p><p className="text-xs text-slate-500">{label}</p>
  </div>;
  return <Card icon="clock" title="Pieces made this week" href="/rpt/production-status">
    <div className="grid grid-cols-3 gap-2">{stat(activity.today, 'Pieces today')}{stat(activity.averagePerDay, 'Average a work day')}{stat(activity.workersToday, 'Workers today')}</div>
    <div role="img" aria-label={`Pieces made each day: ${activity.days.map((d) => `${weekday(d.date)} ${d.pieces}`).join(', ')}`} className="flex h-40 items-end gap-2">
      {activity.days.map((d) => <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
        <span className="text-[10px] tabular-nums text-slate-500">{d.pieces || ''}</span>
        <div title={`${d.date}: ${d.pieces} pieces by ${d.workers} workers`} style={{ height: `${Math.max(6, (d.pieces / max) * 100)}%` }}
          className={`w-full rounded-xl ${d.pieces > 0 && d === best ? 'bg-indigo-600' : 'bg-slate-100'}`} />
        <span className="text-[11px] text-slate-500">{weekday(d.date)}</span>
      </div>)}
    </div>
    <div className="flex items-center gap-2 text-xs text-slate-500"><span>Less busy</span><span className="h-1.5 flex-1 rounded-full bg-gradient-to-r from-slate-100 to-slate-400" /><span>Busy</span></div>
  </Card>;
}

export function CalendarCard({ calendar, today }: { calendar: NonNullable<DashCards['calendar']>; today: string }) {
  const first = new Date(`${calendar.month}-01T00:00:00Z`).getUTCDay();
  const title = new Intl.DateTimeFormat('en-PH', { month: 'long', timeZone: 'UTC' }).format(new Date(`${calendar.month}-01T00:00:00Z`));
  const due = calendar.days.reduce((n, d) => n + d.due, 0);
  return <Card icon="calendar" title={`${title} due dates`} count={due} href="/cal">
    <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="text-slate-400">{d}</span>)}
      {Array.from({ length: first }, (_, i) => <span key={`blank${i}`} />)}
      {calendar.days.map((d) => {
        const past = d.date < today;
        const isToday = d.date === today;
        // The day of the month in every circle (the owner: the dates must show); what is due that day is the badge on it.
        const look = isToday ? 'bg-indigo-600 text-white font-semibold' : d.late ? 'bg-red-50 text-red-700 font-medium ring-1 ring-red-200'
          : d.due > 0 ? 'bg-slate-100 text-slate-900 font-medium ring-1 ring-slate-300' : past ? 'text-slate-400' : 'text-slate-700';
        return <span key={d.date} title={`${d.date}: ${d.due} due${d.late ? ' (late)' : ''}`} className={`relative mx-auto grid size-8 place-items-center rounded-full tabular-nums ${look}`}>
          {Number(d.date.slice(8))}
          {d.due > 0 && <span aria-hidden="true" className={`absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none text-white ${d.late ? 'bg-red-600' : 'bg-slate-700'}`}>{d.due}</span>}
        </span>;
      })}
    </div>
    <p className="text-xs text-slate-500">The badge on a date: open job orders due that day. Red: past due. Blue: today.</p>
  </Card>;
}

// Not started, in production, ready, released: the same colours as the status chips of the floor table.
const BUBBLE = ['bg-slate-100 text-slate-700', 'bg-slate-200 text-slate-900', 'bg-emerald-50 text-emerald-800', 'bg-white text-slate-600 ring-1 ring-slate-200'];
const DOT = ['bg-slate-300', 'bg-slate-500', 'bg-emerald-500', 'bg-slate-200'];

export function StagesCard({ stages }: { stages: NonNullable<DashCards['stages']> }) {
  const total = stages.reduce((n, s) => n + s.count, 0);
  const max = Math.max(1, ...stages.map((s) => s.count));
  return <Card icon="stages" title="Job orders by stage" count={total} href="/rpt/job-order-follow-up">
    <div className="flex min-h-48 flex-wrap items-center justify-center gap-1">
      {stages.map((s, i) => {
        const size = 48 + Math.round(Math.sqrt(s.count / max) * 104);
        return <div key={s.key} title={`${s.label}: ${s.count}`} style={{ width: size, height: size }}
          className={`grid place-items-center rounded-full text-center ${BUBBLE[i % BUBBLE.length]} ${s.count === 0 ? 'opacity-50' : ''}`}>
          <span><span className="block text-lg font-semibold tabular-nums">{s.count}</span>{size > 90 && <span className="block text-[11px]">{total ? Math.round((s.count / total) * 100) : 0}%</span>}</span>
        </div>;
      })}
    </div>
    <ul className="grid grid-cols-2 gap-2 text-xs">
      {stages.map((s, i) => <li key={s.key} className="flex items-center gap-2 rounded-full px-3 py-1 ring-1 ring-slate-100"><span className={`size-2 rounded-full ${DOT[i % DOT.length]}`} />{s.label}</li>)}
    </ul>
  </Card>;
}

/** The cards laid out; `attention` (the Needs attention list) takes the third place of the bottom row. */
export function CardsLayout({ cards, attention }: { cards: DashCards | null; attention: ReactNode }) {
  const bottom = [cards?.calendar && <CalendarCard key="cal" calendar={cards.calendar} today={cards.asOf} />, cards?.stages && <StagesCard key="stages" stages={cards.stages} />, <div key="attention" className="min-w-0">{attention}</div>].filter(Boolean);
  return <div className="space-y-4">
    {cards && <KpiStrip kpis={cards.kpis} />}
    {cards && (cards.jobs || cards.activity) && <div className={`grid gap-4 ${cards.jobs && cards.activity ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
      {cards.jobs && <JobsCard jobs={cards.jobs} />}
      {cards.activity && <ActivityCard activity={cards.activity} />}
    </div>}
    <div className={`grid items-start gap-4 ${bottom.length === 3 ? 'lg:grid-cols-3' : bottom.length === 2 ? 'lg:grid-cols-2' : ''}`}>{bottom}</div>
  </div>;
}

export function HomeCards({ attention }: { attention: ReactNode }) {
  const [cards, setCards] = useState<DashCards | null>(null);
  useEffect(() => { void api.dashCards().then(setCards, () => setCards(null)); }, []);
  return <CardsLayout cards={cards} attention={attention} />;
}
