/**
 * What the generic view cannot show of a purchase order (its supplier and lines by name, and what is still to receive)
 * and of a receiving report (the order it came for and what it received). Each shows where the purchase is on its way
 * (order → receive → bill → pay) with the button for its next step (the owner's request, 25 Oct 2026).
 */
import { useLiveReload } from '../../live.ts';
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type PoStatus, type RrDetail } from '../../api.ts';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Loading, Notice, SURFACE, showDate } from '../../components/ui.tsx';
import { HATCH } from '../../components/charts.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { qtyWords } from './purchasing.ts';

const num = 'py-1 text-right tabular-nums';

function PurchaseOrderDetail({ id }: { id: string }) {
  const [po, setPo] = useState<PoStatus | null>(null);
  const [canReceive, setCanReceive] = useState(false);
  const [may, setMay] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  useEffect(() => void api.purchaseOrder(id).then(setPo, (e: Error) => setError(e.message)), [id]);
  // Live (the owner's request, Oct 2026): a change on any computer shows here too.
  useLiveReload(() => api.purchaseOrder(id).then(setPo));
  useEffect(() => void api.docTypes().then((t) => {
    setCanReceive(Boolean(t.find((d) => d.key === 'pur.rr')?.canPost));
    setMay(Object.fromEntries(t.map((d) => [d.key, !!d.canPost])));
  }, () => undefined), []);
  if (error) return <Notice>{error}</Notice>;
  if (!po) return <Loading />;
  const open = po.status === 'posted' && po.lines.some((l) => l.remainingQty > 0);
  const deliveries = (po.deliveries ?? []).filter((r) => r.status === 'posted');
  const ordered = po.lines.reduce((n, l) => n + l.orderedQty, 0), received = po.lines.reduce((n, l) => n + Math.min(l.receivedQty, l.orderedQty), 0);
  const billed = deliveries.filter((r) => r.bill).length;
  const advanced = po.advancedCents ?? 0;
  const mayAdvance = open && advanced < po.totalCents && may['ap.advance'];
  return (
    <>
      <p className="text-sm">Ordered from <b>{po.supplierName}</b>{po.expectedDate ? `, expected ${showDate(po.expectedDate)}` : ''}.</p>
      {po.status === 'posted' && <Steps steps={[
        ['Ordered', 1],
        [received === 0 ? 'Nothing received yet' : received < ordered ? `Part received (${received} of ${ordered})` : 'All received', ordered > 0 ? received / ordered : 0],
        [deliveries.length === 0 ? 'No bill yet' : billed < deliveries.length ? `${billed} of ${deliveries.length} deliveries billed` : 'Billed', deliveries.length ? billed / deliveries.length : 0],
      ]} />}
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th>Supply</th><th className="text-right">Ordered</th><th className="text-right">Cost of one unit</th><th className="text-right">Line total</th><th className="text-right">Received</th><th className="text-right">Still to receive</th></tr></thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.lineNo} className="border-t border-slate-100">
              <td className="py-1">{l.supplyName}</td><td className={num}>{qtyWords(l.orderedQty, l.unit)}</td><td className={num}>{formatPesos(l.unitCostCents)}</td>
              <td className={num}>{formatPesos(l.orderedQty * l.unitCostCents)}</td><td className={num}>{l.receivedQty}</td>
              <td className={num}>{po.status === 'cancelled' ? '' : l.remainingQty === 0 ? 'All received' : qtyWords(l.remainingQty, l.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {deliveries.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Delivery</th><th>Received</th><th>Supplier’s bill</th></tr></thead>
          <tbody>
            {deliveries.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1"><Link to={docPath('pur.rr', `/${r.id}`)} className="text-indigo-700 underline">{r.number}</Link></td>
                <td>{showDate(r.date)}</td>
                <td>{r.bill ? <Link to={docPath('ap.bill', `/${r.bill.id}`)} className="text-indigo-700 underline">{r.bill.number}</Link>
                  : may['ap.bill'] ? <Link to={docPath('ap.bill', `/new?rr=${r.id}`)} className={secondary}>Record the bill</Link> : <span className="text-amber-700">No bill yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-2">
        {open && canReceive && <Link to={`${docPath('pur.rr', '/new')}?po=${po.id}`} className={action}>Receive goods for this order</Link>}
        {mayAdvance && <Link to={docPath('ap.advance', `/new?supplier=${po.supplierId}&po=${po.id}`)} className={secondary}>Pay an advance on this order</Link>}
      </div>
      {advanced > 0 && (
        <p className={`text-sm ${advanced >= po.totalCents ? 'font-medium text-emerald-700' : 'text-slate-600'}`}>
          {advanced >= po.totalCents ? `Paid in full in advance (${formatPesos(advanced)}).` : `Paid in advance: ${formatPesos(advanced)} of ${formatPesos(po.totalCents)}.`}
        </p>
      )}
    </>
  );
}

const action = 'inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700';
const secondary = 'inline-block rounded-md bg-white px-2.5 py-1.5 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';

/** How far a purchase order is, as steps: each bar fills its share (part received, some deliveries billed). */
function Steps({ steps }: { steps: [string, number][] }) {
  return (
    <ol aria-label="Where this order is" className={`grid gap-3 p-4 sm:grid-cols-3 ${SURFACE}`}>
      {steps.map(([words, share], i) => (
        <li key={i} className="space-y-1.5">
          <span className="block h-2 overflow-hidden rounded-full bg-slate-200">
            <span className={`block h-full rounded-full ${share >= 1 ? 'bg-slate-700' : ''}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`, ...(share < 1 ? HATCH : {}) }} />
          </span>
          <span className={`block text-xs ${share >= 1 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{words}</span>
        </li>
      ))}
    </ol>
  );
}

function ReceivingReportDetail({ id }: { id: string }) {
  const [rr, setRr] = useState<RrDetail | null>(null);
  const [mayBill, setMayBill] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => void api.docTypes().then((t) => setMayBill(!!t.find((d) => d.key === 'ap.bill')?.canPost), () => undefined), []);
  useEffect(() => void api.receivingReport(id).then(setRr, (e: Error) => setError(e.message)), [id]);
  useLiveReload(() => api.receivingReport(id).then(setRr));
  if (error) return <Notice>{error}</Notice>;
  if (!rr) return <Loading />;
  return (
    <>
      <p className="text-sm">From <b>{rr.supplierName}</b>, for purchase order <Link to={docPath('pur.po', `/${rr.poId}`)} className="text-indigo-700 underline">{rr.poNumber}</Link>.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th>Supply</th><th className="text-right">Received</th></tr></thead>
        <tbody>
          {rr.lines.map((l) => <tr key={l.lineNo} className="border-t border-slate-100"><td className="py-1">{l.supplyName}</td><td className={num}>{qtyWords(l.qty, l.unit)}</td></tr>)}
        </tbody>
      </table>
      {rr.status === 'posted' && (rr.bill
        ? <p className="text-sm">Billed on <Link to={docPath('ap.bill', `/${rr.bill.id}`)} className="text-indigo-700 underline">{rr.bill.number}</Link>.</p>
        : <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-amber-700">No supplier’s bill is recorded for these goods yet.</span>
          {mayBill && <Link to={docPath('ap.bill', `/new?rr=${rr.id}`)} className={action}>Record the supplier’s bill</Link>}
        </div>)}
    </>
  );
}

export const purchaseOrderView: ViewParts = { extra: (d) => <PurchaseOrderDetail id={d.header.id} /> };
export const receivingReportView: ViewParts = { extra: (d) => <ReceivingReportDetail id={d.header.id} /> };
