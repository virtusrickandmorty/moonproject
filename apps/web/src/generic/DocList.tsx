/**
 * Generic list for any doc type (PLAN H2): newest first, search and date filters, status filter with counts, the user's
 * drafts on top. By default 25 rows and "Show older"; a screen can ask for numbered pages of its own size, and for its
 * New form and its documents in dialogs over the list.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type DocCounts, type DocHeader, type DocListFilters, type DocTypeInfo, type Draft } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, Dialog, Field, Notice, Panel, StatusChip, inputClass, manilaTime, peso, searchClass } from '../components/ui.tsx';
import { docPath, labelOf, pluralLabelOf } from '../shell/menu.ts';

const PAGE = 25;
const FILTERS = [['', 'All'], ['posted', 'Recorded'], ['cancelled', 'Cancelled']] as const;
type ListState = { key: string; rows: DocHeader[]; counts?: DocCounts; more: boolean; busy: boolean; error: string; before?: string };
const waiting = (key: string): ListState => ({ key, rows: [], more: false, busy: true, error: '' });

/**
 * Rows and status counts always use the same search and dates. Counts cover all pages and statuses. `peek` (numbered
 * pages) asks for one row more than the page, so the Older button shows only when an older page exists.
 */
export async function documentPage(type: string, filters: DocListFilters, status: string, before?: string, size = PAGE, peek = false) {
  const [rows, counts] = await Promise.all([api.list(type, { ...filters, status, before, limit: size + (peek ? 1 : 0) }), api.docCounts(type, filters)]);
  return { rows: rows.slice(0, size), counts, more: peek ? rows.length > size : rows.length === size };
}

export function ListMessage({ state, filtered, canCreate, onRetry, onClear, onNew }: { state: ListState; filtered: boolean; canCreate: boolean; onRetry: () => void; onClear: () => void; onNew: () => void }) {
  if (state.busy) return <Notice tone="info">Loading… Please wait for the records to arrive.</Notice>;
  if (state.error) return <Notice>{state.error} Check the connection, then <Button onClick={onRetry}>Retry list</Button>.</Notice>;
  if (state.rows.length > 0) return null;
  return <Notice tone="note">{filtered ? 'No records match these filters.' : 'Nothing here yet.'} {filtered ? <Button onClick={onClear}>Clear filters</Button> : canCreate ? <Button onClick={onNew}>Create a record</Button> : 'Ask the owner if you expected a record here.'}</Notice>;
}

/** A New (or draft) form shown in a dialog over the list: `draftId` when a saved draft is opened; `close` when it is done. */
export type ListForm = (p: { draftId?: string; close: () => void; setDirty: (dirty: boolean) => void; show: (id: string) => void }) => ReactNode;
/** A document shown in a dialog over the list; `refresh` reloads the list (after a cancel). */
export type ListView = (p: { id: string; recorded: boolean; refresh: () => void }) => ReactNode;

/**
 * `notice`: a line a screen that sent the user here wants shown (a quotation that could not open the Job Order form yet).
 * `pageSize`: numbered pages of this many rows (Newer / Older) instead of "Show older". `form`: New opens in a dialog.
 * `view` with `viewing` (from the address, ?view=<id>): a row opens in a dialog, and Back closes it.
 */
export function DocList({ type, notice, pageSize, form, view, viewing }: {
  type: DocTypeInfo; notice?: string; pageSize?: number; form?: ListForm; view?: ListView; viewing?: { id: string; recorded: boolean };
}) {
  const [status, setStatus] = useState('');
  const [typed, setTyped] = useState({ q: '', from: '', to: '' });
  const [filters, setFilters] = useState(typed);
  const key = JSON.stringify([type.key, status, filters]);
  const [loaded, setLoaded] = useState<ListState>(() => waiting(key));
  const state = loaded.key === key ? loaded : waiting(key);
  const { rows, counts, more } = state;
  const asked = useRef(0);
  // Numbered pages: where each page starts (the server pages by "recorded before"); the first page starts at the top.
  const [starts, setStarts] = useState<(string | undefined)[]>([undefined]);
  const [pageNo, setPageNo] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ draftId?: string } | null>(null);
  const dirty = useRef(false); // something typed in the dialog's form and not saved
  const fail = (e: Error) => setError(e.message);
  const size = pageSize ?? PAGE;

  const load = useCallback(
    async (before?: string) => {
      const n = ++asked.current;
      // "Show older" adds to the rows on screen; a numbered page replaces them.
      const adding = !pageSize && !!before;
      setLoaded((s) => ({ ...(adding && s.key === key ? s : waiting(key)), busy: true, error: '', before }));
      try {
        const page = await documentPage(type.key, filters, status, before, size, !!pageSize);
        if (n === asked.current) setLoaded((s) => ({ ...page, key, rows: adding ? [...s.rows, ...page.rows] : page.rows, busy: false, error: '', before }));
      } catch (e) {
        if (n === asked.current) setLoaded((s) => ({ ...s, busy: false, error: (e as Error).message }));
      }
    },
    [key, size, pageSize], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [draftRetry, setDraftRetry] = useState(0);
  const loadDrafts = () => setDraftRetry((n) => n + 1);
  useEffect(() => { setStarts([undefined]); setPageNo(0); void load(); return () => { asked.current++; }; }, [load]);
  useEffect(() => {
    let active = true;
    setDrafts([]); setError('');
    if (type.canCreate) void api.drafts(type.key).then((ds) => { if (active) setDrafts(ds); }, (e: Error) => { if (active) fail(e); });
    return () => { active = false; };
  }, [type.key, type.canCreate, draftRetry]);
  const clear = () => { setTyped({ q: '', from: '', to: '' }); setFilters({ q: '', from: '', to: '' }); setStatus(''); };
  const filtered = !!(filters.q || filters.from || filters.to || status);
  const pending = JSON.stringify(typed) !== JSON.stringify(filters);

  const goTo = (n: number) => {
    const before = n > pageNo ? rows.at(-1)?.postedAt : starts[n];
    if (n > pageNo) setStarts((s) => [...s.slice(0, n), before]);
    setPageNo(n); void load(before); window.scrollTo(0, 0);
  };
  /** Close the dialog's form (×, Escape or its Close button), asking first when something typed is not saved. */
  const closeForm = () => {
    if (dirty.current && !window.confirm('Close this form? What you typed is lost unless you save it as a draft first.')) return;
    dirty.current = false; setOpen(null); loadDrafts();
  };
  const rowPath = (id: string) => (view ? `${docPath(type.key)}?view=${id}` : docPath(type.key, `/${id}`));
  /** Recorded from the New dialog: the list starts over at its first page (the new one is on top) and opens it. */
  const showRecorded = (id: string) => {
    dirty.current = false; setOpen(null); loadDrafts();
    setStarts([undefined]); setPageNo(0); void load();
    navigate(`${docPath(type.key)}?view=${id}&recorded=1`);
  };
  const openNew = (draftId?: string) => (form ? (dirty.current = false, setOpen({ draftId })) : navigate(docPath(type.key, draftId ? `/new?draft=${draftId}` : '/new')));
  const total = counts?.[status === 'posted' || status === 'cancelled' ? status : 'all'];
  const first = pageSize ? pageNo * pageSize : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold text-[#010101]">{pluralLabelOf(type)}</h1>
        {type.canCreate && <Button tone="primary" onClick={() => openNew()}>+ New {labelOf(type)}</Button>}
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
      {error && <Notice>{error} <Button onClick={loadDrafts}>Retry drafts</Button></Notice>}
      {drafts.length > 0 && (
        <Panel title="Your drafts (not recorded yet)">
          {drafts.map((d) => (
            <p key={d.id} className="flex gap-4 text-sm">
              <span className="flex-1">Draft saved {manilaTime(d.updatedAt)}</span>
              {form ? <button type="button" className="text-indigo-700 hover:underline" onClick={() => openNew(d.id)}>Open</button>
                : <Link to={docPath(type.key, `/new?draft=${d.id}`)} className="text-indigo-700 hover:underline">Open</Link>}
              <button type="button" className="text-slate-500 hover:underline" onClick={() => api.discardDraft(d.id).then(loadDrafts, fail)}>Discard</button>
            </p>
          ))}
        </Panel>
      )}
      {/* The status buttons on the left; the search, its dates and the Search button on the right, in half the page. */}
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-sm ring-1 ${status === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
              {label}{counts && ` (${counts[v || 'all']})`}
            </button>
          ))}
        </div>
        <form className={`${searchClass} space-y-2`} onSubmit={(e) => { e.preventDefault(); const next = { ...typed, q: typed.q.trim() }; setTyped(next); if (JSON.stringify(next) === JSON.stringify(filters)) void load(); else setFilters(next); }}>
          <Field label="Search records" hint="Number, customer or supplier, or words in the summary."><input type="search" maxLength={100} className={inputClass} value={typed.q} onChange={(e) => setTyped({ ...typed, q: e.target.value })} /></Field>
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <Field label="From date"><input type="date" className={inputClass} value={typed.from} onChange={(e) => setTyped({ ...typed, from: e.target.value })} /></Field>
            <Field label="To date"><input type="date" className={inputClass} value={typed.to} min={typed.from || undefined} onChange={(e) => setTyped({ ...typed, to: e.target.value })} /></Field>
            <Button type="submit" tone="primary">Search</Button>
            {(filtered || typed.q || typed.from || typed.to) && <Button onClick={clear}>Clear filters</Button>}
          </div>
          {pending && <p className="text-sm text-slate-500">Filters not applied yet. Press Search.</p>}
        </form>
      </div>
      <ListMessage state={state} filtered={filtered} canCreate={type.canCreate} onRetry={() => void load(state.before)} onClear={clear} onNew={() => openNew()} />
      {counts && <p className="text-sm text-slate-500">Showing {rows.length === 0 ? '0' : `${first + 1} to ${first + rows.length}`} of {total} matching records, newest first.</p>}
      {rows.length > 0 && (
      <div className="overflow-x-auto rounded-lg bg-white p-2 shadow-sm">
        <table className="w-full text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3">
          <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <tr><th>Number</th><th>Date</th><th>What</th><th className="text-right">Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(rowPath(r.id))} className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${r.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="whitespace-nowrap font-medium"><Link to={rowPath(r.id)} onClick={(e) => e.stopPropagation()}>{r.number}</Link></td>
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
      {!pageSize && more && <Button disabled={state.busy} onClick={() => void load(rows.at(-1)?.postedAt)}>Show older</Button>}
      {pageSize && (pageNo > 0 || more) && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pages">
          <Button disabled={pageNo === 0 || state.busy} onClick={() => goTo(pageNo - 1)}>← Newer</Button>
          <span className="text-slate-600">Page {pageNo + 1} · {first + 1}–{first + rows.length}</span>
          <Button disabled={!more || state.busy} onClick={() => goTo(pageNo + 1)}>Older →</Button>
        </nav>
      )}
      {view && viewing && (
        <Dialog title={`${labelOf(type)}`} size="full" hideTitle onClose={() => navigate(docPath(type.key))}>
          {view({ id: viewing.id, recorded: viewing.recorded, refresh: () => void load(starts[pageNo]) })}
        </Dialog>
      )}
      {form && open && (
        <Dialog title={`New ${labelOf(type)}`} size="full" onClose={closeForm}>
          {form({ draftId: open.draftId, setDirty: (d) => { dirty.current = d; }, close: closeForm, show: showRecorded })}
        </Dialog>
      )}
    </div>
  );
}
