/**
 * Payroll release form (PLAN D5 PAY-REL): pick a recorded run with net pay still to release, tick who is paid now (all by
 * default), and say where the money came from, split across cash places if needed. Each person's pay is released once.
 * Or one at a time (the owner's request, Oct 2026): each person released on their own, from a window with their payslip,
 * their QR code and where the money came from (split if needed), staying on the form for the next person.
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, newIdempotencyKey, type CashPlace, type DocTypeInfo, type Payslips, type Preview, type ReleaseRow, type RunToRelease } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Button, Dialog, Loading, Notice, Panel, peso, showDate, useAction } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { emptyTender, sum, tendersToInput, type TenderRow } from '../COL/money.ts';
import { Errors, TenderRows, useLive } from '../COL/parts.tsx';
import { GROUP_LABEL } from './run.ts';
import { PayslipCard } from './views.tsx';

/** "Paid by" on the employee record; cash has no account, so its QR is a bank or GCash one. */
const PAID_BY = { cash: 'bank or GCash', bank: 'Bank', gcash: 'GCash' } as const;

function QrIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h3v-3" strokeLinecap="round" />
    </svg>
  );
}

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
  const [qrOf, setQrOf] = useState<ReleaseRow | null>(null);
  const [oneByOne, setOneByOne] = useState(false);
  const [single, setSingle] = useState<ReleaseRow | null>(null);
  const [released, setReleased] = useState('');
  const fail = (e: Error) => setError(e.message);

  useEffect(() => {
    api.runsToRelease().then(setRuns, fail);
    api.cashPlaces().then(setPlaces, fail);
  }, []);
  const loadRows = (id: string) => api.releaseStatus(id).then((r) => (setRows(r), setPicked(new Set(r.filter((x) => !x.releasedBy && x.netCents > 0).map((x) => x.employeeId)))), fail);
  useEffect(() => {
    setRows([]);
    setReleased('');
    if (runId) void loadRows(runId);
  }, [runId]);
  const run = runs?.find((r) => r.id === runId);
  /** One person released from the window: say so, and show who is left (the run leaves the list once everyone is paid). */
  const releasedOne = (number: string, name: string) => {
    setSingle(null);
    setReleased(`${number} recorded: ${name}'s pay is released.`);
    void loadRows(runId);
    api.runsToRelease().then(setRuns, fail);
  };

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
          {runs?.length === 0 && <p className="text-sm text-slate-500">Every recorded payroll and 13th-month pay is released.</p>}
          <div role="radiogroup" aria-label="Which payroll?" className="space-y-2">
            {runs?.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={runId === r.id} onClick={() => setRunId(r.id)}
                className={`flex w-full justify-between rounded-lg p-3 text-left text-sm ring-1 ${runId === r.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
                <span>{r.number} · {GROUP_LABEL[r.payGroup]} · {r.kind === 'thirteenth' ? `13th month ${r.periodStart.slice(0, 4)}` : `${showDate(r.periodStart)} to ${showDate(r.periodEnd)}`}</span><span className="tabular-nums">{formatPesos(r.dueCents)} to release</span>
              </button>
            ))}
          </div>
        </Panel>
        {rows.length > 0 && (
          <Panel title="Who is paid now?">
            <div role="radiogroup" aria-label="Release" className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
              {([[false, 'Together'], [true, 'One at a time']] as const).map(([one, label]) => (
                <button key={label} type="button" role="radio" aria-checked={oneByOne === one} onClick={() => setOneByOne(one)}
                  className={`rounded-md px-3 py-1.5 font-medium ${oneByOne === one ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{label}</button>
              ))}
            </div>
            {oneByOne && <p className="mb-2 text-xs text-slate-500">Each person is released on their own: their payslip, their QR code and where the money came from, split if needed.</p>}
            {released && <Notice tone="success">{released}</Notice>}
            {oneByOne && rows.map((r) => (
              <div key={r.employeeId} className={`flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0 ${r.releasedBy || r.netCents <= 0 ? 'text-slate-400' : ''}`}>
                <span className="min-w-0">{r.name}{r.releasedBy ? ` (released by ${r.releasedBy})` : r.netCents <= 0 ? ' (no net pay)' : ''}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums">{peso(r.netCents)}</span>
                  {!r.releasedBy && r.netCents > 0 && <Button disabled={!type.canPost} onClick={() => (setReleased(''), setSingle(r))}>Release</Button>}
                </span>
              </div>
            ))}
            {!oneByOne && rows.map((r) => (
              <div key={r.employeeId} className={`flex items-center justify-between gap-2 text-sm ${r.releasedBy || r.netCents <= 0 ? 'text-slate-400' : ''}`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <label><input type="checkbox" disabled={!!r.releasedBy || r.netCents <= 0} checked={picked.has(r.employeeId)} onChange={() => toggle(r.employeeId)} /> {r.name}{r.releasedBy ? ` (released by ${r.releasedBy})` : ''}</label>
                  {/* Their bank or GCash QR code, to scan when sending the pay (the owner's request, Oct 2026). */}
                  {r.payoutQrVersion !== null && (
                    <button type="button" onClick={() => setQrOf(r)} aria-label={`Show ${r.name}'s ${PAID_BY[r.payoutMethod]} QR code`} title={`${PAID_BY[r.payoutMethod]} QR code`}
                      className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800">
                      <QrIcon />
                    </button>
                  )}
                </span>
                <span className="tabular-nums">{peso(r.netCents)}</span>
              </div>
            ))}
          </Panel>
        )}
        {!oneByOne && <>
          <Panel title="Where did the money come from?">
            <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money come from?" amountHint={formatPesos(total)} />
          </Panel>
          <Errors list={errors} show={touched} />
        </>}
        <div className="flex gap-2">
          {!oneByOne && <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>}
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      {oneByOne ? (
        <Panel title="Still to release">
          <p className="text-2xl font-semibold tabular-nums">{peso(sum(rows.filter((r) => !r.releasedBy && r.netCents > 0).map((r) => r.netCents)))}</p>
          <p className="text-sm text-slate-600">{rows.filter((r) => !r.releasedBy && r.netCents > 0).length} of {rows.length} people</p>
        </Panel>
      ) : <Panel title="So far">
        <p className="text-2xl font-semibold tabular-nums">{peso(total)}</p>
        <p className="text-sm text-slate-600">{due.length} {due.length === 1 ? 'person' : 'people'}; paid out {peso(sum(pay.tenders.map((t) => t.amountCents)))}</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.message} tone={i.level}>{i.message}</Notice>)}
      </Panel>}
      {single && run && <ReleaseOne type={type} run={run} row={single} places={places} onReleased={releasedOne} onClose={() => setSingle(null)} />}
      {qrOf && qrOf.payoutQrVersion !== null && (
        <Dialog title={`${qrOf.name}: ${PAID_BY[qrOf.payoutMethod]} QR code`} onClose={() => setQrOf(null)}>
          <img src={api.releaseQrUrl(runId, qrOf.employeeId, qrOf.payoutQrVersion)} alt={`${qrOf.name}'s ${PAID_BY[qrOf.payoutMethod]} QR code`}
            className="mx-auto aspect-square w-full max-w-md rounded-lg bg-white object-contain p-2 ring-1 ring-slate-200" />
          <p className="text-center text-sm text-slate-600">
            {qrOf.payoutAccount ? `${qrOf.payoutAccount} · ` : ''}Net pay {peso(qrOf.netCents)}
          </p>
        </Dialog>
      )}
      {confirm && <RecordDialog type={type} preview={confirm} reason="" onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}

/**
 * Releasing one person's pay (the owner's request, Oct 2026): their payslip beside their QR code and where the money came
 * from, split across cash places if needed (part cash, part GCash). Records a release of that one person.
 */
function ReleaseOne({ type, run, row, places, onReleased, onClose }: {
  type: DocTypeInfo; run: RunToRelease; row: ReleaseRow; places: CashPlace[]; onReleased: (number: string, name: string) => void; onClose: () => void;
}) {
  const [slips, setSlips] = useState<Payslips | null>(null);
  const [slipError, setSlipError] = useState('');
  const [tenders, setTenders] = useState<TenderRow[]>([{ ...emptyTender(), amount: (row.netCents / 100).toFixed(2) }]);
  const [touched, setTouched] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const [bigQr, setBigQr] = useState(false);
  const a = useAction();
  useEffect(() => {
    if (run.kind === 'run') api.payslips(run.id).then(setSlips, (e: Error) => setSlipError(e.message));
  }, [run.id, run.kind]);
  const slip = slips?.employees.find((e) => e.employeeId === row.employeeId);
  const pay = tendersToInput(tenders, 'pick where the money came from');
  const paid = sum(pay.tenders.map((t) => t.amountCents));
  const input = { runId: run.id, employeeIds: [row.employeeId], tenders: pay.tenders };
  const live = useLive(JSON.stringify(input), pay.errors.length === 0, () => api.preview(type.key, input));
  const record = () => a.run(async () => {
    setTouched(true);
    if (pay.errors.length) return;
    const pre = await api.preview(type.key, input);
    const stop = pre.issues.find((i) => i.level === 'error');
    if (stop) throw new Error(stop.message);
    const r = await api.post(type.key, input, pre.totalCents, key);
    onReleased(r.number, row.name);
  });
  const qrName = { cash: 'bank or GCash', bank: 'Bank', gcash: 'GCash' }[row.payoutMethod];
  const qrSrc = row.payoutQrVersion !== null ? api.releaseQrUrl(run.id, row.employeeId, row.payoutQrVersion) : null;
  return (
    <>
    <Dialog wide title={`Release ${row.name}'s pay`} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {run.kind !== 'run' ? <p className="text-sm text-slate-600">{run.number}: 13th-month pay of {peso(row.netCents)} (no payslip for it).</p>
            : slip && slips ? <PayslipCard p={slips} e={slip} />
            : slipError ? <Notice tone="info">The payslip is not shown: {slipError}</Notice>
            : <Loading />}
        </div>
        <div className="space-y-3">
          <p className="text-sm">Net pay <span className="text-xl font-semibold tabular-nums">{peso(row.netCents)}</span></p>
          {qrSrc && (
            // Opens big in a window of its own (the owner's request, Oct 2026), easier to scan from a phone.
            <button type="button" onClick={() => setBigQr(true)} title="Open the QR code big"
              className="flex w-full cursor-zoom-in items-center gap-3 rounded-lg p-2 text-left ring-1 ring-slate-200 hover:bg-indigo-50/50 hover:ring-indigo-300">
              <img src={qrSrc} alt={`${row.name}'s ${qrName} QR code`} className="size-36 shrink-0 rounded bg-white object-contain" />
              <span className="text-sm text-slate-600">
                Scan to send by {qrName}{row.payoutAccount ? `: ${row.payoutAccount}` : ''}.
                <span className="mt-1 block font-medium text-indigo-700">Open it big</span>
              </span>
            </button>
          )}
          <h3 className="text-sm font-semibold">Where did the money come from?</h3>
          <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money come from?" amountHint={formatPesos(row.netCents)} />
          <p className="text-sm text-slate-600">Paid out {peso(paid)} of {peso(row.netCents)}{paid !== row.netCents && paid > 0 ? ` (${peso(row.netCents - paid)} ${paid < row.netCents ? 'short' : 'over'})` : ''}</p>
          <Errors list={pay.errors} show={touched} />
          {live?.issues.filter((i) => i.level === 'error').map((i) => <Notice key={i.code + i.message} tone={i.level}>{i.message}</Notice>)}
          {a.error && <Notice>{a.error}</Notice>}
          <div className="flex gap-2">
            <Button tone="primary" disabled={a.busy || !type.canPost} onClick={record}>{a.busy ? 'Recording…' : `Record ${row.name}'s release`}</Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </Dialog>
    {bigQr && qrSrc && (
      <Dialog title={`${row.name}: ${qrName} QR code`} onClose={() => setBigQr(false)}>
        <img src={qrSrc} alt={`${row.name}'s ${qrName} QR code`} className="mx-auto aspect-square w-full max-w-md rounded-lg bg-white object-contain p-2 ring-1 ring-slate-200" />
        <p className="text-center text-sm text-slate-600">{row.payoutAccount ? `${row.payoutAccount} · ` : ''}Net pay {peso(row.netCents)}</p>
      </Dialog>
    )}
    </>
  );
}
