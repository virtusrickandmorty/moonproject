import { useCallback, useEffect, useState } from 'react';
import { api, type BoardCard, type PrdStep } from '../../api.ts';
import { Notice } from '../../components/ui.tsx';
import { columns, customerInitials } from './board.ts';

export function TvBoard() {
  const [data, setData] = useState<{ steps: PrdStep[]; cards: BoardCard[] }>();
  const [error, setError] = useState('');
  const load = useCallback(() => api.prdTv().then((x) => (setData(x), setError('')), (e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); const timer = setInterval(load, 30_000); return () => clearInterval(timer); }, [load]);
  if (error && !data) return <Notice>{error}</Notice>;
  if (!data) return <p className="text-xl text-slate-500">Loading production board…</p>;
  return <div className="space-y-5">
    <div className="flex items-end gap-4"><h1 className="text-4xl font-bold">Production TV board</h1><span className="text-slate-500">Refreshes every 30 seconds</span></div>
    {error && <Notice>{error}</Notice>}
    <div className="flex gap-5 overflow-x-auto pb-4">{columns(data.steps, data.cards).map((col) =>
      <section key={col.key} className="w-80 shrink-0 rounded-xl bg-slate-100 p-4">
        <h2 className="mb-3 flex justify-between text-2xl font-bold"><span>{col.title}</span><span>{col.cards.length}</span></h2>
        <div className="space-y-3">{col.cards.map((card) => <article key={`${card.jobOrderId}-${card.lineNo}`} className="rounded-lg bg-white p-4 text-xl shadow">
          <p className="font-bold">{card.number} · L{card.lineNo} {card.priority === 'rush' && <strong className="text-red-700">RUSH</strong>}</p>
          <p>{customerInitials(card.customerName)} · {card.description}</p><p className="text-slate-600">{card.qty - card.releasedQty} pcs · due {card.dueDate}</p>
        </article>)}</div>
      </section>)}</div>
  </div>;
}
