/**
 * The steps a worker does (the owner's request, Nov 2026), on their employee page: the floor app's Jobs tab lists the
 * open job orders with pieces left on these. Seen with prd.view, changed with prd.assign.
 */
import { useEffect, useState } from 'react';
import { api, type PrdStep } from '../../api.ts';
import { Button, Notice, Panel, useAction } from '../../components/ui.tsx';

export function WorkerSteps({ employeeId, name, editable }: { employeeId: string; name: string; editable: boolean }) {
  const [steps, setSteps] = useState<PrdStep[] | null>(null);
  const [saved, setSaved] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [done, setDone] = useState('');
  const a = useAction();
  useEffect(() => {
    void Promise.all([api.prdCatalogue(), api.workerSteps(employeeId)]).then(([c, w]) => { setSteps(c.steps.filter((s) => s.isActive || w.stepIds.includes(s.id))); setSaved(w.stepIds); setPicked(w.stepIds); }, () => setSteps([]));
  }, [employeeId]);
  if (!steps || !saved) return null;
  const changed = picked.slice().sort().join() !== saved.slice().sort().join();
  const toggle = (id: number) => (setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])), setDone(''));
  const save = async () => {
    const r = await api.setWorkerSteps(employeeId, picked);
    setSaved(r.stepIds); setPicked(r.stepIds); setDone('Saved. Their Jobs tab on the floor app follows these steps.');
  };
  return (
    <Panel title="Production steps they do">
      <p className="text-sm text-slate-600">The floor app shows {name} the open job orders with pieces left on these steps.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Production steps they do">
        {steps.map((s) => (
          <label key={s.id} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 ${picked.includes(s.id) ? 'bg-indigo-50 ring-indigo-300' : 'bg-white ring-slate-300'}`}>
            <input type="checkbox" checked={picked.includes(s.id)} disabled={!editable} onChange={() => toggle(s.id)} />{s.name}
          </label>
        ))}
      </div>
      {editable && <Button tone="primary" disabled={a.busy || !changed} onClick={() => a.run(save)}>Save steps</Button>}
      {a.error && <Notice>{a.error}</Notice>}
      {done && !a.error && <Notice tone="success">{done}</Notice>}
    </Panel>
  );
}
