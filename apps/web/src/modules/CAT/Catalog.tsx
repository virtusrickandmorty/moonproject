import { useCallback, useEffect, useState } from 'react';
import { parsePesos } from '@moonproject/shared';
import type { Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { masterRequest } from '../CUS/http.ts';

type Item = { id: string; code: string; name: string; class: 'made_to_order_garment' | 'service' | 'ready_made_item';
  garment_type: string | null; unit: 'pc' | 'set'; set_components: number; is_active: number; version: number };
type Price = { id: string; effectiveFrom: string; minQty: number; unitPriceCents: number; createdAt: string };
type Detail = Item & { prices: Price[] };
const classes = { made_to_order_garment: 'Made-to-order garment', service: 'Service', ready_made_item: 'Ready-made item' };
const moneyCents = (s: string) => {
  try { const cents = parsePesos(s); return cents >= 0 ? cents : null; }
  catch { return null; }
};

export function Catalog({ me }: { me: Me }) {
  const [rows, setRows] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [error, setError] = useState('');
  const canManage = me.permissions.includes('cat.manage');
  const load = useCallback(async () => {
    try { setRows(await masterRequest<Item[]>(me, `/api/cat/items?${new URLSearchParams({ search, offset: String(offset), limit: '25' })}`)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, [me, search, offset]);
  const open = async (id: string) => {
    try { setSelected(await masterRequest<Detail>(me, `/api/cat/items/${id}`)); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [load]);
  return <div className="max-w-5xl space-y-4">
    <div className="flex items-center gap-3"><h1 className="flex-1 text-2xl font-semibold">Catalog</h1>
      {canManage && <Button tone="primary" onClick={() => setEditing('new')}>+ New item</Button>}</div>
    {error && <Notice>{error}</Notice>}
    <input aria-label="Search catalog" placeholder="Search name or code" className={`${inputClass} max-w-md`} value={search}
      onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
    <Panel title="Items"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
      <th>Code</th><th>Name</th><th>Class</th><th>Unit</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id} className="border-t">
        <td className="py-2">{r.code}</td><td><button className="text-indigo-700 underline" onClick={() => void open(r.id)}>{r.name}</button></td>
        <td>{classes[r.class]}</td><td>{r.unit}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table>
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No items found.</p>}</div>
      <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button>
        <Button disabled={rows.length < 25} onClick={() => setOffset(offset + 25)}>Next</Button></div></Panel>
    {selected && <ItemDetail me={me} data={selected} onEdit={() => setEditing(selected)} onClose={() => setSelected(null)} onRefresh={async () => { await load(); await open(selected.id); }} />}
    {editing && <ItemEditor me={me} row={editing} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await load(); await open(id); }} />}
  </div>;
}

function ItemEditor({ me, row, onClose, onSaved }: { me: Me; row: Item | 'new'; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const old = row === 'new' ? null : row;
  const [v, setV] = useState({ code: old?.code ?? '', name: old?.name ?? '', class: old?.class ?? 'made_to_order_garment',
    garmentType: old?.garment_type ?? '', unit: old?.unit ?? 'pc', setComponents: old?.set_components ?? 1 });
  const [error, setError] = useState('');
  const save = async () => {
    try {
      const body = { ...v, garmentType: v.class === 'made_to_order_garment' ? v.garmentType.trim() : null,
        setComponents: v.unit === 'pc' ? 1 : v.setComponents };
      const saved = await masterRequest<Item>(me, old ? `/api/cat/items/${old.id}` : '/api/cat/items', old ? 'PUT' : 'POST', body, old?.version);
      await onSaved(saved.id);
    } catch (e) { setError((e as Error).message); }
  };
  return <Panel title={old ? `Edit ${old.name}` : 'New catalog item'}><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Code" required><input className={inputClass} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
    <Field label="Name" required><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
    <Field label="Class" required><select className={inputClass} value={v.class} onChange={(e) => setV({ ...v, class: e.target.value as Item['class'] })}>
      {Object.entries(classes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></Field>
    {v.class === 'made_to_order_garment' && <Field label="Garment type" required><input className={inputClass} value={v.garmentType}
      onChange={(e) => setV({ ...v, garmentType: e.target.value })} /></Field>}
    <Field label="Unit" required><select className={inputClass} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as Item['unit'] })}>
      <option value="pc">Piece</option><option value="set">Set</option></select></Field>
    {v.unit === 'set' && <Field label="Components per set" required><input type="number" min="1" className={inputClass} value={v.setComponents}
      onChange={(e) => setV({ ...v, setComponents: Number(e.target.value) })} /></Field>}
  </div>{error && <Notice>{error}</Notice>}<div className="flex gap-2"><Button tone="primary" disabled={!v.code.trim() || !v.name.trim()} onClick={() => void save()}>Save</Button>
    <Button onClick={onClose}>Cancel</Button></div></Panel>;
}

function ItemDetail({ me, data, onEdit, onClose, onRefresh }: { me: Me; data: Detail; onEdit: () => void; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [minQty, setMinQty] = useState(1);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const savePrice = async () => {
    try {
      const cents = moneyCents(amount);
      if (cents === null) throw new Error('Enter a price with at most two decimal places.');
      await masterRequest(me, `/api/cat/items/${data.id}/prices`, 'POST', { effectiveFrom, minQty, unitPriceCents: cents }, data.version);
      setAmount(''); setError(''); await onRefresh();
    } catch (e) { setError((e as Error).message); }
  };
  return <div className="space-y-4"><Panel title={`${data.name} · ${data.code}`}>
    <p className="text-sm text-slate-600">{classes[data.class]} · {data.unit} · {data.is_active ? 'Active' : 'Inactive'}</p>
    {data.garment_type && <p>Garment type: {data.garment_type}</p>}
    {me.permissions.includes('cat.manage') && data.is_active === 1 && <Button onClick={onEdit}>Edit item</Button>} <Button onClick={onClose}>Close</Button>
  </Panel><Panel title="Price history"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
    <th>Effective from</th><th>Minimum quantity</th><th className="text-right">Price per {data.unit}</th></tr></thead><tbody>
    {data.prices.map((p) => <tr key={p.id} className="border-t"><td className="py-2">{p.effectiveFrom}</td><td>{p.minQty}</td>
      <td className="text-right tabular-nums">{peso(p.unitPriceCents)}</td></tr>)}</tbody></table>
    {data.prices.length === 0 && <p className="py-2 text-sm text-slate-500">No prices yet.</p>}</div></Panel>
    {me.permissions.includes('cat.price.manage') && data.is_active === 1 && <Panel title="New effective-dated price"><div className="grid gap-3 sm:grid-cols-3">
      <Field label="Effective from" required><input type="date" className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
      <Field label="Minimum quantity" required><input type="number" min="1" className={inputClass} value={minQty} onChange={(e) => setMinQty(Number(e.target.value))} /></Field>
      <Field label="Price per unit" required><input inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      <p className="text-sm text-slate-500">Earlier prices stay in the history. The newest applicable date and quantity tier is used.</p>
      {error && <Notice>{error}</Notice>}<Button tone="primary" disabled={!effectiveFrom || !Number.isInteger(minQty) || minQty < 1 || moneyCents(amount) === null}
        onClick={() => void savePrice()}>Save price</Button></Panel>}
  </div>;
}
