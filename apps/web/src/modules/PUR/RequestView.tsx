/**
 * What the generic view cannot show of a purchase request (the owner's request, 26 Oct 2026): where it stands on the
 * purchase's way (asked → approved → ordered or paid), its things to buy with the estimate, the decision with who made it
 * and why, Approve and Reject for the owner or the accountant, and once approved "Make the purchase order" or "Record
 * as an expense".
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
import { Facts, Journey, RequestBadge, type Step } from './parts.tsx';

const action = 'inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700';
const secondary = 'inline-block rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const num = 'py-2 text-right tabular-nums';
const head = 'border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500';

/** The request's way: asked, the decision, then the order or the expense that used it. */
function requestSteps(r: PurchaseRequestStatus): Step[] {
  const decided = r.decision ? `${r.decision.userName}, ${showDate(r.decision.at.slice(0, 10))}` : undefined;
  return [
    { label: 'Asked', state: 'done', note: r.requestedByName },
    r.state === 'rejected'
      ? { label: 'Not approved', state: 'now', note: decided }
      : { label: r.decision ? 'Approved' : 'Approve it', state: r.decision ? 'done' : 'now', note: decided ?? 'By the owner or the accountant' },
    { label: r.usedBy ? (r.usedBy.docType === 'pur.po' ? 'Ordered' : 'Paid') : 'Order or pay', state: r.usedBy ? 'done' : r.state === 'approved' ? 'now' : 'later',
      note: r.usedBy?.number ?? 'A purchase order, or an expense paid on the spot' },
  ];
}

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
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true); setError('');
    try { setR({ ...(await api.purDecide(r.id, decision, note.trim() || undefined)), mayDecide: false }); setNote(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 pt-1">
      <Facts items={[
        ['Where it stands', <RequestBadge state={r.state} />],
        ['Asked by', r.requestedByName],
        ['Needed by', r.neededBy ? showDate(r.neededBy) : 'Not set'],
        ['Supplier', r.supplierId ? <Link to={`/pur/suppliers/${r.supplierId}`} className="text-indigo-700 underline">{r.supplierName}</Link> : 'Any'],
      ]} />
      {r.state !== 'cancelled' && <Journey steps={requestSteps(r)} label="Where this request is" />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className={head}><tr><th className="py-2">What</th><th className="text-right">Quantity</th><th className="text-right">Estimated cost of one</th><th className="text-right">Estimate</th></tr></thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.lineNo} className="border-b border-slate-100">
                <td className="py-2 font-medium">{l.description}{l.supplyName && l.supplyName !== l.description ? <span className="font-normal text-slate-500"> ({l.supplyName})</span> : ''}
                  {!l.supplyId && <span className="block text-xs font-normal text-slate-500">Not on file: add it as a supply before it is ordered</span>}</td>
                <td className={num}>{l.unit ? qtyWords(l.qty, l.unit) : l.qty}</td>
                <td className={num}>{formatPesos(l.unitCostCents)}</td>
                <td className={num}>{formatPesos(l.qty * l.unitCostCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="py-2 font-semibold" colSpan={3}>About, in all</td><td className={`${num} font-semibold`}>{formatPesos(r.totalCents)}</td></tr></tfoot>
        </table>
      </div>
      {r.note && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="font-medium">Note:</span> {r.note}</p>}
      {r.decision && (
        <p className={`rounded-lg p-3 text-sm ${r.decision.decision === 'approved' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
          <span className="font-semibold">{r.decision.decision === 'approved' ? 'Approved' : 'Not approved'}</span> by {r.decision.userName} on {showDate(r.decision.at.slice(0, 10))}{r.decision.note ? `: ${r.decision.note}` : '.'}
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      {r.mayDecide && (
        <div className="space-y-3 rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">Your decision</p>
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
      {r.state === 'approved' && (may['pur.po'] || may['exp.voucher']) && (
        <div className="flex flex-wrap gap-2">
          {may['pur.po'] && <Link to={docPath('pur.po', `/new?request=${r.id}`)} className={action}>Make the purchase order</Link>}
          {may['exp.voucher'] && <Link to={docPath('exp.voucher', `/new?request=${r.id}`)} className={secondary}>Record as an expense (paid on the spot)</Link>}
        </div>
      )}
      {r.usedBy && <p className="text-sm">{r.usedBy.docType === 'pur.po' ? 'Ordered on' : 'Paid on'} <Link to={docPath(r.usedBy.docType, `/${r.usedBy.id}`)} className="text-indigo-700 underline">{r.usedBy.number}</Link>.</p>}
    </div>
  );
}

export const purchaseRequestView: ViewParts = { extra: (d) => <RequestDetail id={d.header.id} />, totalLabel: 'Estimate' };
