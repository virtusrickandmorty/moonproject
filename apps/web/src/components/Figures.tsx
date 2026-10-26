/**
 * The look of the dashboard and Cash Accounts, for every screen that shows money (the owner's request, 26 Oct 2026: "the
 * money links in the UI we use"): a page heading with what the page is for and its buttons, a strip of figures (a round
 * icon, the label, the figure, a note), and white cards with an icon and a title over their contents and tables.
 */
import type { ReactNode } from 'react';
import { CARD_TITLE, SURFACE } from './ui.tsx';
import { Icon, type IconName } from '../modules/DASH/Cards.tsx';

/** The heading of a page: its title, a line on what it is for, and its buttons on the right. */
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {sub && <p className="text-sm text-slate-600">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export interface Figure {
  label: string;
  value: ReactNode;
  icon: IconName;
  note?: ReactNode;
  /** Red: something needs doing (late, short, overdue). */
  warn?: boolean;
  /** Green: in order. */
  good?: boolean;
  /** Under the note, on its right: a TickBar share. */
  side?: ReactNode;
}

const COLS: Record<number, string> = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-2 lg:grid-cols-5' };

/** A strip of figures at a glance, in one white card (up to five side by side; two to a row on a phone-sized tablet). */
export function FigureStrip({ label, figures }: { label: string; figures: Figure[] }) {
  const n = Math.min(5, figures.length);
  const lined = (i: number) => (n >= 4
    ? `${i > 0 ? 'border-t border-slate-100 sm:border-t-0' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''} ${i > 0 ? 'lg:border-l' : ''} ${i >= 2 ? 'sm:border-t lg:border-t-0' : ''}`
    : `${i > 0 ? 'border-t border-slate-100 sm:border-l sm:border-t-0' : ''}`);
  return (
    <section aria-label={label} className={`grid ${COLS[n] ?? COLS[5]} ${SURFACE}`}>
      {figures.slice(0, 5).map((f, i) => (
        <div key={f.label} className={`flex flex-col gap-2 border-slate-100 p-4 ${lined(i)}`}>
          <span className="flex items-center gap-2">
            <span className={`grid size-8 shrink-0 place-items-center rounded-full ${f.warn ? 'bg-red-50 text-red-600' : f.good ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><Icon name={f.icon} className="size-4" /></span>
            <span className="flex-1 text-sm text-slate-500">{f.label}</span>
          </span>
          <strong className={`block text-2xl font-semibold tabular-nums leading-tight ${f.warn ? 'text-red-600' : ''}`}>{f.value}</strong>
          {(f.note || f.side) && (
            <span className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{f.note}</span>{f.side}</span>
          )}
        </div>
      ))}
    </section>
  );
}

/** A white card with an icon and a title (and a small note and buttons beside it) over its contents. */
export function Card({ title, icon, note, actions, children, label }: { title: ReactNode; icon?: IconName; note?: ReactNode; actions?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? (typeof title === 'string' ? title : undefined)} className={`flex flex-col gap-4 p-5 ${SURFACE} print:shadow-none print:ring-0`}>
      <header className="flex flex-wrap items-center gap-3">
        {icon && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 print:hidden"><Icon name={icon} /></span>}
        <h2 className={CARD_TITLE}>{title}</h2>
        {note && <span className="text-xs text-slate-500">{note}</span>}
        {actions && <span className="ml-auto flex flex-wrap gap-2 print:hidden">{actions}</span>}
      </header>
      {children}
    </section>
  );
}

/** A table's heading row, as on Cash Accounts' recent transactions. */
export const TABLE_HEAD = 'text-left text-xs uppercase tracking-wide text-slate-500';
/** The green of money coming in. */
export const MONEY_IN = 'text-emerald-700';
