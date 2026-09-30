import { useEffect, useState } from 'react';
import { api, type DashHomeData, type DashItem, type DashNotification, type DashOwnerHealth, type NightlyStatus } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Notice, Panel, peso } from '../../components/ui.tsx';
import { nightlyLine } from '../AUD/nightly.ts';

function Item({ item, action, muted = false }: { item: DashItem; action?: React.ReactNode; muted?: boolean }) {
  const title = item.href ? <Link to={item.href} className="font-medium text-indigo-700 hover:underline">{item.label}</Link> : <span className="font-medium">{item.label}</span>;
  return <li className={`flex flex-wrap items-start justify-between gap-x-4 border-t border-slate-100 py-2 text-sm first:border-0 ${muted ? 'opacity-60' : ''}`}>
    <div className="min-w-0 flex-1">{title}{item.detail && <p className="text-slate-500">{item.detail}</p>}</div>
    {item.amountCents !== undefined && <strong className="tabular-nums">{peso(item.amountCents)}</strong>}
    {action}
  </li>;
}

function Notifications({ all = false }: { all?: boolean }) {
  const [rows, setRows] = useState<DashNotification[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { void api.dashNotifications().then(setRows, (e: Error) => setError(e.message)); }, []);
  const shown = all ? rows : rows?.filter((n) => !n.read).slice(0, 8);
  async function markRead(id: string) {
    setBusy(id);
    try {
      await api.dashRead(id);
      setRows((prior) => prior?.map((n) => n.id === id ? { ...n, read: true } : n) ?? null);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }
  return <Panel title="Notifications">
    {error && <Notice>{error}</Notice>}
    {rows === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
    {shown?.length === 0 && <p className="text-sm text-slate-500">Nothing needs your attention.</p>}
    <ul>{shown?.map((row) => <Item key={row.id} item={row} muted={row.read} action={!row.read &&
      <button type="button" disabled={busy === row.id} onClick={() => void markRead(row.id)} className="shrink-0 text-xs text-indigo-700 hover:underline disabled:opacity-50">Mark read</button>} />)}</ul>
    {!all && <Link to="/dash/notifications" className="text-sm text-indigo-700 hover:underline">See all notifications</Link>}
  </Panel>;
}

function Metric({ label, value, href, money = true }: { label: string; value: number; href: string; money?: boolean }) {
  return <Link to={href} className="rounded border border-slate-200 p-3 hover:border-indigo-300">
    <span className="block text-xs text-slate-500">{label}</span>
    <strong className="tabular-nums">{money ? peso(value) : value}</strong>
  </Link>;
}

function OwnerHealth() {
  const [data, setData] = useState<DashOwnerHealth | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashOwnerHealth().then(setData, (e: Error) => setError(e.message)); }, []);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading how the business is doing…</p>;
  const report = (path: string, query: Record<string, string>) => `${path}?${new URLSearchParams(query)}`;
  return <Panel title="How the business is doing">
    <div className="grid gap-4 md:grid-cols-2">
      {data.periods.map((period) => <div key={period.from}>
        <h3 className="mb-2 font-medium">{period.label}</h3>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="VATable sales" value={period.salesCents} href={report('/tax/sales-register', { from: period.from, to: period.to })} />
          <Metric label="VAT" value={period.vatCents} href={report('/tax/sales-register', { from: period.from, to: period.to })} />
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
      <Link to="/tax/calendar" className="block rounded border border-slate-200 p-3 hover:border-indigo-300">
        <strong>{deadline.form}</strong><span className="block text-sm text-slate-500">{deadline.periodLabel} · due {deadline.dueDate}</span>
      </Link>
    </li>)}</ul>
  </Panel>;
}

/** The red line on the owner's and accountant's Home when last night's checks found anything (AUD). */
function NightlyLine() {
  const [status, setStatus] = useState<NightlyStatus | null>(null);
  useEffect(() => { void api.nightlyStatus().then(setStatus, () => setStatus(null)); }, []);
  const line = status && nightlyLine(status);
  if (!line) return null;
  return <Link to="/aud/nightly" role="status" className="block rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100">{line} See Nightly checks.</Link>;
}

export function DashHome() {
  const [home, setHome] = useState<DashHomeData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashHome().then(setHome, (e: Error) => setError(e.message)); }, []);
  return <div className="space-y-4">
    {error && <Notice>{error}</Notice>}
    {!home && !error && <p className="text-sm text-slate-500">Loading your home…</p>}
    {(home?.role === 'owner' || home?.role === 'accountant') && <NightlyLine />}
    {home?.role === 'owner' && <OwnerHealth />}
    {home && <div className="grid gap-4 lg:grid-cols-2">
      {home.widgets.map((widget) => <Panel key={widget.key} title={widget.title}>
        {widget.amountCents !== undefined && <p className="text-2xl font-semibold tabular-nums">{peso(widget.amountCents)}</p>}
        {widget.items && (widget.items.length ? <ul>{widget.items.map((row) => <Item key={row.id} item={row} />)}</ul> : <p className="text-sm text-slate-500">Nothing here right now.</p>)}
        {widget.href && <Link to={widget.href} className="text-sm text-indigo-700 hover:underline">Open board</Link>}
      </Panel>)}
    </div>}
    <Notifications />
  </div>;
}

export function NotificationsPage() {
  return <div className="max-w-3xl space-y-4"><h1 className="text-2xl font-semibold">Notifications</h1><Notifications all /></div>;
}
