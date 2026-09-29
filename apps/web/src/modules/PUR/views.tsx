/**
 * What the generic view cannot show of a purchase order (its supplier and lines by name, and what is still to receive)
 * and of a receiving report (the order it came for and what it received).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type PoStatus, type RrDetail } from '../../api.ts';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Notice } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { qtyWords } from './purchasing.ts';

const num = 'py-1 text-right tabular-nums';

function PurchaseOrderDetail({ id }: { id: string }) {
  const [po, setPo] = useState<PoStatus | null>(null);
  const [canReceive, setCanReceive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => void api.purchaseOrder(id).then(setPo, (e: Error) => setError(e.message)), [id]);
  useEffect(() => void api.docTypes().then((t) => setCanReceive(Boolean(t.find((d) => d.key === 'pur.rr')?.canPost)), () => undefined), []);
  if (error) return <Notice>{error}</Notice>;
  if (!po) return <p className="text-sm text-slate-500">Loading…</p>;
  const open = po.status === 'posted' && po.lines.some((l) => l.remainingQty > 0);
  return (
    <>
      <p className="text-sm">Ordered from <b>{po.supplierName}</b>{po.expectedDate ? `, expected ${po.expectedDate}` : ''}.</p>
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
      {open && canReceive && <Link to={`${docPath('pur.rr', '/new')}?po=${po.id}`} className="inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Receive goods for this order</Link>}
    </>
  );
}

function ReceivingReportDetail({ id }: { id: string }) {
  const [rr, setRr] = useState<RrDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.receivingReport(id).then(setRr, (e: Error) => setError(e.message)), [id]);
  if (error) return <Notice>{error}</Notice>;
  if (!rr) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <>
      <p className="text-sm">From <b>{rr.supplierName}</b>, for purchase order <Link to={docPath('pur.po', `/${rr.poId}`)} className="text-indigo-700 underline">{rr.poNumber}</Link>.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th>Supply</th><th className="text-right">Received</th></tr></thead>
        <tbody>
          {rr.lines.map((l) => <tr key={l.lineNo} className="border-t border-slate-100"><td className="py-1">{l.supplyName}</td><td className={num}>{qtyWords(l.qty, l.unit)}</td></tr>)}
        </tbody>
      </table>
    </>
  );
}

export const purchaseOrderView: ViewParts = { extra: (d) => <PurchaseOrderDetail id={d.header.id} /> };
export const receivingReportView: ViewParts = { extra: (d) => <ReceivingReportDetail id={d.header.id} /> };
