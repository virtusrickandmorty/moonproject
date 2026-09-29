import { useCallback, useEffect, useState } from 'react';
import { api, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { CLASS_LABELS as classes, PAGE_SIZE, blankItem, catalogCalls, moneyCents, typeLocked, valuesOf, type Detail, type Item, type ItemValues } from './catalog.ts';

export function Catalog({ me }: { me: Me }) {
  const [rows, setRows] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<Detail | 'new' | null>(null);
  const [error, setError] = useState('');
  const canView = me.permissions.includes('cat.view');
  const canManage = me.permissions.includes('cat.manage');
  const calls = catalogCalls(me);
  const load = useCallback(async () => {
    if (!canView) return;
    try { setRows(await calls.list(search, offset)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, [me, canView, search, offset]);
  const open = async (id: string) => {
    try { setSelected(await calls.open(id)); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [load]);
  if (!canView) return <Notice>You do not have permission to see the price list.</Notice>;
  return <div className="max-w-5xl space-y-4">
    <div className="flex items-center gap-3"><h1 className="flex-1 text-2xl font-semibold">Price list</h1>
      {canManage && <Button tone="primary" onClick={() => setEditing('new')}>+ New item</Button>}</div>
    {error && <Notice>{error}</Notice>}
    <input aria-label="Search catalog" placeholder="Search name or code" className={`${inputClass} max-w-md`} value={search}
      onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
    <Panel title="Items"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
      <th>Code</th><th>Name</th><th>Class</th><th>Unit</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id} className="border-t">
        <td className="py-2">{r.code}</td><td><button className="text-indigo-700 underline" onClick={() => void open(r.id)}>{r.name}</button></td>
        <td>{classes[r.class]}</td><td>{r.unit}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table>
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No items found.</p>}</div>
      <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
        <Button disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button></div></Panel>
    {selected && <ItemDetail me={me} data={selected} onEdit={() => setEditing(selected)} onClose={() => setSelected(null)}
      onRefresh={async () => { await load(); await open(selected.id); }} />}
    {editing && <ItemEditor me={me} row={editing} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await load(); await open(id); }} />}
  </div>;
}

export function ItemEditor({ me, row, onClose, onSaved }: { me: Me; row: Detail | 'new'; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const old = row === 'new' ? null : row;
  const locked = typeLocked(old);
  const [v, setV] = useState<ItemValues>(old ? valuesOf(old) : blankItem());
  const save = useAction();
  const submit = () => save.run(async () => {
    const calls = catalogCalls(me);
    const saved = old ? await calls.update(old, v) : await calls.create(v);
    await onSaved(saved.id);
  });
  return <Panel title={old ? `Edit ${old.name}` : 'New catalog item'}><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Code" required><input className={inputClass} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
    <Field label="Name" required><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
    <Field label="Class" required><select disabled={locked} className={inputClass} value={v.class} onChange={(e) => setV({ ...v, class: e.target.value as ItemValues['class'] })}>
      {Object.entries(classes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></Field>
    {v.class === 'made_to_order_garment' && <Field label="Garment type" required><input disabled={locked} className={inputClass} value={v.garmentType}
      onChange={(e) => setV({ ...v, garmentType: e.target.value })} /></Field>}
    <Field label="Unit" required><select disabled={locked} className={inputClass} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as ItemValues['unit'] })}>
      <option value="pc">Piece</option><option value="set">Set</option></select></Field>
    {v.unit === 'set' && <Field label="Components per set" required><input type="number" min="1" disabled={locked} className={inputClass} value={v.setComponents}
      onChange={(e) => setV({ ...v, setComponents: Number(e.target.value) })} /></Field>}
  </div>{locked && <p className="text-sm text-slate-500">This item has prices, so its class, garment type and unit cannot change. Deactivate it and add a new item instead.</p>}
    {save.error && <Notice>{save.error}</Notice>}<div className="flex gap-2"><Button tone="primary" disabled={save.busy || !v.code.trim() || !v.name.trim() || (v.class === 'made_to_order_garment' && !v.garmentType.trim())}
      onClick={() => void submit()}>Save</Button><Button onClick={onClose}>Cancel</Button></div></Panel>;
}

function ItemDetail({ me, data, onEdit, onClose, onRefresh }: { me: Me; data: Detail; onEdit: () => void; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [today, setToday] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [minQty, setMinQty] = useState(1);
  const [amount, setAmount] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const price = useAction();
  const off = useAction();
  const canManage = me.permissions.includes('cat.manage');
  const active = data.is_active === 1;
  // A new price starts today or later (the server refuses an earlier date); the server's own date is the default.
  useEffect(() => { void api.health().then((h) => { setToday(h.serverTime.slice(0, 10)); setEffectiveFrom((d) => d || h.serverTime.slice(0, 10)); }, () => undefined); }, []);
  const savePrice = () => price.run(async () => {
    const cents = moneyCents(amount);
    if (cents === null) throw new Error('Enter a price with at most two decimal places.');
    await catalogCalls(me).addPrice(data, { effectiveFrom, minQty, unitPriceCents: cents });
    setAmount('');
    await onRefresh();
  });
  const deactivate = () => off.run(async () => { await catalogCalls(me).deactivate(data); setConfirmOff(false); await onRefresh(); });
  return <div className="space-y-4"><Panel title={`${data.name} · ${data.code}`}>
    <p className="text-sm text-slate-600">{classes[data.class]} · {data.unit} · {active ? 'Active' : 'Inactive'}</p>
    {data.garment_type && <p>Garment type: {data.garment_type}</p>}
    <div className="flex gap-2">{canManage && active && <Button onClick={onEdit}>Edit item</Button>}
      {canManage && active && <Button tone="danger" onClick={() => setConfirmOff(true)}>Deactivate</Button>} <Button onClick={onClose}>Close</Button></div>
  </Panel><Panel title="Price history"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
    <th>Effective from</th><th>Minimum quantity</th><th className="text-right">Price per {data.unit}</th></tr></thead><tbody>
    {data.prices.map((p) => <tr key={p.id} className="border-t"><td className="py-2">{p.effectiveFrom}</td><td>{p.minQty}</td>
      <td className="text-right tabular-nums">{peso(p.unitPriceCents)}</td></tr>)}</tbody></table>
    {data.prices.length === 0 && <p className="py-2 text-sm text-slate-500">No prices yet. A quotation cannot use this item until it has one.</p>}</div></Panel>
    {me.permissions.includes('cat.price.manage') && active && <Panel title="New effective-dated price"><div className="grid gap-3 sm:grid-cols-3">
      <Field label="Effective from" required><input type="date" min={today || undefined} className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
      <Field label="Minimum quantity" required><input type="number" min="1" className={inputClass} value={minQty} onChange={(e) => setMinQty(Number(e.target.value))} /></Field>
      <Field label="Price per unit" required><input inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
      <p className="text-sm text-slate-500">Prices include VAT. Earlier prices stay in the history. The newest applicable date and quantity tier is used.</p>
      {price.error && <Notice>{price.error}</Notice>}<Button tone="primary" disabled={price.busy || !effectiveFrom || !Number.isInteger(minQty) || minQty < 1 || moneyCents(amount) === null}
        onClick={() => void savePrice()}>Save price</Button></Panel>}
    {confirmOff && <Dialog title={`Deactivate ${data.name}?`} onClose={() => setConfirmOff(false)}>
      <p className="text-sm text-slate-700">It stays in the price list and on old quotations, but new quotations cannot use it. An item cannot be turned back on, so add a new item if you need it again.</p>
      {off.error && <Notice>{off.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={() => setConfirmOff(false)}>Go back</Button>
        <Button tone="danger" disabled={off.busy} onClick={() => void deactivate()}>Deactivate</Button></div></Dialog>}
  </div>;
}
