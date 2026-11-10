import { useEffect, useState } from 'react';
import { api, type AuditLogPage, type AuditLogRow, type Me } from '../../api.ts';
import { Button, Field, inputClass, Loading, Notice, PageBar, Panel } from '../../components/ui.tsx';
import { auditData, auditQuery, type AuditFilters } from './audit.ts';
import { useLiveReload } from '../../live.ts';
import { SearchSelect } from '../../components/SearchSelect.tsx';
import { Link } from '../../router.tsx';

const empty: AuditFilters = { from: '', to: '', userId: '', action: '', entityType: '', entityId: '', number: '' };

/** One entry in plain words: what happened to which record, who and when, and what changed. */
function Entry({ r, codes }: { r: AuditLogRow; codes: boolean }) {
  const details = r.details ?? [];
  return <li className="py-3">
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium">{r.what ?? r.action}</span>
      {r.record && (r.record.href
        ? <Link to={r.record.href} className="text-indigo-700 underline-offset-2 hover:underline">{r.record.label}</Link>
        : <span className="text-slate-700">{r.record.label}</span>)}
    </div>
    <div className="text-sm text-slate-500">{r.userName ?? 'System or customer'} · {r.when ?? r.at}</div>
    {details.length > 0 && <ul className="mt-1 space-y-0.5 text-sm">
      {details.map((d, i) => <li key={i} className="break-words">
        <span className="text-slate-500">{d.label}: </span>
        {d.before !== undefined
          ? <><span className="text-slate-500 line-through decoration-slate-300">{d.before}</span> <span aria-label="changed to">→</span> <span className="font-medium">{d.after}</span></>
          : <span>{d.value}</span>}
      </li>)}
    </ul>}
    {codes && <div className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600">
      <div>#{r.seq} · {r.at} · {r.action} · {r.entityType}{r.entityId ? ` · ${r.entityId}` : ''}</div>
      <pre className="whitespace-pre-wrap break-words">{auditData(r.data)}</pre>
    </div>}
  </li>;
}

export function AuditLog({ me }: { me: Me }) {
  const [draft, setDraft] = useState<AuditFilters>(empty);
  const [filters, setFilters] = useState<AuditFilters>(empty);
  const [before, setBefore] = useState<number | undefined>();
  // The pages before this one: where each started and how many rows it had (for Previous and "41–60").
  const [earlier, setEarlier] = useState<{ before: number | undefined; rows: number }[]>([]);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [actions, setActions] = useState<{ value: string; label: string }[]>([]);
  const [codes, setCodes] = useState(false);
  const [error, setError] = useState('');
  const query = auditQuery(filters, before);
  const canView = (me?.permissions ?? []).includes('aud.log.view');
  useEffect(() => {
    if (!canView) return;
    void api.auditUsers().then(setUsers, () => undefined);
    void api.auditChoices().then((c) => setActions(c.actions), () => undefined);
  }, [canView]);
  useEffect(() => {
    if (!canView) return;
    let active = true;
    setPage(null); setError('');
    void api.auditLog(query).then((r) => { if (active) setPage(r); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [query, canView]);
  useLiveReload(() => api.auditLog(query).then(setPage), () => canView && !before); // the newest page: the log grows as people work
  if (!canView) return <Notice>Access denied.</Notice>;
  const set = (key: keyof AuditFilters, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  return <article className="space-y-4">
    <h1 className="text-2xl font-semibold">Audit log</h1>
    <p className="text-sm text-slate-600">Everything done in the system: who did it, when, and what changed. Entries can never be changed or removed.</p>
    <Panel title="Filters">
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); setBefore(undefined); setEarlier([]); setFilters({ ...draft }); }}>
        <Field label="From"><input type="date" className={inputClass} value={draft.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={draft.to} onChange={(e) => set('to', e.target.value)} /></Field>
        <Field label="Who"><SearchSelect aria-label="Who" value={draft.userId} onChange={(id) => set('userId', id)} emptyLabel="Everyone" choices={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
        <Field label="What happened"><SearchSelect aria-label="What happened" value={draft.action} onChange={(a) => set('action', a)} emptyLabel="Everything" choices={actions} /></Field>
        <Field label="Document no."><input className={inputClass} value={draft.number} onChange={(e) => set('number', e.target.value)} placeholder="e.g. JO-000036" /></Field>
        <div className="flex flex-wrap items-end gap-2"><Button tone="primary" type="submit">Show</Button>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" href={`/api/aud/log?${auditQuery(filters, before, 'csv')}`}>Download CSV</a></div>
      </form>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={codes} onChange={(e) => setCodes(e.target.checked)} /> Show codes and raw data (for the accountant or an auditor)
      </label>
    </Panel>
    {error && <Notice>{error}</Notice>}
    {!page && !error && <Loading />}
    {page && <Panel title={`${page.rows.length} entries`}>
      {page.rows.length === 0 ? <p>No entries match these filters.</p>
        : <ul className="divide-y divide-slate-100">{page.rows.map((r) => <Entry key={r.seq} r={r} codes={codes} />)}</ul>}
      {(earlier.length > 0 || page.nextBefore !== null) && (() => {
        const first = earlier.reduce((n, p) => n + p.rows, 0) + 1;
        return <PageBar first={first} last={first + page.rows.length - 1} page={earlier.length + 1} hasPrevious={earlier.length > 0} hasNext={page.nextBefore !== null}
          onPrevious={() => { setBefore(earlier.at(-1)!.before); setEarlier(earlier.slice(0, -1)); }}
          onNext={() => { setEarlier([...earlier, { before, rows: page.rows.length }]); setBefore(page.nextBefore!); }} />;
      })()}
    </Panel>}
  </article>;
}
