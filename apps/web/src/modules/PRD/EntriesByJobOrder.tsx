/**
 * The production entries grouped by job order (the owner's request, Oct 2026): one row a job order with its entries, the
 * pieces, the workers and the last work date, 20 a page; a row opens the job order's production summary.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type PrdEntriesByJo } from '../../api.ts';
import { Loading, Notice, inputClass, searchClass, searchRowClass, showDate } from '../../components/ui.tsx';
import { usePages } from '../../components/RowPages.tsx';
import { useLiveReload } from '../../live.ts';
import { JobSummaryDialog } from './Summary.tsx';

const STAGE_WORDS: Record<string, string> = { open: 'Not started', in_production: 'In production', ready: 'All steps done', partially_released: 'Partly released', released: 'Released', closed: 'Closed' };

export function EntriesByJobOrder({ me }: { me: Me }) {
  const [rows, setRows] = useState<PrdEntriesByJo[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api.prdEntriesByJobOrder(q).then((r) => (setRows(r.rows), setError('')), (e: Error) => setError(e.message)), [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  useLiveReload(load);
  const { shown, buttons } = usePages(rows);
  return (
    <div className="space-y-3">
      <div className={searchRowClass}>
        <input type="search" aria-label="Search job number or customer" placeholder="Job number or customer" className={`${inputClass} ${searchClass}`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <Notice>{error}</Notice>}
      {!rows ? <Loading /> : rows.length === 0 ? <p className="text-sm text-slate-500">{q ? 'No job order matches.' : 'No production entries yet.'}</p> : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="p-3">Job order</th><th className="p-3">Customer</th><th className="p-3 text-right">Entries</th><th className="p-3 text-right">Pieces</th><th className="p-3 text-right">Workers</th><th className="p-3">Last work</th><th className="p-3">Stage</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50" onClick={() => setOpen(r.id)}>
                <td className="p-3"><button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>{r.number}</button></td>
                <td className="p-3">{r.customerName}</td>
                <td className="p-3 text-right tabular-nums">{r.entries}</td>
                <td className="p-3 text-right tabular-nums">{r.pieces.toLocaleString('en-PH')}</td>
                <td className="p-3 text-right tabular-nums">{r.workers}</td>
                <td className="p-3 whitespace-nowrap">{showDate(r.lastWorkDate)}</td>
                <td className="p-3">{r.stage === 'ready' ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{STAGE_WORDS[r.stage]}</span> : STAGE_WORDS[r.stage] ?? r.stage}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="px-3 pb-3">{buttons}</div>
        </div>
      )}
      {open && <JobSummaryDialog jobOrderId={open} canReassign={me.permissions.includes('prd.reassign')} onClose={() => setOpen(null)} />}
    </div>
  );
}

const VIEW_KEY = 'moonproject.prd.entries.view';
/** The Production entries page: every entry (the usual list), or grouped by job order; the last one picked is kept. */
export function ProductionEntriesPage({ me, list }: { me: Me; list: ReactNode }) {
  const [view, setView] = useState<'all' | 'jo'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'jo' ? 'jo' : 'all'; } catch { return 'all'; } });
  const pick = (v: 'all' | 'jo') => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* kept for this visit only */ } };
  const seg = (v: 'all' | 'jo', label: string) => (
    <button type="button" role="tab" aria-selected={view === v} onClick={() => pick(v)}
      className={`rounded-md px-4 py-2 text-sm font-semibold ${view === v ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-indigo-50'}`}>{label}</button>
  );
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Show production entries" className="flex gap-2">{seg('all', 'Every entry')}{seg('jo', 'By job order')}</div>
      {view === 'jo' ? <><h1 className="text-2xl font-bold text-[#010101]">Production entries by job order</h1><EntriesByJobOrder me={me} /></> : list}
    </div>
  );
}
