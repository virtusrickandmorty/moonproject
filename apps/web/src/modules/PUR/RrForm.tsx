/**
 * Receiving report form (PLAN E9 RR-): starts from an open purchase order (also from the order's own "Receive goods"
 * button, ?po=) and shows, per line, what was ordered, what came before and what is still to receive. Nothing is
 * journalled. Also the Edit of a recorded report (cancel and reissue, NR-4): the report being replaced no longer counts.
 * Laid out like the purchase order (the owner's request, 26 Oct 2026): the open orders as cards (late ones marked, a
 * search once there are many), each line with how much of it is in, and beside them what is being received and its
 * worth at the order's costs.
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type DocTypeInfo, type Me, type PoStatus } from '../../api.ts';
import { Button, Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { PurFrame, usePurForm } from './PurForm.tsx';
import { overReceived, qtyCents, qtyOf, qtyWords, receiveAllLeft, rrRows, rrToInput, type RrRow } from './purchasing.ts';
import { Badge, PickCard, Progress } from './parts.tsx';

type Stored = { poDocumentId: string; lines: { poLineNo: number; qty: number }[] };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const SEARCH_FROM = 6; // a search box once this many orders are waiting

export function RrForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const editing = mode.kind === 'edit';
  const [open, setOpen] = useState<PoStatus[]>([]);
  const [poId, setPoId] = useState('');
  const [po, setPo] = useState<PoStatus | null>(null);
  const [rows, setRows] = useState<RrRow[]>([]);
  const [previous, setPrevious] = useState<Record<number, number>>({});
  const [find, setFind] = useState('');
  const [error, setError] = useState('');
  const form = usePurForm(type, mode, (d) => {
    const input = d.input as Stored;
    setPrevious(Object.fromEntries(input.lines.map((l) => [l.poLineNo, l.qty])));
    setPoId(input.poDocumentId);
  });

  useEffect(() => {
    if (editing) return;
    const wanted = new URLSearchParams(window.location.search).get('po') ?? '';
    api.openPurchaseOrders().then((list) => {
      setOpen(list);
      if (wanted && list.some((p) => p.id === wanted)) setPoId(wanted);
      else if (wanted) setError('That purchase order has nothing left to receive, or is cancelled.');
    }, (e: Error) => setError(e.message));
  }, []);

  // The order's lines with what is still to receive; on an edit the order is fetched, as it may be fully received by this very report.
  useEffect(() => {
    if (!poId) return (setPo(null), setRows([]));
    let stale = false;
    const found = editing ? undefined : open.find((p) => p.id === poId);
    (found ? Promise.resolve(found) : api.purchaseOrder(poId)).then((p) => stale || (setPo(p), setRows(rrRows(p, previous))), (e: Error) => stale || setError(e.message));
    return () => void (stale = true);
  }, [poId, open.length, previous]);

  const { input, errors } = rrToInput(poId, rows);
  const set = (i: number, qty: string) => setRows(rows.map((r, j) => (j === i ? { ...r, qty } : r)));
  const costOf = (poLineNo: number) => po?.lines.find((l) => l.lineNo === poLineNo)?.unitCostCents ?? 0;
  const now = rows.flatMap((r) => { const qty = qtyOf(r.qty); return qty === undefined ? [] : [{ r, qty }]; });
  const worth = now.reduce((n, { r, qty }) => n + qtyCents(qty, costOf(r.poLineNo)), 0);
  const date = today();
  const words = find.trim().toLowerCase();
  const shown = open.filter((p) => !words || `${p.number} ${p.supplierName} ${p.lines.map((l) => l.supplyName).join(' ')}`.toLowerCase().includes(words));

  const side = (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Receiving now</p>
      {!po && <p className="text-sm text-slate-500">Pick the order the goods came for.</p>}
      {po && now.length === 0 && <p className="text-sm text-slate-500">Type how many of each came, or press Receive everything that is left.</p>}
      <ol className="divide-y divide-slate-100">
        {now.map(({ r, qty }) => (
          <li key={r.poLineNo} className="flex justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">{r.supplyName} <span className="text-slate-500">× {qtyWords(qty, r.unit)}</span></span>
            <span className="shrink-0 tabular-nums">{peso(qtyCents(qty, costOf(r.poLineNo)))}</span>
          </li>
        ))}
      </ol>
      {now.length > 0 && <p className="flex justify-between border-t border-slate-200 pt-2 text-sm"><span>Worth at the order’s costs</span><b className="tabular-nums">{peso(worth)}</b></p>}
      {po && <p className="text-xs text-slate-500">Nothing is booked until the supplier’s bill is recorded for these goods.</p>}
    </div>
  );

  return (
    <PurFrame type={type} form={form} title="New receiving report" input={input} errors={errors} showTotal={false} wide side={side}>
      {error && <Notice>{error}</Notice>}
      <Panel title="Which order did the goods come for?">
        {editing ? (
          po && <p className="text-sm"><b>{po.number}</b> · {po.supplierName}</p>
        ) : (
          <>
            {open.length >= SEARCH_FROM && (
              <input type="search" aria-label="Find an order" placeholder="Find an order: number, supplier or supply" className={inputClass} value={find} onChange={(e) => setFind(e.target.value)} />
            )}
            <div role="radiogroup" aria-label="Purchase order" className="space-y-2">
              {shown.map((p) => {
                const ordered = p.lines.reduce((n, l) => n + l.orderedQty, 0), received = p.lines.reduce((n, l) => n + Math.min(l.receivedQty, l.orderedQty), 0);
                const late = !!p.expectedDate && p.expectedDate < date;
                const toCome = p.lines.reduce((n, l) => n + l.remainingQty * l.unitCostCents, 0);
                return (
                  <PickCard key={p.id} picked={poId === p.id} onPick={() => setPoId(p.id)} title={`${p.number} · ${p.supplierName}`}
                    badge={late ? <Badge tone="bg-red-100 text-red-700">Late</Badge> : received > 0 ? <Badge tone="bg-indigo-100 text-indigo-700">Part received</Badge> : undefined}
                    lines={[
                      p.expectedDate ? `Expected ${showDate(p.expectedDate)}` : `Ordered ${showDate(p.date)}`,
                      <Progress done={received} of={ordered} words={received ? `${received} of ${ordered} pieces in` : `${ordered} pieces to come`} />,
                    ]}
                    right={formatPesos(toCome)} rightNote="still to come" />
                );
              })}
            </div>
            {open.length > 0 && shown.length === 0 && <p className="text-sm text-slate-500">No waiting order matches “{find}”.</p>}
          </>
        )}
        {!editing && open.length === 0 && !error && <p className="text-sm text-slate-500">No purchase order is waiting for goods.</p>}
      </Panel>
      {po && (
        <Panel title="What came?">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Leave a line empty when nothing of it came. You can receive the rest in another report.</p>
            <Button onClick={() => setRows(receiveAllLeft(rows))}>Receive everything that is left</Button>
          </div>
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const over = overReceived(r);
              const done = r.remaining === 0;
              return (
                <li key={r.poLineNo} className={`grid items-center gap-3 rounded-lg p-3 ring-1 sm:grid-cols-[minmax(0,1fr)_9rem] ${done ? 'bg-slate-50 ring-slate-100' : 'ring-slate-200'}`}>
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{r.supplyName}</p>
                    <Progress done={r.received} of={r.ordered} words={`${qtyWords(r.ordered, r.unit)} ordered · ${r.received} in before · ${done ? 'all received' : `${qtyWords(r.remaining, r.unit)} to come`}`} />
                  </div>
                  <div>
                    <input aria-label={`${r.supplyName}: receiving now`} inputMode="decimal" placeholder="0" className={`${inputClass} text-right tabular-nums`} value={r.qty} onChange={(e) => set(i, e.target.value)} />
                    {over > 0 && <span className="block text-right text-xs text-amber-700">{qtyWords(over, r.unit)} more than ordered</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
    </PurFrame>
  );
}
