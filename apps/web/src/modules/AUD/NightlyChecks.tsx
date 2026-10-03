import { useEffect, useState } from 'react';
import { api, type Me, type NightlyCheck, type NightlyNight, type NightlyRunNow } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Notice, Panel } from '../../components/ui.tsx';
import { checkResult } from './nightly.ts';

function Checks({ checks }: { checks: NightlyCheck[] }) {
  return <ul className="space-y-2">{checks.map((c) => <li key={c.key} className="text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className={c.passed ? 'text-green-700' : 'font-medium text-red-700'}>{c.passed ? '✓' : '✗'} {c.label}: {checkResult(c)}</span>
      <Link to={c.reportPath} className="text-xs text-indigo-700 hover:underline">Open the report</Link>
    </div>
    {c.findings.length > 0 && <ul className="ml-5 list-disc text-slate-700">{c.findings.map((f, i) => <li key={i}>
      {f.path ? <Link to={f.path} className="text-indigo-700 hover:underline">{f.detail}</Link> : f.detail}</li>)}</ul>}
  </li>)}</ul>;
}

export function NightlyChecks({ me }: { me: Me }) {
  const [nights, setNights] = useState<NightlyNight[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState<NightlyRunNow | null>(null);
  const [busy, setBusy] = useState(false);
  const canRun = me.permissions.includes('aud.nightly.run');
  useEffect(() => {
    if (!me.permissions.includes('aud.integrity.view')) return;
    void api.nightlyChecks().then((r) => { setNights(r.rows); setNext(r.nextBefore); }, (e: Error) => setError(e.message));
  }, [me.permissions]);
  if (!me.permissions.includes('aud.integrity.view')) return <Notice>Access denied.</Notice>;
  async function runNow() {
    setBusy(true); setError('');
    try { setNow(await api.nightlyRunNow()); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function more() {
    if (!next) return;
    try { const r = await api.nightlyChecks(next); setNights((prior) => [...(prior ?? []), ...r.rows]); setNext(r.nextBefore); } catch (e) { setError((e as Error).message); }
  }
  return <article className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Nightly checks</h1>
      {canRun && <Button disabled={busy} onClick={() => void runNow()}>{busy ? 'Checking…' : 'Run the checks now'}</Button>}</div>
    <p className="text-sm text-slate-600">Every night at 2:00 AM, or at the next start if this PC was off, Virtus checks the books and lists anything to look at.
      Running the checks by hand only reads: it changes nothing.</p>
    {error && <Notice>{error}</Notice>}
    {now && <Panel title={`Checked just now (${now.from === now.to ? now.to : `${now.from} to ${now.to}`})`}><Checks checks={now.checks} /></Panel>}
    {!nights && !error && <p className="text-slate-500">Loading…</p>}
    {nights?.length === 0 && <p className="text-slate-500">No nightly check has run yet. The first one runs at the next 2:00 AM.</p>}
    {nights?.map((n) => <Panel key={n.night} title={`Night of ${n.coversFrom === n.night ? n.night : `${n.coversFrom} to ${n.night}`}`}>
      <p className={`text-sm ${n.foundCount ? 'text-red-700' : 'text-green-700'}`}>{n.foundCount ? `${n.foundCount} found` : 'Everything passed'} · run {n.ranAt.slice(0, 16).replace('T', ' ')}</p>
      <Checks checks={n.checks} />
    </Panel>)}
    {next && <Button onClick={() => void more()}>Show older nights</Button>}
  </article>;
}
