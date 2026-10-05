/**
 * Fixed assets (PLAN E10, H2): the register with class, date bought, cost, accumulated depreciation, book value and
 * status; and one asset's page with its depreciation month by month from the recorded runs, its documents and the
 * buttons for the depreciation run and a disposal. A month before this one with no run shows a warning. Figures come
 * from the ledger and the documents on the server (NR-2); this screen posts only through the two dialogs.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type AssetPage as AssetData, type AssetRow, type AssetStatus, type DepreciationGaps, type DocTypeInfo } from '../../api.ts';
import { Button, Notice, Panel, StatusChip, inputClass, peso, searchClass, searchRowClass } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { monthLabel } from '../TAX/bir.ts';
import { DepreciationRun, DisposeAsset } from './Actions.tsx';
import { STATUSES, STATUS_WORDS, canDispose, filterAssets, gapWarning, monthRows, onTheBooks } from './register.ts';
import { Crumb } from '../../shell/crumbs.tsx';

const num = 'py-1 text-right tabular-nums';
const link = 'rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const chip = (s: AssetStatus) => `rounded-full px-2 py-0.5 text-xs font-medium ${s === 'in service' ? 'bg-emerald-100 text-emerald-800' : s === 'fully depreciated' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`;
const mayPost = (docTypes: DocTypeInfo[], key: string) => docTypes.some((d) => d.key === key && d.canPost);

/** The warning, and the depreciation run button that goes with it. */
function GapWarning({ gaps }: { gaps: DepreciationGaps }) {
  const text = gapWarning(gaps.months);
  return text ? <Notice tone="warning">{text}</Notice> : null;
}

export function Assets({ docTypes }: { docTypes: DocTypeInfo[] }) {
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [gaps, setGaps] = useState<DepreciationGaps | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AssetStatus | 'all'>('all');
  const [running, setRunning] = useState(false);
  const load = useCallback(() => void Promise.all([api.assets(), api.depreciationGaps()]).then(([r, g]) => (setRows(r), setGaps(g), setError('')), (e: Error) => setError(e.message)), []);
  useEffect(load, [load]);
  if (error) return <Notice>{error}</Notice>;
  if (!rows || !gaps) return <p className="text-slate-500">Loading…</p>;
  const shown = filterAssets(rows, search, status);
  const t = onTheBooks(rows);
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">Fixed assets</h1>
        {mayPost(docTypes, 'fa.depreciation') && <Button tone="primary" onClick={() => setRunning(true)}>Run depreciation</Button>}
        {mayPost(docTypes, 'fa.buy') && <Link to={docPath('fa.buy', '/new')} className={link}>Record a purchase</Link>}
      </div>
      <GapWarning gaps={gaps} />
      <p className="text-sm">On the books: <b>{t.count}</b> asset{t.count === 1 ? '' : 's'} · cost <b className="tabular-nums">{peso(t.costCents)}</b> · accumulated depreciation <b className="tabular-nums">{peso(t.accumulatedCents)}</b> · book value <b className="tabular-nums">{peso(t.bookValueCents)}</b></p>
      <div className={searchRowClass}>
        <input aria-label="Search assets" placeholder="Search number, description or class" className={`${inputClass} ${searchClass}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Status" className={`${inputClass} max-w-48`} value={status} onChange={(e) => setStatus(e.target.value as AssetStatus | 'all')}>
          <option value="all">Every status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
        </select>
      </div>
      {shown.length === 0 ? <p className="text-slate-500">{rows.length === 0 ? 'No fixed asset is recorded yet.' : 'No asset matches.'}</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Asset</th><th>Class</th><th>Bought</th><th className="text-right">Cost</th><th className="text-right">Accumulated depreciation</th><th className="text-right">Book value</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className={`border-t border-slate-100 ${a.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="py-1"><Link to={`/fa/assets/${a.id}`} className="underline">{a.number}</Link> {a.description}</td>
                <td className="py-1">{a.className}</td><td className="py-1">{a.acquiredOn}</td>
                <td className={num}>{peso(a.costCents ?? 0)}</td><td className={num}>{peso(a.accumulatedCents ?? 0)}</td><td className={num}>{peso(a.bookValueCents ?? 0)}</td>
                <td className="py-1"><span className={chip(a.status)}>{STATUS_WORDS[a.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {running && <DepreciationRun gaps={gaps} onClose={() => setRunning(false)} onDone={() => (setRunning(false), load())} />}
    </div>
  );
}

export function AssetPage({ docTypes, params }: { docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [a, setA] = useState<AssetData | null>(null);
  const [gaps, setGaps] = useState<DepreciationGaps | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'run' | 'dispose' | null>(null);
  const load = useCallback(() => void Promise.all([api.asset(id), api.depreciationGaps()]).then(([x, g]) => (setA(x), setGaps(g), setError('')), (e: Error) => setError(e.message)), [id]);
  useEffect(load, [load]);
  if (error) return <Notice>{error}</Notice>;
  if (!a || !gaps) return <p className="text-slate-500">Loading…</p>;
  const months = monthRows(a);
  const done = () => (setDialog(null), load());
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Crumb label={a.number} /><h1 className="text-2xl font-semibold">{a.number} {a.description}</h1>
        <span className={chip(a.status)}>{STATUS_WORDS[a.status]}</span>
        <span className="flex-1" />
        <Link to="/fa/assets" className="text-sm underline">All fixed assets</Link>
      </div>
      {a.missingMonths.length > 0 && <Notice tone="warning">{gapWarning(a.missingMonths)}</Notice>}
      <div className="flex flex-wrap gap-2">
        {canDispose(a) && mayPost(docTypes, 'fa.depreciation') && <Button tone="primary" onClick={() => setDialog('run')}>Run depreciation</Button>}
        {canDispose(a) && mayPost(docTypes, 'fa.disposal') && <Button onClick={() => setDialog('dispose')}>Dispose of this asset</Button>}
      </div>
      <Panel title="Details">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <dt className="text-slate-500">Class</dt><dd>{a.className}</dd>
          <dt className="text-slate-500">Bought</dt><dd>{a.acquiredOn}</dd>
          <dt className="text-slate-500">Where it is</dt><dd>{a.location ?? '—'}</dd>
          <dt className="text-slate-500">Cost</dt><dd className="tabular-nums">{peso(a.costCents)}</dd>
          <dt className="text-slate-500">Value at the end of its life</dt><dd className="tabular-nums">{peso(a.residualCents)}</dd>
          <dt className="text-slate-500">Life</dt><dd>{a.lifeMonths} months · {peso(a.monthlyChargeCents)} a month</dd>
          <dt className="text-slate-500">Accumulated depreciation</dt><dd className="tabular-nums">{peso(a.accumulatedCents)}</dd>
          <dt className="text-slate-500">Book value</dt><dd className="font-semibold tabular-nums">{peso(a.bookValueCents)}</dd>
        </dl>
      </Panel>
      <Panel title="Depreciation, month by month">
        {months.length === 0 ? <p className="text-sm text-slate-500">No depreciation has been recorded for this asset yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Month</th><th>Run</th><th className="text-right">Charged</th><th className="text-right">Accumulated after</th></tr></thead>
            <tbody>
              {months.map((m) => m.run ? (
                <tr key={m.month} className="border-t border-slate-100">
                  <td className="py-1">{monthLabel(m.month)}</td>
                  <td className="py-1"><Link to={docPath('fa.depreciation', `/${m.run.documentId}`)} className="underline">{m.run.documentNumber}</Link></td>
                  <td className={num}>{peso(m.run.chargeCents)}</td><td className={num}>{peso(m.run.accumulatedCents)}</td>
                </tr>
              ) : (
                <tr key={m.month} className="border-t border-slate-100 border-l-4 border-l-amber-500 bg-amber-50">
                  <td className="py-1 pl-2">{monthLabel(m.month)}</td><td className="py-1 text-amber-900" colSpan={3}>No depreciation run</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Documents">
        <table className="w-full text-sm">
          <tbody>
            {a.documents.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="py-1"><Link to={docPath(d.docType, `/${d.id}`)} className="underline">{d.number}</Link></td>
                <td className="py-1 text-slate-600">{DOC_WORDS[d.docType] ?? d.docType}</td><td className="py-1">{d.date}</td><td className="py-1">{d.status !== 'posted' && <StatusChip status={d.status} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {dialog === 'run' && <DepreciationRun gaps={gaps} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'dispose' && <DisposeAsset assetId={a.id} label={`${a.number} ${a.description}`} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

const DOC_WORDS: Record<string, string> = { 'fa.buy': 'Purchase', 'fa.opening': 'Opening asset', 'fa.depreciation': 'Depreciation run', 'fa.disposal': 'Disposal' };
