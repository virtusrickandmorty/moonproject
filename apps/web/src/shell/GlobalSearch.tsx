import { useEffect, useState } from 'react';
import { api, type NavResult } from '../api.ts';
import { Link } from '../router.tsx';

const KIND: Record<NavResult['kind'], string> = { customer: 'Customer', wearer: 'Wearer', job_order: 'Job order', document: 'Document', supplier: 'Supplier', employee: 'Employee' };

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<NavResult[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setError(''); return; }
    const timer = setTimeout(() => void api.navSearch(q.trim()).then((x) => (setResults(x), setError('')), (e: Error) => (setResults([]), setError(e.message))), 200);
    return () => clearTimeout(timer);
  }, [q]);
  return <div className="relative order-last w-full sm:order-none sm:w-72">
    <label className="sr-only" htmlFor="global-search">Search Moonproject</label>
    <input id="global-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers, JOs, numbers…"
      className="w-full rounded-md border-0 bg-white px-3 py-1.5 text-slate-900 placeholder:text-slate-500" autoComplete="off" />
    {q.trim().length >= 2 && <div className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md bg-white text-slate-900 shadow-xl ring-1 ring-slate-200">
      {error && <p className="p-3 text-red-700">{error}</p>}
      {!error && results.length === 0 && <p className="p-3 text-slate-500">No matches</p>}
      {results.map((r, i) => <Link key={`${r.kind}-${r.href}-${i}`} to={r.href} className="block border-b border-slate-100 px-3 py-2 hover:bg-indigo-50" onClick={() => setQ('')}>
        <span className="block text-xs font-semibold uppercase text-indigo-700">{KIND[r.kind]}</span><span className="font-medium">{r.label}</span>{r.detail && <span className="block text-xs text-slate-500">{r.detail}</span>}
      </Link>)}
    </div>}
  </div>;
}
