/**
 * A job order's status on the customer's own private links (the owner's request, Nov 2026): after they approve a design
 * (PRF) and once the shop makes the job order from their order link answer (OLK). Where it is, the promised date, and each
 * item with its wearers: name, size or made to measure, jersey name and number. No prices.
 */
import type { CustomerOrder } from '../api.ts';
import { SHOP_CONTACT } from './products.ts';
import { STEPS } from './Track.tsx';

const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });

export function OrderStatus({ order, title = 'Your order status' }: { order: CustomerOrder; title?: string }) {
  const flow = STEPS.job_order;
  const at = flow.at[order.stage] ?? -1;
  return (
    <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5" aria-label={`${title}: ${order.number}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title} · Job order {order.number}</p>
          <p className="mt-1 text-2xl font-extrabold">{order.stageLabel}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Promised for {day(order.dueDate)}</span>
      </div>
      {at >= 0 && <ol className="grid gap-1 text-center text-[11px] font-semibold sm:text-xs" style={{ gridTemplateColumns: `repeat(${flow.steps.length}, minmax(0, 1fr))` }}>
        {flow.steps.map((s, i) => <li key={s} className={i <= at ? 'text-indigo-700' : 'text-slate-400'}><span className={`mx-auto mb-1 block h-1.5 rounded-full ${i <= at ? 'bg-indigo-600' : 'bg-slate-200'}`} aria-hidden="true" />{s}</li>)}
      </ol>}
      <ul className="space-y-3">
        {order.lines.map((l, i) => (
          <li key={i} className="rounded-2xl bg-slate-50 p-4">
            <p className="flex justify-between gap-3 font-semibold"><span>{l.description}</span><span className="tabular-nums text-slate-500">× {l.qty}</span></p>
            {l.wearers.length > 0 && <ul className="mt-2 divide-y divide-slate-200/70 text-sm">
              {l.wearers.map((w, j) => (
                <li key={j} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                  <span>
                    {w.jerseyNumber && <b className="tabular-nums">#{w.jerseyNumber} </b>}
                    {w.jerseyName && <b className="uppercase">{w.jerseyName} </b>}
                    <span className={w.jerseyName || w.jerseyNumber ? 'text-slate-500' : ''}>{w.jerseyName || w.jerseyNumber ? `· ${w.name}` : w.name}</span>
                  </span>
                  <span className="text-slate-600">{w.measured ? 'Made to measure' : w.size}{w.qty > 1 ? ` × ${w.qty}` : ''}</span>
                </li>
              ))}
            </ul>}
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">Something wrong with a name or size? Call or text {SHOP_CONTACT.phone} and give the number {order.number}.</p>
    </section>
  );
}
