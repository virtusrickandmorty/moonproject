/** Admin › Practice shop (PLAN C8): where to practise, and the owner's "start over". */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PracticeStatus } from '../../api.ts';
import { Loading, Button, Notice, Panel } from '../../components/ui.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { PRACTICE_URL, isLocalAddress, practiceAddress, practiceLine } from './practice.ts';

export function PracticeShop({ me }: { me: Me }) {
  const [status, setStatus] = useState<PracticeStatus>();
  const [error, setError] = useState('');
  const load = useCallback(() => api.practice().then(setStatus, (e: Error) => setError(e.message)), []);
  const action = useStepUpAction('starting the practice shop over');
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (status?.state !== 'preparing') return;
    const t = setInterval(() => void load(), 5_000);
    return () => clearInterval(t);
  }, [status?.state, load]);

  const canReset = me.permissions.includes('sec.practice.reset');
  // Its public address; on this PC or the shop network, the address on the network too (it works there without the internet).
  const address = status?.port ? PRACTICE_URL : null;
  const local = status?.port && isLocalAddress(window.location.hostname) ? practiceAddress(window.location, status.port) : null;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Practice shop</h1>
      {error && <Notice>{error}</Notice>}
      {!status && !error && <Loading />}
      {status && (
        <Panel title="Practise without touching the real books">
          <p className="text-sm">{practiceLine(status)}</p>
          {status.state === 'ready' && status.message && <Notice tone="warning">{status.message}</Notice>}
          {status.state === 'ready' && address && (
            <>
              <p className="text-sm text-slate-700">
                Open it on any phone or PC and sign in with your usual username and password. Everything there is made up; nothing
                you record, print or change there reaches the real shop.
              </p>
              <p><a href={address} target="_blank" rel="noreferrer" className="font-mono text-lg font-semibold text-indigo-700 underline">{address}</a></p>
              {local && <p className="text-sm text-slate-600">On the shop network it also opens at <a href={local} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 underline">{local}</a>, even without the internet.</p>}
            </>
          )}
          {status.preparedAt && <p className="text-sm text-slate-500">Made-up data from {status.preparedAt.slice(0, 16).replace('T', ' ')}.</p>}
          {canReset && status.state !== 'off' && status.state !== 'here' && (
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <p className="text-sm text-slate-700">
                Start over: throws away everything recorded in the practice shop and makes new made-up data for the last 30 days. The real shop is not touched.
              </p>
              <Button tone="danger" disabled={action.busy || status.state === 'preparing'}
                onClick={() => action.run(async () => setStatus(await api.practiceReset()))}>Start the practice shop over</Button>
              {action.error && <Notice>{action.error}</Notice>}
            </div>
          )}
        </Panel>
      )}
      {action.dialog}
    </div>
  );
}
