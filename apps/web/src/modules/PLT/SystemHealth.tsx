/** Admin › System health (PLAN C8): traffic lights, "Run system check" and the support file. */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type SystemHealth } from '../../api.ts';
import { Loading, Button, Notice, Panel } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { DOT, OVERALL, fixLink } from './health.ts';

const when = (at: string) => at.slice(0, 16).replace('T', ' ');

export function SystemHealthPage({ me }: { me: Me }) {
  const [health, setHealth] = useState<SystemHealth>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.systemHealth().then(setHealth, (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  if (!me.permissions.includes('sec.health.view')) return <Notice>Access denied.</Notice>;
  const check = async () => {
    setBusy(true);
    setError('');
    try {
      setHealth(await api.systemCheck());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">System health</h1>
        <div className="flex gap-2">
          <Button tone="primary" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Run system check'}</Button>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" href="/api/system/support-file">Download support file</a>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {!health && !error && <Loading />}
      {health && (
        <>
          <p className="flex items-center gap-2 text-base font-medium">
            <span className={`inline-block h-4 w-4 rounded-full ${DOT[health.overall]}`} aria-hidden />
            {OVERALL[health.overall]}
          </p>
          <Panel title={`As of ${when(health.at)}`}>
            <ul className="divide-y divide-slate-100">
              {health.lights.map((l) => {
                const fix = fixLink(l.key, l.light, me.permissions);
                return (
                  <li key={l.key} className="flex gap-3 py-2">
                    <span className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full ${DOT[l.light]}`} aria-label={l.light} />
                    <div className="text-sm">
                      <p className="font-medium">{l.label}</p>
                      <p className="text-slate-700">{l.message}</p>
                      {fix && <Link to={fix.path} className="text-indigo-700 hover:underline">{fix.label}</Link>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <p className="text-sm text-slate-500">
            The system check runs every night by itself. The support file has the version, these lights and counts, but no names, amounts or files of the shop.
          </p>
        </>
      )}
    </div>
  );
}
