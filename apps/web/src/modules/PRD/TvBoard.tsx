import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type BoardCard } from '../../api.ts';
import { columns, tvPages, TV_CARD_HEIGHT, TURN_MS, useBoardRefresh, type Column } from './board.ts';

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
  return <main ref={frame} style={{ height }} className="flex h-dvh flex-col gap-4 overflow-hidden bg-slate-50 p-4">
    <header className="shrink-0 space-y-1">
      <div className="flex flex-wrap items-end justify-between gap-2"><h1 className="text-4xl font-bold">Production</h1><p className="text-xl text-slate-500">Refreshes every 30 seconds</p></div>
      <p className="text-lg text-slate-600">Server date: {data?.today ?? '…'} · Page {pages.length ? page % pages.length + 1 : 1} of {Math.max(1, pages.length)}{pages.length > 1 && ' · Pages turn every 12 seconds'}</p>
      <p role="status" className={`text-xl ${stale ? 'font-bold text-red-800' : 'text-slate-600'}`}>{words}</p>
      {error && <p className="text-lg text-red-800">{error}</p>}
    </header>
    <div ref={area} className="min-h-0 flex-1">
      {!data ? <p className="text-2xl text-slate-500">Loading…</p> : cols.length === 0 ? <p className="text-3xl text-slate-600">No job order is in production.</p> : <TvPage cols={pages[page % pages.length] ?? []} today={data.today} />}
    </div>
  </main>;
}

export function TvPage({ cols, today }: { cols: Column[]; today: string }) {
  return <div className="grid h-full gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols.length)}, minmax(0, 1fr))` }}>{cols.map((col) => <section key={col.key} aria-label={col.title} className="min-w-0 rounded-xl bg-slate-100 p-3">
    <h2 className="mb-3 line-clamp-2 h-16 break-words text-2xl font-bold">{col.title}</h2>
    <div className="space-y-3">{col.cards.map((card) => <TvCard key={`${card.jobOrderId}:${card.lineNo}`} card={card} today={today} />)}</div>
  </section>)}</div>;
}

export function TvCard({ card, today }: { card: BoardCard; today: string }) {
  const late = !!today && card.dueDate < today;
  return <article style={{ height: TV_CARD_HEIGHT }} className={`space-y-1 rounded-lg bg-white p-3 text-xl shadow-sm ${late ? 'border-l-4 border-red-600' : ''}`}>
    <p className="truncate font-bold">{card.number} · line {card.lineNo} · {initials(card.customerName)}</p>
    <p className="line-clamp-2 break-words">{card.description}</p>
    <p>{card.qty - card.releasedQty} pcs · Due {card.dueDate}</p>
    <p className="flex flex-wrap gap-2 font-bold">{card.priority === 'rush' && <strong className="rounded bg-red-700 px-2 text-white">RUSH</strong>}{late && <strong className="rounded bg-red-100 px-2 text-red-900">OVERDUE</strong>}</p>
  </article>;
}
