/**
 * The two things done from the fixed-asset screens: the month's depreciation run, and taking an asset off the books
 * (a retirement). Each shows the server's own preview and plain summary first, then records it (PLAN H2 "Record").
 */
import { useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey, type DepreciationGaps, type Preview } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, useAction } from '../../components/ui.tsx';
import { monthLabel } from '../TAX/bir.ts';
import { defaultRunMonth, disposalInput, runDate } from './register.ts';

/** Previews `input` on the server as it changes, and records it with one idempotency key per confirmed input. */
function RecordDialog(p: { title: string; type: string; input: unknown; ready: boolean; businessDate?: string; confirmLabel: string; onDone: () => void; onClose: () => void; children: React.ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState('');
  const a = useAction();
  const json = JSON.stringify([p.input, p.businessDate]);
  const key = useMemo(() => newIdempotencyKey(), [json]);
  useEffect(() => {
    setPreview(null);
    setProblem('');
    if (!p.ready) return;
    let stale = false;
    void api.preview(p.type, p.input, p.businessDate).then((r) => stale || setPreview(r), (e: Error) => stale || setProblem(e.message));
    return () => void (stale = true);
  }, [json, p.ready]);
  const errors = (preview?.issues ?? []).filter((i) => i.level === 'error');
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      {p.children}
      {problem && <Notice>{problem}</Notice>}
      {errors.map((i, n) => <Notice key={n}>{i.message}</Notice>)}
      {preview && errors.length === 0 && <Notice tone="info">{preview.summary}</Notice>}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={p.onClose}>Go back</Button>
        <Button tone="primary" disabled={!preview || errors.length > 0 || a.busy} onClick={() => a.run(async () => { await api.post(p.type, p.input, preview!.totalCents, key, p.businessDate); p.onDone(); })}>{p.confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

/** The depreciation run for one month: offers the first month still to run and any month up to this one. */
export function DepreciationRun({ gaps, onDone, onClose }: { gaps: DepreciationGaps; onDone: () => void; onClose: () => void }) {
  const [month, setMonth] = useState(defaultRunMonth(gaps));
  const choices = [...new Set([...gaps.months, gaps.thisMonth])].sort();
  return (
    <RecordDialog title="Run depreciation" type="fa.depreciation" input={{ month }} ready={/^\d{4}-\d{2}$/.test(month)} businessDate={runDate(month, gaps.thisMonth)} confirmLabel="Record the run" onDone={onDone} onClose={onClose}>
      <Field label="Month to depreciate" hint={gaps.lastRunMonth ? `The latest run so far is ${monthLabel(gaps.lastRunMonth)}. Runs go month by month.` : 'No run has been recorded yet.'}>
        <select aria-label="Month to depreciate" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)}>
          {choices.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === gaps.thisMonth ? ' (this month)' : ''}</option>)}
        </select>
      </Field>
    </RecordDialog>
  );
}

/** A retirement: the asset comes off the books at its book value. A sale cannot be recorded yet (it needs an invoice record). */
export function DisposeAsset({ assetId, label, onDone, onClose }: { assetId: string; label: string; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { input, errors } = disposalInput(assetId, reason);
  return (
    <RecordDialog title={`Take ${label} off the books`} type="fa.disposal" input={input} ready={errors.length === 0} confirmLabel="Record the disposal" onDone={onDone} onClose={onClose}>
      <p className="text-sm text-slate-700">Only a retirement (nothing received for it) can be recorded now. Run the month’s depreciation first: the book value left is charged as a loss.</p>
      <Field label="Why is it being taken off?" required>
        <textarea autoFocus rows={2} aria-label="Why is it being taken off?" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </RecordDialog>
  );
}
