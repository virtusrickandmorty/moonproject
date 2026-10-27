/**
 * A job order's production summary (the owner's request, Oct 2026): every item, every step in its order, who made the
 * pieces (which part of a set, rework or not), the wearers ticked, the entry and its date, and whether it is paid. The
 * owner and the accountant (prd.reassign) can move a row to another worker while its entry is not paid.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type PrdSummary } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Dialog, Field, Loading, Notice, inputClass, showDate, useAction } from '../../components/ui.tsx';
import { docPath } from '../../shell/menu.ts';
import { useLiveReload } from '../../live.ts';
import { SearchSelect } from '../../components/SearchSelect.tsx';

const STATUS_WORDS: Record<string, string> = { completed: 'Done', in_progress: 'In progress', pending: 'Not started', not_needed: 'Not needed' };
const PART_WORDS: Record<string, string> = { upper: 'Upper', lower: 'Lower', whole: '' };

export function JobSummaryDialog({ jobOrderId, canReassign, onClose }: { jobOrderId: string; canReassign: boolean; onClose: () => void }) {
  const [data, setData] = useState<PrdSummary | null>(null);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState<{ entryId: string; rowNo: number; from: string } | null>(null);
  const load = useCallback(() => api.prdSummary(jobOrderId).then((d) => (setData(d), setError('')), (e: Error) => setError(e.message)), [jobOrderId]);
  useEffect(() => void load(), [load]);
  useLiveReload(load);
  const title = data ? `Production summary · ${data.jobOrder.number}` : 'Production summary';
  return (
    <Dialog wide title={title} onClose={onClose}>
      {error && <Notice>{error}</Notice>}
      {!data ? <Loading /> : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">
            {data.jobOrder.customerName} · due {showDate(data.jobOrder.dueDate)} ·{' '}
            {data.allDone ? <b className="text-emerald-700">Every step of every item is done</b> : <b className="text-amber-700">Still in production</b>}
          </p>
          {data.lines.map((l) => (
            <section key={l.lineNo} className="space-y-2 rounded-xl p-3 ring-1 ring-slate-200">
              <h3 className="flex flex-wrap items-baseline gap-2 font-semibold">
                <span>Item {l.lineNo}: {l.description}</span>
                <span className="text-sm font-normal text-slate-500">{l.qty} {l.isSet ? 'sets' : 'pcs'}</span>
                {l.done && <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">All steps done</span>}
              </h3>
              {l.steps.length === 0 && <p className="text-sm text-slate-500">No production steps chosen yet.</p>}
              {l.steps.map((s) => (
                <div key={s.stepId} className="space-y-1">
                  <p className="text-sm"><b>{s.name}</b> <span className="text-slate-500">· {STATUS_WORDS[s.status] ?? s.status}</span></p>
                  {s.rows.length === 0 ? <p className="pl-3 text-xs text-slate-400">Nothing recorded.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-slate-500"><th>Date</th><th>Worker</th><th className="text-right">Pieces</th><th>Wearers</th><th>Entry</th><th /></tr></thead>
                        <tbody>{s.rows.map((r) => (
                          <tr key={r.assignmentId} className="border-t border-slate-100 align-top">
                            <td className="whitespace-nowrap py-1 pr-2">{showDate(r.workDate)}</td>
                            <td className="py-1 pr-2 font-medium">{r.employeeName}</td>
                            <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{r.pieces}{PART_WORDS[r.part] ? ` ${PART_WORDS[r.part]}` : ''}{r.kind === 'rework' ? ' · rework' : r.kind === 'correction' ? ' · correction' : ''}</td>
                            <td className="py-1 pr-2 text-xs text-slate-600">{r.wearers.length ? r.wearers.join(', ') : '—'}</td>
                            <td className="whitespace-nowrap py-1 pr-2"><Link to={docPath('prd.entry', `/${r.entryId}`)} className="text-indigo-700 hover:underline">{r.entryNumber}</Link>{r.paid && <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-600">paid</span>}</td>
                            <td className="whitespace-nowrap py-1 text-right">
                              {canReassign && !r.paid && !r.carried && r.kind !== 'correction' && (
                                <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setMoving({ entryId: r.entryId, rowNo: r.rowNo, from: r.employeeName })}>Change worker</button>
                              )}
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
          {canReassign && <p className="text-xs text-slate-500">Change worker edits that production entry (the old one is kept, cancelled). A row already paid in a payroll run cannot be moved here: correct it in the next payroll run.</p>}
        </div>
      )}
      {moving && <ChangeWorker {...moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); void load(); }} />}
    </Dialog>
  );
}

function ChangeWorker({ entryId, rowNo, from, onClose, onDone }: { entryId: string; rowNo: number; from: string; onClose: () => void; onDone: () => void }) {
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const a = useAction();
  useEffect(() => void api.prdWorkers().then((list) => setWorkers(list.filter((x) => x.name !== from))), [from]);
  return (
    <Dialog title={`Change the worker: ${from}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Made by" required>
          <SearchSelect aria-label="Worker who made these pieces" value={to} onChange={setTo} placeholder="Pick the worker who made these pieces" choices={workers.map((x) => ({ value: x.id, label: x.name }))} />
        </Field>
        <Field label="Reason" required hint="At least 10 characters, kept with the change"><input className={inputClass} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded under the wrong sewer" /></Field>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Back</Button>
          <Button tone="primary" disabled={a.busy || !to || reason.trim().length < 10} onClick={() => void a.run(async () => { await api.prdReassign(entryId, { rowNo, employeeId: to, reason: reason.trim() }); onDone(); })}>Change worker</Button>
        </div>
      </div>
    </Dialog>
  );
}
