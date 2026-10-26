/**
 * The purchasing lists' own parts (DocList, the owner's request, 26 Oct 2026): figures above each list, and rows that
 * say who and how far instead of the long summary sentence.
 *   Purchase requests: what for, who asked, by when, and where it stands (waiting, approved, not approved, ordered).
 *   Purchase orders:   the supplier, the expected date (late marked), the pieces received and the deliveries billed.
 *   Receiving reports: the supplier and the order, what came and its worth, and its bill.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type DocHeader, type PoListRow, type PurListSummary, type PurRequestListRow, type RrListRow } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { FigureStrip } from '../../components/Figures.tsx';
import type { ListColumn, ListSource } from '../../generic/DocList.tsx';
import { useLiveReload } from '../../live.ts';
import { Badge, Progress, RequestBadge } from './parts.tsx';

const shortDay = (date: string) => { const [y, m, d] = date.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-PH')} ${n === 1 ? one : many}`;

function useSummary<K extends keyof PurListSummary>(kind: K): PurListSummary[K] | null {
  const [s, setS] = useState<PurListSummary[K] | null>(null);
  const load = () => api.purListSummary(kind).then(setS, () => setS(null));
  useEffect(() => void load(), [kind]);
  useLiveReload(load);
  return s;
}

/** A row's two lines: the main words (cancelled ones struck through), then the small facts under them. */
function RowWords({ r, main, facts }: { r: DocHeader; main: ReactNode; facts: ReactNode[] }) {
  const cancelled = r.status === 'cancelled';
  return (
    <div className={`min-w-0 ${cancelled ? 'text-slate-400 line-through' : ''}`} title={r.summary}>
      <p className="truncate font-medium text-slate-900">{main}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">{facts.filter(Boolean).map((f, i) => <span key={i} className="whitespace-nowrap">{f}</span>)}</p>
    </div>
  );
}

// ---- Purchase requests ----
const req = (r: DocHeader) => r as PurRequestListRow;

function RequestFigures() {
  const s = useSummary('request');
  if (!s) return null;
  return <FigureStrip label="Purchase requests at a glance" figures={[
    { label: 'Waiting for approval', value: String(s.waiting.count), icon: 'clock', warn: s.waiting.count > 0, note: s.waiting.count ? `About ${peso(s.waiting.cents)}` : 'Nothing to decide' },
    { label: 'Approved, not ordered yet', value: String(s.approved.count), icon: 'check', note: s.approved.count ? `About ${peso(s.approved.cents)}: make the order` : 'All ordered' },
    { label: 'Ordered or paid', value: String(s.used.count), icon: 'stages', good: true, note: `About ${peso(s.used.cents)}` },
    { label: 'Not approved', value: String(s.rejected.count), icon: 'undo', note: 'With the reason on each' },
  ]} />;
}

export const purchaseRequestList = {
  source: { list: (q) => api.purList('request', q), counts: (q) => api.purListCounts('request', q) } as ListSource,
  head: <RequestFigures />,
  summaryHead: 'What for',
  amountHead: 'Estimate' as string | null,
  searchHint: 'Number, purpose, supplier or what is asked for',
  summary: (r: DocHeader) => {
    const x = req(r);
    if (!x.purpose) return <span className="line-clamp-2 text-slate-700">{r.summary}</span>;
    return <RowWords r={r} main={x.purpose} facts={[
      r.status === 'posted' && <RequestBadge state={x.state} />,
      plural(x.lineCount, 'thing'),
      `asked by ${x.requestedByName}`,
      x.neededBy && <span className={x.late ? 'font-semibold text-red-600' : ''}>needed by {shortDay(x.neededBy)}{x.late ? ' (late)' : ''}</span>,
      x.supplierName && `from ${x.supplierName}`,
      x.usedBy && `${x.usedBy.docType === 'pur.po' ? 'ordered on' : 'paid on'} ${x.usedBy.number}`,
    ]} />;
  },
};

// ---- Purchase orders ----
const po = (r: DocHeader) => r as PoListRow;

function OrderFigures() {
  const s = useSummary('po');
  if (!s) return null;
  return <FigureStrip label="Purchase orders at a glance" figures={[
    { label: 'Waiting for goods', value: String(s.open), icon: 'jobs', note: s.open ? `${peso(s.toReceiveCents)} still to come` : 'Everything received' },
    { label: 'Late', value: String(s.late), icon: 'clock', warn: s.late > 0, note: 'Past the expected date' },
    { label: 'Deliveries to bill', value: String(s.toBill), icon: 'draft', warn: s.toBill > 0, note: s.toBill ? 'Record the supplier’s bill' : 'All billed' },
    { label: 'Ordered this month', value: peso(s.monthCents), icon: 'chart' },
  ]} />;
}

export const purchaseOrderList = {
  source: { list: (q) => api.purList('po', q), counts: (q) => api.purListCounts('po', q) } as ListSource,
  head: <OrderFigures />,
  summaryHead: 'Supplier and order',
  searchHint: 'Number, supplier or a supply ordered',
  summary: (r: DocHeader) => {
    const x = po(r);
    if (!x.supplierName) return <span className="line-clamp-2 text-slate-700">{r.summary}</span>;
    return <RowWords r={r} main={x.supplierName} facts={[
      x.expectedDate && <span className={x.late ? 'font-semibold text-red-600' : ''}>expected {shortDay(x.expectedDate)}{x.late ? ' (late)' : ''}</span>,
      x.requestNumber && `for ${x.requestNumber}`,
    ]} />;
  },
  columns: [{
    head: 'Received',
    cell: (r) => {
      const x = po(r);
      if (r.status !== 'posted' || !x.orderedQty) return '';
      const all = x.receivedQty >= x.orderedQty;
      return (
        <div className="space-y-1">
          <Progress done={x.receivedQty} of={x.orderedQty} words={all ? 'All received' : x.receivedQty ? `${x.receivedQty} of ${x.orderedQty}` : 'Nothing yet'} />
          {x.deliveries > 0 && (x.billed < x.deliveries ? <Badge tone="bg-amber-100 text-amber-800">{x.deliveries - x.billed} to bill</Badge> : <Badge tone="bg-emerald-100 text-emerald-800">Billed</Badge>)}
        </div>
      );
    },
  }] as ListColumn[],
};

// ---- Receiving reports ----
const rr = (r: DocHeader) => r as RrListRow;

function DeliveryFigures() {
  const s = useSummary('rr');
  if (!s) return null;
  return <FigureStrip label="Deliveries at a glance" figures={[
    { label: 'Orders waiting for goods', value: String(s.ordersWaiting), icon: 'jobs', note: 'Receive them as they come' },
    { label: 'Received this month', value: String(s.month), icon: 'check', note: `Worth ${peso(s.monthCents)} at the orders’ costs` },
    { label: 'Waiting for the supplier’s bill', value: String(s.toBill), icon: 'draft', warn: s.toBill > 0, note: s.toBill ? `Worth ${peso(s.toBillCents)}` : 'All billed' },
  ]} />;
}

export const receivingReportList = {
  source: { list: (q) => api.purList('rr', q), counts: (q) => api.purListCounts('rr', q) } as ListSource,
  head: <DeliveryFigures />,
  summaryHead: 'Supplier and goods',
  amountHead: null as string | null,
  searchHint: 'Number, supplier, order number or a supply received',
  summary: (r: DocHeader) => {
    const x = rr(r);
    if (!x.supplierName) return <span className="line-clamp-2 text-slate-700">{r.summary}</span>;
    return <RowWords r={r} main={x.supplierName} facts={[
      `for ${x.poNumber}`,
      `${plural(x.qty, 'piece')} on ${plural(x.lines, 'line')}`,
    ]} />;
  },
  columns: [{
    head: 'Worth', figure: true,
    cell: (r) => <span title="At the order’s costs">{peso(rr(r).valueCents)}</span>,
  }, {
    head: 'Bill',
    cell: (r) => {
      const x = rr(r);
      if (r.status !== 'posted') return '';
      return x.bill ? <Badge tone="bg-emerald-100 text-emerald-800">{x.bill.number}</Badge> : <Badge tone="bg-amber-100 text-amber-800">No bill yet</Badge>;
    },
  }] as ListColumn[],
};

/** Each purchasing list's parts, by document type. */
export const PURCHASING_LISTS: Record<string, typeof purchaseRequestList | typeof purchaseOrderList | typeof receivingReportList> = {
  'pur.request': purchaseRequestList, 'pur.po': purchaseOrderList, 'pur.rr': receivingReportList,
};
