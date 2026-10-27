/**
 * Purchase request form (PRQ-, the owner's request, 26 Oct 2026): what it is for, by when, from whom if known, and each
 * thing with its quantity and an estimated cost of one unit: a supply on file (its name and last cost fill in) or
 * something described only. Recording it sends it to the owner or the accountant for approval. Also its Edit (cancel and
 * reissue, NR-4), which waits for a new decision.
 * Laid out like the purchase order (26 Oct 2026): each thing in its own card, and beside them what is asked for with the
 * estimate and what happens next.
 */
import { useState } from 'react';
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import { api, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, Field, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { cents } from '../COL/money.ts';
import { SupplierSelect, useList } from '../AP/parts.tsx';
import { PurFrame, usePurForm } from './PurForm.tsx';
import { UNIT_WORDS, qtyCents, qtyOf } from './purchasing.ts';
import { Journey } from './parts.tsx';
import { SearchSelect } from '../../components/SearchSelect.tsx';

interface Row { supplyId: string; description: string; qty: string; unitCost: string }
type Stored = { purpose: string; neededBy?: string; supplierId?: string; note?: string; lines: { supplyId?: string; description: string; qty: number; unitCostCents: number }[] };
const emptyRow = (): Row => ({ supplyId: '', description: '', qty: '', unitCost: '' });
const lineTotal = (r: Row) => { const q = qtyOf(r.qty), c = cents(r.unitCost || '0'); return q !== undefined && c !== undefined && c >= 0 ? qtyCents(q, c) : undefined; };

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
    const qty = qtyOf(r.qty), cost = cents(r.unitCost || '0');
    if (r.description.trim().length < 2) errors.push(`Line ${i + 1}: say what it is.`);
    if (qty === undefined) errors.push(`Line ${i + 1}: type the quantity, like 10 or 2.5.`);
    if (cost === undefined || cost < 0) errors.push(`Line ${i + 1}: type the estimated cost of one, like 150.00.`);
    return [{ ...(r.supplyId ? { supplyId: r.supplyId } : {}), description: r.description.trim(), qty: qty ?? 0, unitCostCents: cost ?? 0 }];
  });
  if (lines.length === 0) errors.push('Add what is needed.');
  const total = lines.reduce((n, l) => n + (l.qty > 0 ? qtyCents(l.qty, l.unitCostCents) : 0), 0);
  const input = {
    purpose: purpose.trim(), ...(neededBy ? { neededBy } : {}), ...(supplierId ? { supplierId } : {}), ...(note.trim() ? { note: note.trim() } : {}), lines,
  };

  const side = (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Asked for</p>
      {lines.length === 0 && <p className="text-sm text-slate-500">Nothing yet. Add what is needed on the left.</p>}
      <ol className="divide-y divide-slate-100">
        {rows.map((r, i) => {
          const t = lineTotal(r);
          if (!r.description.trim() && !r.qty.trim()) return null;
          return (
            <li key={i} className="flex justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0"><span className="text-slate-400">{i + 1}.</span> {r.description || 'Something'} <span className="text-slate-500">× {r.qty || '0'}</span></span>
              <span className="shrink-0 tabular-nums">{t === undefined ? '—' : peso(t)}</span>
            </li>
          );
        })}
      </ol>
      <p className="flex justify-between border-t border-slate-200 pt-2 text-sm"><span>About, in all</span><b className="tabular-nums">{peso(total)}</b></p>
      <Journey label="What happens next" stacked steps={[
        { label: 'You ask', state: 'now', note: 'Record this request' },
        { label: 'Approved', state: 'later', note: 'By the owner or the accountant' },
        { label: 'Ordered or paid', state: 'later', note: 'A purchase order, or an expense' },
      ]} />
    </div>
  );

  return (
    <PurFrame type={type} form={form} title="New purchase request" input={input} errors={errors} showTotal wide side={side}>
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
        <Field label="Note" hint="Optional: anything the approver should know">
          <textarea rows={2} className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Panel>
      <Panel title="What is needed?">
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const s = supplies.find((x) => x.id === r.supplyId);
            const t = lineTotal(r);
            return (
              <li key={i} className="rounded-lg p-3 ring-1 ring-slate-200">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thing {i + 1}</span>
                  {rows.length > 1 && <button type="button" className="text-xs text-red-700 underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Supply on file" hint={s ? `Counted by the ${UNIT_WORDS[s.unit].toLowerCase()}` : 'Or leave it as None and describe it'}>
                    <SearchSelect aria-label={`Line ${i + 1}: supply on file`} value={r.supplyId} onChange={(id) => pickSupply(i, id)} emptyLabel="None: describe it"
                      choices={supplies.map((x) => ({ value: x.id, label: `${x.name} (${UNIT_WORDS[x.unit].toLowerCase()})` }))} />
                  </Field>
                  <Field label="What it is">
                    <input aria-label={`Line ${i + 1}: what it is`} className={inputClass} value={r.description} maxLength={200} onChange={(e) => set(i, { description: e.target.value })} />
                  </Field>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Quantity">
                    <input aria-label={`Line ${i + 1}: quantity`} inputMode="decimal" placeholder="0" className={`${inputClass} text-right tabular-nums`} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                  </Field>
                  <Field label="Estimated cost of one">
                    <input aria-label={`Line ${i + 1}: estimated cost of one`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
                  </Field>
                  <div className="col-span-2 flex items-end justify-between rounded-md bg-slate-50 px-3 py-2 text-sm sm:col-span-1 sm:block">
                    <span className="block text-xs text-slate-500">Estimate</span>
                    <b className="block tabular-nums">{t === undefined ? '—' : peso(t)}</b>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button onClick={() => setRows([...rows, emptyRow()])} disabled={rows.length >= 50}>+ Add another thing</Button>
          <span className="text-sm">About <b className="tabular-nums">{peso(total)}</b> in all</span>
        </div>
      </Panel>
    </PurFrame>
  );
}
