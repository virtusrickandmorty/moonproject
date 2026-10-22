/**
 * Website shop > Visitors (the owner's request, Oct 2026: what customers do on the website, for marketing, and which
 * items they look at most). Anonymous counts from SHP insights: visitors and visits, the way from a product to an order,
 * visitors each day, the products looked at most, what was searched (and found nothing), where visitors came from,
 * their devices and the busiest hours. The charts use the dashboard's TrackChart; every figure is also in a table.
 */
import { useEffect, useState } from 'react';
import { Loading, Notice } from '../../components/ui.tsx';
import { TrackChart, niceTop } from '../../components/charts.tsx';

interface Insights {
  from: string; to: string; days: number; visitors: number; visits: number; pageViews: number;
  funnel: { product: number; cart: number; checkout: number; order: number; quote: number };
  byDay: { day: string; visitors: number; pageViews: number }[];
  products: { productId: string; name: string | null; views: number; viewers: number; carts: number; wishes: number; orders: number }[];
  searches: { query: string; times: number; noResults: number }[];
  categories: { category: string; times: number }[];
  pages: { page: string; views: number }[];
  sources: { source: string; visits: number }[];
  devices: { device: string; visitors: number }[];
  hours: { hour: number; visits: number }[];
}

const PAGE: Record<string, string> = { '/': 'Shop', '/shop': 'Shop', '/services': 'Services', '/about': 'About us', '/support': 'Support', '/track': 'Track order', '/checkout': 'Checkout', '/orders': 'My orders' };
const n = (v: number) => v.toLocaleString('en-PH');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** A calendar day n days from another (YYYY-MM-DD), no clock involved. */
const plusDays = (date: string, n: number) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const card = 'space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70';
const th = 'py-1 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';

export function Visitors() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData(null); setError('');
    fetch(`/api/shp/insights?days=${days}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() as Promise<Insights> : Promise.reject(new Error('The visitor counts could not be loaded.'))))
      .then((d) => live && setData(d), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [days]);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <Loading />;

  // Visitors each day, the days with none too; over a month, each week (bars stay readable).
  const weekly = data.days > 31;
  const seen = new Map(data.byDay.map((d) => [d.day, d]));
  const allDays = Array.from({ length: data.days }, (_, i) => plusDays(data.from, i))
    .map((day) => seen.get(day) ?? { day, visitors: 0, pageViews: 0 });
  const buckets = weekly
    ? Object.values(allDays.reduce<Record<string, { key: string; label: string; visitors: number }>>((acc, d) => {
      const monday = plusDays(d.day, -((new Date(`${d.day}T00:00:00Z`).getUTCDay() + 6) % 7));
      (acc[monday] ??= { key: monday, label: dayLabel(monday), visitors: 0 }).visitors += d.visitors;
      return acc;
    }, {}))
    : allDays.map((d) => ({ key: d.day, label: `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8))}`, visitors: d.visitors }));
  const busiest = Math.max(0, ...buckets.map((b) => b.visitors));
  const hourTop = Math.max(0, ...data.hours.map((h) => h.visits));
  const viewsTop = Math.max(1, ...data.products.map((p) => p.views));
  const f = data.funnel;
  const steps: [string, number][] = [['Looked at a product', f.product], ['Added to the cart', f.cart], ['Reached the checkout', f.checkout], ['Placed an order', f.order]];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">Anonymous counts from the website ({dayLabel(data.from)} to {dayLabel(data.to)}): no names are kept, and visitors who chose "Don't count me" are not counted. Staff are never counted.</p>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
            className={`rounded-md px-3 py-1 text-sm font-medium ${days === d ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600'}`}>Last {d} days</button>)}
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([['Visitors', data.visitors, 'different people (browsers)'], ['Visits', data.visits, 'times they came'], ['Pages viewed', data.pageViews, ''],
          ['Quotation requests', f.quote, 'from the website'], ['Online orders', f.order, 'visitors who ordered']] as [string, number, string][]).map(([label, value, hint]) => (
          <div key={label} className={card}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">{n(value)}</dd>{hint && <dd className="text-xs text-slate-500">{hint}</dd>}</div>
        ))}
      </dl>

      {data.visitors === 0 && <Notice tone="info">No visits counted in this period yet. Counting starts once this version is live; check back after a few days of visitors.</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Visitors over time">
          <h2 className="font-semibold">Visitors {weekly ? 'each week' : 'each day'}</h2>
          {buckets.length ? <TrackChart height="h-48" top={niceTop(busiest)} label={`Visitors ${weekly ? 'each week' : 'each day'}: ${buckets.map((b) => `${b.label} ${b.visitors}`).join(', ')}`}
            bars={buckets.map((b, i) => ({ key: b.key, label: buckets.length > 12 && i % Math.ceil(buckets.length / 8) ? '' : b.label, value: b.visitors, title: `${weekly ? 'Week of ' : ''}${dayLabel(b.key)}: ${n(b.visitors)} visitors`, best: b.visitors === busiest && busiest > 0 }))} />
            : <p className="text-sm text-slate-500">No visits yet.</p>}
        </section>
        <section className={card} aria-label="From a product to an order">
          <h2 className="font-semibold">From a product to an order <span className="text-sm font-normal text-slate-500">(visitors)</span></h2>
          <ul className="space-y-2">
            {steps.map(([label, value], i) => (
              <li key={label} className="space-y-1" title={`${label}: ${n(value)} visitors${i ? `, ${pct(value, steps[i - 1]![1])} of the step before` : ''}`}>
                <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-slate-700">{n(value)}{i > 0 && <span className="text-slate-500"> · {pct(value, steps[i - 1]![1])}</span>}</span></div>
                <div className="h-2.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${steps[0]![1] ? (value / steps[0]![1]) * 100 : 0}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">A big drop between two steps is where shoppers give up: for example many add to the cart but few reach the checkout.</p>
        </section>
      </div>

      <section className={card} aria-label="Products looked at most">
        <h2 className="font-semibold">Products looked at most</h2>
        {data.products.length === 0 ? <p className="text-sm text-slate-500">No product opened yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className={th}>Product</th><th className={th}>Times opened</th><th className={`${th} text-right`}>People</th><th className={`${th} text-right`}>Added to cart</th><th className={`${th} text-right`}>Wishlisted</th><th className={`${th} text-right`}>Ordered</th></tr></thead>
            <tbody>{data.products.map((p) => (
              <tr key={p.productId} className="border-t border-slate-100">
                <td className="py-1.5 pr-3">{p.name ?? <span className="text-slate-500">A product no longer shown</span>}</td>
                <td className="w-1/3 pr-3"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${(p.views / viewsTop) * 100}%` }} /></div><span className="w-10 text-right tabular-nums">{n(p.views)}</span></div></td>
                <td className="pr-3 text-right tabular-nums">{n(p.viewers)}</td><td className="pr-3 text-right tabular-nums">{n(p.carts)}</td>
                <td className="pr-3 text-right tabular-nums">{n(p.wishes)}</td><td className="text-right tabular-nums">{n(p.orders)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="What they searched for">
          <h2 className="font-semibold">What they searched for</h2>
          {data.searches.length === 0 ? <p className="text-sm text-slate-500">No searches yet.</p> : <>
            <table className="w-full text-sm"><thead><tr><th className={th}>Words</th><th className={`${th} text-right`}>Times</th><th className={th}>Found</th></tr></thead>
              <tbody>{data.searches.map((s) => <tr key={s.query} className="border-t border-slate-100"><td className="py-1.5 pr-3">{s.query}</td><td className="pr-3 text-right tabular-nums">{n(s.times)}</td>
                <td>{s.noResults > 0 ? <span className="font-semibold text-amber-700">Nothing matched{s.noResults < s.times ? ` (${s.noResults} times)` : ''}</span> : <span className="text-slate-500">Yes</span>}</td></tr>)}</tbody></table>
            <p className="text-xs text-slate-500">"Nothing matched": shoppers want it and the shop does not show it yet, a product idea.</p>
          </>}
        </section>
        <section className={card} aria-label="Where visitors came from">
          <h2 className="font-semibold">Where visitors came from</h2>
          {data.sources.length === 0 ? <p className="text-sm text-slate-500">No visits yet.</p> :
            <table className="w-full text-sm"><thead><tr><th className={th}>From</th><th className={`${th} text-right`}>Visits</th></tr></thead>
              <tbody>{data.sources.map((s) => <tr key={s.source} className="border-t border-slate-100"><td className="py-1.5 pr-3">{s.source === 'direct' ? 'Typed the address or a saved link' : s.source}</td><td className="text-right tabular-nums">{n(s.visits)}</td></tr>)}</tbody></table>}
          <p className="text-xs text-slate-500">Tip: share links with <code>?utm_source=facebook</code> (or tiktok, a school's name…) at the end to see which posts bring visitors.</p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`} aria-label="Busiest hours">
          <h2 className="font-semibold">Busiest hours</h2>
          <TrackChart height="h-36" top={niceTop(hourTop)} label={`Visits by hour: ${data.hours.map((h) => `${h.hour}:00 ${h.visits}`).join(', ')}`}
            bars={Array.from({ length: 24 }, (_, h) => { const v = data.hours.find((x) => x.hour === h)?.visits ?? 0; return { key: String(h), label: h % 6 === 0 ? `${h}:00` : '', value: v, title: `${h}:00–${h}:59: ${n(v)} visits`, best: v === hourTop && hourTop > 0 }; })} />
          <p className="text-xs text-slate-500">A good time to post on social media.</p>
        </section>
        {/* Devices and pages beside the hours, one above the other. */}
        <div className="space-y-4">
          <section className={card} aria-label="Devices">
            <h2 className="font-semibold">Devices</h2>
            <table className="w-full text-sm"><tbody>{data.devices.map((d) => <tr key={d.device} className="border-t border-slate-100 first:border-0"><td className="py-1.5 capitalize">{d.device}</td>
              <td className="text-right tabular-nums">{n(d.visitors)} · {pct(d.visitors, data.visitors)}</td></tr>)}</tbody></table>
          </section>
          <section className={card} aria-label="Pages and categories">
            <h2 className="font-semibold">Pages and categories</h2>
            <table className="w-full text-sm"><tbody>
              {data.pages.map((p) => <tr key={p.page} className="border-t border-slate-100 first:border-0"><td className="py-1.5">{PAGE[p.page] ?? p.page}</td><td className="text-right tabular-nums">{n(p.views)} views</td></tr>)}
              {data.categories.map((c) => <tr key={c.category} className="border-t border-slate-100"><td className="py-1.5">Category: {c.category}</td><td className="text-right tabular-nums">{n(c.times)} picks</td></tr>)}
            </tbody></table>
          </section>
        </div>
      </div>
    </div>
  );
}
