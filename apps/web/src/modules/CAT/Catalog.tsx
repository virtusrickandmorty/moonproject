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
import { Loading, Button, Dialog, Field, Notice, Panel, inputClass, peso, useAction, searchClass, searchRowClass, showDate } from '../../components/ui.tsx';
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
      {canManage && <Button tone="primary" onClick={() => setEditing('new')}>+ New item</Button>}</div>
    {error && <Notice>{error}</Notice>}
    <div className={searchRowClass}><input aria-label="Search catalog" placeholder="Search name or code" className={`${inputClass} ${searchClass}`} value={search}
      onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></div>
    <div className="overflow-x-auto rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-200/70"><table className="w-full text-sm"><thead><tr>
      <th>Code</th><th>Name</th><th>Kind</th><th>Unit</th><th>Status</th></tr></thead><tbody>{rows.map((r) => (
        <tr key={r.id} onClick={() => void open(r.id)} className={`cursor-pointer ${r.is_active ? '' : 'text-slate-400'}`}>
          <td className="whitespace-nowrap font-medium">{r.code}</td>
          <td><button type="button" className="text-left text-indigo-700 hover:underline" onClick={(e) => (e.stopPropagation(), void open(r.id))}>{r.name}</button></td>
          <td>{classes[r.class]}</td><td>{unitWords(r)}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td></tr>))}</tbody></table>
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No items found.</p>}</div>
    <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
      <Button disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button></div>
    {me.permissions.includes('rate.view') && <UnmatchedRates />}
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

const COMPLEXITIES = ['simple', 'standard', 'complex'] as const;
const LEVEL: Record<string, string> = { simple: 'Simple', standard: 'Standard', complex: 'Complex' };
const PART: Record<string, string> = { whole: '', upper: 'Upper part', lower: 'Lower part' };

/**
 * The item's labour (piece) rates in force today, per step and difficulty (simple, standard, complex: a job order item is
 * set up at one of them on the board); a set's upper and lower apart; and every rate it ever had (the owner's request,
 * Oct 2026: the price list holds all piece rates, so the separate Piece rates screen is gone).
 */
function LabourRates({ me, item }: { me: Me; item: Detail }) {
  const [rates, setRates] = useState<{ asOf: string; current: PieceRate[]; history: PieceRate[] } | null>(null);
  const [steps, setSteps] = useState<PrdStep[]>([]);
  const [error, setError] = useState('');
  const set = item.unit === 'set';
  const parts = set ? (['upper', 'lower'] as const) : (['whole'] as const);
  const load = useCallback(() => api.rates().then((t) => setRates({ asOf: t.asOf, current: t.current, history: t.history }), (e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); api.prdCatalogue().then((c) => setSteps(c.steps), () => undefined); }, [load]);
  if (error) return <Notice>{error}</Notice>;
  const same = (r: PieceRate) => r.garmentType.toLowerCase() === item.garment_type!.toLowerCase();
  const mine = (rates?.current ?? []).filter(same);
  const past = (rates?.history ?? []).filter(same);
  const stepName = (code: string) => steps.find((s) => s.code === code)?.name ?? code;
  const order = (code: string) => { const i = steps.findIndex((s) => s.code === code); return i < 0 ? 99 : i; };
  // One row per step (and part, on a set) that has any rate; a column per difficulty.
  const rows = [...new Map(mine.map((r) => [`${r.stepCode}|${r.part ?? 'whole'}`, { stepCode: r.stepCode, part: r.part ?? 'whole' }])).values()]
    .sort((a, b) => order(a.stepCode) - order(b.stepCode) || a.part.localeCompare(b.part));
  const rateOf = (stepCode: string, complexity: string, part: string) => mine.find((r) => r.stepCode === stepCode && r.complexity === complexity && (r.part ?? 'whole') === part);
  return <Panel title="Labour (piece rates)">
    {!rates ? <Loading /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
      <th>Step</th>{COMPLEXITIES.map((c) => <th key={c} className="text-right">{LEVEL[c]}</th>)}</tr></thead><tbody>
      {rows.map((k) => <tr key={`${k.stepCode}|${k.part}`}><td>{stepName(k.stepCode)}{k.part !== 'whole' && <span className="text-slate-500"> · {PART[k.part]}</span>}</td>
        {COMPLEXITIES.map((c) => { const r = rateOf(k.stepCode, c, k.part); return <td key={c} className={`text-right tabular-nums ${c === 'standard' ? 'font-medium' : ''}`}>{r ? peso(r.rateCents) : <span className="text-slate-400">—</span>}</td>; })}</tr>)}
    </tbody></table>
      {rows.length === 0 && <p className="py-2 text-sm text-slate-500">No piece rate for {item.name} yet{set ? ' (upper or lower)' : ''}. Production can still record its pieces with a typed rate.</p>}
      <p className="pt-1 text-xs text-slate-500">A job order item is paid at the difficulty it is set up with on the production board (Standard unless changed).</p></div>}
    {rates && past.length > 0 && <details className="rounded-md bg-slate-50 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-indigo-700">Rate history ({past.length})</summary>
      <div className="overflow-x-auto pt-2"><table className="w-full text-sm"><thead><tr><th>From</th><th>Step</th><th>Difficulty</th><th className="text-right">Rate</th><th>Why</th></tr></thead><tbody>
        {past.map((r) => <tr key={r.id} className={mine.some((m) => m.id === r.id) ? '' : 'text-slate-500'}>
          <td className="whitespace-nowrap">{showDate(r.effectiveFrom)}</td>
          <td>{stepName(r.stepCode)}{(r.part ?? 'whole') !== 'whole' && ` · ${PART[r.part!]}`}</td>
          <td>{LEVEL[r.complexity] ?? r.complexity}</td>
          <td className="text-right tabular-nums">{peso(r.rateCents)}</td>
          <td>{r.reason}</td></tr>)}
      </tbody></table><p className="pt-1 text-xs text-slate-500">Grey: replaced by a later rate. A recorded production entry keeps the rate it was paid at.</p></div>
    </details>}
    {rates && me.permissions.includes('rate.manage') && <NewRate garmentType={item.garment_type!} itemName={item.name} parts={parts} asOf={rates.asOf} steps={steps} onSaved={load} />}
  </Panel>;
}

/** Piece rates in force for a garment type no price list item goes by (from before the price list held them): kept for the job orders that use them. */
function UnmatchedRates() {
  const [rows, setRows] = useState<PieceRate[] | null>(null);
  const [steps, setSteps] = useState<PrdStep[]>([]);
  useEffect(() => { api.rates().then((t) => setRows(t.unmatched ?? []), () => setRows([])); api.prdCatalogue().then((c) => setSteps(c.steps), () => undefined); }, []);
  if (!rows || rows.length === 0) return null;
  const stepName = (code: string) => steps.find((s) => s.code === code)?.name ?? code;
  const sorted = [...rows].sort((a, b) => a.garmentType.localeCompare(b.garmentType) || a.stepCode.localeCompare(b.stepCode) || a.complexity.localeCompare(b.complexity));
  return <details className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
    <summary className="cursor-pointer text-sm font-semibold text-slate-800">Piece rates with no price list item ({new Set(rows.map((r) => r.garmentType.toLowerCase())).size} garment types)</summary>
    <p className="pt-2 text-sm text-slate-600">These rates are from before the price list held piece rates. Job order items made as these garment types are still paid at them. To change one, add a price list item named like the garment type (its rates then show on the item), or ask the accountant to replace it.</p>
    <div className="overflow-x-auto pt-2"><table className="w-full text-sm"><thead><tr><th>Garment type</th><th>Step</th><th>Difficulty</th><th className="text-right">Rate</th><th>From</th></tr></thead><tbody>
      {sorted.map((r) => <tr key={r.id}><td>{r.garmentType}</td><td>{stepName(r.stepCode)}{(r.part ?? 'whole') !== 'whole' && ` · ${PART[r.part!]}`}</td><td>{LEVEL[r.complexity] ?? r.complexity}</td>
        <td className="text-right tabular-nums">{peso(r.rateCents)}</td><td className="whitespace-nowrap">{showDate(r.effectiveFrom)}</td></tr>)}
    </tbody></table></div>
  </details>;
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
    setDone(`${itemName}${v.part !== 'whole' ? ` (${v.part} part)` : ''}: ${steps.find((s) => s.code === r.stepCode)?.name ?? r.stepCode} (${LEVEL[r.complexity] ?? r.complexity}) is ${peso(r.rateCents)} per piece from ${showDate(r.effectiveFrom)}.`);
    setV(blank);
    await onSaved();
  };
  return <div className="space-y-2 border-t border-slate-100 pt-3">
    <p className="text-sm font-medium">New piece rate for {itemName}</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Step" required><select className={inputClass} value={v.stepCode} onChange={(e) => setV({ ...v, stepCode: e.target.value })}>{steps.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
      <Field label="Difficulty" required hint="Standard unless the job is simpler or harder than usual"><select className={inputClass} value={v.complexity} onChange={(e) => setV({ ...v, complexity: e.target.value })}>{COMPLEXITIES.map((c) => <option key={c} value={c}>{LEVEL[c]}</option>)}</select></Field>
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
