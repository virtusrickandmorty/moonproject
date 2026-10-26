/**
 * Purchase request form (PRQ-, the owner's request, 26 Oct 2026): what it is for, by when, from whom if known, and each
 * thing with its quantity and an estimated cost of one unit: a supply on file (its name and last cost fill in) or
 * something described only. Recording it sends it to the owner or the accountant for approval. Also its Edit (cancel and
 * reissue, NR-4), which waits for a new decision.
 */
import { useState } from 'react';
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import { api, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, Field, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { cents } from '../COL/money.ts';
import { SupplierSelect, useList } from '../AP/parts.tsx';
import { PurFrame, usePurForm } from './PurForm.tsx';
import { UNIT_WORDS } from './purchasing.ts';

interface Row { supplyId: string; description: string; qty: string; unitCost: string }
type Stored = { purpose: string; neededBy?: string; supplierId?: string; note?: string; lines: { supplyId?: string; description: string; qty: number; unitCostCents: number }[] };
const emptyRow = (): Row => ({ supplyId: '', description: '', qty: '', unitCost: '' });

export function RequestForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const suppliers = useList(api.suppliers);
  const supplies = useList(() => api.supplyList('active'));
  const [purpose, setPurpose] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const form = usePurForm(type, mode, (d) => {
    const input = d.input as Stored;
    setPurpose(input.purpose);
    setNeededBy(input.neededBy ?? '');
    setSupplierId(input.supplierId ?? '');
    setNote(input.note ?? '');
    setRows(input.lines.map((l) => ({ supplyId: l.supplyId ?? '', description: l.description, qty: String(l.qty), unitCost: formatPesos(l.unitCostCents) })));
  });

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickSupply = (i: number, supplyId: string) => {
    const s = supplies.find((x) => x.id === supplyId);
    const r = rows[i]!;
    set(i, { supplyId, ...(s && !r.description.trim() ? { description: s.name } : {}), ...(s?.purchase_cost_cents && !r.unitCost.trim() ? { unitCost: formatPesos(s.purchase_cost_cents) } : {}) });
  };
  const errors: string[] = [];
  if (purpose.trim().length < 5) errors.push('Say what it is for (5 characters or more).');
  if (neededBy && !isBusinessDate(neededBy)) errors.push('Pick a real date it is needed by, or leave it empty.');
  const lines = rows.flatMap((r, i) => {
    if (!r.supplyId && !r.description.trim() && !r.qty.trim() && !r.unitCost.trim()) return [];
    const qty = Number(r.qty), cost = cents(r.unitCost || '0');
    if (r.description.trim().length < 2) errors.push(`Line ${i + 1}: say what it is.`);
    if (!Number.isInteger(qty) || qty <= 0) errors.push(`Line ${i + 1}: type a whole quantity, like 10.`);
    if (cost === undefined || cost < 0) errors.push(`Line ${i + 1}: type the estimated cost of one, like 150.00.`);
    return [{ ...(r.supplyId ? { supplyId: r.supplyId } : {}), description: r.description.trim(), qty, unitCostCents: cost ?? 0 }];
  });
  if (lines.length === 0) errors.push('Add what is needed.');
  const total = lines.reduce((n, l) => n + (Number.isInteger(l.qty) ? l.qty * l.unitCostCents : 0), 0);
  const input = {
    purpose: purpose.trim(), ...(neededBy ? { neededBy } : {}), ...(supplierId ? { supplierId } : {}), ...(note.trim() ? { note: note.trim() } : {}), lines,
  };

  return (
    <PurFrame type={type} form={form} title="New purchase request" input={input} errors={errors} showTotal>
      <Panel title="What is it for?">
        <Field label="Purpose" required hint="What the things are needed for, e.g. Materials for the school uniforms of JO-000123">
          <input className={inputClass} value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)]">
          <div><SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} /><p className="text-xs text-slate-500">Optional: the supplier to buy from, if you know it.</p></div>
          <Field label="Needed by" hint="Optional">
            <input type="date" className={inputClass} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </Field>
        </div>
      </Panel>
      <Panel title="What is needed?">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Supply on file</th><th>What it is</th><th className="w-24 text-right">Quantity</th><th className="w-36 text-right">Estimated cost of one</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const s = supplies.find((x) => x.id === r.supplyId);
              return (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-2">
                    <select aria-label={`Line ${i + 1}: supply on file`} className={inputClass} value={r.supplyId} onChange={(e) => pickSupply(i, e.target.value)}>
                      <option value="">None: describe it</option>
                      {supplies.map((x) => <option key={x.id} value={x.id}>{x.name} ({UNIT_WORDS[x.unit].toLowerCase()})</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input aria-label={`Line ${i + 1}: what it is`} className={inputClass} value={r.description} maxLength={200} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1}: quantity`} inputMode="numeric" placeholder="0" className={`${inputClass} text-right tabular-nums`} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                    {s && <span className="text-xs text-slate-500">{UNIT_WORDS[s.unit]}</span>}
                  </td>
                  <td className="py-1 pr-2"><input aria-label={`Line ${i + 1}: estimated cost of one`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} /></td>
                  <td className="py-1">{rows.length > 1 && <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button onClick={() => setRows([...rows, emptyRow()])} disabled={rows.length >= 50}>+ Add a line</Button>
          <span className="text-sm">About <b className="tabular-nums">{peso(total)}</b> in all</span>
        </div>
      </Panel>
      <Field label="Note"><textarea rows={2} className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      <p className="text-sm text-slate-500">The owner or the accountant approves it. Once approved, it becomes a purchase order, or an expense voucher when it is bought and paid on the spot.</p>
    </PurFrame>
  );
}
