/**
 * Production entry form (PLAN E7 "assign workers with piece counts in a quick grid", H5 ≤ 30 s): one step of one job
 * order, a row per worker and line. The server takes the piece rate from the table; a typed rate (override or rework)
 * needs a reason. Opened from the board with ?jo=<JO>&step=<step>. Also its Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Preview, type PrdJob, type Worker } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { formatPesos } from '@moonproject/shared';
import { EditGate, Errors, useLive } from '../COL/parts.tsx';
import { emptyRow, rowsToInput, type EntryRow } from './board.ts';
import { PayDetails, PayTotal } from '../PAY/entry.tsx';

type Stored = { jobOrderId: string; stepId: number; overCapReason?: string; rows: { lineNo: number; employeeId: string; pieces: number; rework?: true; rateCents?: number; rateReason?: string }[] };
const cell = `${inputClass} py-1`;

export function EntryForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [jo, setJo] = useState('');
  const [job, setJob] = useState<PrdJob | null>(null);
  const [stepId, setStepId] = useState<number | null>(null);
  const [rows, setRows] = useState<EntryRow[]>([emptyRow()]);
  const [overCapReason, setOverCapReason] = useState('');
  const [original, setOriginal] = useState<DocHeader>();
  const [editReason, setEditReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  useEffect(() => {
    api.prdWorkers().then(setWorkers, fail);
    api.prdBoard().then((cards) => setJobs([...new Map(cards.map((c) => [c.jobOrderId, { id: c.jobOrderId, label: `${c.number} · ${c.customerName} · due ${c.dueDate}` }])).values()]), fail);
    if (mode.kind === 'edit') {
      api.get(type.key, mode.id).then((d) => {
        const input = d.input as Stored;
        setOriginal(d.header);
        setJo(input.jobOrderId);
        setStepId(input.stepId);
        setOverCapReason(input.overCapReason ?? '');
        setRows(input.rows.map((r) => ({ lineNo: String(r.lineNo), employeeId: r.employeeId, pieces: String(r.pieces), rework: !!r.rework, rate: r.rateCents === undefined ? '' : formatPesos(r.rateCents), rateReason: r.rateReason ?? '' })));
      }, fail);
      return;
    }
    const q = new URLSearchParams(location.search);
    setJo(q.get('jo') ?? '');
    setStepId(q.get('step') ? Number(q.get('step')) : null);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  useEffect(() => {
    setJob(null);
    if (jo) api.prdJob(jo).then(setJob, fail);
  }, [jo]);

  // Steps still open on some line of this JO, in canonical order; the lines where the chosen step is open.
  const openOn = (l: PrdJob['lines'][number], id: number) => l.route?.some((s) => s.id === id && s.status !== 'completed' && s.status !== 'not_needed');
  const steps = job ? [...new Map(job.lines.flatMap((l) => l.route ?? []).sort((x, y) => x.seq - y.seq).map((s) => [s.id, s])).values()].filter((s) => job.lines.some((l) => openOn(l, s.id)) || s.id === stepId) : [];
  const lines = job && stepId ? job.lines.filter((l) => openOn(l, stepId) || rows.some((r) => r.lineNo === String(l.lineNo))) : [];
  useEffect(() => {
    if (lines.length > 0 && rows.every((r) => !r.lineNo)) setRows(rows.map((r) => ({ ...r, lineNo: String(lines[0]!.lineNo) })));
  }, [lines.length, stepId]);

  const set = (i: number, patch: Partial<EntryRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const typed = rowsToInput(rows);
  const errors = [...(jo ? [] : ['Pick the job order.']), ...(stepId ? [] : ['Pick the step.']), ...typed.errors];
  const input = { jobOrderId: jo, stepId: stepId ?? 0, rows: typed.rows, ...(overCapReason.trim() ? { overCapReason: overCapReason.trim() } : {}) };
  const live = useLive(JSON.stringify(input), errors.length === 0, () => api.preview(type.key, input));
  const askOverCap = !!overCapReason || !!live?.issues.some((i) => i.code === 'OVER_CAP');
  const calculated = (live?.doc as { rows: { rowNo: number; rateCents: number; amountCents: number }[] } | undefined)?.rows ?? [];

  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, editReason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };

  if (original && !editReason) return <EditGate original={original} typeKey={type.key} onReason={setEditReason} />;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="space-y-4">
      <PayTotal label="Piece pay" total={live?.totalCents}>{typed.rows.reduce((s, r) => s + (Number.isInteger(r.pieces) ? r.pieces : 0), 0)} pcs</PayTotal>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'Record pieces'}</h1>
        {original && <Notice tone="info">When you record, {original.number} is cancelled and the replacement gets a new number. Reason: {editReason}</Notice>}
        {error && <Notice>{error}</Notice>}
        {workers.length === 0 && <Notice tone="warning">No workers are on file yet. Employees come with the Employees screen (EMP).</Notice>}
        <Panel title="Job order and step">
          <select aria-label="Job order" className={inputClass} value={jo} onChange={(e) => (setJo(e.target.value), setStepId(null), setRows([emptyRow()]))}>
            <option value="">Pick the job order…</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            {jo && !jobs.some((j) => j.id === jo) && job && <option value={jo}>{job.jobOrder.number} · {job.jobOrder.customerName}</option>}
          </select>
          <div role="radiogroup" aria-label="Step" className="flex flex-wrap gap-2">
            {steps.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={stepId === s.id} onClick={() => (setStepId(s.id), setRows([emptyRow()]))}
                className={`rounded-lg px-3 py-2 text-sm ring-1 ${stepId === s.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{s.name}</button>
            ))}
            {job && steps.length === 0 && <p className="text-sm text-slate-500">No step is open for pieces on {job.jobOrder.number}. Set up its route on the board.</p>}
          </div>
        </Panel>
        {stepId !== null && job && (
          <Panel title="Who did how many pieces">
            <div className="space-y-3">
              {rows.map((r, i) => {
                const pay = !r.employeeId && !r.pieces.trim() ? undefined : calculated[rows.slice(0, i).filter((row) => row.employeeId || row.pieces.trim()).length];
                return (
                  <section key={i} aria-label={`Worker entry ${i + 1}`} className="space-y-3 rounded-lg border border-slate-200 p-3">
                    <Field label="Line">
                      <select aria-label={`Row ${i + 1} line`} className={cell} value={r.lineNo} onChange={(e) => set(i, { lineNo: e.target.value })}>
                        <option value="" />
                        {lines.map((l) => {
                          const s = l.route?.find((x) => x.id === stepId);
                          return <option key={l.lineNo} value={l.lineNo}>{l.lineNo}: {l.description} ({s ? `${s.pieces} of ${l.qty} done, ${Math.max(0, s.availablePieces - s.pieces)} ready` : `${l.qty} pcs`})</option>;
                        })}
                      </select>
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(6rem,1fr)_minmax(8rem,1fr)]">
                      <Field label="Worker">
                        <select aria-label={`Row ${i + 1} worker`} className={cell} value={r.employeeId} onChange={(e) => set(i, { employeeId: e.target.value })}>
                          <option value="" />
                          {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Pieces"><input aria-label={`Row ${i + 1} pieces`} inputMode="numeric" className={`${cell} text-right tabular-nums`} value={r.pieces} onChange={(e) => set(i, { pieces: e.target.value })} /></Field>
                      <div className="text-sm"><p className="font-medium">Rate per piece</p><p className="tabular-nums">{pay ? peso(pay.rateCents) : 'Awaiting calculation'}</p><p className="text-xs text-slate-500">Last calculated rate; leave the rate blank to use the table.</p></div>
                    </div>
                    <PayDetails title="Change rate or record rework" active={!!r.rate.trim() || r.rework || !!r.rateReason.trim()}>
                      <label className="flex items-center gap-2 text-sm"><input aria-label={`Row ${i + 1} rework`} type="checkbox" checked={r.rework} onChange={(e) => set(i, { rework: e.target.checked })} /> Rework (pasubra)</label>
                      <Field label="Rate (blank = table)">
                        <input aria-label={`Row ${i + 1} rate`} inputMode="decimal" className={`${cell} text-right tabular-nums`} value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} />
                      </Field>
                      {(r.rate.trim() || r.rework) && <Field label="Why this rate?"><input aria-label={`Row ${i + 1} rate reason`} placeholder="Why this rate?" className={cell} value={r.rateReason} onChange={(e) => set(i, { rateReason: e.target.value })} /></Field>}
                      <p className="text-sm text-slate-600">{r.rework ? 'Rework is paid at the typed rate and does not add to normal production progress.' : 'A typed rate replaces the usual rate for these pieces only.'} {pay && <>Last calculated piece pay for this entry: <b className="tabular-nums">{peso(pay.amountCents)}</b>.</>}</p>
                    </PayDetails>
                  </section>
                );
              })}
            </div>
            <Button onClick={() => setRows([...rows, emptyRow(rows.at(-1)?.lineNo ?? '')])}>+ Another worker</Button>
          </Panel>
        )}
        {askOverCap && (
          <Field label="Why more pieces than came out of the step before? (at least 10 characters)">
            <input className={inputClass} value={overCapReason} onChange={(e) => setOverCapReason(e.target.value)} />
          </Field>
        )}
        <Errors list={errors} show={touched} />
      </div>
      <Panel title="So far">
        <p className="text-2xl font-semibold tabular-nums">{typed.rows.reduce((s, r) => s + (Number.isInteger(r.pieces) ? r.pieces : 0), 0)} pcs</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live && live.totalCents !== 0 && <p className="text-sm">Piece pay: <b className="tabular-nums">{peso(live.totalCents)}</b></p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={editReason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
