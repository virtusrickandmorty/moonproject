/**
 * A job order's status on the customer's own private links (the owner's request, Nov 2026): after they approve a design
 * (PRF) and once the shop makes the job order from their order link answer (OLK). Where it is, the promised date, and each
 * item with its wearers: name, size or custom fit, jersey name and number. No prices. Written for an ordinary customer
 * reading on a phone (the owner's request, Nov 2026): the step in plain words, one wearer per row with the size on the right,
 * and a name shown once.
 */
import type { CustomerOrder } from '../api.ts';
import { SHOP_CONTACT } from './products.ts';
import { STEPS, StatusJourney } from './StatusJourney.tsx';

const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00+08:00` : d).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' });
export const pcs = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

/** Where the order is, in the customer's words: the step's own name, else the shop's label (Out for delivery, Partly released). */
function stepWords(order: CustomerOrder, steps: string[], at: number): string {
  if (order.stage === 'open' || order.stage === 'in_production' || order.stage === 'ready' || order.stage === 'released') return steps[at] ?? order.stageLabel;
  return order.stageLabel;
}

/**
 * An item's production steps (the owner's request, Nov 2026): done with a tick, the one being worked on now, the rest after.
 * When nothing is being worked on, the first step not done yet is "next".
 */
function ItemSteps({ steps }: { steps: NonNullable<CustomerOrder['lines'][number]['steps']> }) {
  const next = steps.some((s) => s.state === 'now') ? -1 : steps.findIndex((s) => s.state === 'later');
  return (
    <ol className="mt-2 flex flex-wrap gap-1.5 text-sm" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} className={`rounded-full px-2.5 py-0.5 font-semibold ${
          s.state === 'done' ? 'bg-emerald-100 text-emerald-800' : s.state === 'now' ? 'bg-indigo-600 text-white' : i === next ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
          {s.state === 'now' && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-white align-middle motion-safe:animate-pulse" aria-hidden="true" />}
          {s.state === 'done' ? `✓ ${s.name}` : s.state === 'now' ? `${s.name} · now` : i === next ? `${s.name} · next` : s.name}
        </li>
      ))}
    </ol>
  );
}

/** The size column: the size, or Custom fit, with the pieces when more than one. */
export const sizeWords = (size: string | undefined, custom: boolean, qty: number) =>
  [custom ? 'Custom fit' : size ? `Size ${size}` : '', qty > 1 ? pcs(qty) : ''].filter(Boolean).join(' · ');

/** An item's wearers, one per row: the jersey number and name (or the wearer's name), with the size on the right. */
export function WearerRows({ wearers }: { wearers: CustomerOrder['lines'][number]['wearers'] }) {
  return (
    <ul className="mt-2 divide-y divide-slate-200/70">
      {wearers.map((w, j) => {
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
    </ul>
  );
}

/**
 * An item's wearers as a table, like the job ticket's (the owner's request, Nov 2026, for the design link): Wearer, Size,
 * Jersey name, Jersey no., Qty (titled short: Jersey, No.). A jersey column no wearer of the item has is left out, so
 * it fits a phone.
 */
export function WearerTable({ wearers }: { wearers: CustomerOrder['lines'][number]['wearers'] }) {
  const names = wearers.some((w) => w.jerseyName), numbers = wearers.some((w) => w.jerseyNumber);
  const th = 'px-1.5 py-1.5 text-left text-xs font-bold text-slate-500';
  const td = 'px-1.5 py-1.5 align-top';
  return (
    <div className="-mx-1.5 mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px] leading-snug">
        <thead>
          <tr className="border-b border-slate-200">
            <th scope="col" className={th}>Wearer</th>
            <th scope="col" className={th}>Size</th>
            {names && <th scope="col" className={th}><abbr title="Jersey name" className="no-underline">Jersey</abbr></th>}
            {numbers && <th scope="col" className={th}><abbr title="Jersey number" className="no-underline">No.</abbr></th>}
            <th scope="col" className={`${th} text-right`}>Qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70">
          {wearers.map((w, j) => (
            <tr key={j}>
              <td className={`${td} font-semibold`}>{w.name}</td>
              <td className={td}>{w.measured ? 'Custom fit' : w.size ?? ''}</td>
              {names && <td className={`${td} uppercase`}>{w.jerseyName ?? ''}</td>}
              {numbers && <td className={`${td} tabular-nums`}>{w.jerseyNumber ?? ''}</td>}
              <td className={`${td} text-right tabular-nums`}>{w.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** table: the wearers as a table like the job ticket's (the design link), else one per row. */
export function OrderStatus({ order, title = 'Your order', table = false }: { order: CustomerOrder; title?: string; table?: boolean }) {
  const flow = STEPS.job_order;
  const at = flow.at[order.stage] ?? -1;
  return (
    <section className="space-y-5 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5" aria-label={`${title}: ${order.number}`}>
      <div>
        <p className="text-sm font-semibold text-slate-500">{title}</p>
        <p className="mt-1 text-2xl font-extrabold">{stepWords(order, flow.steps, at)}</p>
        <p className="mt-1 text-sm text-slate-600">Promised for <b className="text-slate-900">{day(order.dueDate)}</b> · <span className="whitespace-nowrap">Job order no. {order.number}</span></p>
      </div>
      <StatusJourney key={order.stage} kind="job_order" status={order.stage} />
      <ul className="space-y-3">
        {order.lines.map((l, i) => (
          <li key={i} className="rounded-2xl bg-slate-50 p-4">
            <p className="flex items-baseline justify-between gap-3"><span className="font-bold">{l.description}</span><span className="shrink-0 text-sm text-slate-500">{pcs(l.qty)}</span></p>
            {l.steps && l.steps.length > 0 && <ItemSteps steps={l.steps} />}
            {l.wearers.length > 0 && (table ? <WearerTable wearers={l.wearers} /> : <WearerRows wearers={l.wearers} />)}
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">A wrong name or size? Call or text <b className="whitespace-nowrap">{SHOP_CONTACT.phone}</b> and give job order no. <span className="whitespace-nowrap">{order.number}</span>.</p>
    </section>
  );
}
