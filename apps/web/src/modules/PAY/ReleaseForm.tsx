/**
 * Payroll release form (PLAN D5 PAY-REL): pick a recorded run with net pay still to release, tick who is paid now (all by
 * default), and say where the money came from, split across cash places if needed. Each person's pay is released once.
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, type CashPlace, type DocTypeInfo, type Preview, type ReleaseRow, type RunToRelease } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Button, Notice, Panel, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { emptyTender, sum, tendersToInput, type TenderRow } from '../COL/money.ts';
import { Errors, TenderRows, useLive } from '../COL/parts.tsx';
import { GROUP_LABEL } from './run.ts';

export function ReleaseForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [runs, setRuns] = useState<RunToRelease[] | null>(null);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [runId, setRunId] = useState(new URLSearchParams(location.search).get('run') ?? '');
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tenders, setTenders] = useState<TenderRow[]>([emptyTender()]);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  useEffect(() => {
    api.runsToRelease().then(setRuns, fail);
    api.cashPlaces().then(setPlaces, fail);
  }, []);
  useEffect(() => {
    setRows([]);
    if (runId) api.releaseStatus(runId).then((r) => (setRows(r), setPicked(new Set(r.filter((x) => !x.releasedBy && x.netCents > 0).map((x) => x.employeeId)))), fail);
  }, [runId]);

  const due = rows.filter((r) => picked.has(r.employeeId));
  const total = sum(due.map((r) => r.netCents));
  const pay = tendersToInput(tenders, 'pick where the money came from');
  const errors = [...(runId ? [] : ['Pick the payroll run.']), ...(due.length ? [] : ['Tick who is paid now.']), ...pay.errors];
  const input = { runId, employeeIds: due.map((r) => r.employeeId), tenders: pay.tenders };
  const live = useLive(JSON.stringify(input), errors.length === 0, () => api.preview(type.key, input));

  if (mode.kind === 'edit') {
    return <Notice tone="info">To change a release, cancel it and record it again. <Link to={docPath(type.key, `/${mode.id}`)} className="underline">Back to the release</Link></Notice>;
  }
  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));

  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Release net pay</h1>
        {error && <Notice>{error}</Notice>}
        <Panel title="Which payroll?">
          {runs?.length === 0 && <p className="text-sm text-slate-500">Every recorded payroll is released.</p>}
          <div role="radiogroup" aria-label="Which payroll?" className="space-y-2">
            {runs?.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={runId === r.id} onClick={() => setRunId(r.id)}
                className={`flex w-full justify-between rounded-lg p-3 text-left text-sm ring-1 ${runId === r.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
                <span>{r.number} · {GROUP_LABEL[r.payGroup]} · {r.periodStart} to {r.periodEnd}</span><span className="tabular-nums">{formatPesos(r.dueCents)} to release</span>
              </button>
            ))}
          </div>
        </Panel>
        {rows.length > 0 && (
          <Panel title="Who is paid now?">
            {rows.map((r) => (
              <label key={r.employeeId} className={`flex justify-between text-sm ${r.releasedBy || r.netCents <= 0 ? 'text-slate-400' : ''}`}>
                <span><input type="checkbox" disabled={!!r.releasedBy || r.netCents <= 0} checked={picked.has(r.employeeId)} onChange={() => toggle(r.employeeId)} /> {r.name}{r.releasedBy ? ` (released by ${r.releasedBy})` : ''}</span>
                <span className="tabular-nums">{peso(r.netCents)}</span>
              </label>
            ))}
          </Panel>
        )}
        <Panel title="Where did the money come from?">
          <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money come from?" amountHint={formatPesos(total)} />
        </Panel>
        <Errors list={errors} show={touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <p className="text-2xl font-semibold tabular-nums">{peso(total)}</p>
        <p className="text-sm text-slate-600">{due.length} {due.length === 1 ? 'person' : 'people'}; paid out {peso(sum(pay.tenders.map((t) => t.amountCents)))}</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.message} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} reason="" onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
