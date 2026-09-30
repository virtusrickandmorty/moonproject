import { useEffect, useState } from 'react';
import { api, type DashHomeData, type DashItem, type DashNotification } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Notice, Panel, peso } from '../../components/ui.tsx';

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

export function DashHome() {
  const [home, setHome] = useState<DashHomeData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.dashHome().then(setHome, (e: Error) => setError(e.message)); }, []);
  return <div className="space-y-4">
    {error && <Notice>{error}</Notice>}
    {!home && !error && <p className="text-sm text-slate-500">Loading your home…</p>}
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
