/**
 * Receiving report form (PLAN E9 RR-): starts from an open purchase order (also from the order's own "Receive goods"
 * button, ?po=) and shows, per line, what was ordered, what came before and what is still to receive. Nothing is
 * journalled. Also the Edit of a recorded report (cancel and reissue, NR-4): the report being replaced no longer counts.
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Me, type PoStatus } from '../../api.ts';
import { Button, Notice, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { PurFrame, usePurForm } from './PurForm.tsx';
import { overReceived, qtyWords, receiveAllLeft, rrRows, rrToInput, type RrRow } from './purchasing.ts';

type Stored = { poDocumentId: string; lines: { poLineNo: number; qty: number }[] };

export function RrForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const editing = mode.kind === 'edit';
  const [open, setOpen] = useState<PoStatus[]>([]);
  const [poId, setPoId] = useState('');
  const [po, setPo] = useState<PoStatus | null>(null);
  const [rows, setRows] = useState<RrRow[]>([]);
  const [previous, setPrevious] = useState<Record<number, number>>({});
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

  return (
    <PurFrame type={type} form={form} title="New receiving report" input={input} errors={errors} showTotal={false}>
      {error && <Notice>{error}</Notice>}
      <Panel title="Which order did the goods come for?">
        {editing ? (
          po && <p className="text-sm"><b>{po.number}</b> · {po.supplierName}</p>
        ) : (
          <select aria-label="Purchase order" className={inputClass} value={poId} onChange={(e) => setPoId(e.target.value)}>
            <option value="">Pick an open purchase order</option>
            {open.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.supplierName}{p.expectedDate ? ` · expected ${p.expectedDate}` : ''}</option>)}
          </select>
        )}
        {!editing && open.length === 0 && !error && <p className="text-sm text-slate-500">No purchase order is waiting for goods.</p>}
      </Panel>
      {po && (
        <Panel title="What came?">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Supply</th><th className="text-right">Ordered</th><th className="text-right">Received before</th><th className="text-right">Still to receive</th><th className="w-32 text-right">Receiving now</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const over = overReceived(r);
                return (
                  <tr key={r.poLineNo} className="border-t border-slate-100">
                    <td className="py-1">{r.supplyName}</td>
                    <td className="text-right tabular-nums">{qtyWords(r.ordered, r.unit)}</td>
                    <td className="text-right tabular-nums">{r.received}</td>
                    <td className={`text-right tabular-nums ${r.remaining === 0 ? 'text-slate-400' : 'font-medium'}`}>{r.remaining === 0 ? 'All received' : qtyWords(r.remaining, r.unit)}</td>
                    <td className="py-1 pl-2">
                      <input aria-label={`${r.supplyName}: receiving now`} inputMode="numeric" placeholder="0" className={`${inputClass} text-right tabular-nums`} value={r.qty} onChange={(e) => set(i, e.target.value)} />
                      {over > 0 && <span className="block text-right text-xs text-amber-700">{qtyWords(over, r.unit)} more than ordered</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="space-y-1">
            <Button onClick={() => setRows(receiveAllLeft(rows))}>Receive everything that is left</Button>
            <p className="text-xs text-slate-500">Leave a line empty when nothing of it came. You can receive the rest of an order in another report.</p>
          </div>
        </Panel>
      )}
    </PurFrame>
  );
}
