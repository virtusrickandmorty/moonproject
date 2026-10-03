/**
 * Sales › Website shop: the garments the public website shows. Staff with shp.manage add, change, hide and show them
 * and upload a photo; the website reads the active ones. A showcase only: the "from" price never reaches a quotation.
 */
import { formatPesos, parsePesos } from '@moonproject/shared';
import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, peso, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { ProductPicture } from '../../shop/GarmentArt.tsx';
import { SAMPLE_PRODUCTS, SIZES, type Product, type Shape } from '../../shop/products.ts';
import { masterRequest } from '../CUS/http.ts';

interface Row extends Product { sortOrder: number; isActive: boolean; version: number; updatedAt: string }
interface Values {
  name: string; category: string; shape: Shape; price: string; madeToOrder: boolean; minQty: string; leadDays: string; badge: string;
  summary: string; sortOrder: string; features: string; sizes: string[]; colours: { name: string; hex: string }[];
}
const SHAPES: [Shape, string][] = [['tee', 'T-shirt'], ['polo', 'Polo'], ['jersey', 'Jersey'], ['jacket', 'Jacket'], ['hoodie', 'Hoodie'], ['shorts', 'Shorts']];
const blank: Values = { name: '', category: '', shape: 'tee', price: '', madeToOrder: true, minQty: '10', leadDays: '14', badge: '', summary: '', sortOrder: '0',
  features: '', sizes: ['S', 'M', 'L', 'XL'], colours: [{ name: 'White', hex: '#f8fafc' }] };
const valuesOf = (p: Row): Values => ({ name: p.name, category: p.category, shape: p.shape, price: formatPesos(p.priceCents), madeToOrder: p.madeToOrder,
  minQty: String(p.minQty), leadDays: String(p.leadDays), badge: p.badge ?? '', summary: p.summary, sortOrder: String(p.sortOrder),
  features: p.features.join('\n'), sizes: p.sizes, colours: p.colours });
/** What the server takes; a message for the first thing that is not right. */
function bodyOf(v: Values): { body?: unknown; problem?: string } {
  let priceCents: number;
  try { priceCents = parsePesos(v.price); } catch { return { problem: 'Type the price in pesos, like 550 or 550.00.' }; }
  const whole = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s) : NaN);
  if (!v.name.trim() || !v.category.trim() || !v.summary.trim()) return { problem: 'Name, category and short description are needed.' };
  if (!v.sizes.length) return { problem: 'Tick at least one size.' };
  if (!v.colours.length || v.colours.some((c) => !c.name.trim())) return { problem: 'Give every colour a name.' };
  if ([whole(v.minQty), whole(v.leadDays), whole(v.sortOrder)].some(Number.isNaN)) return { problem: 'Minimum, days and order must be whole numbers.' };
  return { body: { name: v.name, category: v.category, shape: v.shape, priceCents, madeToOrder: v.madeToOrder, minQty: whole(v.minQty), leadDays: whole(v.leadDays),
    badge: v.badge, summary: v.summary, sortOrder: whole(v.sortOrder), features: v.features.split('\n').map((f) => f.trim()).filter(Boolean),
    sizes: v.sizes, colours: v.colours } };
}

export function ShopProducts({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const { busy, error, run } = useAction();
  const canManage = me.permissions.includes('shp.manage');
  const load = useCallback(() => run(async () => setRows(await masterRequest<Row[]>(me, '/api/shp/admin/products'))), [me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const toggle = (p: Row) => run(async () => { await masterRequest(me, `/api/shp/products/${p.id}/${p.isActive ? 'hide' : 'show'}`, 'POST', {}, p.version); await load(); });
  /** Copies the made-up sample garments in, so the shop starts from something it can edit. */
  const startFromSamples = () => run(async () => {
    for (const [i, s] of SAMPLE_PRODUCTS.entries()) {
      await masterRequest(me, '/api/shp/products', 'POST', { name: s.name, category: s.category, shape: s.shape, priceCents: s.priceCents, madeToOrder: s.madeToOrder,
        minQty: s.minQty, leadDays: s.leadDays, badge: s.badge ?? '', summary: s.summary, sortOrder: i + 1, features: s.features, sizes: s.sizes, colours: s.colours });
    }
    await load();
  });
  const shown = rows?.filter((r) => r.isActive).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Website shop</h1>
          <p className="text-sm text-slate-600">The garments the public website shows. {rows && `${shown} shown, ${rows.length - shown} hidden.`} Prices here are "from" prices for the website only.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/shop" className="rounded-md bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-indigo-50">View the website shop</Link>
          {canManage && <Button tone="primary" onClick={() => setEditing('new')}>+ New product</Button>}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {rows?.length === 0 && (
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <p className="font-semibold">The website shop has no products yet, so it shows made-up sample garments.</p>
          <p className="mt-1 text-sm text-slate-600">Add your own, or copy the {SAMPLE_PRODUCTS.length} samples in and change them into yours.</p>
          {canManage && <Button className="mt-3" disabled={busy} onClick={() => void startFromSamples()}>{busy ? 'Copying…' : 'Start from the sample garments'}</Button>}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3 text-right">From</th><th className="p-3">Order</th><th className="p-3">Sizes</th><th className="p-3">On the website</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className={p.isActive ? '' : 'text-slate-400'}>
                  <td className="p-3"><div className="flex items-center gap-3">
                    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-50"><ProductPicture product={p} colour={p.colours[0]?.hex ?? '#ccc'} className={p.photoUrl ? '' : 'w-10'} /></div>
                    <div><p className="font-semibold">{p.name}</p><p className="text-xs text-slate-500">{p.madeToOrder ? `Made to order · min. ${p.minQty}` : 'Ready stock'}{p.badge ? ` · ${p.badge}` : ''}</p></div>
                  </div></td>
                  <td className="p-3">{p.category}</td>
                  <td className="p-3 text-right tabular-nums">{peso(p.priceCents)}</td>
                  <td className="p-3 tabular-nums">{p.sortOrder}</td>
                  <td className="p-3">{p.sizes.join(' ')}</td>
                  <td className="p-3">{p.isActive ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Shown</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Hidden</span>}</td>
                  <td className="whitespace-nowrap p-3 text-right">{canManage && <>
                    <Button onClick={() => setEditing(p)}>Edit</Button> <Button disabled={busy} onClick={() => void toggle(p)}>{p.isActive ? 'Hide' : 'Show'}</Button>
                  </>}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProductDialog me={me} product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

function ProductDialog({ me, product, onClose, onSaved }: { me: Me; product: Row | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Values>(product ? valuesOf(product) : blank);
  const [current, setCurrent] = useState<Row | null>(product);
  const [problem, setProblem] = useState('');
  const { busy, error, run } = useAction();
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((x) => ({ ...x, [k]: value }));

  const save = () => {
    const { body, problem: p } = bodyOf(v);
    setProblem(p ?? '');
    if (!body) return;
    void run(async () => {
      if (current) await masterRequest(me, `/api/shp/products/${current.id}`, 'PUT', body, current.version);
      else await masterRequest(me, '/api/shp/products', 'POST', body);
      onSaved();
    });
  };
  /** The photo goes up as it is (JPEG, PNG or WebP up to 4 MB); a new product is saved first so it has somewhere to go. */
  const upload = (file: File) => run(async () => {
    if (!current) throw new Error('Save the product first, then add its photo.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG or WebP photo.');
    if (file.size > 4 * 1024 * 1024) throw new Error('The photo is bigger than 4 MB. Use a smaller one.');
    const res = await fetch(`/api/shp/products/${current.id}/photo`, { method: 'POST', credentials: 'same-origin', body: file,
      headers: { 'x-csrf-token': me.csrfToken, 'content-type': 'application/octet-stream' } });
    const data = await res.json().catch(() => null) as (Row & { message?: string }) | null;
    if (!res.ok) throw new Error(data?.message ?? 'The photo could not be uploaded.');
    setCurrent(data);
  });
  const removePhoto = () => run(async () => { if (current) setCurrent(await masterRequest<Row>(me, `/api/shp/products/${current.id}/photo/remove`, 'POST', {})); });

  return (
    <Dialog title={product ? `Edit ${product.name}` : 'New website product'} onClose={onClose}>
      <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-[9rem_1fr]">
        <div className="space-y-2">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
            <ProductPicture product={{ name: v.name, shape: v.shape, photoUrl: current?.photoUrl }} colour={v.colours[0]?.hex ?? '#ccc'} className={current?.photoUrl ? '' : 'w-4/5'} />
          </div>
          <label className={`block cursor-pointer rounded-md px-3 py-1.5 text-center text-xs font-semibold ring-1 ring-slate-300 hover:bg-indigo-50 ${current ? '' : 'pointer-events-none opacity-50'}`}>
            {current?.photoUrl ? 'Change photo' : 'Add photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!current} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </label>
          {current?.photoUrl && <button type="button" onClick={() => void removePhoto()} className="block w-full text-xs text-slate-500 hover:text-red-600">Remove photo</button>}
          {!current && <p className="text-xs text-slate-500">Save first to add a photo. Without one, the drawing is shown.</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Name" required><input className={inputClass} maxLength={100} value={v.name} onChange={(e) => set('name', e.target.value)} /></Field></div>
          <Field label="Category" required hint="Products with the same category are grouped."><input className={inputClass} maxLength={40} list="shp-categories" value={v.category} onChange={(e) => set('category', e.target.value)} />
            <datalist id="shp-categories">{[...new Set(SAMPLE_PRODUCTS.map((p) => p.category))].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Drawing (when there is no photo)"><select className={inputClass} value={v.shape} onChange={(e) => set('shape', e.target.value as Shape)}>{SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="From price per piece (₱)" required><input className={inputClass} inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
          <Field label="Badge" hint="Optional, like Best seller or New."><input className={inputClass} maxLength={30} value={v.badge} onChange={(e) => set('badge', e.target.value)} /></Field>
          <div className="flex items-center gap-4 sm:col-span-2">
            {([[true, 'Made to order'], [false, 'Ready stock']] as const).map(([b, l]) => <label key={l} className="flex items-center gap-2 text-sm"><input type="radio" checked={v.madeToOrder === b} onChange={() => set('madeToOrder', b)} /> {l}</label>)}
          </div>
          <Field label="Minimum pieces"><input className={inputClass} inputMode="numeric" value={v.minQty} onChange={(e) => set('minQty', e.target.value)} /></Field>
          <Field label="Usual days to make"><input className={inputClass} inputMode="numeric" value={v.leadDays} onChange={(e) => set('leadDays', e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Short description" required><textarea className={inputClass} rows={2} maxLength={300} value={v.summary} onChange={(e) => set('summary', e.target.value)} /></Field></div>
          <div className="sm:col-span-2"><Field label="Selling points" hint="One per line, up to 8."><textarea className={inputClass} rows={3} value={v.features} onChange={(e) => set('features', e.target.value)} /></Field></div>
          <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Sizes</legend>
            <div className="mt-1 flex flex-wrap gap-3">{SIZES.map((s) => <label key={s} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={v.sizes.includes(s)} onChange={() => set('sizes', v.sizes.includes(s) ? v.sizes.filter((x) => x !== s) : [...v.sizes, s])} /> {s}</label>)}</div>
          </fieldset>
          <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Colours</legend>
            {v.colours.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="color" value={c.hex} onChange={(e) => set('colours', v.colours.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)))} className="h-9 w-12 cursor-pointer rounded border border-slate-300" aria-label={`Colour ${i + 1}`} />
                <input className={inputClass} maxLength={30} value={c.name} placeholder="Colour name" onChange={(e) => set('colours', v.colours.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label={`Colour ${i + 1} name`} />
                <button type="button" disabled={v.colours.length === 1} onClick={() => set('colours', v.colours.filter((_, k) => k !== i))} className="px-2 text-slate-500 hover:text-red-600 disabled:opacity-30" aria-label={`Remove colour ${i + 1}`}>✕</button>
              </div>))}
            {v.colours.length < 12 && <button type="button" onClick={() => set('colours', [...v.colours, { name: '', hex: '#1f3bb3' }])} className="text-sm font-semibold text-indigo-700 hover:underline">+ Add a colour</button>}
          </fieldset>
          <Field label="Order on the website" hint="Lower numbers come first."><input className={inputClass} inputMode="numeric" value={v.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} /></Field>
        </div>
      </div>
      {(problem || error) && <div className="mt-3"><Notice>{problem || error}</Notice></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{current && current !== product ? 'Done' : 'Cancel'}</Button>
        <Button tone="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Dialog>
  );
}
