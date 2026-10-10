/**
 * The ERP's progress bars and charts (the owner's request, Oct 2026, after a reference dashboard): thin tick bars and bar
 * charts whose bars stand in pale tracks, the best one striped in our blue. Used on the home and across the screens.
 */
import type { CSSProperties } from 'react';

/** The accent stripes of the best bar in a chart (the owner's reference picture), in our blue. */
export const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, #1f3bb3 0 4px, #8c9ee2 4px 7px)' };

/**
 * A progress bar of thin upright ticks (the owner's reference picture): each part fills its share of the ticks in its
 * colour, in order; the rest stay faded. Shares are 0 to 1 of the whole.
 */
export function TickBar({ parts, ticks = 32, height = 'h-7', label, stretch = false }: { parts: { share: number; tone: string }[]; ticks?: number; height?: string; label: string; stretch?: boolean }) {
  const ends: number[] = [];
  parts.reduce((n, p) => (ends.push(n + Math.max(0, p.share) * ticks), n + Math.max(0, p.share) * ticks), 0);
  return <span role="img" aria-label={label} title={label} className={`flex items-end ${stretch ? 'w-full justify-between' : 'gap-[2px]'} ${height}`}>
    {Array.from({ length: ticks }, (_, i) => {
      const part = ends.findIndex((end) => i + 0.5 <= end);
      return <span key={i} className={`h-full rounded-full w-[3px] shrink-0 ${part < 0 ? 'bg-slate-200' : parts[part]!.tone}`} />;
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
export function TrackChart({ bars, top, label, height = 'h-44' }: { bars: { key: string; label: string; value: number; title: string; best?: boolean }[]; top: number; label: string; height?: string }) {
  return <div role="img" aria-label={label} className={`flex gap-2 ${height}`}>
    <div className="flex flex-col justify-between pb-5 text-right text-[10px] tabular-nums text-slate-400">
      {[top, top / 2, 0].map((n) => <span key={n}>{n.toLocaleString('en-PH')}</span>)}
    </div>
    <div className="relative flex flex-1 items-stretch gap-2">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1.5 bottom-5 flex flex-col justify-between">
        {[0, 1, 2].map((n) => <span key={n} className="border-t border-dashed border-slate-100" />)}
      </div>
      {bars.map((b) => <div key={b.key} className="relative flex flex-1 flex-col items-center gap-1">
        <div title={b.title} className="relative w-full flex-1 overflow-hidden rounded-xl bg-slate-50">
          <div className={`absolute inset-x-0 bottom-0 rounded-xl ${b.best ? '' : 'bg-slate-200'}`} style={{ height: `${Math.min(100, (b.value / top) * 100)}%`, ...(b.best ? HATCH : {}) }} />
        </div>
        <span className={`text-[11px] ${b.best ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{b.label}</span>
      </div>)}
    </div>
  </div>;
}
