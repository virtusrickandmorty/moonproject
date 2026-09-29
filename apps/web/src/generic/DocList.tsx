/** Generic list for any doc type (PLAN H2): newest first, status filter, 25 rows a page, the user's drafts on top. */
import { useCallback, useEffect, useState } from 'react';
import { api, type DocHeader, type DocTypeInfo, type Draft } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { Button, Notice, Panel, StatusChip, manilaTime, peso } from '../components/ui.tsx';
import { docPath, labelOf, pluralLabelOf } from '../shell/menu.ts';

const PAGE = 25;
const FILTERS = [['', 'All'], ['posted', 'Recorded'], ['cancelled', 'Cancelled']] as const;

/** `notice`: a line a screen that sent the user here wants shown (a quotation that could not open the Job Order form yet). */
export function DocList({ type, notice }: { type: DocTypeInfo; notice?: string }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<DocHeader[]>([]);
  const [more, setMore] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  const load = useCallback(
    (before?: string) => api.list(type.key, { status, before, limit: PAGE }).then((page) => (setRows((r) => (before ? [...r, ...page] : page)), setMore(page.length === PAGE)), fail),
    [type.key, status],
  );
  const loadDrafts = useCallback(() => void (type.canCreate && api.drafts(type.key).then(setDrafts, fail)), [type]);
  useEffect(() => void load(), [load]);
  useEffect(loadDrafts, [loadDrafts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">{pluralLabelOf(type)}</h1>
        {type.canCreate && <Button tone="primary" onClick={() => navigate(docPath(type.key, '/new'))}>+ New {labelOf(type)}</Button>}
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
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
      <div className="flex gap-2">
        {FILTERS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-sm ring-1 ${status === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>
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
            {rows.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {more && <Button onClick={() => load(rows.at(-1)?.postedAt)}>Show older</Button>}
    </div>
  );
}
