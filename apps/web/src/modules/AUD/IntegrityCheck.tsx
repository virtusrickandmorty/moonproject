import { useEffect, useState } from 'react';
import { api, type IntegrityReport, type Me } from '../../api.ts';
import { Button, Notice, Panel } from '../../components/ui.tsx';

export function IntegrityCheck({ me }: { me: Me }) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [error, setError] = useState('');
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!me.permissions.includes('aud.integrity.view')) return;
    let active = true;
    setReport(null); setError('');
    void api.auditIntegrity().then((r) => { if (active) setReport(r); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [run, me.permissions]);
  if (!me.permissions.includes('aud.integrity.view')) return <Notice>Access denied.</Notice>;
  return <article className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Integrity check</h1>
      <Button disabled={!report && !error} onClick={() => setRun((n) => n + 1)}>Check again</Button></div>
    {error && <Notice>{error}</Notice>}
    {!report && !error && <p className="text-slate-500">Checking…</p>}
    {report && <><Panel title="Audit chain"><p className={report.audit.ok ? 'text-green-700' : 'text-red-700'}>
      {report.audit.ok ? '✓' : '✗'} {report.audit.message}</p>
      <p className="text-sm text-slate-500">{report.audit.count} entries · Newest: {report.audit.newestAt ?? 'none'}</p></Panel>
      <Panel title="Checks"><ul className="space-y-3">{report.checks.map((c) => <li key={c.id} className={c.ok ? 'text-green-700' : 'text-red-700'}>
        {c.ok ? '✓' : '✗'} {c.message}
        {c.problems.length > 0 && <ul className="ml-5 list-disc">{c.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      </li>)}</ul></Panel></>}
  </article>;
}
