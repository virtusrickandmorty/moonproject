import { useEffect, useMemo, useState } from 'react';
import { api, type BoardCard, type PrdStep } from '../../api.ts';
import { columns } from './board.ts';

export const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]!.toLocaleUpperCase()).slice(0, 3).join('');

export function TvBoard() {
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [steps, setSteps] = useState<PrdStep[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => api.prdTv().then((next) => (setCards(next.cards), setSteps(next.steps), setError('')), (e: Error) => setError(e.message));
    void load(); const timer = setInterval(load, 30_000); return () => clearInterval(timer);
  }, []);
  const cols = useMemo(() => columns(steps, cards), [steps, cards]);
  return <div className="space-y-5">
    <header className="flex items-end justify-between"><h1 className="text-4xl font-bold">Production</h1><p className="text-xl text-slate-500">Refreshes every 30 seconds</p></header>
    {error && <p className="rounded bg-red-100 p-3 text-xl text-red-800">{error}</p>}
    <div className="flex gap-4 overflow-x-auto pb-4">{cols.map((col) => <section key={col.key} className="w-80 shrink-0 rounded-xl bg-slate-100 p-3">
      <h2 className="mb-3 flex justify-between text-2xl font-bold"><span>{col.title}</span><span>{col.cards.length}</span></h2>
      <div className="space-y-3">{col.cards.map((card) => <article key={`${card.jobOrderId}:${card.lineNo}`} className="rounded-lg bg-white p-4 text-xl shadow-sm">
        <p className="font-bold">{card.number} · {initials(card.customerName)} {card.priority === 'rush' && <strong className="text-red-700">RUSH</strong>}</p>
        <p>{card.description} · {card.qty - card.releasedQty} pcs</p><p className="text-slate-600">Due {card.dueDate}</p>
      </article>)}</div>
    </section>)}</div>
  </div>;
}
