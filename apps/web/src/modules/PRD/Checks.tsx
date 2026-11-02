/**
 * Check scanned work (the owner's request, Nov 2026): what workers recorded on the floor app waits here for the
 * production head (prd.verify). Approve records it as a Production Entry dated the day of the scan, with the pieces
 * counted (the scanned number unless changed); Reject records nothing and the worker sees the reason. A scan the rules
 * of Record pieces now stop (the line is full, a wearer done since) says why.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PrdChecks } from '../../api.ts';
import { Button, Loading, Notice, SURFACE, inputClass, manilaTime, peso, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { useLiveReload } from '../../live.ts';

type Waiting = PrdChecks['waiting'][number];

export function CheckScannedWork({ me: _me }: { me: Me }) {
  const [data, setData] = useState<PrdChecks | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const load = useCallback(() => api.prdChecks().then((d) => (setData(d), setError('')), (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);
  useLiveReload(load, () => !busy);
  const clean = data?.waiting.filter((w) => w.problems.length === 0 && !w.jobOrderCancelled) ?? [];
  const approveAll = async () => {
    setBusy(true); setSaid(''); setError('');
    let ok = 0;
    const failed: string[] = [];
    for (const w of clean) await api.prdApproveScan(w.id).then(() => ok++, (e: Error) => failed.push(`${w.employeeName}, ${w.jobOrderNumber}: ${e.message}`));
    setSaid(`${ok} approved.`);
    if (failed.length) setError(failed.join(' '));
    setBusy(false);
    await load();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">What workers recorded on the floor app. It counts on the job and in their pay only once you approve it.</p>
      {error && <Notice>{error}</Notice>}
      {said && <Notice tone="success">{said}</Notice>}
      {!data ? <Loading /> : data.waiting.length === 0 ? <p className={`${SURFACE} p-5 text-sm text-slate-600`}>Nothing waiting. New scans show here by themselves.</p> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold">{data.waiting.length} waiting for your check</h2>
            {clean.length > 1 && <Button tone="primary" disabled={busy} onClick={() => void approveAll()}>Approve all {clean.length} as scanned</Button>}
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.waiting.map((w) => <ScanCard key={w.id} scan={w} disabled={busy} onDone={(m) => { setSaid(m); void load(); }} />)}
          </ul>
        </>
      )}
      {data && data.checked.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">Checked lately</h2>
          <div className={`overflow-x-auto ${SURFACE}`}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="p-3">Worker</th><th className="p-3">Job order · step</th><th className="p-3 text-right">Pieces</th><th className="p-3">Checked</th><th className="p-3">Result</th></tr></thead>
              <tbody>{data.checked.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="p-3">{c.employeeName}</td>
                  <td className="p-3">{c.jobOrderNumber} · {c.stepName}{c.part ? ` (${c.part})` : ''}<span className="block text-xs text-slate-500">{c.description}</span></td>
                  <td className="p-3 text-right tabular-nums">{c.checkedPieces ? <>{c.checkedPieces} <span className="text-xs text-slate-500">of {c.pieces}</span></> : c.pieces}</td>
                  <td className="p-3 whitespace-nowrap">{c.checkedAt ? manilaTime(c.checkedAt) : ''}<span className="block text-xs text-slate-500">{c.checkedBy}</span></td>
                  <td className="p-3">{c.status === 'approved'
                    ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Approved · {c.entryNumber}</span>
                    : <><span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Rejected</span><span className="block text-xs text-slate-600">{c.reason}</span></>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ScanCard({ scan: w, disabled, onDone }: { scan: Waiting; disabled: boolean; onDone: (message: string) => void }) {
  const [pieces, setPieces] = useState(String(w.pieces));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const counted = Number(pieces);
  const valid = Number.isInteger(counted) && counted >= 1;
  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setError('');
    await fn().then(onDone, (e: Error) => setError(e.message));
    setBusy(false);
  };
  const off = disabled || busy;
  return (
    <li className={`${SURFACE} space-y-3 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">{w.employeeName}</p>
          <p className="text-xs text-slate-500">Scanned {manilaTime(w.at)}{w.workDate !== w.at.slice(0, 10) ? ` · work of ${showDate(w.workDate)}` : ''}</p>
        </div>
        <p className="text-right"><span className="block text-2xl font-extrabold tabular-nums">{w.pieces}</span><span className="text-xs text-slate-500">pcs scanned{w.amountCents > 0 ? ` · ${peso(w.amountCents)}` : ''}</span></p>
      </div>
      <p className="text-sm">
        <Link to={`/docs/jo.job_order/${w.jobOrderId}`} className="font-semibold text-indigo-700 hover:underline">{w.jobOrderNumber}</Link> · {w.customerName}
        <span className="block text-slate-700">{w.stepName}{w.part ? ` (${w.part === 'upper' ? 'upper' : 'lower'})` : ''} · Item {w.lineNo}: {w.description}</span>
        {w.wearers.length > 0 && <span className="block text-xs text-slate-500">For {w.wearers.map((x) => x.name).join(', ')}</span>}
        {w.again && <span className="block text-xs text-amber-800">The worker said this is another batch of the same count today.</span>}
      </p>
      {w.jobOrderCancelled && <Notice>The job order was edited after this scan. Reject it and ask the worker to scan the new job ticket.</Notice>}
      {w.problems.map((p) => <Notice key={p}>{p}</Notice>)}
      {error && <Notice>{error}</Notice>}
      {rejecting ? (
        <div className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor={`reject-${w.id}`}>Why? The worker sees this.</label>
          <input id={`reject-${w.id}`} autoFocus className={inputClass} value={reason} placeholder="Only 8 were sewn; scan again" onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button disabled={off} onClick={() => setRejecting(false)}>Go back</Button>
            <Button tone="danger" disabled={off || reason.trim().length < 3}
              onClick={() => void act(async () => (await api.prdRejectScan(w.id, reason.trim()), `Rejected ${w.employeeName}'s ${w.pieces} pcs.`))}>Reject</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="text-sm font-semibold">Pieces counted
            <input type="number" min={1} inputMode="numeric" aria-label={`Pieces counted for ${w.employeeName}`} className={`${inputClass.replace('w-full', 'w-28')} mt-1 block`} value={pieces} onChange={(e) => setPieces(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button disabled={off} onClick={() => setRejecting(true)}>Reject…</Button>
            <Button tone="primary" disabled={off || !valid || w.jobOrderCancelled}
              onClick={() => void act(async () => { const r = await api.prdApproveScan(w.id, counted === w.pieces ? undefined : counted); return `Approved ${r.pieces} pcs for ${w.employeeName} (${r.number}).`; })}>
              Approve{valid && counted !== w.pieces ? ` ${counted}` : ''}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** On the production board, for whoever checks: how many scans wait (none: nothing shown). */
export function ScansWaitingNote() {
  const [waiting, setWaiting] = useState(0);
  const load = useCallback(() => api.prdChecksCount().then((r) => setWaiting(r.waiting), () => setWaiting(0)), []);
  useEffect(() => void load(), [load]);
  useLiveReload(load);
  if (!waiting) return null;
  return <Notice tone="warning">{waiting} {waiting === 1 ? 'scan' : 'scans'} from the floor app {waiting === 1 ? 'waits' : 'wait'} for your check. <Link to="/prd/checks" className="font-semibold underline">Check scanned work</Link></Notice>;
}
