import { useEffect, useState } from 'react';
import { api, type DashHomeData, type DashItem, type DashNotification, type DashOwnerCharts, type DashOwnerHealth, type DashWidget, type NightlyStatus } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Loading, Notice, manilaTime, peso } from '../../components/ui.tsx';
import { nightlyLine } from '../AUD/nightly.ts';
import { Card, HomeCards, type IconName } from './Cards.tsx';
import { TodayList } from './Today.tsx';
import { AgingBars, Bars, CashLine } from './MoneyCharts.tsx';
import { REPORT_QUIET_MS, useLiveChange, useLiveReload } from '../../live.ts';

function Item({ item, action, muted = false, at }: { item: DashItem; action?: React.ReactNode; muted?: boolean; at?: string }) {
  const title = item.href ? <Link to={item.href} className="font-medium text-indigo-700 hover:underline">{item.label}</Link> : <span className="font-medium">{item.label}</span>;
  return <li className={`flex flex-wrap items-start justify-between gap-x-4 border-t border-slate-100 py-2 text-sm first:border-0 ${muted ? 'opacity-60' : ''}`}>
    <div className="min-w-0 flex-1">{title}{item.detail && <p className="text-slate-500">{item.detail}</p>}{at && <p className="text-xs text-slate-400">{manilaTime(at)}</p>}</div>
    {item.amountCents !== undefined && <strong className="tabular-nums">{peso(item.amountCents)}</strong>}
    {action}
  </li>;
}

const NOTE_PAGE = 50;
const ATTENTION_KEYS = ['overdue-collectibles', 'due', 'ready', 'collectibles', 'exceptions', 'production', 'drafts', 'month-end'];
type AttentionItem = DashItem & { notificationId?: string };

/** Prioritise only the reminders already returned; the full widgets and notifications remain reachable. */
export function attentionItems(widgets: DashWidget[], notifications: DashNotification[]): AttentionItem[] {
  const priority = ['health-red', 'negative-cash', 'jo-overdue', 'released-balance', 'tax-deadline', 'remittance-deadline', 'jo-due', 'jo-ready'];
  const notes = notifications.filter((n) => !n.read).sort((a, b) => {
    const rank = (kind: string) => { const i = priority.indexOf(kind); return i < 0 ? priority.length : i; };
    return rank(a.kind) - rank(b.kind);
  }).map((n) => ({ ...n, notificationId: n.id }));
  const warnings = widgets.filter((w) => w.tone === 'danger').map((w) => ({ id: w.key, label: w.title, href: w.href,
    detail: w.items?.map((i) => `${i.label}: ${i.detail ?? ''}`).join(' · ') }));
  const work = ATTENTION_KEYS.flatMap((key) => widgets.filter((w) => w.key === key && w.tone !== 'danger').flatMap((w) =>
    (w.items ?? []).filter((i) => !notes.some((n) => n.href && n.href === i.href)).slice(0, 2).map((i) => ({ ...i, id: `${w.key}:${i.id}`, label: `${w.title} · ${i.label}`, href: i.href ?? w.href }))));
  const rank = (item: AttentionItem) => {
    if (warnings.some((w) => w === item)) return -1;
    if (item.notificationId) {
      const n = notes.find((n) => n.id === item.id)!;
      const i = priority.indexOf(n.kind);
      return i < 0 ? 12 : i;
    }
    return [2, 6, 7, 3, 8, 9, 10, 4][ATTENTION_KEYS.indexOf(item.id.split(':')[0]!)] ?? 12;
  };
  return [...warnings, ...notes, ...work].sort((a, b) => rank(a) - rank(b)).slice(0, 8);
}

function Notifications({ all = false, widgets = [], children }: { all?: boolean; widgets?: DashWidget[]; children?: React.ReactNode }) {
  const [rows, setRows] = useState<DashNotification[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // The home panel asks for its 8 unread ones; the full list comes 50 at a time (there can be thousands).
  const load = (offset: number) => api.dashNotifications(all ? { limit: NOTE_PAGE, offset } : { limit: 8, offset: 0, unread: true }).then((page) => {
    setRows((prior) => (offset ? [...(prior ?? []), ...page] : page));
    setMore(all && page.length === NOTE_PAGE);
  }, (e: Error) => setError(e.message));
  useEffect(() => { void load(0); }, []);
  useLiveReload(() => load(0));
  const shown: AttentionItem[] | null = all ? rows : attentionItems(widgets, rows ?? []);
  async function markRead(id: string) {
    setBusy(id);
    try {
      await api.dashRead(id);
      setRows((prior) => prior?.map((n) => n.id === id ? { ...n, read: true } : n) ?? null);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }
  return <Card icon="bell" title={all ? 'Notifications' : 'Needs attention'} count={rows ? rows.filter((n) => !n.read).length : undefined} href={all ? undefined : '/dash/notifications'}>
    {children}
    {error && <Notice>{error}</Notice>}
    {rows === null && !error && <Loading />}
    {rows !== null && shown?.length === 0 && <p className="text-sm text-slate-500">Nothing needs your attention.</p>}
    {/* Two columns of items only when the card itself is wide (alone across the screen), not beside Today. */}
    <ul className={all ? undefined : '@3xl:grid @3xl:grid-cols-2 @3xl:gap-x-10 @3xl:[&>li:nth-child(2)]:border-0'}>{shown?.map((row) => { const note = all ? rows?.find((n) => n.id === row.id) : rows?.find((n) => n.id === row.notificationId); return <Item key={row.id} item={row} muted={note?.read} at={all ? note?.at : undefined} action={note && !note.read &&
      <button type="button" disabled={busy === note.id} onClick={() => void markRead(note.id)} className="shrink-0 text-xs text-indigo-700 hover:underline disabled:opacity-50">Mark read</button>} />; })}</ul>
    {more && <button type="button" onClick={() => void load(rows?.length ?? 0)} className="text-sm text-indigo-700 hover:underline">Show more</button>}
    {!all && <Link to="/dash/notifications" className="text-sm text-indigo-700 hover:underline">See all notifications</Link>}
  </Card>;
}

function Metric({ label, value, href, money = true }: { label: string; value: number; href: string; money?: boolean }) {
  return <Link to={href} className="rounded-xl p-3 ring-1 ring-slate-100 hover:bg-slate-50">
    <span className="block text-xs text-slate-500">{label}</span>
    <strong className="text-lg font-semibold tabular-nums">{money ? peso(value) : value}</strong>
  </Link>;
}

function OwnerHealth() {
  const [data, setData] = useState<DashOwnerHealth | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashOwnerHealth().then(setData, (e: Error) => setError(e.message)); }, []);
  useLiveChange(() => void api.dashOwnerHealth().then(setData, () => undefined), undefined, REPORT_QUIET_MS); // Live (the owner's check, 26 Oct 2026): a change on any computer shows here too.
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading label="Loading how the business is doing…" />;
  return <OwnerHealthFigures data={data} />;
}

export function OwnerHealthFigures({ data }: { data: DashOwnerHealth }) {
  const report = (path: string, query: Record<string, string>) => `${path}?${new URLSearchParams(query)}`;
  return <Card icon="trend" title="How the business is doing">
    <div className="grid gap-4 md:grid-cols-2">
      {data.periods.map((period) => <div key={period.from}>
        <h3 className="mb-2 font-medium">{period.label}</h3>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="VATable sales" value={period.salesCents} href={report('/tax/sales', { from: period.from, to: period.to })} />
          <Metric label="VAT" value={period.vatCents} href={report('/tax/sales', { from: period.from, to: period.to })} />
          <Metric label="Collections" value={period.collectionsCents} href={report('/rpt/collections-register', { from: period.from, to: period.to })} />
          <Metric label="Gross payroll" value={period.payrollCents} href={report('/rpt/payroll-register', { month: period.from.slice(0, 7) })} />
        </div>
      </div>)}
    </div>
    <h3 className="mb-2 mt-5 font-medium">Today · {data.asOf}</h3>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {data.cashPlaces.map((place) => <Metric key={place.id} label={`Cash · ${place.name}`} value={place.balanceCents} href={report('/rpt/cash-position', { asOf: data.asOf })} />)}
      <Metric label="Customers owe" value={data.receivables.totalCents} href={report('/rpt/ar-aging', { asOf: data.asOf })} />
      <Metric label="Over 30 days" value={data.receivables.over30Cents} href={report('/rpt/ar-aging', { asOf: data.asOf })} />
      <Metric label="Over 60 days" value={data.receivables.over60Cents} href={report('/rpt/ar-aging', { asOf: data.asOf })} />
      <Metric label="Over 90 days" value={data.receivables.over90Cents} href={report('/rpt/ar-aging', { asOf: data.asOf })} />
      <Metric label="Owed to suppliers" value={data.payables.totalCents} href={report('/rpt/ap-aging', { asOf: data.asOf })} />
      <Metric label="Supplier bills due in 7 days" value={data.payables.dueNext7DaysCents} href={report('/rpt/ap-aging', { asOf: data.asOf })} />
      <Metric label="Deposits held" value={data.depositsHeldCents} href={report('/rpt/deposits-held', { asOf: data.asOf })} />
      <Metric label="Open job orders" value={data.jobs.open} href="/rpt/job-order-follow-up" money={false} />
      <Metric label="Job orders due this week" value={data.jobs.dueThisWeek} href={report('/rpt/lead-time', { asOf: data.asOf })} money={false} />
      <Metric label="Late job orders" value={data.jobs.late} href={report('/rpt/late-jobs', { asOf: data.asOf })} money={false} />
    </div>
    <h3 className="mb-2 mt-5 font-medium">Next tax due dates</h3>
    <ul className="grid gap-2 sm:grid-cols-2">{data.taxDeadlines.map((deadline) => <li key={`${deadline.form}:${deadline.periodLabel}`}>
      <Link to="/tax/calendar" className="block rounded-xl p-3 ring-1 ring-slate-100 hover:bg-slate-50">
        <strong>{deadline.form}</strong><span className="block text-sm text-slate-500">{deadline.periodLabel} · due {deadline.dueDate}</span>
      </Link>
    </li>)}</ul>
  </Card>;
}

/** The red line on the owner's and accountant's Home when last night's checks found anything (AUD). */
function NightlyLine() {
  const [status, setStatus] = useState<NightlyStatus | null>(null);
  useEffect(() => { void api.nightlyStatus().then(setStatus, () => setStatus(null)); }, []);
  useLiveReload(() => api.nightlyStatus().then(setStatus));
  const line = status && nightlyLine(status);
  if (!line) return null;
  return <Link to="/aud/nightly" role="status" className="block rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100">{line} See Nightly checks.</Link>;
}

function OwnerCharts() {
  const [data, setData] = useState<DashOwnerCharts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashOwnerCharts().then(setData, (e: Error) => setError(e.message)); }, []);
  useLiveChange(() => void api.dashOwnerCharts().then(setData, () => undefined), undefined, REPORT_QUIET_MS);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading label="Loading the last 12 months…" />;
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Last 12 months</h2>
    <p className="text-sm text-slate-600">Cancelled expenses are left out, so a month can differ from the Income statement. Point at a month or a bar for its details; on a phone, tap it.</p>
    <Card icon="chart" title="Sales, collections and expenses" href={`/rpt/income-statement?from=${data.months[0]!.from}&to=${data.asOf}`}><div className="overflow-x-auto"><Bars data={data.months} /></div>
      <p className="flex flex-wrap gap-3 text-sm"><span>See the report:</span>
        <Link to={`/rpt/income-statement?from=${data.months[0]!.from}&to=${data.asOf}`} className="text-indigo-700 hover:underline">Income statement</Link>
        <Link to={`/rpt/collections-register?from=${data.months[0]!.from}&to=${data.asOf}`} className="text-indigo-700 hover:underline">Collections register</Link></p></Card>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card icon="cash" title="Cash on hand at month end" grow href={`/rpt/cash-position?asOf=${data.asOf}`}><div className="overflow-x-auto"><CashLine data={data.months} /></div></Card>
      <Card icon="money" title="Receivables by age today" grow href={`/rpt/ar-aging?asOf=${data.asOf}`}><div className="overflow-x-auto"><AgingBars data={data.receivables} /></div></Card>
    </div>
  </section>;
}

export function DashHome() {
  const [home, setHome] = useState<DashHomeData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashHome().then(setHome, (e: Error) => setError(e.message)); }, []);
  useLiveReload(() => api.dashHome().then(setHome)); // Live (the owner's check, 26 Oct 2026): a change on any computer shows here too.
  return <div className="space-y-4">
    {error && <Notice>{error}</Notice>}
    {!home && !error && <Loading label="Loading your home…" />}
    {home && <HomeContent home={home} />}
  </div>;
}

/** Each role widget's icon on its card (the owner's request, Oct 2026: every home card alike). */
const WIDGET_ICON: Record<string, IconName> = {
  cash: 'cash', sales: 'sales', collections: 'money', 'vat-quarter': 'tax', 'month-end': 'calendar', integrity: 'alert', cancellations: 'undo',
  drafts: 'draft', exceptions: 'inbox', production: 'floor', due: 'calendar', ready: 'jobs', collectibles: 'money', 'overdue-collectibles': 'money',
};

/** Where a widget's list leads when it has no page of its own. */
const WIDGET_MORE: Record<string, string> = { cancellations: '/rpt/cancellations' };
/** A widget's list stays short on the home (the owner's request, Oct 2026: cards of a size); the rest is a click away. */
const SHOWN = 5;

function widgetCards(widgets: DashWidget[]) {
  return widgets.map((widget) => {
    const more = widget.href ?? WIDGET_MORE[widget.key];
    const left = (widget.items?.length ?? 0) - SHOWN;
    return <Card key={widget.key} icon={widget.tone === 'danger' ? 'alert' : WIDGET_ICON[widget.key] ?? 'jobs'} title={widget.title}
      count={widget.items?.length || undefined} href={more} tone={widget.tone}>
      {widget.amountCents !== undefined && <p className="text-2xl font-semibold tabular-nums">{peso(widget.amountCents)}</p>}
      {widget.items && (widget.items.length ? <ul>{widget.items.slice(0, SHOWN).map((row) => <Item key={row.id} item={row} />)}</ul> : <p className="text-sm text-slate-500">Nothing here right now.</p>)}
      {left > 0 && (more ? <Link to={more} className="text-sm text-indigo-700 hover:underline">{left} more</Link> : <p className="text-sm text-slate-500">{left} more</p>)}
    </Card>;
  });
}

function Widgets({ widgets }: { widgets: DashWidget[] }) {
  return <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{widgetCards(widgets)}</div>;
}

/**
 * Figures the home already shows elsewhere (the owner's request, Oct 2026: no card twice): the owner's sales and
 * collections this month are headline figures at the top, and the cash places are under How the business is doing.
 */
const SHOWN_ELSEWHERE: Record<string, string[]> = { owner: ['sales', 'collections', 'cash'] };

export function HomeContent({ home }: { home: DashHomeData }) {
  const work = home.widgets.filter((w) => ATTENTION_KEYS.includes(w.key) || w.tone === 'danger');
  const hidden = SHOWN_ELSEWHERE[home.role] ?? [];
  const figures = home.widgets.filter((w) => !work.includes(w) && !hidden.includes(w.key));
  return <div className="space-y-4">
    {/* Today and what needs attention side by side on a computer (the owner's request, Nov 2026), ending level; one under
        the other on a phone. With nothing for today, Needs attention takes the whole width. Then the cards. */}
    <div className="grid items-stretch gap-4 lg:[&:has(>:nth-child(2))]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [&>*]:min-w-0 [&>section]:h-full [&>div>section]:h-full">
      <TodayList />
      <div className="@container"><Notifications widgets={home.widgets}>{(home.role === 'owner' || home.role === 'accountant') && <NightlyLine />}</Notifications></div>
    </div>
    <HomeCards more={widgetCards(figures)} />
    {home.role === 'owner' && <OwnerHealth />}
    {home.showCharts && <OwnerCharts />}
    {work.length > 0 && <details className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <summary className="cursor-pointer text-sm font-medium text-indigo-700">More role details: {work.map((w) => w.title).join(', ')}</summary>
      <div className="mt-4"><Widgets widgets={work} /></div>
    </details>}
  </div>;
}

export function NotificationsPage() {
  return <div className="max-w-3xl space-y-4"><h1 className="text-2xl font-semibold">Notifications</h1><Notifications all /></div>;
}
