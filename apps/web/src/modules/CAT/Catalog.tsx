/**
 * Sales › Price list & piece rates (PLAN E2, E7 RATE; merged on the owner's request, Oct 2026): every item with its
 * selling prices and, for a made-to-order garment, its labour (piece) rates per step, in one modal. A set is made as an
 * upper and a lower part, each paid at its own rate. A new item's code is always the server's (MTO-0001, SRV-0001,
 * RTW-0001), and its name is what its piece rates go by (the owner's decision, Oct 2026: no garment type or complexity
 * is typed). Prices and rates are effective-dated: earlier ones stay in the history.
 */
import { useLiveChange } from '../../live.ts';
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PieceRate, type PrdStep } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Dialog, Field, Notice, Panel, inputClass, peso, useAction, searchClass, searchRowClass, showDate } from '../../components/ui.tsx';
import { cents } from '../COL/money.ts';
import { CLASS_LABELS as classes, PAGE_SIZE, blankItem, catalogCalls, moneyCents, typeLocked, valuesOf, type Detail, type Item, type ItemValues } from './catalog.ts';

const unitWords = (r: Pick<Item, 'unit'>) => (r.unit === 'set' ? 'Set (upper and lower)' : 'Piece');

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
  useLiveChange(() => void load()); // an item added or changed on another computer shows here
  if (!canView) return <Notice>You do not have permission to see the price list.</Notice>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="flex-1 text-2xl font-semibold">Price list & piece rates</h1>
      {me.permissions.includes('rate.view') && <Link to="/prd/rates" className="text-sm text-indigo-700 underline">All piece rates and their history</Link>}
      {canManage && <Button tone="primary" onClick={() => setEditing('new')}>+ New item</Button>}</div>
    {error && <Notice>{error}</Notice>}
    <div className={searchRowClass}><input aria-label="Search catalog" placeholder="Search name or code" className={`${inputClass} ${searchClass}`} value={search}
      onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></div>
    <div className="overflow-x-auto rounded-lg bg-white p-2 shadow-sm"><table className="w-full text-sm"><thead><tr>
      <th>Code</th><th>Name</th><th>Kind</th><th>Unit</th><th>Status</th></tr></thead><tbody>{rows.map((r) => (
        <tr key={r.id} onClick={() => void open(r.id)} className={`cursor-pointer ${r.is_active ? '' : 'text-slate-400'}`}>
          <td className="whitespace-nowrap font-medium">{r.code}</td>
          <td><button type="button" className="text-left text-indigo-700 hover:underline" onClick={(e) => (e.stopPropagation(), void open(r.id))}>{r.name}</button></td>
          <td>{classes[r.class]}</td><td>{unitWords(r)}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td></tr>))}</tbody></table>
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No items found.</p>}</div>
    <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
      <Button disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button></div>
    {selected && !editing && <Dialog wide title={`${selected.name} · ${selected.code}`} onClose={() => setSelected(null)}>
      <ItemDetail me={me} data={selected} onEdit={() => setEditing(selected)} onRefresh={async () => { await load(); await open(selected.id); }} />
    </Dialog>}
    {editing && <Dialog wide title={editing === 'new' ? 'New item' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
      <ItemEditor me={me} row={editing} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await load(); await open(id); }} />
    </Dialog>}
  </div>;
}

export function ItemEditor({ me, row, onClose, onSaved }: { me: Me; row: Detail | 'new'; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const old = row === 'new' ? null : row;
  const locked = typeLocked(old);
  const [v, setV] = useState<ItemValues>(old ? valuesOf(old) : blankItem());
  const save = useAction();
  const submit = () => save.run(async () => {
    const calls = catalogCalls(me);
    // A new garment's piece rates go by its name; an edit keeps what its rates were set under (a rename keeps its rates).
    const values = { ...v, code: old ? v.code : '', garmentType: old?.garment_type ?? v.name };
    const saved = old ? await calls.update(old, values) : await calls.create(values);
    await onSaved(saved.id);
  });
  return <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Name" required><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
    <Field label="Kind" required><select disabled={locked} className={inputClass} value={v.class} onChange={(e) => setV({ ...v, class: e.target.value as ItemValues['class'] })}>
      {Object.entries(classes).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></Field>
    <Field label="Unit" required hint={v.unit === 'set' ? 'A set is made as an upper and a lower part, each with its own piece rate.' : undefined}>
      <select disabled={locked} className={inputClass} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as ItemValues['unit'], setComponents: e.target.value === 'set' ? 2 : 1 })}>
        <option value="pc">Piece</option><option value="set">Set (upper and lower)</option></select></Field>
  </div>{locked && <p className="text-sm text-slate-500">This item has prices, so its kind and unit cannot change. Deactivate it and add a new item instead.</p>}
    {save.error && <Notice>{save.error}</Notice>}<div className="flex gap-2"><Button tone="primary" disabled={save.busy || !v.name.trim()}
      onClick={() => void submit()}>Save</Button><Button onClick={onClose}>Cancel</Button></div></div>;
}

function ItemDetail({ me, data, onEdit, onRefresh }: { me: Me; data: Detail; onEdit: () => void; onRefresh: () => Promise<void> }) {
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
    const c = moneyCents(amount);
    if (c === null) throw new Error('Enter a price with at most two decimal places.');
    await catalogCalls(me).addPrice(data, { effectiveFrom, minQty, unitPriceCents: c });
    setAmount('');
    await onRefresh();
  });
  const deactivate = () => off.run(async () => { await catalogCalls(me).deactivate(data); setConfirmOff(false); await onRefresh(); });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span>{classes[data.class]} · {unitWords(data)} · {active ? 'Active' : 'Inactive'}</span>
      <span className="flex-1" />
      {canManage && active && <Button onClick={onEdit}>Edit item</Button>}
      {canManage && active && <Button tone="danger" onClick={() => setConfirmOff(true)}>Deactivate</Button>}
    </div>
    <Panel title={`Selling price per ${data.unit === 'set' ? 'set' : 'piece'}`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
      <th>Effective from</th><th>Minimum quantity</th><th className="text-right">Price</th></tr></thead><tbody>
      {data.prices.map((p) => <tr key={p.id}><td>{showDate(p.effectiveFrom)}</td><td>{p.minQty}</td>
        <td className="text-right tabular-nums">{peso(p.unitPriceCents)}</td></tr>)}</tbody></table>
      {data.prices.length === 0 && <p className="py-2 text-sm text-slate-500">No prices yet. A quotation cannot use this item until it has one.</p>}</div>
      {me.permissions.includes('cat.price.manage') && active && <div className="space-y-2 border-t border-slate-100 pt-3"><div className="grid gap-3 sm:grid-cols-3">
        <Field label="New price from" required><input type="date" min={today || undefined} className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
        <Field label="Minimum quantity" required><input type="number" min="1" className={inputClass} value={minQty} onChange={(e) => setMinQty(Number(e.target.value))} /></Field>
        <Field label="Price (VAT included)" required><input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
        {price.error && <Notice>{price.error}</Notice>}<Button tone="primary" disabled={price.busy || !effectiveFrom || !Number.isInteger(minQty) || minQty < 1 || moneyCents(amount) === null}
          onClick={() => void savePrice()}>Save price</Button></div>}
    </Panel>
    {data.class === 'made_to_order_garment' && data.garment_type && me.permissions.includes('rate.view') && <LabourRates me={me} item={data} />}
    {confirmOff && <Dialog title={`Deactivate ${data.name}?`} onClose={() => setConfirmOff(false)}>
      <p className="text-sm text-slate-700">It stays in the price list and on old quotations, but new quotations cannot use it. An item cannot be turned back on, so add a new item if you need it again.</p>
      {off.error && <Notice>{off.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={() => setConfirmOff(false)}>Go back</Button>
        <Button tone="danger" disabled={off.busy} onClick={() => void deactivate()}>Deactivate</Button></div></Dialog>}
  </div>;
}

/** The item's labour (piece) rates in force today, per step; a set's upper and lower apart. They go by the item (standard rates). */
function LabourRates({ me, item }: { me: Me; item: Detail }) {
  const [rates, setRates] = useState<{ asOf: string; current: PieceRate[] } | null>(null);
  const [steps, setSteps] = useState<PrdStep[]>([]);
  const [error, setError] = useState('');
  const set = item.unit === 'set';
  const parts = set ? (['upper', 'lower'] as const) : (['whole'] as const);
  const load = useCallback(() => api.rates().then((t) => setRates({ asOf: t.asOf, current: t.current }), (e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); api.prdCatalogue().then((c) => setSteps(c.steps), () => undefined); }, [load]);
  if (error) return <Notice>{error}</Notice>;
  const mine = (rates?.current ?? []).filter((r) => r.garmentType.toLowerCase() === item.garment_type!.toLowerCase() && r.complexity === 'standard');
  const keys = [...new Map(mine.map((r) => [r.stepCode, r])).values()]
    .sort((a, b) => steps.findIndex((s) => s.code === a.stepCode) - steps.findIndex((s) => s.code === b.stepCode));
  const rateOf = (stepCode: string, complexity: string, part: string) => mine.find((r) => r.stepCode === stepCode && r.complexity === complexity && (r.part ?? 'whole') === part);
  const stepName = (code: string) => steps.find((s) => s.code === code)?.name ?? code;
  return <Panel title="Labour (piece rates)">
    {!rates ? <p className="text-sm text-slate-500">Loading…</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
      <th>Step</th>{parts.map((p) => <th key={p} className="text-right">{p === 'whole' ? 'Per piece' : p === 'upper' ? 'Upper part' : 'Lower part'}</th>)}</tr></thead><tbody>
      {keys.map((k) => <tr key={k.stepCode}><td>{stepName(k.stepCode)}</td>
        {parts.map((p) => { const r = rateOf(k.stepCode, 'standard', p); return <td key={p} className="text-right tabular-nums">{r ? peso(r.rateCents) : <span className="text-slate-400">—</span>}</td>; })}</tr>)}
    </tbody></table>
      {keys.length === 0 && <p className="py-2 text-sm text-slate-500">No piece rate for {item.name} yet{set ? ' (upper or lower)' : ''}. Production can still record its pieces with a typed rate.</p>}</div>}
    {rates && me.permissions.includes('rate.manage') && <NewRate garmentType={item.garment_type!} itemName={item.name} parts={parts} asOf={rates.asOf} steps={steps} onSaved={load} />}
  </Panel>;
}

function NewRate({ garmentType, itemName, parts, asOf, steps, onSaved }: { garmentType: string; itemName: string; parts: readonly ('whole' | 'upper' | 'lower')[]; asOf: string; steps: PrdStep[]; onSaved: () => Promise<unknown> }) {
  const blank = { stepCode: 'SEWING', complexity: 'standard', part: parts[0]!, rate: '', effectiveFrom: asOf, reason: '' };
  const [v, setV] = useState(blank);
  const [done, setDone] = useState('');
  const a = useAction();
  const rateCents = cents(v.rate);
  const ready = rateCents !== undefined && v.rate.trim() && v.reason.trim().length >= 10;
  const save = async () => {
    const r = await api.addRate({ garmentType, stepCode: v.stepCode, complexity: v.complexity, ...(v.part !== 'whole' ? { part: v.part } : {}), rateCents: rateCents!, effectiveFrom: v.effectiveFrom, reason: v.reason.trim() });
    setDone(`${itemName}${v.part !== 'whole' ? ` (${v.part} part)` : ''}: ${steps.find((s) => s.code === r.stepCode)?.name ?? r.stepCode} is ${peso(r.rateCents)} per piece from ${showDate(r.effectiveFrom)}.`);
    setV(blank);
    await onSaved();
  };
  return <div className="space-y-2 border-t border-slate-100 pt-3">
    <p className="text-sm font-medium">New piece rate for {itemName}</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Step" required><select className={inputClass} value={v.stepCode} onChange={(e) => setV({ ...v, stepCode: e.target.value })}>{steps.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
      {parts.length > 1 && <Field label="Part" required><select className={inputClass} value={v.part} onChange={(e) => setV({ ...v, part: e.target.value as typeof v.part })}>
        <option value="upper">Upper part</option><option value="lower">Lower part</option></select></Field>}
      <Field label="Rate per piece" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></Field>
      <Field label="From (today or later)" required><input type="date" min={asOf} className={inputClass} value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} /></Field>
      <Field label="Why (at least 10 characters)" required hint="Kept in the rate history: who changed a rate, when and why (e.g. owner raised the sewing rate)."><input className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
    </div>
    {a.error && <Notice>{a.error}</Notice>}
    {done && <Notice tone="success">{done}</Notice>}
    <Button tone="primary" disabled={!ready || a.busy} onClick={() => a.run(save)}>Save rate</Button>
  </div>;
}
