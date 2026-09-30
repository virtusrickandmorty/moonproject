/** The supplies catalogue (PLAN E9): the list with search and status, add, change (If-Match) and deactivate, for pur.supply.edit. */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PurStatus, type SupplyRecord } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { CATEGORY_WORDS, UNIT_WORDS, emptySupplyForm, filterSupplies, supplyToForm, supplyToInput, type SupplyForm } from './purchasing.ts';

export function Supplies({ me }: { me: Me }) {
  const [rows, setRows] = useState<SupplyRecord[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurStatus>('active');
  const [editing, setEditing] = useState<SupplyRecord | 'new' | null>(null);
  const [error, setError] = useState('');
  const canEdit = me.permissions.includes('pur.supply.edit');
  const load = useCallback(() => api.supplyList(status).then((r) => (setRows(r), setError('')), (e: Error) => setError(e.message)), [status]);
  useEffect(() => void load(), [load]);
  const shown = rows && filterSupplies(rows, search);
  const a = useAction();

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Supplies</h1>
        {canEdit && editing !== 'new' && <Button tone="primary" onClick={() => setEditing('new')}>+ New supply</Button>}
      </div>
      {editing && <SupplyEditor key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />}
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Search supplies" placeholder="Search supplies" className={`${inputClass} max-w-xs`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Show" className={`${inputClass} max-w-40`} value={status} onChange={(e) => setStatus(e.target.value as PurStatus)}>
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </select>
      </div>
      {(error || a.error) && <Notice>{error || a.error}</Notice>}
      {shown && (
        <table className="w-full rounded-lg bg-white text-sm shadow-sm ring-1 ring-slate-200 [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2">
          <thead className="text-left text-slate-500"><tr><th>Name</th><th>Unit</th><th>Kind</th><th className="text-right">Last purchase cost</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className={`border-t border-slate-100 ${s.is_active ? '' : 'text-slate-500'}`}>
                <td><Link to={`/pur/supplies/${s.id}`} className="underline">{s.name}</Link></td><td>{UNIT_WORDS[s.unit]}</td><td>{CATEGORY_WORDS[s.category]}</td>
                <td className="text-right tabular-nums">{peso(s.purchase_cost_cents)}<div className="text-xs text-slate-500">{costSource(s)}</div></td>
                <td>{s.is_active ? 'Active' : 'Inactive'}</td>
                <td className="space-x-2 text-right">
                  {canEdit && s.is_active === 1 && <Button onClick={() => setEditing(s)}>Change</Button>}
                  {canEdit && s.is_active === 1 && <Button disabled={a.busy} onClick={() => a.run(async () => { await api.deactivateSupply(s.id, s.version); await load(); })}>Deactivate</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown?.length === 0 && <p className="text-sm text-slate-500">No supply matches.</p>}
    </div>
  );
}

export const costSource = (s: SupplyRecord) => s.purchase_cost_source_number
  ? `${s.purchase_cost_source === 'bill' ? 'Bill' : 'PO'} ${s.purchase_cost_source_number} · ${s.purchase_cost_source_date}`
  : 'Catalogue figure';

function SupplyEditor({ row, onClose, onSaved }: { row: SupplyRecord | null; onClose: () => void; onSaved: () => unknown }) {
  const [v, setV] = useState<SupplyForm>(row ? supplyToForm(row) : emptySupplyForm());
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { input, errors } = supplyToInput(v);
  const save = () => a.run(async () => { await (row ? api.updateSupply(row.id, row.version, input) : api.addSupply(input)); await onSaved(); });
  return (
    <Panel title={row ? `Change ${row.name}` : 'New supply'}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Unit" required>
          <select className={inputClass} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as SupplyForm['unit'] })}>
            {Object.entries(UNIT_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
          </select>
        </Field>
        <Field label="Kind" required>
          <select className={inputClass} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as SupplyForm['category'] })}>
            {Object.entries(CATEGORY_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
          </select>
        </Field>
      </div>
      {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex gap-2">
        <Button tone="primary" disabled={a.busy} onClick={() => (setTouched(true), errors.length === 0 && save())}>{row ? 'Save changes' : 'Add supply'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Panel>
  );
}
