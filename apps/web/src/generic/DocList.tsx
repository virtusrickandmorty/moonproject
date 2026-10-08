/**
 * Generic list for any doc type (PLAN H2): newest first, search and date filters, status filter with counts, the user's
 * drafts on top. By default 25 rows and "Show older"; a screen can ask for numbered pages of its own size. Its New form,
 * its documents and their Edit open in dialogs over the list, each with its own address (?new, ?view=<id>, ?edit=<id>),
 * so Back closes them and a link still opens them; each row has its quick actions (print, edit, cancel).
 */
import { useLiveChange } from '../live.ts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type DocCounts, type DocHeader, type DocListFilters, type DocTypeInfo, type Draft, type PrintVariant } from '../api.ts';
import { addRewrite, Link, navigate } from '../router.tsx';
import { askConfirm, Button, Dialog, Field, Notice, Panel, StatusChip, inputClass, manilaTime, peso, showDate, useExit } from '../components/ui.tsx';
import { docPath, labelOf, pluralLabelOf } from '../shell/menu.ts';
import { printDocument } from './DocView.tsx';
import type { FormMode } from './DocForm.tsx';

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

/** A New (or draft) form, or an Edit, shown in a dialog over the list; `close` when it is done; `show` opens what it recorded. */
export type ListForm = (p: { mode: FormMode; close: () => void; setDirty: (dirty: boolean) => void; show: (id: string) => void }) => ReactNode;
/** A document shown in a dialog over the list; `refresh` reloads the list (after a cancel); `cancel` opens its cancel at once. */
export type ListView = (p: { id: string; recorded: boolean; cancel: boolean; refresh: () => void }) => ReactNode;

/** What the address opens over a list: ?view=<id> (&recorded=1 just recorded, &act=cancel its cancel), ?new (&draft=<id>), ?edit=<id>. */
export type Opened = { kind: 'view'; id: string; recorded: boolean; cancel: boolean } | { kind: 'new'; draftId?: string } | { kind: 'edit'; id: string };
export function openedFrom(query: string): Opened | undefined {
  const q = new URLSearchParams(query);
  const view = q.get('view');
  const edit = q.get('edit');
  if (view) return { kind: 'view', id: view, recorded: q.get('recorded') === '1', cancel: q.get('act') === 'cancel' };
  if (edit) return { kind: 'edit', id: edit };
  if (q.has('new')) return { kind: 'new', draftId: q.get('draft') ?? undefined };
  return undefined;
}
export function openedPath(base: string, o: Opened): string {
  if (o.kind === 'view') return `${base}?view=${encodeURIComponent(o.id)}${o.recorded ? '&recorded=1' : ''}${o.cancel ? '&act=cancel' : ''}`;
  if (o.kind === 'edit') return `${base}?edit=${encodeURIComponent(o.id)}`;
  return `${base}?new${o.draftId ? `&draft=${encodeURIComponent(o.draftId)}` : ''}`;
}
/**
 * While the list is on screen, its own document pages open over it instead: a form that recorded (…/<id>?recorded=1,
 * in the form's place), an Edit (…/<id>/edit), New (…/new) and a link to one of them (…/<id>).
 */
export function overList(base: string, to: string): { to: string; replace?: boolean } | null {
  const [path = '', query = ''] = to.split('?');
  if (!path.startsWith(`${base}/`)) return null;
  const q = new URLSearchParams(query);
  const rest = path.slice(base.length + 1).split('/').map(decodeURIComponent);
  if (rest.length === 1 && rest[0] === 'new') return [...q.keys()].every((k) => k === 'draft') ? { to: openedPath(base, { kind: 'new', draftId: q.get('draft') ?? undefined }) } : null;
  if (rest.length === 2 && rest[1] === 'edit' && !query) return { to: openedPath(base, { kind: 'edit', id: rest[0]! }) };
  if (rest.length !== 1 || !rest[0]) return null;
  if (query === 'recorded=1') return { to: openedPath(base, { kind: 'view', id: rest[0], recorded: true, cancel: false }), replace: true };
  return query ? null : { to: openedPath(base, { kind: 'view', id: rest[0], recorded: false, cancel: false }) };
}

/** A small button at the end of a row; a click on it does not open the row. */
export function QuickAction({ label, title, onClick, tone = 'plain' }: { label: string; title?: string; onClick: () => void; tone?: 'plain' | 'danger' }) {
  const look = tone === 'danger' ? 'bg-white text-red-700 ring-red-200 hover:bg-red-50' : 'bg-white text-slate-700 ring-slate-300 hover:bg-indigo-50 hover:ring-indigo-200';
  return <button type="button" title={title ?? label} onClick={(e) => (e.stopPropagation(), onClick())} className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ring-1 transition-colors ${look}`}>{label}</button>;
}

/**
 * `notice`: a line a screen that sent the user here wants shown (a quotation that could not open the Job Order form yet).
 * `pageSize`: numbered pages of this many rows (Newer / Older) instead of "Show older". `form` and `view` open over the
 * list what the address names (`opened`, from openedFrom). `noEdit`: no Edit on its rows (its view has none either).
 * `rowActions`: a screen's own quick actions for a row, before Print, Edit and Cancel (a job order's Make payment).
 * `formTitled`: the form shows no heading of its own in a dialog, so the dialog shows its title.
 */
export function DocList({ type, notice, pageSize, form, view, opened, noEdit, rowActions, formTitled }: {
  type: DocTypeInfo; notice?: string; pageSize?: number; form?: ListForm; view?: ListView; opened?: Opened; noEdit?: boolean; rowActions?: (r: DocHeader) => ReactNode; formTitled?: boolean;
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
  const [printError, setPrintError] = useState('');
  const [printVariants, setPrintVariants] = useState<PrintVariant[]>([]);
  const dirty = useRef(false); // something typed in the dialog's form and not saved
  const base = docPath(type.key);
  // Over the list only what it can show: a form needs `form`, a document needs `view`.
  const wanted = opened && (opened.kind === 'view' ? view : form) ? opened : undefined;
  const [shown, leaving] = useExit(wanted);
  const pushed = useRef(''); // the dialog address this list opened itself, so closing it is Back
  const fail = (e: Error) => setError(e.message);
  const size = pageSize ?? PAGE;

  const load = useCallback(
    async (before?: string, quiet = false) => {
      const n = ++asked.current;
      // "Show older" adds to the rows on screen; a numbered page replaces them. A quiet reload (a live change) keeps the
      // rows on screen until the new ones arrive.
      const adding = !pageSize && !!before;
      if (!quiet) setLoaded((s) => ({ ...(adding && s.key === key ? s : waiting(key)), busy: true, error: '', before }));
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
  // Someone recorded or changed something (here or on another computer): the page on show and the drafts again, quietly.
  // After "Show older" the list holds still rather than jump back to the newest rows.
  useLiveChange(() => {
    if (!pageSize && state.before) return;
    void load(pageSize ? starts[pageNo] : undefined, true);
    loadDrafts();
  });
  const over = !!(view && form);
  useEffect(() => (over ? addRewrite((to) => overList(base, to)) : undefined), [base, over]);
  useEffect(() => {
    let active = true;
    api.printableTypes().then((types) => { if (active) setPrintVariants(types.find((item) => item.key === type.key)?.variants ?? []); }, () => undefined);
    return () => { active = false; };
  }, [type.key]);
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
  /** Opens something over the list; closing it later is Back. */
  const openOver = (o: Opened) => {
    const to = openedPath(base, o);
    pushed.current = to;
    navigate(to);
  };
  /** Back to the bare list: Back when this list opened the dialog, else the list's own address in its place. */
  const closeOver = () => {
    if (window.location.pathname !== base) return; // the user already went elsewhere
    const here = window.location.pathname + window.location.search;
    if (pushed.current === here) history.back(); else navigate(base, { replace: true });
    pushed.current = '';
  };
  /** Before a form's dialog closes (×, Escape or its Close button): asks first when something typed is not saved. */
  const mayCloseForm = async () =>
    !dirty.current || askConfirm('What you typed is lost unless you save it as a draft first.', { title: 'Close this form?', yes: 'Close the form', no: 'Keep typing', danger: true });
  const formClosed = () => { dirty.current = false; loadDrafts(); closeOver(); };
  const closeForm = async () => { if (await mayCloseForm()) formClosed(); };
  const rowPath = (id: string) => (view ? openedPath(base, { kind: 'view', id, recorded: false, cancel: false }) : docPath(type.key, `/${id}`));
  /** Recorded from a form over the list: the list starts over at its first page (the new one is on top) and opens it in the form's place. */
  const showRecorded = (id: string) => {
    dirty.current = false; loadDrafts();
    setStarts([undefined]); setPageNo(0); void load();
    navigate(openedPath(base, { kind: 'view', id, recorded: true, cancel: false }), { replace: true });
  };
  const openNew = (draftId?: string) => (form ? (dirty.current = false, openOver({ kind: 'new', draftId })) : navigate(docPath(type.key, draftId ? `/new?draft=${draftId}` : '/new')));
  const print = (id: string, variant: PrintVariant) => void printDocument(type.key, id, variant).then((e) => setPrintError(e ?? ''));
  const canEdit = type.canCancel && type.canPost && !noEdit;
  /** A row's Edit or Cancel: over the list, or on the document's own page when this list has no dialogs. */
  const act = (o: Opened, page: string) => (over ? openOver(o) : navigate(docPath(type.key, page)));
  /** A row's quick actions, the same in the table and on a phone's card. */
  const actions = (r: DocHeader) => (
    <>
      {rowActions?.(r)}
      {printVariants.includes('document') && <QuickAction label="Print" title={`Print ${r.number}`} onClick={() => print(r.id, 'document')} />}
      {printVariants.includes('job_ticket') && <QuickAction label="Job ticket" title={`Print the job ticket of ${r.number}`} onClick={() => print(r.id, 'job_ticket')} />}
      {r.status === 'posted' && canEdit && <QuickAction label="Edit" title={`Edit ${r.number}`} onClick={() => act({ kind: 'edit', id: r.id }, `/${r.id}/edit`)} />}
      {r.status === 'posted' && type.canCancel && <QuickAction label="Cancel" title={`Cancel ${r.number}`} tone="danger" onClick={() => act({ kind: 'view', id: r.id, recorded: false, cancel: true }, `/${r.id}`)} />}
    </>
  );
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
      {printError && <Notice>{printError}</Notice>}
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
      <div className="flex flex-col-reverse gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-sm ring-1 ${status === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
              {label}{counts && ` (${counts[v || 'all']})`}
            </button>
          ))}
        </div>
        {/* The search, its dates and the button on one line (they wrap on a phone). */}
        <form className="w-full space-y-1 xl:w-2/3" onSubmit={(e) => { e.preventDefault(); const next = { ...typed, q: typed.q.trim() }; setTyped(next); if (JSON.stringify(next) === JSON.stringify(filters)) void load(); else setFilters(next); }}>
          <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <div className="basis-full sm:min-w-40 sm:flex-1 sm:basis-auto"><Field label="Search records"><input type="search" maxLength={100} className={inputClass} placeholder="Number, customer, supplier or words in the summary" value={typed.q} onChange={(e) => setTyped({ ...typed, q: e.target.value })} /></Field></div>
            <div className="flex-1 sm:w-36 sm:flex-none sm:shrink-0"><Field label="From date"><input type="date" className={inputClass} value={typed.from} onChange={(e) => setTyped({ ...typed, from: e.target.value })} /></Field></div>
            <div className="flex-1 sm:w-36 sm:flex-none sm:shrink-0"><Field label="To date"><input type="date" className={inputClass} value={typed.to} min={typed.from || undefined} onChange={(e) => setTyped({ ...typed, to: e.target.value })} /></Field></div>
            <Button type="submit" tone="primary" className="shrink-0">Search</Button>
            {(filtered || typed.q || typed.from || typed.to) && <Button className="whitespace-nowrap" onClick={clear}>Clear filters</Button>}
          </div>
          {pending && <p className="text-sm text-slate-500">Filters not applied yet. Press Search.</p>}
        </form>
      </div>
      <ListMessage state={state} filtered={filtered} canCreate={type.canCreate} onRetry={() => void load(state.before)} onClear={clear} onNew={() => openNew()} />
      {counts && <p className="text-sm text-slate-500">Showing {rows.length === 0 ? '0' : `${first + 1} to ${first + rows.length}`} of {total} matching records, newest first.</p>}
      {/* On a phone each record is a card (number, status, date, what, amount and its quick actions); a table from a tablet up. */}
      {rows.length > 0 && (
      <ul className="space-y-3 md:hidden" aria-label={pluralLabelOf(type)}>
        {rows.map((r) => (
          <li key={r.id} onClick={() => navigate(rowPath(r.id))} className={`cursor-pointer space-y-2 rounded-lg bg-white p-4 shadow-sm active:bg-indigo-50 ${r.status === 'cancelled' ? 'text-slate-400' : ''}`}>
            <div className="flex items-center gap-2">
              <Link to={rowPath(r.id)} onClick={(e) => e.stopPropagation()} className={`font-semibold text-indigo-700 ${r.status === 'cancelled' ? 'line-through' : ''}`}>{r.number}</Link>
              <StatusChip status={r.status} />
              <span className="ml-auto text-sm text-slate-500">{showDate(r.businessDate)}</span>
            </div>
            <p className={`line-clamp-3 text-sm ${r.status === 'cancelled' ? 'line-through' : 'text-slate-700'}`}>{r.summary}</p>
            <p className="text-sm">Amount <b className="tabular-nums">{peso(r.totalCents)}</b></p>
            <div className="flex flex-wrap gap-1.5">{actions(r)}</div>
          </li>
        ))}
      </ul>
      )}
      {rows.length > 0 && (
      <div className="hidden overflow-x-auto rounded-lg bg-white p-2 shadow-sm md:block">
        <table className="w-full text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3">
          <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <tr><th>Number</th><th>Date</th><th>What</th><th className="text-right">Amount</th><th>Status</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => navigate(rowPath(r.id))} className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${r.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="whitespace-nowrap font-medium"><Link to={rowPath(r.id)} onClick={(e) => e.stopPropagation()}>{r.number}</Link></td>
                <td className="whitespace-nowrap">{showDate(r.businessDate)}</td>
                <td>{r.summary}</td>
                <td className="text-right tabular-nums">{peso(r.totalCents)}</td>
                <td><StatusChip status={r.status} /></td>
                <td><div className="flex flex-wrap justify-end gap-1">{actions(r)}</div></td>
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
      {view && shown?.kind === 'view' && (
        <Dialog key={`view-${shown.id}-${shown.cancel}`} title={labelOf(type)} size="full" hideTitle leaving={leaving} onClose={closeOver}>
          {view({ id: shown.id, recorded: shown.recorded, cancel: shown.cancel, refresh: () => void load(starts[pageNo]) })}
        </Dialog>
      )}
      {form && shown && shown.kind !== 'view' && (
        <Dialog key={shown.kind === 'edit' ? `edit-${shown.id}` : `new-${shown.draftId ?? ''}`} title={shown.kind === 'edit' ? `Edit ${labelOf(type)}` : `New ${labelOf(type)}`}
          size="full" hideTitle={!formTitled} leaving={leaving} beforeClose={mayCloseForm} onClose={formClosed}>
          {form({ mode: shown.kind === 'edit' ? { kind: 'edit', id: shown.id } : { kind: 'new', draftId: shown.draftId }, setDirty: (d) => { dirty.current = d; }, close: () => void closeForm(), show: showRecorded })}
        </Dialog>
      )}
    </div>
  );
}
