/**
 * What the generic view cannot show of a purchase request (the owner's request, 26 Oct 2026): where it stands (waiting,
 * approved, not approved, used, cancelled), its things to buy, the decision with who made it and why, Approve and Reject
 * for the owner or the accountant, and once approved "Make the purchase order" or "Record as an expense".
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type PurchaseRequestStatus } from '../../api.ts';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Button, Field, Loading, Notice, inputClass, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { useLiveReload } from '../../live.ts';
import { qtyWords } from './purchasing.ts';

const STATE: Record<PurchaseRequestStatus['state'], [string, string]> = {
  waiting: ['Waiting for approval', 'bg-amber-100 text-amber-800'],
  approved: ['Approved', 'bg-emerald-100 text-emerald-800'],
  rejected: ['Not approved', 'bg-red-100 text-red-800'],
  used: ['Ordered or paid', 'bg-slate-100 text-slate-700'],
  cancelled: ['Cancelled', 'bg-slate-100 text-slate-500'],
};
const action = 'inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700';
const num = 'py-1 text-right tabular-nums';

function RequestDetail({ id }: { id: string }) {
  const [r, setR] = useState<PurchaseRequestStatus | null>(null);
  const [may, setMay] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.purRequest(id).then(setR, (e: Error) => setError(e.message));
  useEffect(() => { void load(); void api.docTypes().then((t) => setMay(Object.fromEntries(t.map((d) => [d.key, !!d.canPost]))), () => undefined); }, [id]);
  useLiveReload(load);
  if (!r) return error ? <Notice>{error}</Notice> : <Loading />;
  const [label, tone] = STATE[r.state];
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true); setError('');
    try { setR({ ...(await api.purDecide(r.id, decision, note.trim() || undefined)), mayDecide: false }); setNote(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
        Asked by <b>{r.requestedByName}</b>
        {r.neededBy && <span className="text-slate-500">· needed by {showDate(r.neededBy)}</span>}
        {r.supplierName && <span className="text-slate-500">· from {r.supplierName}</span>}
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th>What</th><th className="text-right">Quantity</th><th className="text-right">Estimated cost of one</th><th className="text-right">Estimate</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.lineNo} className="border-t border-slate-100">
              <td className="py-1">{l.description}{l.supplyName && l.supplyName !== l.description ? <span className="text-slate-500"> ({l.supplyName})</span> : ''}</td>
              <td className={num}>{l.unit ? qtyWords(l.qty, l.unit) : l.qty}</td>
              <td className={num}>{formatPesos(l.unitCostCents)}</td>
              <td className={num}>{formatPesos(l.qty * l.unitCostCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.note && <p className="text-sm text-slate-600">Note: {r.note}</p>}
      {r.decision && (
        <p className={`text-sm ${r.decision.decision === 'approved' ? 'text-emerald-800' : 'text-red-800'}`}>
          {r.decision.decision === 'approved' ? 'Approved' : 'Not approved'} by {r.decision.userName} on {showDate(r.decision.at.slice(0, 10))}{r.decision.note ? `: ${r.decision.note}` : '.'}
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      {r.mayDecide && (
        <div className="space-y-2 rounded-md bg-amber-50 p-3">
          <Field label="Note for the person who asked" hint="Needed when it is not approved; optional when it is">
            <input className={inputClass} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" disabled={busy} onClick={() => void decide('approved')}>Approve</Button>
            <Button tone="danger" disabled={busy || !note.trim()} onClick={() => void decide('rejected')}>Do not approve</Button>
          </div>
        </div>
      )}
      {r.state === 'waiting' && !r.mayDecide && <p className="text-sm text-slate-500">The owner or the accountant approves it. It cannot be ordered or paid until then.</p>}
      {r.state === 'approved' && (
        <div className="flex flex-wrap gap-2">
          {may['pur.po'] && <Link to={docPath('pur.po', `/new?request=${r.id}`)} className={action}>Make the purchase order</Link>}
          {may['exp.voucher'] && <Link to={docPath('exp.voucher', `/new?request=${r.id}`)} className="inline-block rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">Record as an expense (paid on the spot)</Link>}
        </div>
      )}
      {r.usedBy && <p className="text-sm">{r.usedBy.docType === 'pur.po' ? 'Ordered on' : 'Paid on'} <Link to={docPath(r.usedBy.docType, `/${r.usedBy.id}`)} className="text-indigo-700 underline">{r.usedBy.number}</Link>.</p>}
    </>
  );
}

export const purchaseRequestView: ViewParts = { extra: (d) => <RequestDetail id={d.header.id} /> };
