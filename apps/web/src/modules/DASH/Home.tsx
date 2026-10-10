import { useEffect, useState } from 'react';
import { api, type DashHomeData, type DashItem, type DashNotification, type DashOwnerCharts, type DashOwnerHealth, type DashWidget, type NightlyStatus } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Notice, peso } from '../../components/ui.tsx';
import { nightlyLine } from '../AUD/nightly.ts';
import { Card, HomeCards, type IconName } from './Cards.tsx';

function Item({ item, action, muted = false }: { item: DashItem; action?: React.ReactNode; muted?: boolean }) {
  const title = item.href ? <Link to={item.href} className="font-medium text-indigo-700 hover:underline">{item.label}</Link> : <span className="font-medium">{item.label}</span>;
  return <li className={`flex flex-wrap items-start justify-between gap-x-4 border-t border-slate-100 py-2 text-sm first:border-0 ${muted ? 'opacity-60' : ''}`}>
    <div className="min-w-0 flex-1">{title}{item.detail && <p className="text-slate-500">{item.detail}</p>}</div>
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
    {rows === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
    {rows !== null && shown?.length === 0 && <p className="text-sm text-slate-500">Nothing needs your attention.</p>}
    <ul>{shown?.map((row) => { const note = all ? rows?.find((n) => n.id === row.id) : rows?.find((n) => n.id === row.notificationId); return <Item key={row.id} item={row} muted={note?.read} action={note && !note.read &&
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
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading how the business is doing…</p>;
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
  const line = status && nightlyLine(status);
  if (!line) return null;
  return <Link to="/aud/nightly" role="status" className="block rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100">{line} See Nightly checks.</Link>;
}

const shortPeso = (cents: number) => Math.abs(cents) < 100_000 ? peso(cents) : Math.abs(cents) >= 100_000_000 ? `₱${(cents / 100_000_000).toFixed(1)}m` : `₱${Math.round(cents / 100_000).toLocaleString()}k`;
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-PH', { month: 'short' }).format(new Date(`${month}-01T00:00:00Z`));
const signedScale = (values: number[], bottom: number, height: number) => {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return { min, max, y: (value: number) => bottom - (value - min) / (max - min || 1) * height };
};

export function Bars({ data }: { data: DashOwnerCharts['months'] }) {
  // `light`: the second colour of each series' stripes.
  const fields = [{ key: 'salesCents', label: 'Sales', colour: '#1f3bb3', light: '#8c9ee2' }, { key: 'collectionsCents', label: 'Collections', colour: '#64748b', light: '#b6c0cd' },
    { key: 'expensesCents', label: 'Expenses', colour: '#cbd5e1', light: '#eef2f6' }] as const;
  const scale = signedScale(data.flatMap((row) => fields.map((field) => row[field.key])), 190, 150);
  const zero = scale.y(0);
  const top = scale.y(scale.max);
  const last = data.length - 1;
  // As the home's other charts (the owner's reference picture): a pale track behind each month, this month's track
  // tinted, every bar striped in its series' colours, dashed guides and light labels.
  return <div><svg viewBox="0 0 720 245" role="img" aria-label="Sales, collections and expenses by month" className="h-auto min-w-[620px] print:min-w-0">
    <desc>Negative amounts, including reversals, appear below the labelled zero line.</desc>
    <defs>{fields.map((field) => <pattern key={field.key} id={`month-hatch-${field.key}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill={field.light} /><rect width="3.5" height="6" fill={field.colour} /></pattern>)}</defs>
    <line x1="42" y1={zero} x2="710" y2={zero} stroke="#cbd5e1" />
    {scale.max > 0 && [top, (top + zero) / 2].map((y) => <line key={y} x1="42" y1={y} x2="710" y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />)}
    {data.map((row, index) => <g key={row.month}>
      <rect x={44 + index * 55} y="32" width="42" height="160" rx="12" fill={index === last ? '#eef1fb' : '#f8fafc'} />
      {fields.map((field, fieldIndex) => {
        const y = scale.y(row[field.key]);
        const striped = row[field.key] !== 0; // every month's bars striped, each in its own colour (the owner's choice)
        return <rect key={field.key} x={48 + index * 55 + fieldIndex * 12} y={Math.min(zero, y)} width="10" height={Math.abs(y - zero)} rx="3" fill={striped ? `url(#month-hatch-${field.key})` : field.colour} tabIndex={0}>
          <title>{`${field.label}, ${row.month}: ${peso(row[field.key])}`}</title>
        </rect>;
      })}
      <text x={65 + index * 55} y="208" textAnchor="middle" fontSize="11" fill={index === last ? '#0f172a' : '#64748b'} fontWeight={index === last ? 600 : 400}>{monthLabel(row.month)}</text></g>)}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="194" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
    {fields.map((field, index) => <g key={field.key}><circle cx={240 + index * 115} cy="230" r="5" fill={field.colour} />
      <text x={250 + index * 115} y="234" fontSize="12" fill="#475569">{field.label}</text></g>)}
  </svg></div>;
}

export function CashLine({ data }: { data: DashOwnerCharts['months'] }) {
  const scale = signedScale(data.map((row) => row.cashCents), 170, 130);
  const zero = scale.y(0);
  const points = data.map((row, index) => `${48 + index * 59},${scale.y(row.cashCents)}`).join(' ');
  return <svg viewBox="0 0 720 215" role="img" aria-label="Cash on hand at each month end" className="h-auto min-w-[620px] print:min-w-0">
    <desc>Negative cash balances appear below the labelled zero line.</desc>
    <line x1="42" y1={zero} x2="710" y2={zero} stroke="#cbd5e1" />
    {scale.max > 0 && [scale.y(scale.max), (scale.y(scale.max) + zero) / 2].map((y) => <line key={y} x1="42" y1={y} x2="710" y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />)}
    <polyline points={points} fill="none" stroke="#1f3bb3" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    {data.map((row, index) => { const x = 48 + index * 59; const y = scale.y(row.cashCents); return <g key={row.month}>
      <circle cx={x} cy={y} r={index === data.length - 1 ? 6 : 4} fill={index === data.length - 1 ? '#1f3bb3' : '#ffffff'} stroke="#1f3bb3" strokeWidth="2" tabIndex={0}><title>{`${row.month}: ${peso(row.cashCents)}`}</title></circle>
      <text x={x} y="190" textAnchor="middle" fontSize="11" fill={index === data.length - 1 ? '#0f172a' : '#64748b'} fontWeight={index === data.length - 1 ? 600 : 400}>{monthLabel(row.month)}</text></g>; })}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="174" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
  </svg>;
}

export function AgingBars({ data }: { data: DashOwnerCharts['receivables'] }) {
  const scale = signedScale(data.map((row) => row.amountCents), 170, 130);
  const zero = scale.y(0);
  const largest = data.reduce((b, row) => (row.amountCents > b.amountCents ? row : b), data[0] ?? { key: '', amountCents: 0 });
  // A pale track behind each bar and the largest one striped in our blue (the owner's reference picture).
  return <svg viewBox="0 0 520 220" role="img" aria-label="Receivables by age today" className="h-auto min-w-[450px] print:min-w-0">
    <desc>Negative receivables appear below the labelled zero line.</desc>
    <defs><pattern id="aging-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#8c9ee2" /><rect width="4" height="7" fill="#1f3bb3" /></pattern></defs>
    <line x1="42" y1={zero} x2="510" y2={zero} stroke="#cbd5e1" />
    {data.map((row, index) => { const y = scale.y(row.amountCents); const best = row.amountCents > 0 && row === largest; return <g key={row.key}>
      <rect x={63 + index * 90} y="32" width="46" height="144" rx="12" fill="#f8fafc" />
      <rect x={65 + index * 90} y={Math.min(zero, y)} width="42" height={Math.max(1, Math.abs(y - zero))} rx="10" fill={best ? 'url(#aging-hatch)' : '#cbd5e1'} tabIndex={0}><title>{`${row.label} days: ${peso(row.amountCents)}`}</title></rect>
      <text x={86 + index * 90} y="190" textAnchor="middle" fontSize="12" fill="#64748b">{row.label}</text></g>; })}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="174" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
  </svg>;
}

function OwnerCharts() {
  const [data, setData] = useState<DashOwnerCharts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashOwnerCharts().then(setData, (e: Error) => setError(e.message)); }, []);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading the last 12 months…</p>;
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Last 12 months</h2>
    <p className="text-sm text-slate-600">Negative amounts appear below ₱0, including reversals. Point at a bar or dot for its signed amount.</p>
    <Card icon="chart" title="Sales, collections and expenses" href={`/rpt/income-statement?from=${data.months[0]!.from}&to=${data.asOf}`}><div className="overflow-x-auto"><Bars data={data.months} /></div>
      <p className="flex flex-wrap gap-3 text-sm"><span>See the report:</span>
        <Link to={`/rpt/income-statement?from=${data.months[0]!.from}&to=${data.asOf}`} className="text-indigo-700 hover:underline">Income statement</Link>
        <Link to={`/rpt/collections-register?from=${data.months[0]!.from}&to=${data.asOf}`} className="text-indigo-700 hover:underline">Collections register</Link></p></Card>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card icon="cash" title="Cash on hand at month end" href={`/rpt/cash-position?asOf=${data.asOf}`}><div className="overflow-x-auto"><CashLine data={data.months} /></div></Card>
      <Card icon="money" title="Receivables by age today" href={`/rpt/ar-aging?asOf=${data.asOf}`}><div className="overflow-x-auto"><AgingBars data={data.receivables} /></div></Card>
    </div>
  </section>;
}

export function DashHome({ actions }: { actions?: React.ReactNode }) {
  const [home, setHome] = useState<DashHomeData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashHome().then(setHome, (e: Error) => setError(e.message)); }, []);
  return <div className="space-y-4">
    {error && <Notice>{error}</Notice>}
    {!home && !error && <p className="text-sm text-slate-500">Loading your home…</p>}
    {home ? <HomeContent home={home} actions={actions} /> : actions}
  </div>;
}

/** Each role widget's icon on its card (the owner's request, Oct 2026: every home card alike). */
const WIDGET_ICON: Record<string, IconName> = {
  cash: 'cash', sales: 'sales', collections: 'money', 'vat-quarter': 'tax', 'month-end': 'calendar', integrity: 'alert', cancellations: 'undo',
  drafts: 'draft', exceptions: 'inbox', production: 'floor', due: 'calendar', ready: 'jobs', collectibles: 'money', 'overdue-collectibles': 'money',
};

function Widgets({ widgets }: { widgets: DashWidget[] }) {
  return <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {widgets.map((widget) => <Card key={widget.key} icon={widget.tone === 'danger' ? 'alert' : WIDGET_ICON[widget.key] ?? 'jobs'} title={widget.title}
        count={widget.items?.length || undefined} href={widget.href} tone={widget.tone}>
        {widget.amountCents !== undefined && <p className="text-2xl font-semibold tabular-nums">{peso(widget.amountCents)}</p>}
        {widget.items && (widget.items.length ? <ul>{widget.items.map((row) => <Item key={row.id} item={row} />)}</ul> : <p className="text-sm text-slate-500">Nothing here right now.</p>)}
      </Card>)}
    </div>;
}

export function HomeContent({ home, actions }: { home: DashHomeData; actions?: React.ReactNode }) {
  const work = home.widgets.filter((w) => ATTENTION_KEYS.includes(w.key) || w.tone === 'danger');
  return <div className="space-y-4">
    {/* The cards first (the owner's request, Oct 2026); Needs attention is the last card of their bottom row. */}
    <HomeCards attention={<Notifications widgets={home.widgets}>{(home.role === 'owner' || home.role === 'accountant') && <NightlyLine />}</Notifications>} />
    {actions}
    {work.length > 0 && <details><summary className="cursor-pointer text-sm font-medium text-indigo-700">More role details</summary><Widgets widgets={work} /></details>}
    <Widgets widgets={home.widgets.filter((w) => !work.includes(w))} />
    {home.role === 'owner' && <OwnerHealth />}
    {home.showCharts && <OwnerCharts />}
  </div>;
}

export function NotificationsPage() {
  return <div className="max-w-3xl space-y-4"><h1 className="text-2xl font-semibold">Notifications</h1><Notifications all /></div>;
}
