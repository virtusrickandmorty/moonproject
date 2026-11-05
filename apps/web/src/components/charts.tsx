/**
 * The ERP's progress bars and charts (the owner's request, Oct 2026, after a reference dashboard): thin tick bars and bar
 * charts whose bars stand in pale tracks, the best one striped in our blue. Used on the home and across the screens.
 */
import { useEffect, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

/** What a graph shows when pointed at: a heading, figures, and short notes. `sub`: a part of the row above it. */
export interface TipRow { label: string; value: string; colour?: string; strong?: boolean; sub?: boolean }
export interface Tip { title: string; rows?: TipRow[]; notes?: string[] }
/** A tip in words, for screen readers. */
export const tipWords = (tip: Tip) => [tip.title, ...(tip.rows ?? []).map((r) => `${r.label}: ${r.value}`), ...(tip.notes ?? [])].join('. ');

const TIP_WIDTH = 288;
/** Beside the pointer, kept on the screen; on the body, so no card or scrolling box cuts it off. */
function TipBox({ tip, x, y }: { tip: Tip; x: number; y: number }) {
  const width = Math.min(TIP_WIDTH, innerWidth - 16);
  const left = x + 16 + width <= innerWidth ? x + 16 : Math.max(8, x - 16 - width);
  const place = y > innerHeight * 0.55 ? { bottom: innerHeight - y + 12 } : { top: y + 12 };
  return createPortal(<div data-testid="chart-tip" aria-hidden="true" style={{ left, width, ...place }} className="pointer-events-none fixed z-50 rounded-xl bg-white p-3 text-sm shadow-lg ring-1 ring-slate-200 print:hidden">
    <p className="font-semibold text-slate-900">{tip.title}</p>
    {tip.rows && <dl className="mt-1.5 space-y-1">{tip.rows.map((r) => <div key={r.label} className={`flex items-baseline justify-between gap-3 ${r.sub ? 'pl-5 text-xs' : ''}`}>
      <dt className="flex min-w-0 items-center gap-2 text-slate-600">{r.colour && <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.colour }} />}<span className="truncate">{r.label}</span></dt>
      <dd className={`shrink-0 tabular-nums ${r.strong ? 'font-semibold text-slate-900' : r.sub ? 'text-slate-600' : 'font-medium text-slate-800'}`}>{r.value}</dd>
    </div>)}</dl>}
    {tip.notes?.map((note) => <p key={note} className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">{note}</p>)}
  </div>, document.body);
}

/**
 * The details box of a graph (the owner's request, Nov 2026). Spread `hover(key, tip)` or `mark(key, tip)` on what is pointed
 * at, and render `box` once. A mouse shows it while over the mark, a tap until the next tap or a scroll, the keyboard while
 * on the mark. `mark` also takes the keyboard and says the details to a screen reader; `hover` is for a mark inside a link.
 * `active`: the key of the mark showing, to highlight it.
 */
export function useTip() {
  const [at, setAt] = useState<{ key: string; tip: Tip; x: number; y: number } | null>(null);
  const open = at !== null;
  useEffect(() => {
    if (!open) return;
    const hide = () => setAt(null);
    const away = (e: Event) => { if (!(e.target instanceof Element && e.target.closest('[data-tip]'))) hide(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    addEventListener('scroll', hide, true);
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', escape);
    return () => { removeEventListener('scroll', hide, true); removeEventListener('pointerdown', away, true); removeEventListener('keydown', escape); };
  }, [open]);
  const hover = (key: string, tip: Tip) => {
    const show = (e: PointerEvent) => setAt({ key, tip, x: e.clientX, y: e.clientY });
    return { 'data-tip': '', onPointerEnter: show, onPointerMove: show, onPointerLeave: (e: PointerEvent) => { if (e.pointerType !== 'touch') setAt(null); } };
  };
  const mark = (key: string, tip: Tip) => ({
    ...hover(key, tip), role: 'img', tabIndex: 0, 'aria-label': tipWords(tip),
    onFocus: (e: FocusEvent<Element>) => {
      if (!e.currentTarget.matches(':focus-visible')) return; // a click: the pointer already shows it
      const r = e.currentTarget.getBoundingClientRect();
      setAt({ key, tip, x: r.left + r.width / 2, y: r.top + 12 });
    },
    onBlur: () => setAt(null),
  });
  return { active: at?.key ?? null, hover, mark, box: at && <TipBox tip={at.tip} x={at.x} y={at.y} /> };
}

/** The accent stripes of the best bar in a chart (the owner's reference picture), in our blue. */
export const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, #1f3bb3 0 4px, #8c9ee2 4px 7px)' };

/**
 * A progress bar of thin upright ticks (the owner's reference picture): each part fills its share of the ticks in its
 * colour, in order; the rest stay faded. Shares are 0 to 1 of the whole.
 */
export function TickBar({ parts, ticks = 32, height = 'h-7', label, stretch = false, tip }: { parts: { share: number; tone: string }[]; ticks?: number; height?: string; label: string; stretch?: boolean; tip?: Tip }) {
  const { hover, box } = useTip();
  const ends: number[] = [];
  parts.reduce((n, p) => (ends.push(n + Math.max(0, p.share) * ticks), n + Math.max(0, p.share) * ticks), 0);
  // Stretched, the ticks narrow to fit the width they are given (a phone), never running past it (the owner's report, Oct 2026).
  return <span role="img" aria-label={label} {...hover('bar', tip ?? { title: label })} className={`flex items-end ${stretch ? 'w-full min-w-0 max-w-full justify-between gap-px overflow-hidden' : 'gap-[2px]'} ${height}`}>
    {box}
    {Array.from({ length: ticks }, (_, i) => {
      const part = ends.findIndex((end) => i + 0.5 <= end);
      // On a phone a long stretched bar shows every other tick: the same share, at a width that stays even.
      const thin = stretch && ticks > 48 && i % 2 === 1 ? 'max-sm:hidden' : '';
      return <span key={i} className={`h-full rounded-full w-[3px] ${stretch ? 'min-w-px shrink' : 'shrink-0'} ${thin} ${part < 0 ? 'bg-slate-200' : parts[part]!.tone}`} />;
    })}
  </span>;
}

/** A round top for a chart's scale: 1, 2 or 5 times a power of ten, at least the largest value. */
export function niceTop(max: number): number {
  if (max <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((n) => n >= max)!;
}

/**
 * A bar chart as in the owner's reference picture: each bar stands in a pale full-height track, the best one striped in
 * our blue, with a light scale (0, half, top) on the left.
 */
export function TrackChart({ bars, top, label, height = 'h-44' }: { bars: { key: string; label: string; value: number; title: string; best?: boolean; tip?: Tip }[]; top: number; label: string; height?: string }) {
  const { active, mark, box } = useTip();
  return <div role="group" aria-label={label} className={`flex gap-2 ${height}`}>
    {box}
    <div className="flex flex-col justify-between pb-5 text-right text-[10px] tabular-nums text-slate-400">
      {[top, top / 2, 0].map((n) => <span key={n}>{n.toLocaleString('en-PH')}</span>)}
    </div>
    <div className="relative flex flex-1 items-stretch gap-2">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1.5 bottom-5 flex flex-col justify-between">
        {[0, 1, 2].map((n) => <span key={n} className="border-t border-dashed border-slate-100" />)}
      </div>
      {bars.map((b) => <div key={b.key} className="relative flex flex-1 flex-col items-center gap-1">
        <div {...mark(b.key, b.tip ?? { title: b.title })} className={`relative w-full flex-1 overflow-hidden rounded-xl bg-slate-50 outline-none ${active === b.key ? 'ring-2 ring-indigo-300' : ''}`}>
          <div className={`absolute inset-x-0 bottom-0 rounded-xl ${b.best ? '' : 'bg-slate-200'}`} style={{ height: `${Math.min(100, (b.value / top) * 100)}%`, ...(b.best ? HATCH : {}) }} />
        </div>
        <span className={`text-[11px] ${b.best ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{b.label}</span>
      </div>)}
    </div>
  </div>;
}
