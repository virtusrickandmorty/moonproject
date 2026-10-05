import { useEffect, useState } from 'react';
import { api, type NavResult } from '../../api.ts';
import { Link } from '../../router.tsx';

export type SearchState = { query: string; status: 'idle' | 'searching' | 'ready' | 'error'; results: NavResult[] };

/** Cleanup cancels the debounce and ignores both late answers and late failures. */
export function startSearch(query: string, search: (query: string) => Promise<NavResult[]>, show: (state: SearchState) => void): () => void {
  if (query.length < 2) { show({ query, status: 'idle', results: [] }); return () => undefined; }
  let current = true;
  show({ query, status: 'searching', results: [] });
  const timer = setTimeout(() => void search(query).then(
    (results) => { if (current) show({ query, status: 'ready', results }); },
    () => { if (current) show({ query, status: 'error', results: [] }); },
  ), 180);
  return () => { current = false; clearTimeout(timer); };
}

export function SearchResults({ state, onChoose, onRetry }: { state: SearchState; onChoose: () => void; onRetry: () => void }) {
  return <div aria-busy={state.status === 'searching'} className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md bg-white text-slate-900 shadow-xl ring-1 ring-slate-200">
    {state.status === 'searching' && <p role="status" className="px-3 py-2 text-slate-500">Searching…</p>}
    {state.status === 'error' && <div className="px-3 py-2"><p role="alert">Cannot search right now. Check the connection and try again.</p><button type="button" onClick={onRetry} className="mt-2 text-indigo-700 hover:underline">Retry search</button></div>}
    {state.status === 'ready' && (state.results.length === 0 ? <p role="status" className="px-3 py-2 text-slate-500">No matches</p> : state.results.map((r) =>
      <Link key={`${r.kind}:${r.id}`} to={r.href} onClickCapture={onChoose} className="block border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
        <span className="block text-xs font-semibold uppercase text-indigo-700">{r.kind}</span><span>{r.label}</span>{r.detail && <span className="ml-2 text-slate-500">{r.detail}</span>}
      </Link>))}
  </div>;
}

export function SearchBox() {
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>({ query: '', status: 'idle', results: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => startSearch(q.trim(), (query) => api.navSearch(query), setState), [q, retry]);
  const shown: SearchState = state.query === q.trim() ? state : { query: q.trim(), status: 'searching', results: [] };
  return <div className="relative order-last w-full sm:order-none sm:w-72">
    <input aria-label="Search everywhere" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers, JOs, numbers…"
      className="w-full rounded-md border border-white/30 bg-white px-3 py-1.5 text-slate-900 placeholder:text-slate-500" />
    {q.trim().length >= 2 && <SearchResults state={shown} onChoose={() => setQ('')} onRetry={() => setRetry((n) => n + 1)} />}
  </div>;
}
