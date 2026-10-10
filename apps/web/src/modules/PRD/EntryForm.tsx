/**
 * Production entry form (PLAN E7 "assign workers with piece counts in a quick grid", H5 ≤ 30 s): one step of one job
 * order, a row per worker and line. No rate or piece pay shows here (the owner's decision, Oct 2026): the server takes the
 * piece rate from the price list item (for rework too), and payroll shows and changes the pay. Opened from the board with ?jo=<JO>&step=<step>. Also its
 * Edit (NR-4). A row takes at most the pieces ready on the step (came from the step before, not done yet); rework, at most
 * the pieces done there: more is not recorded.
 * The work date is today unless the sheet is late (audit B2-F2). When the server takes a row for a sheet already recorded
 * (LIKELY_REPEAT, B2-F3), the row asks why it is a different sheet.
 * Wearers (the owner's request, Oct 2026): a step lists the wearers forwarded from the step before (and those done there);
 * a rework row lists the wearers done on the step (those sent back first). ?line=<n> picks the item opened from the board;
 * ?rework=1 starts with a rework row.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Preview, type PrdJob, type Worker } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { formatPesos, manilaDate, type Issue } from '@moonproject/shared';
import { EditGate, Errors, useLive } from '../COL/parts.tsx';
import { emptyRow, rowsToInput, type EntryRow } from './board.ts';

type Stored = { jobOrderId: string; stepId: number; workDate?: string; overCapReason?: string; rows: { lineNo: number; employeeId: string; pieces: number; rework?: true; rateCents?: number; rateReason?: string; repeatReason?: string; wearers?: number[]; part?: 'upper' | 'lower' }[] };
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
  const [workDate, setWorkDate] = useState(() => manilaDate(new Date()));
  const [refusedRepeat, setRefusedRepeat] = useState<number[]>([]); // rows (as sent) the server took for a repeated sheet on Record
  const [originalRows, setOriginalRows] = useState<Stored['rows'] | null>(null); // the edited entry's rows: its wearers are free again
  const fail = (e: Error) => setError(e.message);

  useEffect(() => {
    api.prdWorkers().then(setWorkers, fail);
    api.prdBoard().then((cards) => setJobs([...new Map(cards.map((c) => [c.jobOrderId, { id: c.jobOrderId, label: `${c.number} · ${c.customerName} · due ${c.dueDate}` }])).values()]), fail);
    if (mode.kind === 'edit') {
      api.get(type.key, mode.id).then((d) => {
        const input = d.input as Stored;
        setOriginal(d.header);
        setOriginalRows(input.rows);
        setJo(input.jobOrderId);
        setStepId(input.stepId);
        setOverCapReason(input.overCapReason ?? '');
        if (input.workDate) setWorkDate(input.workDate);
        setRows(input.rows.map((r) => ({ lineNo: String(r.lineNo), employeeId: r.employeeId, pieces: String(r.pieces), rework: !!r.rework, rate: r.rateCents === undefined ? '' : formatPesos(r.rateCents), rateReason: r.rateReason ?? '', repeatReason: r.repeatReason ?? '', ...(r.wearers ? { wearers: r.wearers } : {}), ...(r.part ? { part: r.part } : {}) })));
      }, fail);
      return;
    }
    const q = new URLSearchParams(location.search);
    setJo(q.get('jo') ?? '');
    setStepId(q.get('step') ? Number(q.get('step')) : null);
    // The item opened from the board (?line=) is the row's line; ?rework=1 starts it as rework.
    setRows([{ ...emptyRow(q.get('line') ?? ''), rework: q.has('rework') }]);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  useEffect(() => {
    setJob(null);
    if (jo) api.prdJob(jo).then(setJob, fail);
  }, [jo]);

  // Steps still open on some line of this JO, in canonical order; the lines where the chosen step is open.
  // A step is open for pieces while not done, or while rework sent back to it is not redone yet.
  const reworkLeft = (s: NonNullable<PrdJob['lines'][number]['route']>[number]) => (s.rework?.pieces ?? 0) + (s.partRework ? s.partRework.upper.pieces + s.partRework.lower.pieces : 0);
  const openOn = (l: PrdJob['lines'][number], id: number) => l.route?.some((s) => s.id === id && ((s.status !== 'completed' && s.status !== 'not_needed') || reworkLeft(s) > 0));
  const steps = job ? [...new Map(job.lines.flatMap((l) => l.route ?? []).sort((x, y) => x.seq - y.seq).map((s) => [s.id, s])).values()].filter((s) => job.lines.some((l) => openOn(l, s.id)) || s.id === stepId) : [];
  const lines = job && stepId ? job.lines.filter((l) => openOn(l, stepId) || rows.some((r) => r.lineNo === String(l.lineNo))) : [];
  useEffect(() => {
    if (lines.length > 0 && rows.every((r) => !r.lineNo)) setRows(rows.map((r) => ({ ...r, lineNo: String(lines[0]!.lineNo) })));
  }, [lines.length, stepId]);

  const set = (i: number, patch: Partial<EntryRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const typed = rowsToInput(rows);
  // Pieces ready per line and part on this step (work: came from the step before, not done yet; rework: done there).
  // On Edit, the entry being replaced still counts until Record cancels it, so its own pieces are free again.
  const capOf = (lineNo: string, part: 'upper' | 'lower' | undefined, rework: boolean) => {
    const s = job?.lines.find((l) => String(l.lineNo) === lineNo)?.route?.find((x) => x.id === stepId);
    if (!s) return null;
    const done = part && s.partPieces ? s.partPieces[part] : s.pieces;
    if (rework) return Math.max(done, part ? s.partRework?.[part]?.pieces ?? 0 : s.rework?.pieces ?? 0); // or the rework that reached it
    const mine = (originalRows ?? []).filter((o) => String(o.lineNo) === lineNo && !o.rework && o.part === part).reduce((n, o) => n + o.pieces, 0);
    return Math.max(0, (part && s.partAvailable ? s.partAvailable[part] : s.availablePieces) - done + mine);
  };
  const overReady = [...new Map(rows.filter((r) => r.lineNo && Number(r.pieces) > 0).map((r) => [`${r.lineNo}|${r.part ?? ''}|${r.rework}`, r])).values()].flatMap((r) => {
    const cap = capOf(r.lineNo, r.part, r.rework);
    const sum = rows.filter((x) => x.lineNo === r.lineNo && x.part === r.part && x.rework === r.rework).reduce((n, x) => n + (Number(x.pieces) || 0), 0);
    const what = `${r.part ? `${r.part} parts` : 'pieces'} of line ${r.lineNo}`;
    return cap !== null && sum > cap ? [r.rework ? `Only ${cap} ${what} are done on this step, so at most ${cap} can be rework. You entered ${sum}.` : `Only ${cap} ${what} are ready on this step. You entered ${sum}.`] : [];
  });
  const errors = [...(jo ? [] : ['Pick the job order.']), ...(stepId ? [] : ['Pick the step.']), ...typed.errors, ...overReady];
  const input = { jobOrderId: jo, stepId: stepId ?? 0, workDate, rows: typed.rows, ...(overCapReason.trim() ? { overCapReason: overCapReason.trim() } : {}) };
  // On Edit the entry being replaced is still recorded until Record cancels it: a row matching only that entry is no repeat.
  const own = (p: Preview): Preview => (original ? { ...p, issues: p.issues.filter((i) => !(i.code === 'LIKELY_REPEAT' && i.message.includes(`: ${original.number} already has`)) && !(i.code === 'WEARER_DONE' && i.message.includes(`(${original.number})`))) } : p);
  const preview = useLive(JSON.stringify(input), errors.length === 0, () => api.preview(type.key, input));
  const live = preview && own(preview);
  const repeatAt = new Set([...refusedRepeat, ...(live?.issues ?? []).filter((i) => i.code === 'LIKELY_REPEAT').map((i) => Number(i.field?.split('.')[1]))]);

  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input).then((p) => setConfirm(own(p)), fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, editReason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(own(await api.preview(type.key, input)));
      if (e instanceof ApiError && Array.isArray(e.details)) setRefusedRepeat((e.details as Issue[]).filter((i) => i.code === 'LIKELY_REPEAT').map((i) => Number(i.field?.split('.')[1])));
      throw e;
    }
  };

  if (original && !editReason) return <EditGate original={original} typeKey={type.key} onReason={setEditReason} />;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="space-y-4">
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
          <Field label="Day the pieces were done" hint="Today unless the sheet is late (up to 31 days back).">
            <input type="date" aria-label="Work date" className={inputClass} value={workDate} max={manilaDate(new Date())} onChange={(e) => setWorkDate(e.target.value)} />
          </Field>
          <div role="radiogroup" aria-label="Step" className="flex flex-wrap gap-2">
            {steps.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={stepId === s.id} onClick={() => (setStepId(s.id), setRows([emptyRow(job?.lines.some((l) => String(l.lineNo) === rows[0]?.lineNo && openOn(l, s.id)) ? rows[0]!.lineNo : '')]))}
                className={`rounded-lg px-3 py-2 text-sm ring-1 ${stepId === s.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{s.name}</button>
            ))}
            {job && steps.length === 0 && <p className="text-sm text-slate-500">No step is open for pieces on {job.jobOrder.number}. Set up its route on the board.</p>}
          </div>
        </Panel>
        {stepId !== null && job && (
          <Panel title="Who did how many pieces">
            <div className="space-y-3">
              {rows.map((r, i) => {
                const sent = rows.slice(0, i).filter((row) => row.employeeId || row.pieces.trim()).length; // its place among the rows sent
                const askRepeat = !r.rework && (!!r.repeatReason?.trim() || ((!!r.employeeId || !!r.pieces.trim()) && repeatAt.has(sent)));
                return (
                  <section key={i} aria-label={`Worker entry ${i + 1}`} className="space-y-3 rounded-xl p-4 ring-1 ring-slate-200/70">
                    <Field label="Line">
                      <select aria-label={`Row ${i + 1} line`} className={cell} value={r.lineNo} onChange={(e) => set(i, { lineNo: e.target.value, part: undefined, ...(r.wearers?.length ? { wearers: [], pieces: '' } : {}) })}>
                        <option value="" />
                        {lines.map((l) => {
                          const s = l.route?.find((x) => x.id === stepId);
                          const words = (s?.partPieces ? `upper ${s.partPieces.upper} of ${l.qty}, lower ${s.partPieces.lower} of ${l.qty} done` : s ? `${s.pieces} of ${l.qty} done, ${Math.max(0, s.availablePieces - s.pieces)} ready` : `${l.qty} pcs`)
                            + (s && reworkLeft(s) > 0 ? `, ${reworkLeft(s)} rework` : '');
                          return <option key={l.lineNo} value={l.lineNo}>{l.lineNo}: {l.description} ({words})</option>;
                        })}
                      </select>
                    </Field>
                    {job.lines.find((l) => String(l.lineNo) === r.lineNo)?.isSet && (
                      <div role="radiogroup" aria-label={`Row ${i + 1} part`} className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">Part of the set</span>
                        {(['upper', 'lower'] as const).map((p) => (
                          <button key={p} type="button" role="radio" aria-checked={r.part === p} onClick={() => set(i, { part: p, ...(r.part !== p && r.wearers?.length ? { wearers: [], pieces: '' } : {}) })}
                            className={`rounded-full px-3 py-1 text-sm ring-1 ${r.part === p ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{p === 'upper' ? 'Upper' : 'Lower'}</button>
                        ))}
                        {!r.part && <span className="text-xs text-amber-800">Pick the part these pieces are for.</span>}
                      </div>
                    )}
                    <label className="flex w-fit items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm ring-1 ring-amber-200">
                      <input aria-label={`Row ${i + 1} rework`} type="checkbox" checked={r.rework} onChange={(e) => set(i, { rework: e.target.checked, ...(r.wearers?.length ? { wearers: [], pieces: '' } : {}) })} />
                      Record rework (pasubra)
                    </label>
                    {(() => {
                      // The line's wearers: tick who this worker finished; the pieces follow the ticks. Done ones show who did them.
                      // Only the wearers forwarded from the step before are listed (not those still to come); on rework, those done
                      // on this step, the ones sent back first.
                      const line = job.lines.find((l) => String(l.lineNo) === r.lineNo);
                      const roster = line?.roster ?? [];
                      if (roster.length === 0 || (line?.isSet && !r.part)) return null;
                      const step = line?.route?.find((x) => x.id === stepId);
                      const part = line?.isSet ? r.part : undefined;
                      const sentBack = (part ? step?.partRework?.[part] : step?.rework)?.wearers ?? [];
                      const doneHere = part ? step?.partWearersDone?.[part] ?? [] : step?.doneWearers ?? [];
                      const forwarded = r.rework ? [...sentBack, ...doneHere] : (part ? step?.partForwarded?.[part] : step?.forwardedWearers) ?? null;
                      if (r.rework && forwarded?.length === 0) return null; // nobody done here yet: the rework pieces are typed
                      const done = new Set(r.rework ? [] : doneHere);
                      // On a set, each wearer's parts already finished on this step.
                      const partsDone = (n: number) => (line?.isSet ? (['upper', 'lower'] as const).filter((p) => step?.partWearersDone?.[p]?.includes(n)) : []);
                      if (original) for (const o of (originalRows ?? []).filter((x) => String(x.lineNo) === r.lineNo)) for (const n of o.wearers ?? []) done.delete(n); // the entry being edited frees its own
                      const elsewhere = new Map(rows.flatMap((x, j) => (j !== i && x.lineNo === r.lineNo && x.rework === r.rework && x.part === r.part ? (x.wearers ?? []).map((n) => [n, j + 1] as const) : [])));
                      const mine = new Set(r.wearers ?? []);
                      const tick = (next: Set<number>) => set(i, { wearers: [...next].sort((a, b) => a - b), pieces: String(roster.filter((w) => next.has(w.rowNo)).reduce((s, w) => s + w.qty, 0) || '') });
                      const listed = (forwarded === null ? roster : roster.filter((w) => forwarded.includes(w.rowNo) || done.has(w.rowNo) || mine.has(w.rowNo)))
                        .sort((a, b) => (r.rework ? +!sentBack.includes(a.rowNo) - +!sentBack.includes(b.rowNo) : 0));
                      const notYet = roster.length - listed.length;
                      const left = listed.filter((w) => !done.has(w.rowNo) && !elsewhere.has(w.rowNo));
                      return (
                        <fieldset className="space-y-2 rounded-md bg-slate-50 p-3">
                          <legend className="sr-only">Wearers finished on row {i + 1}</legend>
                          <div className="flex flex-wrap items-center gap-2">
                            {r.rework ? <span className="rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900">Who needs rework{part ? ` · ${part} part` : ''}</span>
                              : <span className="text-sm font-medium">Wearers finished{part ? ` · ${part} part` : ''}</span>}
                            <span className="text-xs text-slate-500">
                              {r.rework ? `${listed.length} done on this step${sentBack.length ? `, ${sentBack.length} sent back for rework` : ''} · tick the ones this worker redid`
                                : `${done.size} of ${roster.length} done on this step${part ? ` (${part} part)` : ''} · tick the ones this worker finished`}
                              {!r.rework && notYet > 0 && ` · ${notYet} not yet forwarded from the step before`}
                            </span>
                            <span className="flex-1" />
                            {left.length > 0 && <Button onClick={() => tick(new Set([...mine, ...left.map((w) => w.rowNo)]))}>Tick all left ({left.length})</Button>}
                          </div>
                          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                            {listed.map((w) => {
                              const isDone = done.has(w.rowNo);
                              const otherRow = elsewhere.get(w.rowNo);
                              return (
                                <li key={w.rowNo}>
                                  <label className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${isDone || otherRow ? 'text-slate-400' : 'hover:bg-white'}`}>
                                    <input type="checkbox" aria-label={`Row ${i + 1} wearer ${w.wearerName}`} disabled={isDone || !!otherRow} checked={isDone || mine.has(w.rowNo)}
                                      onChange={(e) => { const next = new Set(mine); if (e.target.checked) next.add(w.rowNo); else next.delete(w.rowNo); tick(next); }} />
                                    <span className="min-w-0 flex-1 truncate">{w.wearerName}<span className="text-slate-500">{w.size ? ` · ${w.size}` : w.sizeMode === 'measured' ? ' · measured' : ''}{w.jerseyNumber ? ` · #${w.jerseyNumber}` : ''}{w.qty > 1 ? ` · ${w.qty} pcs` : ''}</span></span>
                                    {line?.isSet ? partsDone(w.rowNo).map((p) => <span key={p} className="rounded bg-emerald-100 px-1 text-xs text-emerald-800">{p === 'upper' ? 'Upper' : 'Lower'} ✓</span>)
                                      : isDone && <span className="text-xs">done</span>}
                                    {r.rework && sentBack.includes(w.rowNo) && <span className="rounded bg-amber-100 px-1 text-xs text-amber-900">sent back</span>}
                                    {otherRow && <span className="text-xs">row {otherRow}</span>}
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </fieldset>
                      );
                    })()}
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(6rem,1fr)]">
                      <Field label="Worker">
                        <select aria-label={`Row ${i + 1} worker`} className={cell} value={r.employeeId} onChange={(e) => set(i, { employeeId: e.target.value })}>
                          <option value="" />
                          {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Pieces" hint={[(r.wearers?.length ?? 0) > 0 ? 'From the wearers ticked' : '', (() => { const cap = r.lineNo ? capOf(r.lineNo, r.part, r.rework) : null; return cap === null ? '' : r.rework ? `${cap} done here` : `${cap} ready`; })()].filter(Boolean).join(' · ') || undefined}><input aria-label={`Row ${i + 1} pieces`} inputMode="numeric" readOnly={(r.wearers?.length ?? 0) > 0} className={`${cell} text-right tabular-nums`} value={r.pieces} onChange={(e) => set(i, { pieces: e.target.value })} /></Field>
                    </div>
                    {askRepeat && (
                      <Field label="This matches a sheet already recorded. Why is it a different sheet? (at least 5 characters)" hint="If the pieces were redone, tick Rework (pasubra) instead.">
                        <input aria-label={`Row ${i + 1} repeat reason`} className={cell} value={r.repeatReason ?? ''} onChange={(e) => set(i, { repeatReason: e.target.value })} />
                      </Field>
                    )}
                    {r.rework && <p className="text-xs text-slate-600">Rework does not add to the pieces done on this step.</p>}
                  </section>
                );
              })}
            </div>
            <Button onClick={() => setRows([...rows, emptyRow(rows.at(-1)?.lineNo ?? '')])}>+ Another worker</Button>
          </Panel>
        )}
        <Errors list={errors} show={touched} />
      </div>
      <Panel title="So far">
        <p className="text-2xl font-semibold tabular-nums">{typed.rows.reduce((s, r) => s + (Number.isInteger(r.pieces) ? r.pieces : 0), 0)} pcs</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog hideTotal type={type} preview={confirm} original={original} reason={editReason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
