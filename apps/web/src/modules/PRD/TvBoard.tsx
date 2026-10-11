import { useEffect, useMemo, useRef, useState } from 'react';
import { Loading, showDate } from '../../components/ui.tsx';
import { TickBar } from '../../components/charts.tsx';
import { api, type BoardCard } from '../../api.ts';
import { boardCounts, columns, dueWords, tvPages, TV_CARD_HEIGHT, TURN_MS, useBoardRefresh, type Column } from './board.ts';

export const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]!.toLocaleUpperCase()).slice(0, 3).join('');

const readTv = async () => {
  const [board, health] = await Promise.all([api.prdTv(), api.health()]);
  return { ...board, today: health.serverTime.slice(0, 10) };
};

export function TvBoard() {
  const { data, error, words, stale } = useBoardRefresh(readTv);
  const frame = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(0);
  useEffect(() => {
    const measure = () => {
      if (frame.current) setHeight(window.innerHeight - frame.current.getBoundingClientRect().top);
      if (area.current) setSize({ width: area.current.clientWidth, height: area.current.clientHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (area.current) observer.observe(area.current);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const cols = useMemo(() => columns(data?.steps ?? [], data?.cards ?? []), [data]);
  const pages = useMemo(() => tvPages(cols, size.width, size.height), [cols, size]);
  useEffect(() => {
    setPage(0);
    if (pages.length < 2) return;
    const timer = setInterval(() => setPage((p) => (p + 1) % pages.length), TURN_MS);
    return () => clearInterval(timer);
  }, [pages.length, size.width, size.height]);
  const counts = data ? boardCounts(data.cards, data.today) : null;
  const longDate = data?.today ? new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.today}T00:00:00Z`)) : '';
  const total = Math.max(1, pages.length);
  const big = (label: string, value: number | undefined, tone = '') => <div className="rounded-2xl bg-white px-5 py-3 ring-1 ring-slate-200">
    <p className="text-lg text-slate-500">{label}</p><p className={`text-5xl font-bold tabular-nums ${tone}`}>{value ?? '…'}</p></div>;
  // A screen across the room (the owner's request, Oct 2026: friendlier): the day, four counts, then the columns.
  return <main ref={frame} style={{ height }} className="flex h-dvh flex-col gap-4 overflow-hidden bg-slate-100 p-5">
    <header className="flex shrink-0 flex-wrap items-center gap-4">
      <div className="mr-auto">
        <h1 className="text-5xl font-bold tracking-tight text-slate-900">Production</h1>
        <p className="text-2xl text-slate-600">{longDate}</p>
        <p className="text-base text-slate-500">Server date: {data?.today ?? '…'} · Refreshes every 30 seconds</p>
        <p role="status" className={`text-lg ${stale ? 'font-bold text-red-700' : 'text-slate-500'}`}>{words}</p>
        {error && <p className="text-lg text-red-700">{error}</p>}
      </div>
      {big('On the floor', counts?.lines)}
      {big('Late', counts?.late, counts?.late ? 'text-red-600' : '')}
      {big('Rush', counts?.rush, counts?.rush ? 'text-red-600' : '')}
      {big('Due this week', counts?.week)}
      <div className="flex flex-col items-center gap-2 px-2" aria-label={`Page ${pages.length ? page % pages.length + 1 : 1} of ${total}`}>
        <div className="flex gap-1.5">{Array.from({ length: total }, (_, i) => <span key={i} className={`size-3 rounded-full ${i === page % total ? 'bg-indigo-600' : 'bg-slate-300'}`} />)}</div>
        <p className="text-base text-slate-500">Page {pages.length ? page % pages.length + 1 : 1} of {total}{pages.length > 1 && ' · turns every 12 s'}</p>
      </div>
    </header>
    <div ref={area} className="min-h-0 flex-1">
      {!data ? <Loading /> : cols.length === 0 ? <p className="rounded-2xl bg-white p-10 text-center text-3xl text-slate-600">No job order is in production.</p> : <TvPage cols={pages[page % pages.length] ?? []} today={data.today} />}
    </div>
  </main>;
}

export function TvPage({ cols, today }: { cols: Column[]; today: string }) {
  return <div className="grid h-full gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols.length)}, minmax(0, 1fr))` }}>{cols.map((col) => <section key={col.key} aria-label={col.title} className="min-w-0 rounded-2xl bg-slate-200/60 p-3">
    <h2 className="mb-3 flex h-16 items-center gap-3 px-1"><span className="line-clamp-2 min-w-0 flex-1 break-words text-2xl font-bold text-slate-900">{col.title}</span>
      <span className="rounded-full bg-white px-3 py-0.5 text-xl font-bold tabular-nums text-slate-700">{col.cards.length}</span></h2>
    <div className="space-y-3">{col.cards.map((card) => <TvCard key={`${card.jobOrderId}:${card.lineNo}`} card={card} today={today} stepId={col.stepId} />)}</div>
  </section>)}</div>;
}

/** One item on the TV: initials only, never a customer's name or a price (it is seen across the floor). */
export function TvCard({ card, today, stepId }: { card: BoardCard; today: string; stepId?: number }) {
  const late = !!today && card.dueDate < today;
  const when = today ? dueWords(today, card.dueDate) : null;
  const here = stepId ? card.steps?.find((s) => s.stepId === stepId) : undefined;
  const done = here ? (here.parts ? Math.min(here.parts.upper, here.parts.lower) : here.pieces) : 0;
  return <article style={{ height: TV_CARD_HEIGHT }} className={`flex flex-col gap-2 rounded-2xl bg-white p-4 text-xl shadow-sm ring-2 ${late ? 'ring-red-400' : 'ring-transparent'}`}>
    <p className="flex items-center gap-2"><span className="truncate text-2xl font-bold text-slate-900">{card.number}</span>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-200 text-base font-bold text-slate-700">{initials(card.customerName)}</span>
      <span className="flex-1" />{card.priority === 'rush' && <strong className="rounded-md bg-red-600 px-2 text-base text-white">RUSH</strong>}</p>
    <p className="line-clamp-1 break-words text-slate-800">{card.description} <span className="text-slate-500">· {card.qty - card.releasedQty} pcs</span></p>
    {here && here.status !== 'not_needed' && <div className="space-y-1"><TickBar parts={[{ share: card.qty ? Math.min(1, done / card.qty) : 0, tone: here.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-600' }]} ticks={40} height="h-4" stretch label={`${done} of ${card.qty} done`} />
      <p className="text-base text-slate-500">{done} of {card.qty} done{(here.reworkOpen ?? 0) > 0 && <span className="ml-2 font-bold text-amber-700">{here.reworkOpen} rework</span>}</p></div>}
    <p className="mt-auto flex flex-wrap items-center gap-2 text-base">
      {when && <span className={`rounded-md px-2 py-0.5 font-bold ${when.tone === 'late' ? 'bg-red-600 text-white' : when.tone === 'soon' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{when.text}</span>}
      <span className="text-slate-500">Due {showDate(card.dueDate)}</span>
      {late && <strong className="text-red-700">OVERDUE</strong>}
    </p>
  </article>;
}
