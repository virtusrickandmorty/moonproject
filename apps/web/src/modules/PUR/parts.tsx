/**
 * Pieces the purchasing screens share (the owner's request, 26 Oct 2026): a request's state as a badge, the purchase's
 * journey (ask → approve → order → receive → bill) with the step it is at, and a card to pick a request or an order by.
 */
import type { ReactNode } from 'react';
import type { PurchaseRequestStatus } from '../../api.ts';
import { SURFACE } from '../../components/ui.tsx';

export const REQUEST_STATE: Record<PurchaseRequestStatus['state'], [string, string]> = {
  waiting: ['Waiting for approval', 'bg-amber-100 text-amber-800'],
  approved: ['Approved', 'bg-emerald-100 text-emerald-800'],
  rejected: ['Not approved', 'bg-red-100 text-red-800'],
  used: ['Ordered or paid', 'bg-slate-100 text-slate-700'],
  cancelled: ['Cancelled', 'bg-slate-100 text-slate-500'],
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

export const RequestBadge = ({ state }: { state: PurchaseRequestStatus['state'] }) => <Badge tone={REQUEST_STATE[state][1]}>{REQUEST_STATE[state][0]}</Badge>;

/** A step of the purchase's journey: done, the one it is at, or still to come; `note` says how far (part received). */
export interface Step { label: string; state: 'done' | 'now' | 'later'; note?: string }

const STEP_COLS: Record<number, string> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5' };

/** The purchase's journey as numbered steps, the one it is at marked; on a phone they wrap two to a row; `stacked`: one under another (a side column). */
export function Journey({ steps, label = 'Where this purchase is', stacked }: { steps: Step[]; label?: string; stacked?: boolean }) {
  return (
    <ol aria-label={label} className={`grid gap-x-3 gap-y-4 p-4 ${stacked ? 'grid-cols-1' : `grid-cols-2 ${STEP_COLS[Math.min(steps.length, 5)] ?? ''}`} ${SURFACE}`}>
      {steps.map((s, i) => (
        <li key={s.label} aria-current={s.state === 'now' ? 'step' : undefined} className="flex min-w-0 items-start gap-2">
          <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.state === 'done' ? 'bg-slate-800 text-white' : s.state === 'now' ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' : 'bg-slate-100 text-slate-500'}`}>
            {s.state === 'done' ? '✓' : i + 1}
          </span>
          <span className="min-w-0">
            <span className={`block text-sm ${s.state === 'later' ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>{s.label}</span>
            {s.note && <span className="block text-xs text-slate-500">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A card picked like a radio button (a request for an order, an order for a delivery): a title, lines under it, an amount on the right. */
export function PickCard({ picked, onPick, title, badge, lines, right, rightNote, disabled }: {
  picked: boolean; onPick: () => void; title: ReactNode; badge?: ReactNode; lines?: ReactNode[]; right?: ReactNode; rightNote?: ReactNode; disabled?: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={picked} disabled={disabled} onClick={onPick}
      className={`flex w-full items-start justify-between gap-3 rounded-lg p-3 text-left text-sm ring-1 transition disabled:opacity-50 ${picked ? 'bg-indigo-50 ring-2 ring-indigo-600' : 'bg-white ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'}`}>
      <span className="flex min-w-0 items-start gap-3">
        <span aria-hidden className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ring-1 ${picked ? 'bg-indigo-600 ring-indigo-600' : 'bg-white ring-slate-400'}`}>
          {picked && <span className="size-1.5 rounded-full bg-white" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{title}</span>{badge}</span>
          {lines?.filter(Boolean).map((l, i) => <span key={i} className="mt-0.5 block text-xs text-slate-600">{l}</span>)}
        </span>
      </span>
      {(right || rightNote) && (
        <span className="shrink-0 text-right">
          {right && <span className="block font-semibold tabular-nums text-slate-900">{right}</span>}
          {rightNote && <span className="block text-xs text-slate-500">{rightNote}</span>}
        </span>
      )}
    </button>
  );
}

/** How much of something is done, as a thin bar with words beside it (pieces received of ordered). */
export function Progress({ done, of, words }: { done: number; of: number; words: string }) {
  const share = of > 0 ? Math.min(1, done / of) : 0;
  return (
    <span className="flex min-w-0 items-baseline gap-2" title={words}>
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={words}>
        <span className={`block h-full rounded-full ${share >= 1 ? 'bg-emerald-600' : 'bg-indigo-500'}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="min-w-0 text-xs text-slate-600">{words}</span>
    </span>
  );
}

/** A record's key facts side by side (two to a row on a phone): who, when, from which request. */
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
