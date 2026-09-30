/**
 * Purchase order form (PLAN E9 PO-): the supplier and each supply picked by name, whole quantities and the cost of one
 * unit; the server works out every total. Also the Edit of a recorded order (cancel and reissue, NR-4).
 */
import { useState } from 'react';
import { api, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, Field, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { SupplierSelect, useList } from '../AP/parts.tsx';
import { PurFrame, usePurForm } from './PurForm.tsx';
import { UNIT_WORDS, emptyPoRow, poRowTotal, poRows, poToInput, type PoRow } from './purchasing.ts';

type Stored = { supplierId: string; expectedDate?: string; lines: { supplyId: string; qty: number; unitCostCents: number }[] };

export function PoForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const suppliers = useList(api.suppliers);
  const supplies = useList(() => api.supplyList('active'));
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [rows, setRows] = useState<PoRow[]>([emptyPoRow()]);
  const form = usePurForm(type, mode, (d) => {
    const input = d.input as Stored;
    setSupplierId(input.supplierId);
    setExpected(input.expectedDate ?? '');
    setRows(poRows(input.lines));
  });
  const { input, errors } = poToInput(supplierId, expected, rows);
  const set = (i: number, patch: Partial<PoRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const unitOf = (id: string) => supplies.find((s) => s.id === id)?.unit;

  return (
    <PurFrame type={type} form={form} title="New purchase order" input={input} errors={errors} showTotal>
      <Panel title="Who are we ordering from?">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
        <Field label="Expected date" hint="When the goods should arrive. Optional; it cannot be in the past.">
          <input type="date" className={`${inputClass} max-w-48`} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
      </Panel>
      <Panel title="What are we ordering?">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Supply</th><th className="w-28 text-right">Quantity</th><th className="w-36 text-right">Cost of one unit</th><th className="w-32 text-right">Line total</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const total = poRowTotal(r);
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-2">
                    <select aria-label={`Line ${i + 1}: supply`} className={inputClass} value={r.supplyId} onChange={(e) => set(i, { supplyId: e.target.value })}>
                      <option value="">Pick the supply</option>
                      {supplies.map((s) => <option key={s.id} value={s.id}>{s.name} ({UNIT_WORDS[s.unit].toLowerCase()})</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1}: quantity`} inputMode="numeric" placeholder={unitOf(r.supplyId) ? UNIT_WORDS[unitOf(r.supplyId)!].toLowerCase() : '0'} className={`${inputClass} text-right tabular-nums`} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1}: cost of one unit`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
                  </td>
                  <td className="py-1 text-right tabular-nums">{total === undefined ? '' : peso(total)}</td>
                  <td className="py-1 pl-2">{rows.length > 1 && <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length < 200 && <Button onClick={() => setRows([...rows, emptyPoRow()])}>+ Add a line</Button>}
        {supplies.length === 0 && <p className="text-sm text-slate-500">No supply is on file yet. Add it under Supplies first.</p>}
      </Panel>
    </PurFrame>
  );
}
