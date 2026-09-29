import { useEffect, useState } from 'react';
import { api, type NavResult } from '../../api.ts';
import { Link } from '../../router.tsx';

export function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<NavResult[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); return; }
    const timer = setTimeout(() => void api.navSearch(query).then(setResults, () => setResults([])), 180);
    return () => clearTimeout(timer);
  }, [q]);
  return <div className="relative order-last w-full sm:order-none sm:w-72">
    <input aria-label="Search everywhere" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers, JOs, numbers…"
      className="w-full rounded-md border border-white/30 bg-white px-3 py-1.5 text-slate-900 placeholder:text-slate-500" />
    {q.trim().length >= 2 && <div className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-md bg-white text-slate-900 shadow-xl ring-1 ring-slate-200">
      {results.length === 0 ? <p className="px-3 py-2 text-slate-500">No matches</p> : results.map((r) =>
        <Link key={`${r.kind}:${r.id}`} to={r.href} onClick={() => setQ('')} className="block border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
          <span className="block text-xs font-semibold uppercase text-indigo-700">{r.kind}</span><span>{r.label}</span>{r.detail && <span className="ml-2 text-slate-500">{r.detail}</span>}
        </Link>)}
    </div>}
  </div>;
}
