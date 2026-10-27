/**
 * Purchase order form (PLAN E9 PO-), laid out like the job order form (the owner's request, Oct 2026): the supplier and
 * the expected date; an item form (supply, quantity, cost of one unit) whose "+ Add to order" puts it in the breakdown on
 * the right, where each line can be changed (Edit fills the item form again) or removed. The supplier's own supplies
 * (linked on its page) come first in the supply list, and a supply picked fills its last cost. The server works out every
 * total. Also the Edit of a recorded order (cancel and reissue, NR-4).
 * An approved purchase request (the owner's request, 26 Oct 2026) is picked first, or comes with ?request=<id>: its
 * supplier and its supplies on file fill in. Staff without pur.po.without_request order only from one (the server says so).
 * The approved requests show as cards with what each is for, who asked, by when and about how much (26 Oct 2026).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Me, type PurchaseRequestStatus, type SupplyRecord } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { formatPesos } from '@moonproject/shared';
import { SupplierSelect, useList } from '../AP/parts.tsx';
import { PurFrame, usePurForm } from './PurForm.tsx';
import { UNIT_WORDS, emptyPoRow, poRowTotal, poRows, poToInput, qtyOf, qtyWords, type PoRow } from './purchasing.ts';
import { PickCard } from './parts.tsx';
import { SearchSelect } from '../../components/SearchSelect.tsx';

type Stored = { supplierId: string; expectedDate?: string; requestId?: string; lines: { supplyId: string; qty: number; unitCostCents: number }[] };
const blank = (r: PoRow) => !r.supplyId && !r.qty.trim() && !r.unitCost.trim();

export function PoForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const suppliers = useList(api.suppliers);
  const supplies = useList(() => api.supplyList('active'));
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [rows, setRows] = useState<PoRow[]>([]);
  const [item, setItem] = useState<PoRow>(emptyPoRow());
  const [editing, setEditing] = useState<number | null>(null); // the breakdown line the item form is changing
  const [itemTouched, setItemTouched] = useState(false);
  const [linked, setLinked] = useState<SupplyRecord[]>([]);
  const [requests, setRequests] = useState<PurchaseRequestStatus[]>([]);
  const [requestId, setRequestId] = useState('');
  const [described, setDescribed] = useState<string[]>([]); // request lines with no supply on file: to pick by hand
  const mayDirect = me.permissions.includes('pur.po.without_request');
  const form = usePurForm(type, mode, (d) => {
    const input = d.input as Stored;
    setRequestId(input.requestId ?? '');
    setSupplierId(input.supplierId);
    setExpected(input.expectedDate ?? '');
    setRows(poRows(input.lines));
  });
  useEffect(() => { setLinked([]); if (supplierId) api.supplierSupplies(supplierId).then(setLinked, () => undefined); }, [supplierId]);
  // Approved requests not used yet; one asked for in the address is picked and fills the order.
  useEffect(() => {
    api.purRequests('approved').then((list) => {
      setRequests(list);
      const wanted = mode.kind === 'new' ? new URLSearchParams(window.location.search).get('request') : null;
      const r = wanted ? list.find((x) => x.id === wanted) : undefined;
      if (r) takeRequest(r);
      else if (wanted) form.setError('That purchase request is not approved, or it is already ordered or paid.');
    }, () => undefined);
  }, []);
  const takeRequest = (r: PurchaseRequestStatus | undefined) => {
    setRequestId(r?.id ?? '');
    if (!r) return setDescribed([]);
    if (r.supplierId) setSupplierId(r.supplierId);
    setRows(r.lines.filter((l) => l.supplyId).map((l) => ({ supplyId: l.supplyId!, qty: String(l.qty), unitCost: formatPesos(l.unitCostCents) })));
    setDescribed(r.lines.filter((l) => !l.supplyId).map((l) => `${l.description} (${l.qty})`));
  };
  const picked = requests.find((r) => r.id === requestId);

  // What Record sends: the breakdown, with the item in the form added (or applied) when one is typed there.
  const pending = !blank(item);
  const all = pending ? (editing === null ? [...rows, item] : rows.map((r, i) => (i === editing ? item : r))) : rows;
  const typed = poToInput(supplierId, expected, all);
  const input = { ...typed.input, ...(requestId ? { requestId } : {}) };
  const { errors } = typed;
  const itemErrors = poToInput('-', '', [item]).errors.map((e) => e.replace(/^Line 1: /, ''));
  const supplyOf = (id: string) => supplies.find((s) => s.id === id) ?? linked.find((s) => s.id === id);
  const others = supplies.filter((s) => !linked.some((l) => l.id === s.id));

  const pickSupply = (supplyId: string) => {
    const s = supplyOf(supplyId);
    // The cost of one unit last bought fills in, unless one is typed already.
    setItem({ ...item, supplyId, unitCost: item.unitCost.trim() || !s?.purchase_cost_cents ? item.unitCost : formatPesos(s.purchase_cost_cents) });
  };
  const clearItem = () => { setItem(emptyPoRow()); setEditing(null); setItemTouched(false); };
  const putItem = () => {
    setItemTouched(true);
    if (blank(item) || itemErrors.length > 0) return;
    setRows(editing === null ? [...rows, item] : rows.map((r, i) => (i === editing ? item : r)));
    clearItem();
  };
  const editRow = (i: number) => { setItem(rows[i]!); setEditing(i); setItemTouched(false); };
  const removeRow = (i: number) => {
    setRows(rows.filter((_, j) => j !== i));
    if (editing === i) clearItem(); else if (editing !== null && editing > i) setEditing(editing - 1);
  };
  const itemTotal = poRowTotal(item);

  const breakdown = (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Order lines</p>
      {rows.length === 0 && <p className="text-sm text-slate-500">No supply yet. Fill in the supply on the left, then press Add to order.</p>}
      <ol className="divide-y divide-slate-100">
        {rows.map((r, i) => {
          const s = supplyOf(r.supplyId);
          const total = poRowTotal(r);
          const qty = qtyOf(r.qty);
          return (
            <li key={i} className={`flex gap-3 py-2 text-sm ${editing === i ? '-mx-2 rounded-md bg-indigo-50 px-2' : ''}`}>
              <span className="text-slate-400">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s?.name ?? 'Supply'}</p>
                <p className="text-slate-600">{s && qty !== undefined ? qtyWords(qty, s.unit) : r.qty} × {r.unitCost ? `₱${r.unitCost}` : '₱0.00'}</p>
              </div>
              <div className="text-right">
                <p className="tabular-nums font-medium">{total === undefined ? '—' : peso(total)}</p>
                <p className="space-x-2 text-xs">
                  <button type="button" className="text-indigo-700 underline" onClick={() => editRow(i)}>Edit</button>
                  <button type="button" className="text-red-700 underline" onClick={() => removeRow(i)}>Remove</button>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {pending && <Notice tone="warning">{editing === null ? 'The supply in the form is not added yet: press Add to order (Record adds it too).' : `Line ${editing + 1} is being changed: press Update item (Record applies it too).`}</Notice>}
    </div>
  );

  return (
    <PurFrame type={type} form={form} title="New purchase order" input={input} errors={errors} showTotal wide side={breakdown}>
      <Panel title="Which approved request?">
        <p className="text-xs text-slate-500">{mayDirect ? 'Optional for you: you may order without one.' : 'Required: the owner or the accountant approves the request first.'}</p>
        <div role="radiogroup" aria-label="Purchase request" className="space-y-2">
          {requests.map((r) => (
            <PickCard key={r.id} picked={requestId === r.id} onPick={() => takeRequest(r)} title={r.number}
              lines={[r.purpose, `Asked by ${r.requestedByName}${r.neededBy ? ` · needed by ${showDate(r.neededBy)}` : ''}${r.supplierName ? ` · from ${r.supplierName}` : ''}`,
                `${r.lines.length} ${r.lines.length === 1 ? 'thing' : 'things'}: ${r.lines.slice(0, 3).map((l) => l.description).join(', ')}${r.lines.length > 3 ? ', …' : ''}`]}
              right={`about ${peso(r.totalCents)}`} rightNote="approved" />
          ))}
          {requestId && !picked && <PickCard picked onPick={() => undefined} title="The request on this order" lines={['It stays with this order when you record the change.']} />}
          {mayDirect && <PickCard picked={!requestId} onPick={() => takeRequest(undefined)} title="None: order directly" lines={['For a purchase nobody needs to approve first.']} />}
        </div>
        {!mayDirect && requests.length === 0 && !requestId && <Notice tone="info">No approved request is waiting to be ordered. Record a purchase request first; the owner or the accountant approves it.</Notice>}
        {described.length > 0 && <Notice tone="warning">These were asked for without a supply on file: {described.join(', ')}. Add each as a supply below (add it under Supplies first if it is new).</Notice>}
      </Panel>
      <Panel title="Who are we ordering from?">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)]">
          <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
          <Field label="Expected date" hint="When the goods should arrive. Optional; it cannot be in the past.">
            <input type="date" className={inputClass} value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
      </Panel>
      <Panel title={editing === null ? 'What are we ordering: add a supply' : `What are we ordering: change line ${editing + 1}`}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(6rem,1fr)_minmax(8rem,1fr)]">
          <Field label="Supply" required>
            <SearchSelect aria-label="Supply" value={item.supplyId} onChange={pickSupply} placeholder="Pick the supply"
              choices={[...linked.map((s) => ({ value: s.id, label: `${s.name} (${UNIT_WORDS[s.unit].toLowerCase()})`, group: 'From this supplier' })),
                ...others.map((s) => ({ value: s.id, label: `${s.name} (${UNIT_WORDS[s.unit].toLowerCase()})`, ...(linked.length > 0 ? { group: 'Other supplies' } : {}) }))]} />
          </Field>
          <Field label="Quantity" required hint={supplyOf(item.supplyId) ? `${UNIT_WORDS[supplyOf(item.supplyId)!.unit]}s; decimals allowed, like 12.5` : 'Decimals allowed, like 12.5'}>
            <input aria-label="Quantity" inputMode="decimal" placeholder="0" className={`${inputClass} text-right tabular-nums`} value={item.qty} onChange={(e) => setItem({ ...item, qty: e.target.value })} />
          </Field>
          <Field label="Cost of one unit" hint="The last cost fills in; change it if the price is new.">
            <input aria-label="Cost of one unit" inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={item.unitCost} onChange={(e) => setItem({ ...item, unitCost: e.target.value })} />
          </Field>
        </div>
        <p className="text-sm text-slate-600">Line total: <b className="tabular-nums">{itemTotal === undefined ? '—' : peso(itemTotal)}</b></p>
        {itemTouched && itemErrors.map((e) => <Notice key={e}>{e}</Notice>)}
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" onClick={putItem} disabled={rows.length >= 200 && editing === null}>{editing === null ? '+ Add to order' : 'Update item'}</Button>
          {(editing !== null || pending) && <Button onClick={clearItem}>{editing === null ? 'Clear' : 'Cancel the change'}</Button>}
        </div>
        {supplies.length === 0 && <p className="text-sm text-slate-500">No supply is on file yet. Add it under Supplies first.</p>}
        {supplierId && linked.length === 0 && supplies.length > 0 && <p className="text-xs text-slate-500">No supply is linked to this supplier yet: link the ones it sells on its page, and they come first here.</p>}
      </Panel>
    </PurFrame>
  );
}
