/**
 * /track: a customer finds where an order is: an online order (WEB-…) or a job order recorded at the shop (JO-…), by its
 * number (POST /api/shp/track): the status, items and dates only. The link /track?n=JO-000123 fills in the number.
 */
import { useState, type FormEvent } from 'react';
import { SHOP_CONTACT } from './products.ts';

interface Tracked {
  kind: 'online' | 'job_order'; number: string; asked?: string; status: string; statusLabel: string; placedAt: string; dueDate?: string;
  fulfilment?: 'pickup' | 'delivery'; deliveryOption?: string | null; lines: { description: string; qty: number }[];
}
/** The steps each kind of order goes through, and where its status sits on them. */
const STEPS: Record<Tracked['kind'], { steps: string[]; at: Record<string, number> }> = {
  job_order: { steps: ['Order received', 'In production', 'Ready for release', 'Released'], at: { open: 0, in_production: 1, ready: 2, partially_released: 3, released: 3, closed: 3 } },
  online: { steps: ['Order placed', 'Payment sent', 'Paid · being prepared', 'Ready / sent', 'Completed'], at: { awaiting_payment: 0, payment_sent: 1, confirmed: 2, ready: 3, completed: 4 } },
};
const input = 'w-full rounded-full border border-slate-300 bg-white px-5 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });

export function Track({ query }: { query: string }) {
  const [number, setNumber] = useState(new URLSearchParams(query).get('n') ?? '');
  const [found, setFound] = useState<Tracked | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  const search = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setFound(null);
    if (number.trim().length < 3) return setError('Type your order or job order number, like WEB-000012 or JO-000123.');
    setBusy(true);
    try {
      const res = await fetch('/api/shp/track', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: number.trim() }) });
      const data = await res.json().catch(() => null) as (Tracked & { message?: string }) | null;
      if (!res.ok) throw new Error(data?.message ?? 'We could not look that up just now. Please try again.');
      setFound(data);
    } catch (err) { setError(err instanceof TypeError ? 'Cannot reach us right now. Check your connection and try again.' : (err as Error).message); }
    finally { setBusy(false); }
  };

  const flow = found ? STEPS[found.kind] : null;
  const at = found && flow ? flow.at[found.status] ?? -1 : -1;
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-12 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Track your order</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">Where is my order?</h1>
      <p className="mt-3 text-lg text-slate-600">For orders placed on this website (WEB-…) and job orders made at the shop (JO-…).</p>
      <form onSubmit={(e) => void search(e)} className="mt-6 grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-[1fr_auto] sm:p-5" role="search">
        <label className="text-sm font-semibold">Order or job order number<input className={`${input} mt-1`} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="WEB-000012 or JO-000123" autoCapitalize="characters" /></label>
        <button type="submit" disabled={busy} className="self-end rounded-full bg-indigo-600 px-7 py-3 font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">{busy ? 'Looking…' : 'Track'}</button>
      </form>
      <p className="mt-2 text-xs text-slate-500">The number is on your order email, your order page, or the job order slip from the shop.</p>
      {error && <p role="alert" className="mt-5 rounded-2xl bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800">{error}</p>}

      {found && flow && (
        <div className="mt-6 space-y-5 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">{found.kind === 'online' ? 'Online order' : 'Job order'} {found.number}{found.asked && found.asked !== found.number ? ` (replaces ${found.asked})` : ''}</p>
              <p className="mt-1 text-2xl font-extrabold">{found.statusLabel}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Placed {day(found.placedAt)}</span>
          </div>
          {at >= 0 && <ol className="grid gap-1 text-center text-[11px] font-semibold sm:text-xs" style={{ gridTemplateColumns: `repeat(${flow.steps.length}, minmax(0, 1fr))` }}>
            {flow.steps.map((s, i) => <li key={s} className={i <= at ? 'text-indigo-700' : 'text-slate-400'}><span className={`mx-auto mb-1 block h-1.5 rounded-full ${i <= at ? 'bg-indigo-600' : 'bg-slate-200'}`} aria-hidden="true" />{s}</li>)}
          </ol>}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {found.dueDate && <div><dt className="text-slate-500">Promised for</dt><dd className="font-semibold">{day(found.dueDate)}</dd></div>}
            {found.kind === 'online' && <div><dt className="text-slate-500">Gets it by</dt><dd className="font-semibold">{found.fulfilment === 'delivery' ? `Delivery${found.deliveryOption ? ` (${found.deliveryOption})` : ''}` : 'Pickup at the shop'}</dd></div>}
          </dl>
          <ul className="divide-y divide-slate-100 text-sm">{found.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{l.description}</span><span className="tabular-nums text-slate-500">× {l.qty}</span></li>)}</ul>
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Questions about this order? Call or text {SHOP_CONTACT.phone} and give the number {found.number}.</p>
        </div>
      )}
    </section>
  );
}
