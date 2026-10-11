import { useEffect, useState } from 'react';
import { api, type AuditLogPage, type Me } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { auditData, auditQuery, type AuditFilters } from './audit.ts';

const empty: AuditFilters = { from: '', to: '', userId: '', action: '', entityType: '', entityId: '' };

export function AuditLog({ me }: { me: Me }) {
  const [draft, setDraft] = useState<AuditFilters>(empty);
  const [filters, setFilters] = useState<AuditFilters>(empty);
  const [before, setBefore] = useState<number | undefined>();
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const query = auditQuery(filters, before);
  useEffect(() => { if (me.permissions.includes('aud.log.view')) void api.auditUsers().then(setUsers, () => undefined); }, [me.permissions]);
  useEffect(() => {
    if (!me.permissions.includes('aud.log.view')) return;
    let active = true;
    setPage(null); setError('');
    void api.auditLog(query).then((r) => { if (active) setPage(r); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [query, me.permissions]);
  if (!me.permissions.includes('aud.log.view')) return <Notice>Access denied.</Notice>;
  const set = (key: keyof AuditFilters, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  return <article className="space-y-4">
    <h1 className="text-2xl font-semibold">Audit log</h1>
    <Panel title="Filters">
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); setBefore(undefined); setFilters({ ...draft }); }}>
        <Field label="From"><input type="date" className={inputClass} value={draft.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={draft.to} onChange={(e) => set('to', e.target.value)} /></Field>
        <Field label="User"><select className={inputClass} value={draft.userId} onChange={(e) => set('userId', e.target.value)}>
          <option value="">All users</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></Field>
        <Field label="Action"><input className={inputClass} value={draft.action} onChange={(e) => set('action', e.target.value)} placeholder="All actions" /></Field>
        <Field label="Entity type"><input className={inputClass} value={draft.entityType} onChange={(e) => set('entityType', e.target.value)} placeholder="All types" /></Field>
        <Field label="Entity ID"><input className={inputClass} value={draft.entityId} onChange={(e) => set('entityId', e.target.value)} placeholder="All records" /></Field>
        <div className="flex items-end gap-2"><Button tone="primary" type="submit">Show</Button>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" href={`/api/aud/log?${auditQuery(filters, before, 'csv')}`}>Download CSV</a></div>
      </form>
    </Panel>
    {error && <Notice>{error}</Notice>}
    {!page && !error && <Loading />}
    {page && <Panel title={`${page.rows.length} entries`}>
      {page.rows.length === 0 ? <p>No audit entries match these filters.</p> : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr>{['Seq', 'When', 'User', 'Action', 'Entity', 'Data'].map((h) => <th className="px-2 py-2" key={h}>{h}</th>)}</tr></thead>
        <tbody>{page.rows.map((r) => <tr key={r.seq} className="border-t border-slate-100 align-top">
          <td className="px-2 py-2">{r.seq}</td><td className="whitespace-nowrap px-2 py-2">{r.at}</td>
          <td className="px-2 py-2">{r.userName ?? 'System'}</td><td className="px-2 py-2">{r.action}</td>
          <td className="px-2 py-2">{r.entityType}{r.entityId && <><br /><span className="text-slate-500">{r.entityId}</span></>}</td>
          <td className="px-2 py-2"><pre className="whitespace-pre-wrap break-words">{auditData(r.data)}</pre></td>
        </tr>)}</tbody>
      </table></div>}
      {page.nextBefore !== null && <Button onClick={() => setBefore(page.nextBefore!)}>Older</Button>}
    </Panel>}
  </article>;
}
