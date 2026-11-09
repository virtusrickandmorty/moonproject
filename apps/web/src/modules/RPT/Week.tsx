/**
 * Reports > Week summary (the owner's request, Nov 2026: "a Monday summary"): last week, Monday to Sunday, on one page, with
 * the week before beside the money; the bell points here every Monday. Another week can be picked.
 */
import { useState } from 'react';
import { Loading, Notice, inputClass, peso, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { useReport } from './Books.tsx';

interface Money { salesCents: number; expensesCents: number; netIncomeCents: number; collectedCents: number }
interface Week {
  from: string; to: string; money: Money; before: Money; cashOnHandCents: number;
  jobOrders: { received: { count: number; totalCents: number }; receivedBefore: number; released: number; late: number; lateList: { id: string; number: string; customerName: string; dueDate: string }[] };
  proofs: { sent: number; approved: number; changes: number };
  ratings: { rated: number; average: number | null; low: number };
  website: { visitors: number; visits: number; orders: number; quotes: number; cities: { city: string; visitors: number }[] };
}

const card = 'min-w-0 space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70';
/** "+12% on the week before", or nothing when there is nothing to compare. */
function change(now: number, before: number, upIsGood = true) {
  if (!before) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (pct === 0) return <span className="text-xs text-slate-500">same as the week before</span>;
  const good = (pct > 0) === upIsGood;
  return <span className={`text-xs font-semibold ${good ? 'text-emerald-700' : 'text-rose-700'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% on the week before</span>;
}
function Figure({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return <div className={card}><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="text-2xl font-bold tabular-nums">{value}</p>{note}</div>;
}

export function WeekSummary() {
  const [day, setDay] = useState('');
  const { data, error } = useReport<Week>(day ? `week?day=${day}` : 'week') as { data: Week | null; error: string };
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading />;
  const m = data.money, b = data.before, j = data.jobOrders;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-slate-600">The week of <b>{showDate(data.from)}</b> to <b>{showDate(data.to)}</b>, against the week before.</p>
      <label className="text-sm text-slate-600">Another week: <input type="date" className={`${inputClass} w-auto`} value={day} onChange={(e) => setDay(e.target.value)} /></label>
    </div>

    <section aria-label="Money" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Figure label="Sales" value={peso(m.salesCents)} note={change(m.salesCents, b.salesCents)} />
      <Figure label="Collected" value={peso(m.collectedCents)} note={change(m.collectedCents, b.collectedCents)} />
      <Figure label="Expenses" value={peso(m.expensesCents)} note={change(m.expensesCents, b.expensesCents, false)} />
      <Figure label="Cash on hand now" value={peso(data.cashOnHandCents)} note={<span className="text-xs text-slate-500">all cash places and banks</span>} />
    </section>

    <section aria-label="Orders" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Figure label="Job orders in" value={j.received.count} note={<span className="text-xs text-slate-500">{peso(j.received.totalCents)} · {j.receivedBefore} the week before</span>} />
      <Figure label="Job orders released" value={j.released} />
      <Figure label="Late now" value={<span className={j.late ? 'text-rose-700' : ''}>{j.late}</span>} note={<span className="text-xs text-slate-500">past their due date, not yet released</span>} />
      <Figure label="Designs approved" value={data.proofs.approved} note={<span className="text-xs text-slate-500">{data.proofs.sent} sent · {data.proofs.changes} sent back for a change</span>} />
    </section>

    <div className="grid gap-4 lg:grid-cols-3">
      <section className={card} aria-label="Late job orders">
        <h2 className="font-semibold">Late job orders</h2>
        {j.lateList.length === 0 ? <p className="text-sm text-slate-500">None. Everything is on time.</p> :
          <ul className="space-y-1 text-sm">{j.lateList.map((o) => <li key={o.id} className="flex justify-between gap-2"><Link to={`/docs/jo.job_order/${o.id}`} className="font-medium text-indigo-700">{o.number}</Link>
            <span className="truncate text-slate-600">{o.customerName}</span><span className="shrink-0 text-rose-700">due {showDate(o.dueDate)}</span></li>)}</ul>}
        {j.late > j.lateList.length && <p className="text-xs text-slate-500">and {j.late - j.lateList.length} more on the production board</p>}
      </section>
      <section className={card} aria-label="Customer ratings">
        <h2 className="font-semibold">Customer ratings</h2>
        {data.ratings.rated === 0 ? <p className="text-sm text-slate-500">No ratings this week.</p> : <>
          <p className="text-3xl font-bold">{data.ratings.average?.toFixed(1)} <span className="text-amber-400">★</span></p>
          <p className="text-sm text-slate-600">{data.ratings.rated} {data.ratings.rated === 1 ? 'rating' : 'ratings'}{data.ratings.low ? <>, <b className="text-rose-700">{data.ratings.low} of 3 stars or less</b></> : ''}</p>
        </>}
        <Link to="/fbk" className="text-sm text-indigo-700">See all ratings</Link>
      </section>
      <section className={card} aria-label="Website">
        <h2 className="font-semibold">Website</h2>
        <p className="text-sm"><b className="text-xl">{data.website.visitors}</b> visitors · {data.website.visits} visits · {data.website.orders} online orders · {data.website.quotes} quotation requests</p>
        {data.website.cities.length > 0 && <ul className="text-sm text-slate-600">{data.website.cities.map((c) => <li key={c.city} className="flex justify-between"><span>{c.city}</span><span className="tabular-nums">{c.visitors}</span></li>)}</ul>}
        <Link to="/shp" className="text-sm text-indigo-700">Website visitors</Link>
      </section>
    </div>
  </div>;
}
