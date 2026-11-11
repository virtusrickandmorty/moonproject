/**
 * A job order's status on the customer's own private links (the owner's request, Nov 2026): after they approve a design
 * (PRF) and once the shop makes the job order from their order link answer (OLK). Where it is, the promised date, and each
 * item with its wearers: name, size or custom fit, jersey name and number. No prices. Written for an ordinary customer
 * reading on a phone (the owner's request, Nov 2026): the step in plain words, one wearer per row with the size on the right,
 * and a name shown once.
 */
import type { CustomerOrder } from '../api.ts';
import { SHOP_CONTACT } from './products.ts';
import { STEPS } from './Track.tsx';

const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });
export const pcs = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/** Where the order is, in the customer's words: the step's own name, else the shop's label (Out for delivery, Partly released). */
function stepWords(order: CustomerOrder, steps: string[], at: number): string {
  if (order.stage === 'open' || order.stage === 'in_production' || order.stage === 'ready' || order.stage === 'released') return steps[at] ?? order.stageLabel;
  return order.stageLabel;
}

/** The size column: the size, or Custom fit, with the pieces when more than one. */
export const sizeWords = (size: string | undefined, custom: boolean, qty: number) =>
  [custom ? 'Custom fit' : size ? `Size ${size}` : '', qty > 1 ? pcs(qty) : ''].filter(Boolean).join(' · ');

export function OrderStatus({ order, title = 'Your order' }: { order: CustomerOrder; title?: string }) {
  const flow = STEPS.job_order;
  const at = flow.at[order.stage] ?? -1;
  return (
    <section className="space-y-5 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5" aria-label={`${title}: ${order.number}`}>
      <div>
        <p className="text-sm font-semibold text-slate-500">{title}</p>
        <p className="mt-1 text-2xl font-extrabold">{stepWords(order, flow.steps, at)}</p>
        <p className="mt-1 text-sm text-slate-600">Promised for <b className="text-slate-900">{day(order.dueDate)}</b> · <span className="whitespace-nowrap">Job order no. {order.number}</span></p>
      </div>
      {at >= 0 && <ol className="grid gap-1 text-center text-[11px] font-semibold sm:text-xs" style={{ gridTemplateColumns: `repeat(${flow.steps.length}, minmax(0, 1fr))` }}>
        {flow.steps.map((s, i) => <li key={s} className={i <= at ? 'text-indigo-700' : 'text-slate-400'}><span className={`mx-auto mb-1 block h-1.5 rounded-full ${i <= at ? 'bg-indigo-600' : 'bg-slate-200'}`} aria-hidden="true" />{s}</li>)}
      </ol>}
      <ul className="space-y-3">
        {order.lines.map((l, i) => (
          <li key={i} className="rounded-2xl bg-slate-50 p-4">
            <p className="flex items-baseline justify-between gap-3"><span className="font-bold">{l.description}</span><span className="shrink-0 text-sm text-slate-500">{pcs(l.qty)}</span></p>
            {l.wearers.length > 0 && <ul className="mt-2 divide-y divide-slate-200/70">
              {l.wearers.map((w, j) => {
                const back = [w.jerseyNumber && `#${w.jerseyNumber}`, w.jerseyName].filter(Boolean).join(' ');
                const sameName = !!w.jerseyName && w.jerseyName.trim().toUpperCase() === w.name.trim().toUpperCase();
                return (
                  <li key={j} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className={`block font-semibold ${back ? 'uppercase' : ''}`}>{back || w.name}</span>
                      {back && !sameName && <span className="block text-sm text-slate-500">{w.name}</span>}
                    </span>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">{sizeWords(w.size, w.measured, w.qty)}</span>
                  </li>
                );
              })}
            </ul>}
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">A wrong name or size? Call or text <b className="whitespace-nowrap">{SHOP_CONTACT.phone}</b> and give job order no. <span className="whitespace-nowrap">{order.number}</span>.</p>
    </section>
  );
}
