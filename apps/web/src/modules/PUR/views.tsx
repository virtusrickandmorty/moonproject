/**
 * What the generic view cannot show of a purchase order (its supplier and lines by name, and what is still to receive)
 * and of a receiving report (the order it came for, what it received and what that is worth at the order's costs). Each
 * shows where the purchase is on its way (request → order → receive → bill) with the button for its next step (the
 * owner's requests, 25 and 26 Oct 2026).
 */
import { useLiveReload } from '../../live.ts';
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type PoStatus, type RrDetail } from '../../api.ts';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Loading, Notice, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { qtyWords } from './purchasing.ts';
import { Badge, Facts, Journey, Progress, type Step } from './parts.tsx';

const num = 'py-2 text-right tabular-nums';
const head = 'border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500';
const link = 'text-indigo-700 underline';
const action = 'inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700';
const secondary = 'inline-block rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

/** The order's journey: asked for (when made from a request), ordered, received (how much), billed (how many deliveries). */
function orderSteps(po: PoStatus): Step[] {
  const deliveries = (po.deliveries ?? []).filter((r) => r.status === 'posted');
  const ordered = po.lines.reduce((n, l) => n + l.orderedQty, 0), received = po.lines.reduce((n, l) => n + Math.min(l.receivedQty, l.orderedQty), 0);
  const billed = deliveries.filter((r) => r.bill).length;
  const allIn = ordered > 0 && received >= ordered, allBilled = deliveries.length > 0 && billed === deliveries.length;
  return [
    ...(po.request ? [{ label: 'Asked and approved', state: 'done' as const, note: po.request.number }] : []),
    { label: 'Ordered', state: 'done', note: po.number },
    { label: allIn ? 'All received' : 'Receive the goods', state: allIn ? 'done' : 'now', note: received === 0 ? 'Nothing received yet' : `${received} of ${ordered} pieces` },
    { label: allIn && allBilled ? 'Billed' : 'Record the bill', state: allIn && allBilled ? 'done' : deliveries.length > billed ? 'now' : 'later',
      note: deliveries.length === 0 ? 'After the goods come' : `${billed} of ${deliveries.length} ${deliveries.length === 1 ? 'delivery' : 'deliveries'} billed` },
  ];
}

function PurchaseOrderDetail({ id }: { id: string }) {
  const [po, setPo] = useState<PoStatus | null>(null);
  const [may, setMay] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  useEffect(() => void api.purchaseOrder(id).then(setPo, (e: Error) => setError(e.message)), [id]);
  // Live (the owner's request, Oct 2026): a change on any computer shows here too.
  useLiveReload(() => api.purchaseOrder(id).then(setPo));
  useEffect(() => void api.docTypes().then((t) => setMay(Object.fromEntries(t.map((d) => [d.key, !!d.canPost]))), () => undefined), []);
  if (error) return <Notice>{error}</Notice>;
  if (!po) return <Loading />;
  const posted = po.status === 'posted';
  const open = posted && po.lines.some((l) => l.remainingQty > 0);
  const deliveries = (po.deliveries ?? []).filter((r) => r.status === 'posted');
  const advanced = po.advancedCents ?? 0;
  const late = open && !!po.expectedDate && po.expectedDate < today();
  const mayAdvance = open && advanced < po.totalCents && may['ap.advance'];
  const toBill = deliveries.find((r) => !r.bill);
  return (
    <div className="space-y-4 pt-1">
      <Facts items={[
        ['Supplier', <Link to={`/pur/suppliers/${po.supplierId}`} className={link}>{po.supplierName}</Link>],
        ['Expected', po.expectedDate ? <span className={late ? 'text-red-600' : ''}>{showDate(po.expectedDate)}{late ? ' (late)' : ''}</span> : 'Not set'],
        ['From request', po.request ? <Link to={docPath('pur.request', `/${po.request.id}`)} className={link}>{po.request.number}</Link> : 'None'],
        ['Paid in advance', advanced > 0 ? (advanced >= po.totalCents ? `${formatPesos(advanced)} (in full)` : `${formatPesos(advanced)} of ${formatPesos(po.totalCents)}`) : 'Nothing'],
      ]} />
      {posted && <Journey steps={orderSteps(po)} label="Where this order is" />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className={head}><tr><th className="py-2">Supply</th><th className="text-right">Ordered</th><th className="text-right">Cost of one</th><th className="text-right">Line total</th><th className="pl-4">Received</th></tr></thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.lineNo} className="border-b border-slate-100">
                <td className="py-2 font-medium">{l.supplyName}</td>
                <td className={num}>{qtyWords(l.orderedQty, l.unit)}</td>
                <td className={num}>{formatPesos(l.unitCostCents)}</td>
                <td className={num}>{formatPesos(l.orderedQty * l.unitCostCents)}</td>
                <td className="py-2 pl-4">{posted && <Progress done={l.receivedQty} of={l.orderedQty} words={l.remainingQty === 0 ? 'All received' : l.receivedQty === 0 ? 'Nothing yet' : `${l.receivedQty} in, ${qtyWords(l.remainingQty, l.unit)} to come`} />}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="py-2 font-semibold" colSpan={3}>Total</td><td className={`${num} font-semibold`}>{formatPesos(po.totalCents)}</td><td /></tr></tfoot>
        </table>
      </div>
      {deliveries.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-sm font-semibold">Deliveries</p>
          <table className="w-full text-sm">
            <thead className={head}><tr><th className="py-2">Receiving report</th><th>Received</th><th>Supplier’s bill</th></tr></thead>
            <tbody>
              {deliveries.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2"><Link to={docPath('pur.rr', `/${r.id}`)} className={link}>{r.number}</Link></td>
                  <td>{showDate(r.date)}</td>
                  <td>{r.bill ? <Link to={docPath('ap.bill', `/${r.bill.id}`)} className={link}>{r.bill.number}</Link>
                    : may['ap.bill'] ? <Link to={docPath('ap.bill', `/new?rr=${r.id}`)} className="text-sm font-medium text-indigo-700 underline">Record the bill</Link> : <Badge tone="bg-amber-100 text-amber-800">No bill yet</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(open && may['pur.rr']) || mayAdvance || (!open && toBill && may['ap.bill']) ? (
        <div className="flex flex-wrap gap-2">
          {open && may['pur.rr'] && <Link to={`${docPath('pur.rr', '/new')}?po=${po.id}`} className={action}>Receive goods for this order</Link>}
          {!open && toBill && may['ap.bill'] && <Link to={docPath('ap.bill', `/new?rr=${toBill.id}`)} className={action}>Record the supplier’s bill</Link>}
          {mayAdvance && <Link to={docPath('ap.advance', `/new?supplier=${po.supplierId}&po=${po.id}`)} className={secondary}>Pay an advance on this order</Link>}
        </div>
      ) : null}
    </div>
  );
}

function ReceivingReportDetail({ id }: { id: string }) {
  const [rr, setRr] = useState<RrDetail | null>(null);
  const [po, setPo] = useState<PoStatus | null>(null);
  const [mayBill, setMayBill] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.receivingReport(id).then((r) => { setRr(r); return api.purchaseOrder(r.poId).then(setPo, () => setPo(null)); }, (e: Error) => setError(e.message));
  useEffect(() => void api.docTypes().then((t) => setMayBill(!!t.find((d) => d.key === 'ap.bill')?.canPost), () => undefined), []);
  useEffect(() => void load(), [id]);
  useLiveReload(load);
  if (error) return <Notice>{error}</Notice>;
  if (!rr) return <Loading />;
  const lineOf = (poLineNo: number) => po?.lines.find((l) => l.lineNo === poLineNo);
  const worth = rr.lines.reduce((n, l) => n + l.qty * (lineOf(l.poLineNo)?.unitCostCents ?? 0), 0);
  const left = po ? po.lines.reduce((n, l) => n + l.remainingQty, 0) : 0;
  const posted = rr.status === 'posted';
  const steps: Step[] = [
    { label: 'Ordered', state: 'done', note: rr.poNumber },
    { label: 'Received', state: 'done', note: po && po.status === 'posted' ? (left === 0 ? 'The order is complete' : `${left} pieces still to come on the order`) : rr.number },
    { label: rr.bill ? 'Billed' : 'Record the bill', state: rr.bill ? 'done' : 'now', note: rr.bill ? rr.bill.number : 'The supplier’s invoice for these goods' },
  ];
  return (
    <div className="space-y-4 pt-1">
      <Facts items={[
        ['Supplier', <Link to={`/pur/suppliers/${rr.supplierId}`} className={link}>{rr.supplierName}</Link>],
        ['For order', <Link to={docPath('pur.po', `/${rr.poId}`)} className={link}>{rr.poNumber}</Link>],
        ['Received', showDate(rr.date)],
        ['Worth at the order’s costs', po ? formatPesos(worth) : null],
      ]} />
      {posted && <Journey steps={steps} label="Where these goods are" />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className={head}><tr><th className="py-2">Supply</th><th className="text-right">Received here</th><th className="text-right">Cost of one</th><th className="text-right">Worth</th><th className="pl-4">On the order now</th></tr></thead>
          <tbody>
            {rr.lines.map((l) => {
              const o = lineOf(l.poLineNo);
              return (
                <tr key={l.lineNo} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{l.supplyName}</td>
                  <td className={num}>{qtyWords(l.qty, l.unit)}</td>
                  <td className={num}>{o ? formatPesos(o.unitCostCents) : ''}</td>
                  <td className={num}>{o ? formatPesos(l.qty * o.unitCostCents) : ''}</td>
                  <td className="py-2 pl-4">{o && <Progress done={o.receivedQty} of={o.orderedQty} words={o.remainingQty === 0 ? `All ${o.orderedQty} received` : `${o.receivedQty} of ${o.orderedQty} received`} />}</td>
                </tr>
              );
            })}
          </tbody>
          {po && <tfoot><tr><td className="py-2 font-semibold" colSpan={3}>Worth in all</td><td className={`${num} font-semibold`}>{formatPesos(worth)}</td><td /></tr></tfoot>}
        </table>
      </div>
      {posted && !rr.bill && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3">
          <span className="text-sm text-amber-800">No supplier’s bill is recorded for these goods yet.</span>
          {mayBill && <Link to={docPath('ap.bill', `/new?rr=${rr.id}`)} className={action}>Record the supplier’s bill</Link>}
        </div>
      )}
    </div>
  );
}

export const purchaseOrderView: ViewParts = { extra: (d) => <PurchaseOrderDetail id={d.header.id} /> };
export const receivingReportView: ViewParts = { extra: (d) => <ReceivingReportDetail id={d.header.id} />, noTotal: true };
