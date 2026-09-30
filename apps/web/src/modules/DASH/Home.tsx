import { useEffect, useState } from 'react';
import { api, type DashHomeData, type DashItem, type DashNotification, type DashOwnerCharts, type DashOwnerHealth, type NightlyStatus } from '../../api.ts';
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

const NOTE_PAGE = 50;

function Notifications({ all = false }: { all?: boolean }) {
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
  const shown = rows;
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
    {more && <button type="button" onClick={() => void load(rows?.length ?? 0)} className="text-sm text-indigo-700 hover:underline">Show more</button>}
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

const shortPeso = (cents: number) => Math.abs(cents) >= 100_000_000 ? `₱${(cents / 100_000_000).toFixed(1)}m` : `₱${Math.round(cents / 100_000).toLocaleString()}k`;
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-PH', { month: 'short' }).format(new Date(`${month}-01T00:00:00Z`));

function Bars({ data }: { data: DashOwnerCharts['months'] }) {
  const fields = [{ key: 'salesCents', label: 'Sales', colour: '#4f46e5' }, { key: 'collectionsCents', label: 'Collections', colour: '#0f766e' },
    { key: 'expensesCents', label: 'Expenses', colour: '#b45309' }] as const;
  const max = Math.max(1, ...data.flatMap((row) => fields.map((field) => Math.abs(row[field.key]))));
  return <div><svg viewBox="0 0 720 245" role="img" aria-label="Sales, collections and expenses by month" className="h-auto min-w-[620px] print:min-w-0">
    <line x1="42" y1="190" x2="710" y2="190" stroke="currentColor" />
    {data.map((row, index) => <g key={row.month}>{fields.map((field, fieldIndex) => {
      const height = Math.abs(row[field.key]) / max * 150;
      return <rect key={field.key} x={48 + index * 55 + fieldIndex * 12} y={190 - height} width="10" height={height} fill={field.colour} tabIndex={0}>
        <title>{`${field.label}, ${row.month}: ${peso(row[field.key])}`}</title>
      </rect>;
    })}<text x={63 + index * 55} y="208" textAnchor="middle" fontSize="11">{monthLabel(row.month)}</text></g>)}
    <text x="4" y="44" fontSize="11">{shortPeso(max)}</text><text x="27" y="194" fontSize="11">₱0</text>
    {fields.map((field, index) => <g key={field.key}><rect x={235 + index * 115} y="225" width="10" height="10" fill={field.colour} />
      <text x={250 + index * 115} y="234" fontSize="12">{field.label}</text></g>)}
  </svg></div>;
}

function CashLine({ data }: { data: DashOwnerCharts['months'] }) {
  const max = Math.max(1, ...data.map((row) => Math.abs(row.cashCents)));
  const points = data.map((row, index) => `${48 + index * 59},${170 - row.cashCents / max * 130}`).join(' ');
  return <svg viewBox="0 0 720 215" role="img" aria-label="Cash on hand at each month end" className="h-auto min-w-[620px] print:min-w-0">
    <line x1="42" y1="170" x2="710" y2="170" stroke="currentColor" /><polyline points={points} fill="none" stroke="#4f46e5" strokeWidth="3" />
    {data.map((row, index) => { const x = 48 + index * 59; const y = 170 - row.cashCents / max * 130; return <g key={row.month}>
      <circle cx={x} cy={y} r="5" fill="#4f46e5" tabIndex={0}><title>{`${row.month}: ${peso(row.cashCents)}`}</title></circle>
      <text x={x} y="190" textAnchor="middle" fontSize="11">{monthLabel(row.month)}</text></g>; })}
    <text x="4" y="44" fontSize="11">{shortPeso(max)}</text><text x="27" y="174" fontSize="11">₱0</text>
  </svg>;
}

function AgingBars({ data }: { data: DashOwnerCharts['receivables'] }) {
  const max = Math.max(1, ...data.map((row) => Math.abs(row.amountCents)));
  return <svg viewBox="0 0 520 220" role="img" aria-label="Receivables by age today" className="h-auto min-w-[450px] print:min-w-0">
    <line x1="42" y1="170" x2="510" y2="170" stroke="currentColor" />
    {data.map((row, index) => { const height = Math.abs(row.amountCents) / max * 130; return <g key={row.key}>
      <rect x={65 + index * 90} y={170 - height} width="42" height={height} fill="#0f766e" tabIndex={0}><title>{`${row.label} days: ${peso(row.amountCents)}`}</title></rect>
      <text x={86 + index * 90} y="190" textAnchor="middle" fontSize="12">{row.label}</text></g>; })}
    <text x="4" y="44" fontSize="11">{shortPeso(max)}</text><text x="27" y="174" fontSize="11">₱0</text>
  </svg>;
}

function OwnerCharts() {
  const [data, setData] = useState<DashOwnerCharts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashOwnerCharts().then(setData, (e: Error) => setError(e.message)); }, []);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading the last 12 months…</p>;
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Last 12 months</h2>
    <Panel title="Sales, collections and expenses"><div className="overflow-x-auto"><Bars data={data.months} /></div>
      <p className="flex flex-wrap gap-3 text-sm"><span>See the report:</span>
        <Link to={`/rpt/income-statement?from=${data.months[0]!.from}&to=${data.asOf}`} className="text-indigo-700 hover:underline">Income statement</Link>
        <Link to={`/rpt/collections-register?from=${data.months[0]!.from}&to=${data.asOf}`} className="text-indigo-700 hover:underline">Collections register</Link></p></Panel>
    <Panel title="Cash on hand at month end"><div className="overflow-x-auto"><CashLine data={data.months} /></div>
      <Link to={`/rpt/cash-position?asOf=${data.asOf}`} className="text-sm text-indigo-700 hover:underline">See the report</Link></Panel>
    <Panel title="Receivables by age today"><div className="overflow-x-auto"><AgingBars data={data.receivables} /></div>
      <Link to={`/rpt/ar-aging?asOf=${data.asOf}`} className="text-sm text-indigo-700 hover:underline">See the report</Link></Panel>
  </section>;
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
    {home?.showCharts && <OwnerCharts />}
    {home && <div className="grid gap-4 lg:grid-cols-2">
      {home.widgets.map((widget) => <div key={widget.key} className={widget.tone === 'danger' ? 'rounded-lg bg-red-50 text-red-900 ring-2 ring-red-300 [&>section]:bg-red-50' : ''}><Panel title={widget.title}>
        {widget.amountCents !== undefined && <p className="text-2xl font-semibold tabular-nums">{peso(widget.amountCents)}</p>}
        {widget.items && (widget.items.length ? <ul>{widget.items.map((row) => <Item key={row.id} item={row} />)}</ul> : <p className="text-sm text-slate-500">Nothing here right now.</p>)}
        {widget.href && <Link to={widget.href} className="text-sm text-indigo-700 hover:underline">Open {widget.title.toLowerCase()}</Link>}
      </Panel></div>)}
    </div>}
    <Notifications />
  </div>;
}

export function NotificationsPage() {
  return <div className="max-w-3xl space-y-4"><h1 className="text-2xl font-semibold">Notifications</h1><Notifications all /></div>;
}
