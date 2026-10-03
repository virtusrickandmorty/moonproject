/**
 * Sales › Website shop: the own-brand garments the public website shows and sells. Products (shp.manage) with their
 * pieces on hand per size and colour (shp.stock records pieces in and counts), the categories they are grouped in, and how
 * customers pay online (the owner: the QR and the cash account the money goes into). Pieces only: the books keep periodic
 * inventory, so stock here never posts a journal; the sale of a piece does (POS, online orders: a quick sale).
 */
import { formatPesos, parsePesos } from '@moonproject/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, type CashPlace, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, manilaTime, peso, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { ProductPicture } from '../../shop/GarmentArt.tsx';
import { SAMPLE_PRODUCTS, SIZES, type Product, type Shape } from '../../shop/products.ts';
import { masterRequest } from '../CUS/http.ts';

export interface StockLine { size: string; colour: string; onHand: number; held: number; available: number }
interface Row extends Product { categoryId: string | null; sortOrder: number; isActive: boolean; version: number; updatedAt: string; stock: StockLine[] | null }
interface Category { id: string; name: string; sortOrder: number; isActive: boolean; version: number; products: number }
interface Values {
  name: string; categoryId: string; shape: Shape; price: string; madeToOrder: boolean; minQty: string; leadDays: string; badge: string;
  summary: string; sortOrder: string; features: string; sizes: string[]; colours: { name: string; hex: string }[];
}
const SHAPES: [Shape, string][] = [['tee', 'T-shirt'], ['polo', 'Polo'], ['jersey', 'Jersey'], ['jacket', 'Jacket'], ['hoodie', 'Hoodie'], ['shorts', 'Shorts']];
const blank: Values = { name: '', categoryId: '', shape: 'tee', price: '', madeToOrder: false, minQty: '1', leadDays: '2', badge: '', summary: '', sortOrder: '0',
  features: '', sizes: ['S', 'M', 'L', 'XL'], colours: [{ name: 'White', hex: '#f8fafc' }] };
const valuesOf = (p: Row): Values => ({ name: p.name, categoryId: p.categoryId ?? '', shape: p.shape, price: formatPesos(p.priceCents), madeToOrder: p.madeToOrder,
  minQty: String(p.minQty), leadDays: String(p.leadDays), badge: p.badge ?? '', summary: p.summary, sortOrder: String(p.sortOrder),
  features: p.features.join('\n'), sizes: p.sizes, colours: p.colours });
/** What the server takes; a message for the first thing that is not right. */
function bodyOf(v: Values): { body?: unknown; problem?: string } {
  let priceCents: number;
  try { priceCents = parsePesos(v.price); } catch { return { problem: 'Type the price in pesos, like 550 or 550.00.' }; }
  const whole = (s: string) => (/^-?\d+$/.test(s.trim()) ? Number(s) : NaN);
  if (!v.name.trim() || !v.categoryId || !v.summary.trim()) return { problem: 'Name, category and short description are needed.' };
  if (!v.sizes.length) return { problem: 'Tick at least one size.' };
  if (!v.colours.length || v.colours.some((c) => !c.name.trim())) return { problem: 'Give every colour a name.' };
  if ([whole(v.minQty), whole(v.leadDays), whole(v.sortOrder)].some(Number.isNaN)) return { problem: 'Minimum, days and order must be whole numbers.' };
  return { body: { name: v.name, categoryId: v.categoryId, shape: v.shape, priceCents, madeToOrder: v.madeToOrder, minQty: whole(v.minQty), leadDays: whole(v.leadDays),
    badge: v.badge, summary: v.summary, sortOrder: whole(v.sortOrder), features: v.features.split('\n').map((f) => f.trim()).filter(Boolean),
    sizes: v.sizes, colours: v.colours } };
}
const total = (s: StockLine[] | null, k: keyof Omit<StockLine, 'size' | 'colour'>) => (s ?? []).reduce((n, l) => n + l[k], 0);
const tab = (on: boolean) => `rounded-md px-4 py-2 text-sm font-semibold ${on ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-indigo-50'}`;

export function ShopProducts({ me }: { me: Me }) {
  const [view, setView] = useState<'products' | 'categories' | 'payment'>('products');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Website shop</h1>
          <p className="text-sm text-slate-600">Your own-brand garments: what the website shows, the pieces left of each, and how customers pay online.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/shop" className="rounded-md bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-indigo-50">View the website shop</Link>
          {me.permissions.includes('shp.orders.view') && <Link to="/shp/orders" className="rounded-md bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-indigo-50">Online orders</Link>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {([['products', 'Products and stock'], ['categories', 'Categories'], ['payment', 'Online payment']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={tab(view === k)} onClick={() => setView(k)}>{l}</button>))}
      </div>
      {view === 'products' && <Products me={me} />}
      {view === 'categories' && <Categories me={me} />}
      {view === 'payment' && <Payment me={me} />}
    </div>
  );
}

function Products({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [stocking, setStocking] = useState<Row | null>(null);
  const { busy, error, run } = useAction();
  const canManage = me.permissions.includes('shp.manage');
  const load = useCallback(() => run(async () => {
    const [r, c] = await Promise.all([masterRequest<Row[]>(me, '/api/shp/admin/products'), masterRequest<Category[]>(me, '/api/shp/categories')]);
    setRows(r); setCategories(c);
  }), [me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const toggle = (p: Row) => run(async () => { await masterRequest(me, `/api/shp/products/${p.id}/${p.isActive ? 'hide' : 'show'}`, 'POST', {}, p.version); await load(); });
  /** Copies the made-up sample garments in (and their categories), so the shop starts from something it can edit. */
  const startFromSamples = () => run(async () => {
    const ids = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    for (const [i, s] of SAMPLE_PRODUCTS.entries()) {
      if (!ids.has(s.category.toLowerCase())) ids.set(s.category.toLowerCase(), (await masterRequest<Category>(me, '/api/shp/categories', 'POST', { name: s.category, sortOrder: ids.size + 1 })).id);
      await masterRequest(me, '/api/shp/products', 'POST', { name: s.name, categoryId: ids.get(s.category.toLowerCase()), shape: s.shape, priceCents: s.priceCents, madeToOrder: s.madeToOrder,
        minQty: s.minQty, leadDays: s.leadDays, badge: s.badge ?? '', summary: s.summary, sortOrder: i + 1, features: s.features, sizes: s.sizes, colours: s.colours });
    }
    await load();
  });
  const shown = rows?.filter((r) => r.isActive).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{rows && `${shown} shown, ${rows.length - shown} hidden. `}Ready-stock items are sold at the POS and online; made-to-order ones are quoted.</p>
        {canManage && <Button tone="primary" disabled={!categories.some((c) => c.isActive)} title={categories.length ? undefined : 'Add a category first'} onClick={() => setEditing('new')}>+ New product</Button>}
      </div>
      {error && <Notice>{error}</Notice>}
      {rows?.length === 0 && (
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <p className="font-semibold">The website shop has no products yet, so it shows made-up sample garments.</p>
          <p className="mt-1 text-sm text-slate-600">Add your own (start with a category), or copy the {SAMPLE_PRODUCTS.length} samples in and change them into yours.</p>
          {canManage && <Button className="mt-3" disabled={busy} onClick={() => void startFromSamples()}>{busy ? 'Copying…' : 'Start from the sample garments'}</Button>}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Pieces left</th><th className="p-3">Sizes</th><th className="p-3">On the website</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => {
                const left = total(p.stock, 'available');
                return (
                  <tr key={p.id} className={p.isActive ? '' : 'text-slate-400'}>
                    <td className="p-3"><div className="flex items-center gap-3">
                      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-50"><ProductPicture product={p} colour={p.colours[0]?.hex ?? '#ccc'} className={p.photoUrl ? '' : 'w-10'} /></div>
                      <div><p className="font-semibold">{p.name}</p><p className="text-xs text-slate-500">{p.madeToOrder ? `Made to order · min. ${p.minQty}` : 'Ready stock'}{p.badge ? ` · ${p.badge}` : ''}</p></div>
                    </div></td>
                    <td className="p-3">{p.category}</td>
                    <td className="p-3 text-right tabular-nums">{peso(p.priceCents)}</td>
                    <td className={`p-3 text-right tabular-nums ${p.stock && left === 0 ? 'font-semibold text-red-700' : ''}`}>
                      {p.stock ? <>{left}{total(p.stock, 'held') > 0 && <span className="block text-xs text-slate-500">{total(p.stock, 'held')} held online</span>}</> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-3">{p.sizes.join(' ')}</td>
                    <td className="p-3">{p.isActive ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Shown</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Hidden</span>}</td>
                    <td className="whitespace-nowrap p-3 text-right">
                      {p.stock && <Button onClick={() => setStocking(p)}>Stock</Button>}{' '}
                      {canManage && <><Button onClick={() => setEditing(p)}>Edit</Button> <Button disabled={busy} onClick={() => void toggle(p)}>{p.isActive ? 'Hide' : 'Show'}</Button></>}
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProductDialog me={me} product={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {stocking && <StockDialog me={me} product={stocking} onClose={() => { setStocking(null); void load(); }} />}
    </div>
  );
}

/** Pieces on hand per size × colour; staff record pieces coming in, or what a count found (which becomes on hand). */
function StockDialog({ me, product, onClose }: { me: Me; product: Row; onClose: () => void }) {
  type Move = { id: string; size: string; colour: string; qty: number; reason: 'stock_in' | 'count'; note: string | null; at: string; userName: string };
  const [data, setData] = useState<{ lines: StockLine[]; moves: Move[] } | null>(null);
  const [mode, setMode] = useState<'in' | 'count'>('in');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [done, setDone] = useState('');
  const { busy, error, run } = useAction();
  const canStock = me.permissions.includes('shp.stock');
  const load = useCallback(() => masterRequest<{ lines: StockLine[]; moves: Move[] }>(me, `/api/shp/products/${product.id}/stock`).then(setData), [me, product.id]);
  useEffect(() => { void run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (l: { size: string; colour: string }) => `${l.size}|${l.colour}`;
  const sizes = product.sizes, colours = product.colours.map((c) => c.name);
  const cell = (size: string, colour: string) => data?.lines.find((l) => l.size === size && l.colour === colour);

  const save = () => run(async () => {
    const lines = Object.entries(typed).filter(([, v]) => v.trim() !== '').map(([k, v]) => {
      const [size, colour] = k.split('|') as [string, string];
      if (!/^\d+$/.test(v.trim())) throw new Error(`Type whole pieces for ${colour}, ${size}.`);
      return { size, colour, qty: Number(v) };
    });
    if (!lines.length) throw new Error(mode === 'in' ? 'Type how many pieces came in.' : 'Type what you counted.');
    await masterRequest(me, `/api/shp/products/${product.id}/stock`, 'POST', { mode, lines, ...(note.trim() ? { note: note.trim() } : {}) });
    setTyped({}); setNote('');
    setDone(mode === 'in' ? 'Pieces added.' : 'Count recorded.');
    await load();
  });

  return (
    <Dialog wide title={`Stock · ${product.name}`} onClose={onClose}>
      <p className="text-sm text-slate-600">Pieces on hand = pieces in and counts, less pieces sold (POS and confirmed online orders). Online orders waiting for payment hold their pieces for 24 hours.</p>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2 pr-3">Colour \ size</th>{sizes.map((s) => <th key={s} className="px-2 text-center">{s}</th>)}</tr></thead>
            <tbody>{colours.map((colour) => (
              <tr key={colour} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-semibold">{colour}</td>
                {sizes.map((size) => {
                  const c = cell(size, colour);
                  return (
                    <td key={size} className="px-2 py-2 text-center align-top">
                      <span className={`block font-semibold tabular-nums ${c && c.available === 0 ? 'text-red-700' : ''}`}>{c?.available ?? 0}</span>
                      <span className="block text-xs text-slate-500">{c ? `${c.onHand} on hand${c.held ? ` · ${c.held} held` : ''}` : ''}</span>
                      {canStock && <input className={`${inputClass} mt-1 w-16 text-center`} inputMode="numeric" aria-label={`${mode === 'in' ? 'Pieces in' : 'Counted'}: ${colour}, ${size}`}
                        placeholder={mode === 'in' ? '+0' : String(c?.onHand ?? 0)} value={typed[key({ size, colour })] ?? ''} onChange={(e) => setTyped({ ...typed, [key({ size, colour })]: e.target.value })} />}
                    </td>);
                })}
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {canStock && (
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <div className="flex gap-2" role="group" aria-label="What you are recording">
            <button type="button" className={tab(mode === 'in')} onClick={() => { setMode('in'); setTyped({}); }}>Pieces came in</button>
            <button type="button" className={tab(mode === 'count')} onClick={() => { setMode('count'); setTyped({}); }}>I counted the shelf</button>
          </div>
          <label className="min-w-[14rem] flex-1 text-sm">Note (optional)<input className={inputClass} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'in' ? 'e.g. Batch 12 from production' : 'e.g. Monthly count'} /></label>
          <Button tone="primary" disabled={busy} onClick={() => void save()}>{mode === 'in' ? 'Add pieces' : 'Record the count'}</Button>
        </div>
      )}
      {canStock && <p className="text-xs text-slate-500">{mode === 'in' ? 'Type how many pieces came in for each size and colour; leave the others empty.' : 'Type what is on the shelf for the ones you counted; the difference is recorded.'}</p>}
      {data && data.moves.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-semibold">Recent stock moves</summary>
          <ul className="mt-2 space-y-1">{data.moves.map((m) => <li key={m.id} className="text-slate-600">{manilaTime(m.at)} · {m.userName} · {m.reason === 'count' ? 'Count' : 'In'} {m.qty > 0 ? `+${m.qty}` : m.qty} · {m.colour}, {m.size}{m.note ? ` · ${m.note}` : ''}</li>)}</ul>
        </details>
      )}
      <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
    </Dialog>
  );
}

function Categories({ me }: { me: Me }) {
  const [rows, setRows] = useState<Category[] | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState(''); const [editOrder, setEditOrder] = useState('0');
  const { busy, error, run } = useAction();
  const canManage = me.permissions.includes('shp.manage');
  const load = useCallback(() => masterRequest<Category[]>(me, '/api/shp/categories').then(setRows), [me]);
  useEffect(() => { void run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = () => run(async () => { await masterRequest(me, '/api/shp/categories', 'POST', { name: name.trim(), sortOrder: (rows?.length ?? 0) + 1 }); setName(''); await load(); });
  const save = () => run(async () => {
    if (!editing) return;
    if (!/^-?\d+$/.test(editOrder.trim())) throw new Error('The order is a whole number.');
    await masterRequest(me, `/api/shp/categories/${editing.id}`, 'PUT', { name: editName.trim(), sortOrder: Number(editOrder) }, editing.version);
    setEditing(null); await load();
  });
  const toggle = (c: Category) => run(async () => { await masterRequest(me, `/api/shp/categories/${c.id}/${c.isActive ? 'hide' : 'show'}`, 'POST', {}, c.version); await load(); });
  return (
    <div className="space-y-3">
      {error && <Notice>{error}</Notice>}
      {canManage && (
        <div className="flex max-w-xl gap-2">
          <input className={inputClass} maxLength={40} placeholder="New category, like Caps or Team jackets" value={name} onChange={(e) => setName(e.target.value)} aria-label="New category name"
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void add(); }} />
          <Button tone="primary" disabled={busy || !name.trim()} onClick={() => void add()}>Add category</Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Category</th><th className="p-3">Order</th><th className="p-3 text-right">Shown products</th><th className="p-3">On the website</th><th className="p-3" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows?.length === 0 && <tr><td colSpan={5} className="p-4 text-slate-500">No categories yet. Add the first one above.</td></tr>}
            {rows?.map((c) => editing?.id === c.id ? (
              <tr key={c.id}>
                <td className="p-3"><input className={inputClass} maxLength={40} value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Category name" /></td>
                <td className="p-3"><input className={`${inputClass} w-20`} inputMode="numeric" value={editOrder} onChange={(e) => setEditOrder(e.target.value)} aria-label="Order" /></td>
                <td className="p-3 text-right">{c.products}</td><td />
                <td className="whitespace-nowrap p-3 text-right"><Button tone="primary" disabled={busy || !editName.trim()} onClick={() => void save()}>Save</Button> <Button onClick={() => setEditing(null)}>Cancel</Button></td>
              </tr>
            ) : (
              <tr key={c.id} className={c.isActive ? '' : 'text-slate-400'}>
                <td className="p-3 font-semibold">{c.name}</td><td className="p-3 tabular-nums">{c.sortOrder}</td><td className="p-3 text-right tabular-nums">{c.products}</td>
                <td className="p-3">{c.isActive ? 'Shown' : 'Hidden'}</td>
                <td className="whitespace-nowrap p-3 text-right">{canManage && <>
                  <Button onClick={() => { setEditing(c); setEditName(c.name); setEditOrder(String(c.sortOrder)); }}>Rename</Button>{' '}
                  <Button disabled={busy} onClick={() => void toggle(c)}>{c.isActive ? 'Hide' : 'Show'}</Button>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The owner sets how customers pay online: the QR they scan, whose account it is, and the cash account the money lands in. */
function Payment({ me }: { me: Me }) {
  type Settings = { version: number; bankName: string; accountName: string; accountHint: string | null; instructions: string | null; cashPlaceId: number; savedAt: string; qrUrl: string;
    deliveryOptions: { name: string; feeCents: number; places: string[]; otherwise: boolean }[] };
  const [current, setCurrent] = useState<Settings | null | undefined>(undefined);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [v, setV] = useState({ bankName: '', accountName: '', accountHint: '', instructions: '', cashPlaceId: '' });
  const [qr, setQr] = useState<{ name: string; data: string; url: string } | null>(null);
  const [areas, setAreas] = useState<{ name: string; fee: string; places: string; otherwise: boolean }[]>([]);
  const [done, setDone] = useState('');
  const { busy, error, run } = useAction();
  const canSet = me.permissions.includes('shp.payment.manage');
  const fill = (s: Settings | null) => {
    setCurrent(s);
    if (s) setV({ bankName: s.bankName, accountName: s.accountName, accountHint: s.accountHint ?? '', instructions: s.instructions ?? '', cashPlaceId: String(s.cashPlaceId) });
    if (s) setAreas(s.deliveryOptions.map((d) => ({ name: d.name, fee: formatPesos(d.feeCents), places: d.places.join(', '), otherwise: d.otherwise })));
  };
  useEffect(() => { void run(async () => { fill(await masterRequest<Settings | null>(me, '/api/shp/admin/payment')); setPlaces(await api.cashPlaces()); }); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (file: File) => run(async () => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG or WebP picture of the QR code.');
    if (file.size > 4 * 1024 * 1024) throw new Error('The picture is bigger than 4 MB.');
    const data = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => fail(new Error('Could not read the picture.')); r.readAsDataURL(file); });
    setQr({ name: file.name, data, url: URL.createObjectURL(file) });
  });
  const save = () => run(async () => {
    if (!v.cashPlaceId) throw new Error('Pick the cash account the online payments go into.');
    const deliveryOptions = areas.filter((a) => a.name.trim() || a.fee.trim()).map((a) => {
      if (!a.name.trim()) throw new Error('Give every delivery area a name.');
      let feeCents: number;
      try { feeCents = parsePesos(a.fee || '0'); } catch { throw new Error(`Type the delivery fee for ${a.name.trim()} in pesos, like 150.`); }
      const places = a.places.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
      if (!a.otherwise && !places.length) throw new Error(`List the cities or provinces ${a.name.trim()} covers, or let it take every other address.`);
      return { name: a.name.trim(), feeCents, places, otherwise: a.otherwise };
    });
    const saved = await masterRequest<Settings>(me, '/api/shp/admin/payment', 'POST', {
      bankName: v.bankName.trim(), accountName: v.accountName.trim(), cashPlaceId: Number(v.cashPlaceId),
      ...(v.accountHint.trim() ? { accountHint: v.accountHint.trim() } : {}), ...(v.instructions.trim() ? { instructions: v.instructions.trim() } : {}),
      ...(qr ? { qr: { name: qr.name, data: qr.data } } : {}), deliveryOptions,
    });
    fill(saved); setQr(null); setDone('Saved. The website shows this QR from now on.');
  });
  if (current === undefined) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-3 rounded-lg bg-white p-5 shadow-sm">
        {!current && <Notice tone="warning">Online ordering is closed until this is set: the website only takes quotation requests.</Notice>}
        {error && <Notice>{error}</Notice>}
        {done && <Notice tone="success">{done}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bank or wallet" required><input className={inputClass} disabled={!canSet} maxLength={60} value={v.bankName} onChange={(e) => setV({ ...v, bankName: e.target.value })} placeholder="e.g. BDO" /></Field>
          <Field label="Account name" required><input className={inputClass} disabled={!canSet} maxLength={100} value={v.accountName} onChange={(e) => setV({ ...v, accountName: e.target.value })} placeholder="As the bank shows it" /></Field>
          <Field label="Account number shown" hint="Only the last digits, like ••••5305."><input className={inputClass} disabled={!canSet} maxLength={40} value={v.accountHint} onChange={(e) => setV({ ...v, accountHint: e.target.value })} /></Field>
          <Field label="Money goes into" required hint="The cash account in the books for this bank account.">
            <select className={inputClass} disabled={!canSet} value={v.cashPlaceId} onChange={(e) => setV({ ...v, cashPlaceId: e.target.value })}>
              <option value="">Pick a cash account</option>{places.filter((p) => !p.kind || p.kind === 'bank' || p.kind === 'ewallet').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></Field>
          <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-semibold">Delivery areas and fees</legend>
            <p className="text-xs text-slate-500">The customer types their city and province; the fee comes from the area that lists it (the city first, then the province), or from the area for every other address. None: pickup only.</p>
            {areas.map((a, i) => {
              const change = (patch: Partial<typeof a>) => setAreas(areas.map((x, k) => (k === i ? { ...x, ...patch } : patch.otherwise ? { ...x, otherwise: false } : x)));
              return (
                <div key={i} className="space-y-2 rounded-md bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <input className={inputClass} disabled={!canSet} maxLength={60} placeholder="Area, like Metro Manila" value={a.name} aria-label={`Delivery area ${i + 1}`} onChange={(e) => change({ name: e.target.value })} />
                    <input className={`${inputClass} w-32`} disabled={!canSet} inputMode="decimal" placeholder="Fee ₱" value={a.fee} aria-label={`Fee for area ${i + 1}`} onChange={(e) => change({ fee: e.target.value })} />
                    {canSet && <button type="button" className="px-2 text-slate-500 hover:text-red-600" aria-label={`Remove area ${i + 1}`} onClick={() => setAreas(areas.filter((_, k) => k !== i))}>✕</button>}
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canSet} checked={a.otherwise} onChange={(e) => change({ otherwise: e.target.checked })} /> Every other address (not listed in another area)</label>
                  {!a.otherwise && <textarea className={inputClass} disabled={!canSet} rows={2} aria-label={`Places in area ${i + 1}`} value={a.places} onChange={(e) => change({ places: e.target.value })}
                    placeholder="Cities, municipalities or provinces, separated by commas: Manila, Quezon City, Makati…" />}
                </div>);
            })}
            {canSet && areas.length < 10 && <button type="button" className="text-sm font-semibold text-indigo-700 hover:underline" onClick={() => setAreas([...areas, { name: '', fee: '', places: '', otherwise: false }])}>+ Add a delivery area</button>}
          </fieldset>
          <div className="sm:col-span-2"><Field label="Instructions for customers" hint="Shown under the QR."><textarea className={inputClass} disabled={!canSet} rows={2} maxLength={500} value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} placeholder="e.g. BDO to BDO transfers are free. Fees may apply for other banks." /></Field></div>
        </div>
        {canSet && <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-md bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-indigo-50">{current || qr ? 'Change QR picture' : 'Upload the QR picture'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} /></label>
          <Button tone="primary" disabled={busy || !v.bankName.trim() || !v.accountName.trim() || (!current && !qr)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>}
        {!canSet && <p className="text-sm text-slate-500">Only an owner can change how customers pay.</p>}
        {current && <p className="text-xs text-slate-500">Version {current.version}, saved {manilaTime(current.savedAt)}.</p>}
      </div>
      <div className="rounded-lg bg-white p-5 text-center shadow-sm">
        <p className="text-sm font-semibold">What customers scan</p>
        {qr || current ? <img src={qr?.url ?? current!.qrUrl} alt="Payment QR code" className="mx-auto mt-3 max-h-80 w-full object-contain" /> : <p className="mt-6 text-sm text-slate-500">No QR yet.</p>}
        {qr && <p className="mt-2 text-xs text-amber-700">Not saved yet.</p>}
      </div>
    </div>
  );
}

function ProductDialog({ me, product, categories, onClose, onSaved }: { me: Me; product: Row | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Values>(product ? valuesOf(product) : { ...blank, categoryId: categories.find((c) => c.isActive)?.id ?? '' });
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
  const choices = categories.filter((c) => c.isActive || c.id === v.categoryId);

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
          <Field label="Category" required hint="Add more on the Categories tab.">
            <select className={inputClass} value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Pick a category</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (hidden)'}</option>)}
            </select></Field>
          <Field label="Drawing (when there is no photo)"><select className={inputClass} value={v.shape} onChange={(e) => set('shape', e.target.value as Shape)}>{SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label={v.madeToOrder ? 'From price per piece (₱)' : 'Price per piece (₱)'} required hint={v.madeToOrder ? undefined : 'What the POS and online orders charge, VAT included.'}><input className={inputClass} inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
          <Field label="Badge" hint="Optional, like Best seller or New."><input className={inputClass} maxLength={30} value={v.badge} onChange={(e) => set('badge', e.target.value)} /></Field>
          <div className="flex items-center gap-4 sm:col-span-2">
            {([[false, 'Ready stock (own brand, sold from the shelf)'], [true, 'Made to order (quoted)']] as const).map(([b, l]) => <label key={l} className="flex items-center gap-2 text-sm"><input type="radio" checked={v.madeToOrder === b} onChange={() => set('madeToOrder', b)} /> {l}</label>)}
          </div>
          <Field label="Minimum pieces"><input className={inputClass} inputMode="numeric" value={v.minQty} onChange={(e) => set('minQty', e.target.value)} /></Field>
          <Field label="Usual days to make or ship"><input className={inputClass} inputMode="numeric" value={v.leadDays} onChange={(e) => set('leadDays', e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Short description" required><textarea className={inputClass} rows={2} maxLength={300} value={v.summary} onChange={(e) => set('summary', e.target.value)} /></Field></div>
          <div className="sm:col-span-2"><Field label="Selling points" hint="One per line, up to 8."><textarea className={inputClass} rows={3} value={v.features} onChange={(e) => set('features', e.target.value)} /></Field></div>
          <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Sizes</legend>
            <div className="mt-1 flex flex-wrap gap-3">{SIZES.map((s) => <label key={s} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={v.sizes.includes(s)} onChange={() => set('sizes', v.sizes.includes(s) ? v.sizes.filter((x) => x !== s) : [...v.sizes, s])} /> {s}</label>)}</div>
          </fieldset>
          <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Colours</legend>
            {!v.madeToOrder && product && <p className="text-xs text-amber-700">Stock is kept by colour name: renaming a colour starts its stock again from zero.</p>}
            {v.colours.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="color" value={c.hex} onChange={(e) => set('colours', v.colours.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)))} className="h-9 w-12 cursor-pointer rounded border border-slate-300" aria-label={`Colour ${i + 1}`} />
                <input className={inputClass} maxLength={30} value={c.name} placeholder="Colour name" onChange={(e) => set('colours', v.colours.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label={`Colour ${i + 1} name`} />
                <button type="button" disabled={v.colours.length === 1} onClick={() => set('colours', v.colours.filter((_, k) => k !== i))} className="px-2 text-slate-500 hover:text-red-600 disabled:opacity-30" aria-label={`Remove colour ${i + 1}`}>✕</button>
              </div>))}
            {v.colours.length < 12 && <button type="button" onClick={() => set('colours', [...v.colours, { name: '', hex: '#1f3bb3' }])} className="text-sm font-semibold text-indigo-700 hover:underline">+ Add a colour</button>}
          </fieldset>
          <Field label="Order on the website" hint="Lower numbers come first within the category."><input className={inputClass} inputMode="numeric" value={v.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} /></Field>
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
