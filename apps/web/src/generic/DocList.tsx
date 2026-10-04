/**
 * Generic list for any doc type (PLAN H2): newest first, status filter, the user's drafts on top. By default 25 rows and
 * "Show older"; a screen can ask for numbered pages of its own size, and for its New form in a dialog over the list.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type DocHeader, type DocTypeInfo, type Draft } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, Dialog, Notice, Panel, StatusChip, manilaTime, peso } from '../components/ui.tsx';
import { docPath, labelOf, pluralLabelOf } from '../shell/menu.ts';

const PAGE = 25;
const FILTERS = [['', 'All'], ['posted', 'Recorded'], ['cancelled', 'Cancelled']] as const;

/** A New (or draft) form shown in a dialog over the list: `draftId` when a saved draft is opened; `close` when it is done. */
export type ListForm = (p: { draftId?: string; close: () => void; setDirty: (dirty: boolean) => void; show: (id: string) => void }) => ReactNode;
/** A document shown in a dialog over the list; `refresh` reloads the list (after a cancel). */
export type ListView = (p: { id: string; recorded: boolean; refresh: () => void }) => ReactNode;

/**
 * `notice`: a line a screen that sent the user here wants shown (a quotation that could not open the Job Order form yet).
 * `pageSize`: numbered pages of this many rows (Previous / Next) instead of "Show older". `form`: New opens in a dialog.
 * `view` with `viewing` (from the address, ?view=<id>): a row opens in a dialog, and Back closes it.
 */
export function DocList({ type, notice, pageSize, form, view, viewing }: {
  type: DocTypeInfo; notice?: string; pageSize?: number; form?: ListForm; view?: ListView; viewing?: { id: string; recorded: boolean };
}) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<DocHeader[]>([]);
  const [more, setMore] = useState(false);
  // Numbered pages: where each page starts (the server pages by "recorded before"), the first page starting at the top.
  const [starts, setStarts] = useState<(string | undefined)[]>([undefined]);
  const [pageNo, setPageNo] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ draftId?: string } | null>(null);
  const dirty = useRef(false); // something typed in the dialog's form and not saved
  const fail = (e: Error) => setError(e.message);
  const size = pageSize ?? PAGE;

  const load = useCallback(
    (before?: string) => api.list(type.key, { status, before, limit: size + (pageSize ? 1 : 0) }).then((page) => {
      if (pageSize) { setRows(page.slice(0, pageSize)); setMore(page.length > pageSize); return; } // one extra row says a next page exists
      setRows((r) => (before ? [...r, ...page] : page)); setMore(page.length === size);
    }, fail),
    [type.key, status, size, pageSize],
  );
  const loadDrafts = useCallback(() => void (type.canCreate && api.drafts(type.key).then(setDrafts, fail)), [type]);
  useEffect(() => { setStarts([undefined]); setPageNo(0); void load(); }, [load]);
  useEffect(loadDrafts, [loadDrafts]);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold text-[#010101]">{pluralLabelOf(type)}</h1>
        {type.canCreate && <Button tone="primary" onClick={() => openNew()}>+ New {labelOf(type)}</Button>}
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
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
      <div className="flex gap-2">
        {FILTERS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-sm ring-1 ${status === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>
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
            {rows.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {!pageSize && more && <Button onClick={() => load(rows.at(-1)?.postedAt)}>Show older</Button>}
      {pageSize && (pageNo > 0 || more) && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pages">
          <Button disabled={pageNo === 0} onClick={() => goTo(pageNo - 1)}>← Newer</Button>
          <span className="text-slate-600">Page {pageNo + 1} · {pageNo * pageSize + 1}–{pageNo * pageSize + rows.length}</span>
          <Button disabled={!more} onClick={() => goTo(pageNo + 1)}>Older →</Button>
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
