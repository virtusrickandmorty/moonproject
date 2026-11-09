/**
 * Today (the owner's request, Nov 2026): at the top of the home, what is waiting on this person, with how many and a link to
 * deal with each; nothing when nothing is waiting. Updates live, like the rest of the home.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Link } from '../../router.tsx';
import { peso } from '../../components/ui.tsx';
import { useLiveReload } from '../../live.ts';

export interface TodayItem { key: string; label: string; count: number; href: string; tone: 'danger' | 'warning' | 'info'; amountCents?: number }

const DOT: Record<TodayItem['tone'], string> = { danger: 'bg-rose-500', warning: 'bg-amber-400', info: 'bg-sky-400' };

export function TodayList() {
  const [items, setItems] = useState<TodayItem[] | null>(null);
  const load = () => api.dashToday().then((x) => setItems(Array.isArray(x) ? x : []), () => setItems([]));
  useEffect(() => { void load(); }, []);
  useLiveReload(load);
  if (!items?.length) return null;
  const date = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' });
  return <section aria-label="Today" className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-semibold">Today</h2>
      <p className="text-xs text-slate-500">{date}</p>
    </div>
    <ul className="mt-2 divide-y divide-slate-100">
      {items.map((i) => (
        <li key={i.key}>
          <Link to={i.href} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-indigo-50">
            <span className={`size-2.5 shrink-0 rounded-full ${DOT[i.tone]}`} aria-hidden="true" />
            <span className="w-8 shrink-0 text-right text-lg font-bold tabular-nums">{i.count}</span>
            <span className="min-w-0 flex-1 text-sm">{i.label}{i.amountCents ? <span className="text-slate-500"> · {peso(i.amountCents)}</span> : ''}</span>
            <span className="text-sm text-indigo-700" aria-hidden="true">›</span>
          </Link>
        </li>
      ))}
    </ul>
  </section>;
}
