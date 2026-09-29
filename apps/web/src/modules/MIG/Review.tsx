/** The review of one upload: its rows by status, each with its problems in words and the four things the owner can do with it. */
import { useState } from 'react';
import type { MigRow } from '../../api.ts';
import { Button, Field, Notice, ReasonDialog, inputClass, useAction } from '../../components/ui.tsx';
import {
  STATUS_FILTERS, countsAddUp, countsWords, filterCount, filterRows, fixBody, fixFieldsOf, fixStart, issueWords, mergeCandidates, rowButtons, rowFields,
  rowStatusWords, sheetNotes, rowTitle, rowTypeWords, type RowCounts, type StatusFilter,
} from './importer.ts';

export interface RowDoers {
  accept: (row: MigRow) => Promise<unknown>;
  fix: (row: MigRow, manualData: Record<string, string | number>) => Promise<unknown>;
  merge: (row: MigRow, into: MigRow) => Promise<unknown>;
  exclude: (row: MigRow, reason: string) => Promise<unknown>;
}

const chip: Record<string, string> = {
  needs_review: 'bg-amber-100 text-amber-900', accepted: 'bg-emerald-100 text-emerald-800', excluded: 'bg-slate-200 text-slate-700',
  merged: 'bg-sky-100 text-sky-800', valid: 'bg-emerald-100 text-emerald-800',
};

function FixForm({ row, onSave, onClose }: { row: MigRow; onSave: (manualData: Record<string, string | number>) => Promise<unknown>; onClose: () => void }) {
  const [edits, setEdits] = useState<Record<string, string>>(() => fixStart(row));
  const [problem, setProblem] = useState('');
  const save = useAction();
  const submit = () => {
    const r = fixBody(row, edits);
    if (!r.ok) return setProblem(r.message);
    setProblem('');
    void save.run(async () => { await onSave(r.manualData); onClose(); });
  };
  return (
    <div className="space-y-3 rounded-md bg-slate-50 p-3">
      <p className="text-sm text-slate-600">Change what is wrong. Saving the fix also accepts the row, and the server checks it again.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fixFieldsOf(row).map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.kind === 'choice' ? (
              <select className={inputClass} value={edits[f.key] ?? ''} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}>
                <option value="">Choose…</option>
                {f.choices?.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input className={inputClass} inputMode={f.kind === 'text' ? undefined : 'decimal'} value={edits[f.key] ?? ''} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
      {problem && <Notice tone="warning">{problem}</Notice>}
      {save.error && <Notice>{save.error}</Notice>}
      <div className="flex gap-2">
        <Button tone="primary" disabled={save.busy} onClick={submit}>Save the fix and accept</Button>
        <Button onClick={onClose}>Go back</Button>
      </div>
    </div>
  );
}

function MergeForm({ row, candidates, onMerge, onClose }: { row: MigRow; candidates: MigRow[]; onMerge: (into: MigRow) => Promise<unknown>; onClose: () => void }) {
  const [intoId, setIntoId] = useState(candidates[0]?.id ?? '');
  const merge = useAction();
  const into = candidates.find((c) => c.id === intoId);
  return (
    <div className="space-y-3 rounded-md bg-slate-50 p-3">
      <p className="text-sm text-slate-600">Row {row.rowNumber} is left out and its legacy ID points at the row you keep.</p>
      <Field label="Keep this row">
        <select className={inputClass} value={intoId} onChange={(e) => setIntoId(e.target.value)}>
          {candidates.map((c) => <option key={c.id} value={c.id}>Row {c.rowNumber}: {rowTitle(c)}</option>)}
        </select>
      </Field>
      {merge.error && <Notice>{merge.error}</Notice>}
      <div className="flex gap-2">
        <Button tone="primary" disabled={!into || merge.busy} onClick={() => into && void merge.run(async () => { await onMerge(into); onClose(); })}>Merge into that row</Button>
        <Button onClick={onClose}>Go back</Button>
      </div>
    </div>
  );
}

function RowCard({ row, all, reason, doers }: { row: MigRow; all: MigRow[]; reason?: string; doers: RowDoers }) {
  const [mode, setMode] = useState<'fix' | 'merge' | 'exclude' | 'fields' | null>(null);
  const accept = useAction();
  const buttons = rowButtons(row, all);
  const candidates = mergeCandidates(row, all);
  const close = () => setMode(null);
  return (
    <li className="space-y-2 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Row {row.rowNumber}</span>
        <span className="text-sm text-slate-500">{rowTypeWords(row.rowType)}</span>
        <strong className="text-sm">{rowTitle(row)}</strong>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip[row.status] ?? ''}`}>{rowStatusWords(row.status)}</span>
      </div>
      {row.status === 'merged' && row.mergeIntoRowId && <p className="text-sm text-slate-600">Merged into row {all.find((r) => r.id === row.mergeIntoRowId)?.rowNumber ?? '?'}.</p>}
      {row.status === 'excluded' && reason && <p className="text-sm text-slate-600">Left out: {reason}</p>}
      {row.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">{row.issues.map((i) => <li key={i}>{issueWords(i)}</li>)}</ul>
      )}
      <div className="flex flex-wrap gap-2">
        {row.status === 'needs_review' && <Button tone="primary" disabled={!buttons.accept || accept.busy} onClick={() => void accept.run(() => doers.accept(row))}>Accept</Button>}
        {buttons.fix && <Button onClick={() => setMode('fix')}>Fix</Button>}
        {buttons.merge && <Button onClick={() => setMode('merge')}>Merge</Button>}
        {buttons.exclude && <Button tone="danger" onClick={() => setMode('exclude')}>Exclude</Button>}
        <Button onClick={() => setMode(mode === 'fields' ? null : 'fields')}>{mode === 'fields' ? 'Hide fields' : 'All fields'}</Button>
      </div>
      {row.status === 'needs_review' && !buttons.accept && <p className="text-xs text-slate-500">Accept opens once what is wrong is fixed. Use Fix, or Exclude to leave the row out.</p>}
      {accept.error && <Notice>{accept.error}</Notice>}
      {mode === 'fix' && <FixForm row={row} onSave={(m) => doers.fix(row, m)} onClose={close} />}
      {mode === 'merge' && <MergeForm row={row} candidates={candidates} onMerge={(into) => doers.merge(row, into)} onClose={close} />}
      {mode === 'fields' && (
        <dl className="grid gap-x-4 gap-y-1 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-[max-content_1fr]">
          {rowFields(row).map(([label, value]) => <div key={label} className="contents"><dt className="text-slate-500">{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {mode === 'exclude' && (
        <ReasonDialog title={`Exclude row ${row.rowNumber}?`} confirmLabel="Exclude the row" danger onClose={close}
          explain="The row is left out of the import. Say why. The reason is shown on this screen while you work on the upload; the server does not keep it yet."
          onConfirm={async (why) => { await doers.exclude(row, why); close(); }} />
      )}
    </li>
  );
}

export function Review({ rows, filter, onFilter, reasons, doers, counts }: { rows: MigRow[]; filter: StatusFilter; onFilter: (f: StatusFilter) => void; reasons: Record<string, string>; doers: RowDoers; counts: RowCounts }) {
  const shown = filterRows(rows, filter);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={f.key === filter} onClick={() => onFilter(f.key)}
            className={`rounded px-3 py-1 ${f.key === filter ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`}>
            {f.label} ({filterCount(counts, f.key)})
          </button>
        ))}
      </div>
      <p className={`text-sm ${countsAddUp(counts) ? 'text-slate-700' : 'font-semibold text-red-700'}`}>
        {countsAddUp(counts) ? countsWords(counts) : 'The counts do not add up. Reload the page.'} Showing {shown.length}.
      </p>
      <p className="text-xs text-slate-500">Rows with nothing wrong are not listed. They go in as they are, and the dry run counts them.</p>
      {sheetNotes(rows).map((note) => <p key={note} className="text-sm text-slate-600">{note}</p>)}
      {shown.length === 0 ? <p className="text-sm text-slate-500">No rows here.</p> : (
        <ul className="space-y-2">{shown.map((r) => <RowCard key={r.id} row={r} all={rows} reason={reasons[r.id]} doers={doers} />)}</ul>
      )}
    </div>
  );
}
