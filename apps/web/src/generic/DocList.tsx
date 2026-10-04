/** Generic list for any doc type (PLAN H2): newest first, status filter, 25 rows a page, the user's drafts on top. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DocCounts, type DocHeader, type DocListFilters, type DocTypeInfo, type Draft } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, Field, Notice, Panel, StatusChip, inputClass, manilaTime, peso } from '../components/ui.tsx';
import { docPath, labelOf, pluralLabelOf } from '../shell/menu.ts';

const PAGE = 25;
const FILTERS = [['', 'All'], ['posted', 'Recorded'], ['cancelled', 'Cancelled']] as const;
type ListState = { key: string; rows: DocHeader[]; counts?: DocCounts; more: boolean; busy: boolean; error: string; before?: string };
const waiting = (key: string): ListState => ({ key, rows: [], more: false, busy: true, error: '' });

/** Rows and status counts always use the same search and dates. Counts cover all pages and statuses. */
export async function documentPage(type: string, filters: DocListFilters, status: string, before?: string) {
  const [rows, counts] = await Promise.all([api.list(type, { ...filters, status, before, limit: PAGE }), api.docCounts(type, filters)]);
  return { rows, counts, more: rows.length === PAGE };
}

export function ListMessage({ state, filtered, canCreate, onRetry, onClear, onNew }: { state: ListState; filtered: boolean; canCreate: boolean; onRetry: () => void; onClear: () => void; onNew: () => void }) {
  if (state.busy) return <Notice tone="info">Loading… Please wait for the records to arrive.</Notice>;
  if (state.error) return <Notice>{state.error} Check the connection, then <Button onClick={onRetry}>Retry list</Button>.</Notice>;
  if (state.rows.length > 0) return null;
  return <Notice tone="note">{filtered ? 'No records match these filters.' : 'Nothing here yet.'} {filtered ? <Button onClick={onClear}>Clear filters</Button> : canCreate ? <Button onClick={onNew}>Create a record</Button> : 'Ask the owner if you expected a record here.'}</Notice>;
}

/** `notice`: a line a screen that sent the user here wants shown (a quotation that could not open the Job Order form yet). */
export function DocList({ type, notice }: { type: DocTypeInfo; notice?: string }) {
  const [status, setStatus] = useState('');
  const [typed, setTyped] = useState({ q: '', from: '', to: '' });
  const [filters, setFilters] = useState(typed);
  const key = JSON.stringify([type.key, status, filters]);
  const [loaded, setLoaded] = useState<ListState>(() => waiting(key));
  const state = loaded.key === key ? loaded : waiting(key);
  const { rows, counts, more } = state;
  const asked = useRef(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  const load = useCallback(
    async (before?: string) => {
      const n = ++asked.current;
      setLoaded((s) => ({ ...(before && s.key === key ? s : waiting(key)), busy: true, error: '', before }));
      try {
        const page = await documentPage(type.key, filters, status, before);
        if (n === asked.current) setLoaded((s) => ({ ...page, key, rows: before ? [...s.rows, ...page.rows] : page.rows, busy: false, error: '' }));
      } catch (e) {
        if (n === asked.current) setLoaded((s) => ({ ...s, busy: false, error: (e as Error).message }));
      }
    },
    [key],
  );
  const [draftRetry, setDraftRetry] = useState(0);
  const loadDrafts = () => setDraftRetry((n) => n + 1);
  useEffect(() => { void load(); return () => { asked.current++; }; }, [load]);
  useEffect(() => {
    let active = true;
    setDrafts([]); setError('');
    if (type.canCreate) void api.drafts(type.key).then((ds) => { if (active) setDrafts(ds); }, (e: Error) => { if (active) fail(e); });
    return () => { active = false; };
  }, [type.key, type.canCreate, draftRetry]);
  const clear = () => { setTyped({ q: '', from: '', to: '' }); setFilters({ q: '', from: '', to: '' }); setStatus(''); };
  const filtered = !!(filters.q || filters.from || filters.to || status);
  const pending = JSON.stringify(typed) !== JSON.stringify(filters);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">{pluralLabelOf(type)}</h1>
        {type.canCreate && <Button tone="primary" onClick={() => navigate(docPath(type.key, '/new'))}>+ New {labelOf(type)}</Button>}
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
      {error && <Notice>{error} <Button onClick={loadDrafts}>Retry drafts</Button></Notice>}
      {drafts.length > 0 && (
        <Panel title="Your drafts (not recorded yet)">
          {drafts.map((d) => (
            <p key={d.id} className="flex gap-4 text-sm">
              <span className="flex-1">Draft saved {manilaTime(d.updatedAt)}</span>
              <Link to={docPath(type.key, `/new?draft=${d.id}`)} className="text-indigo-700 hover:underline">Open</Link>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => api.discardDraft(d.id).then(loadDrafts, fail)}>Discard</button>
            </p>
          ))}
        </Panel>
      )}
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const next = { ...typed, q: typed.q.trim() }; setTyped(next); if (JSON.stringify(next) === JSON.stringify(filters)) void load(); else setFilters(next); }}>
        <div className="min-w-64 flex-1"><Field label="Search records" hint="Number, customer or supplier, or words in the summary."><input type="search" maxLength={100} className={inputClass} value={typed.q} onChange={(e) => setTyped({ ...typed, q: e.target.value })} /></Field></div>
        <Field label="From date"><input type="date" className={inputClass} value={typed.from} onChange={(e) => setTyped({ ...typed, from: e.target.value })} /></Field>
        <Field label="To date"><input type="date" className={inputClass} value={typed.to} min={typed.from || undefined} onChange={(e) => setTyped({ ...typed, to: e.target.value })} /></Field>
        <Button type="submit" tone="primary">Search</Button>
        {(filtered || typed.q || typed.from || typed.to) && <Button onClick={clear}>Clear filters</Button>}
        {pending && <p className="w-full text-sm text-slate-500">Filters not applied yet. Press Search.</p>}
      </form>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-sm ring-1 ${status === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
            {label}{counts && ` (${counts[v || 'all']})`}
          </button>
        ))}
      </div>
      <ListMessage state={state} filtered={filtered} canCreate={type.canCreate} onRetry={() => void load(state.before)} onClear={clear} onNew={() => navigate(docPath(type.key, '/new'))} />
      {counts && <p className="text-sm text-slate-500">Showing {rows.length === 0 ? '0' : `1 to ${rows.length}`} of {counts[status === 'posted' || status === 'cancelled' ? status : 'all']} matching records, newest first.</p>}
      {rows.length > 0 && (
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr><th>Number</th><th>Date</th><th>What</th><th className="text-right">Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(docPath(type.key, `/${r.id}`))} className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${r.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="whitespace-nowrap font-medium"><Link to={docPath(type.key, `/${r.id}`)}>{r.number}</Link></td>
                <td className="whitespace-nowrap">{r.businessDate}</td>
                <td>{r.summary}</td>
                <td className="text-right tabular-nums">{peso(r.totalCents)}</td>
                <td><StatusChip status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {more && <Button disabled={state.busy} onClick={() => void load(rows.at(-1)?.postedAt)}>Show older</Button>}
    </div>
  );
}
