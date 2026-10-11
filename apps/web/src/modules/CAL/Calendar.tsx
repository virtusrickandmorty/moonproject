import { useEffect, useState, type FormEvent } from 'react';
import { api, type CalEvent, type CalItem, type CalKind, type DocHeader, type Me } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, inputClass, longDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { KINDS, itemsOfKind, monthCells, monthRange, shiftMonth } from './calendar.ts';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const KIND_LABELS = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<CalKind, string>;

export function CalendarPage({ me }: { me: Me }) {
  const [month, setMonth] = useState(() => ({ year: Number(today().slice(0, 4)), month: Number(today().slice(5, 7)) }));
  const [items, setItems] = useState<CalItem[]>([]);
  const [kind, setKind] = useState<CalKind | 'all'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get('event'));
  const canCreate = me.permissions.includes('cal.events.create');
  const range = monthRange(month.year, month.month);
  const refresh = async () => { setItems(await api.calItems(range.from, range.to)); };
  useEffect(() => {
    let live = true;
    setLoading(true);
    void api.calItems(range.from, range.to).then((rows) => { if (live) { setItems(rows); setError(''); } },
      (e: Error) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range.from, range.to]);
  const shown = itemsOfKind(items, kind);
  const cells = monthCells(month.year, month.month);
  const byDate = new Map<string, CalItem[]>();
  for (const item of shown) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(Date.UTC(month.year, month.month - 1, 1));

  const card = (item: CalItem) => <li key={item.id} className="rounded-md bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
    <span className="block text-slate-500">{KIND_LABELS[item.kind]}{item.time ? ` · ${item.time}` : ''}</span>
    <Link to={item.href} className="font-medium text-indigo-700 hover:underline">{item.title}</Link>
    {item.rush && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-900">Rush</span>}
    {item.kind === 'event' && canCreate && <button type="button" className="ml-2 text-indigo-700 underline" onClick={() => setSelected(item.id)}>Manage</button>}
  </li>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="mr-auto text-2xl font-semibold">Calendar</h1>
      {canCreate && <Button tone="primary" onClick={() => setNewOpen((v) => !v)}>+ New event</Button>}
    </div>
    {error && <Notice>{error}</Notice>}
    <div className="flex flex-wrap items-center gap-2">
      <Button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month.year, month.month, -1))}>←</Button>
      <strong className="min-w-40 text-center">{label}</strong>
      <Button aria-label="Next month" onClick={() => setMonth(shiftMonth(month.year, month.month, 1))}>→</Button>
      <label className="ml-auto flex items-center gap-2 text-sm">Show
        <select aria-label="Filter by kind" className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as CalKind | 'all')}>
          <option value="all">All kinds</option>{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </label>
    </div>
    {loading && <Loading label="Loading calendar…" />}
    {newOpen && canCreate && <EventForm me={me} initialDate={range.from} onSaved={async () => { setNewOpen(false); await refresh(); }} />}
    {selected && <EventManage id={selected} canCreate={canCreate} onClose={() => setSelected(null)} onChanged={refresh} />}
    <div className="hidden md:block">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">{cells.map((date, i) => <div key={date ?? `blank-${i}`} className="min-h-32 rounded-md bg-white p-2 ring-1 ring-slate-200">
        {date && <><strong className="text-sm">{Number(date.slice(-2))}</strong><ul className="mt-2 space-y-1">{(byDate.get(date) ?? []).map(card)}</ul></>}
      </div>)}</div>
    </div>
    <div className="space-y-2 md:hidden">{cells.filter((d): d is string => !!d).map((date) => <section key={date} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <h2 className="font-semibold">{longDate(date)}</h2><ul className="mt-2 space-y-1">{(byDate.get(date) ?? []).map(card)}</ul>
      {!byDate.has(date) && <p className="text-xs text-slate-400">No items</p>}
    </section>)}</div>
  </div>;
}

function EventForm({ me, initialDate, onSaved }: { me: Me; initialDate: string; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<{ id: string; display_name: string }[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [orders, setOrders] = useState<DocHeader[]>([]);
  const [jobOrderId, setJobOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (me.permissions.includes('jo.view')) void api.list('jo.job_order', { status: 'posted', limit: 100 }).then(setOrders, () => undefined); }, [me.permissions]);
  useEffect(() => {
    if (!me.permissions.includes('cus.view')) return;
    let live = true;
    void api.customers(customerSearch).then((rows) => { if (live) setCustomers(rows); }, () => undefined);
    return () => { live = false; };
  }, [me.permissions, customerSearch]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.calCreate({ title, date, time: time || null, customerId: customerId || null, jobOrderId: jobOrderId || null, notes: notes || null });
      await onSaved();
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }
  return <Panel title="New event"><form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void submit(e)}>
    {error && <div className="md:col-span-2"><Notice>{error}</Notice></div>}
    <Field label="Title" required><input required maxLength={160} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fitting, pickup, or other booking" /></Field>
    <Field label="Date" required><input required type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    <Field label="Time (optional)"><input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
    {me.permissions.includes('cus.view') && <div className="space-y-2"><Field label="Find customer (optional)"><input className={inputClass} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Name or code" /></Field>
      <select aria-label="Customer" className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">No customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></div>}
    {me.permissions.includes('jo.view') && <Field label="Job order (optional)"><select className={inputClass} value={jobOrderId} onChange={(e) => setJobOrderId(e.target.value)}><option value="">No job order</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.summary}</option>)}</select></Field>}
    <div className="md:col-span-2"><Field label="Notes (optional)"><textarea className={inputClass} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
    <div className="md:col-span-2"><Button type="submit" tone="primary" disabled={busy || !title.trim()}>Save event</Button></div>
  </form></Panel>;
}

function EventManage({ id, canCreate, onClose, onChanged }: { id: string; canCreate: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [history, setHistory] = useState<CalEvent[]>([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.calHistory(id).then((rows) => { setHistory(rows); setDate(rows.at(-1)?.date ?? ''); setTime(rows.at(-1)?.time ?? ''); }, (e: Error) => setError(e.message)); }, [id]);
  const latest = history.at(-1);
  async function change(action: 'move' | 'cancel') {
    setBusy(true); setError('');
    try {
      if (action === 'move') await api.calMove(id, date, time || null);
      else await api.calCancel(id, reason);
      await onChanged(); onClose();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return <Panel title={latest ? `Event: ${latest.title}` : 'Event'}>
    {error && <Notice>{error}</Notice>}
    {latest && <p className="text-sm">{longDate(latest.date)}{latest.time ? ` at ${latest.time}` : ''}{latest.action === 'cancel' ? ' · Cancelled' : ''}</p>}
    {canCreate && latest?.action !== 'cancel' && <div className="flex flex-wrap items-end gap-2">
      <Field label="Move to date"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Time"><input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      <Button disabled={busy || !date} onClick={() => void change('move')}>Move</Button>
      <Field label="Cancellation reason"><input className={inputClass} minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Button tone="danger" disabled={busy || reason.trim().length < 10} onClick={() => void change('cancel')}>Cancel event</Button>
    </div>}
    <details><summary className="cursor-pointer text-sm text-indigo-700">History ({history.length})</summary><ol className="mt-2 list-inside list-decimal text-sm">{history.map((r) => <li key={r.id}>{r.action} · {r.date}{r.time ? ` ${r.time}` : ''}{r.reason ? ` · ${r.reason}` : ''}</li>)}</ol></details>
    <Button onClick={onClose}>Close</Button>
  </Panel>;
}
