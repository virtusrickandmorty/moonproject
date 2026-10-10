/**
 * Sales › POS: the counter for the shop's own-brand pieces. Tap a product, pick its size and colour (pieces left shown),
 * then take the payment. Recording is an ordinary quick sale with its payment (PLAN QS-SALE: Dr cash / Cr receivable,
 * Cr sales 4102 and output VAT), so the books and the invoice booklet rules are the same as the Quick Sale screen; each line
 * names its shop item, so the pieces come off the stock (and come back if the sale is cancelled).
 */
import { formatPesos, parsePesos, type Issue } from '@moonproject/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey, type CashPlace, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, peso, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { ProductPicture } from '../../shop/GarmentArt.tsx';
import type { Product } from '../../shop/products.ts';
import { masterRequest } from '../CUS/http.ts';
import type { StockLine } from './ShopProducts.tsx';

type Item = Product & { isActive: boolean; stock: StockLine[] | null };
interface CartLine { product: Item; size: string; colour: string; qty: number }
const same = (a: CartLine, b: { product: Item; size: string; colour: string }) => a.product.id === b.product.id && a.size === b.size && a.colour === b.colour;
const leftOf = (p: Item, size: string, colour: string) => p.stock?.find((s) => s.size === size && s.colour === colour)?.available ?? 0;

export function Pos({ me }: { me: Me }) {
  const [items, setItems] = useState<Item[]>([]);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [search, setSearch] = useState(''); const [category, setCategory] = useState('');
  const [picking, setPicking] = useState<Item | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [invoiceNumber, setInvoice] = useState(''); const [crNumber, setCr] = useState('');
  const [placeId, setPlaceId] = useState<number | null>(null); const [tendered, setTendered] = useState(''); const [reference, setReference] = useState('');
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const [done, setDone] = useState<{ id: string; number: string; change: number } | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const { busy, error, run } = useAction();
  // Selling records a quick sale: the POS needs those permissions too, plus seeing the shop's items and the customers.
  const missing = (['shp.view', 'cus.view', 'qs.create', 'qs.post'] as const).filter((k) => !me.permissions.includes(k));
  const canSell = missing.length === 0;

  const load = useCallback(() => masterRequest<Item[]>(me, '/api/shp/admin/products').then((all) => setItems(all.filter((p) => p.isActive && !p.madeToOrder))), [me]);
  const walkIn = useCallback(() => masterRequest<{ id: string; display_name: string; is_active: number }[]>(me, '/api/cus/customers?search=walk-in&limit=10').then((cs) => {
    const w = cs.find((c) => c.is_active === 1 && c.display_name.trim().toLowerCase() === 'walk-in');
    setCustomer(w ? { id: w.id, name: w.display_name } : null);
  }, () => undefined), [me]);
  useEffect(() => {
    if (!canSell) return; // the notice says what is missing; loading would only be refused
    void run(async () => {
      await load(); await walkIn();
      const ps = await api.cashPlaces();
      setPlaces(ps);
      setPlaceId(ps.find((p) => p.kind === 'cash')?.id ?? ps[0]?.id ?? null);
    });
  }, [load, walkIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => [...new Set(items.map((p) => p.category))], [items]);
  const shown = items.filter((p) => (!category || p.category === category) && (!search.trim() || `${p.name} ${p.category}`.toLowerCase().includes(search.trim().toLowerCase())));
  const totalCents = cart.reduce((n, l) => n + l.qty * l.product.priceCents, 0);
  const place = places.find((p) => p.id === placeId);
  const isCash = place?.kind === 'cash';
  let tenderedCents = totalCents;
  try { if (isCash && tendered.trim()) tenderedCents = parsePesos(tendered); } catch { tenderedCents = -1; }
  const change = tenderedCents - totalCents;

  // Only pieces in stock can be sold: what is left, less what is already in this sale.
  const inSale = (product: Item, size: string, colour: string) => cart.filter((l) => same(l, { product, size, colour })).reduce((n, l) => n + l.qty, 0);
  const add = (product: Item, size: string, colour: string) => {
    if (inSale(product, size, colour) >= leftOf(product, size, colour)) return;
    setDone(null);
    setCart((c) => (c.some((l) => same(l, { product, size, colour })) ? c.map((l) => (same(l, { product, size, colour }) ? { ...l, qty: l.qty + 1 } : l)) : [...c, { product, size, colour, qty: 1 }]));
  };
  const setQty = (line: CartLine, qty: number) => setCart((c) => (qty <= 0 ? c.filter((l) => l !== line)
    : c.map((l) => (l === line ? { ...l, qty: Math.min(leftOf(l.product, l.size, l.colour), qty) } : l))));
  const problems = [
    ...(cart.length ? [] : ['Add at least one piece.']),
    ...(customer ? [] : ['There is no "Walk-in" customer: add one on the Customers screen, or pick a customer.']),
    ...(/^\d+$/.test(invoiceNumber.trim()) ? [] : ['Type the invoice number from the booklet.']),
    ...(/^\d+$/.test(crNumber.trim()) ? [] : ['Type the CR number from the booklet.']),
    ...(placeId ? [] : ['Pick where the money went.']),
    ...(isCash && change < 0 ? ['The cash received is less than the total.'] : []),
  ];
  const body = () => ({
    sale: { customerId: customer!.id, invoiceNumber: invoiceNumber.trim(), lines: cart.map((l) => ({
      kind: 'ready_made', description: `${l.product.name} (${l.colour}, ${l.size})`, qty: l.qty, unitPriceCents: l.product.priceCents, discountCents: 0,
      item: { productId: l.product.id, size: l.size, colour: l.colour } })) },
    // The payment is the sale total; cash given above it goes back as change (QS: never kept as a deposit).
    payment: { crNumber: crNumber.trim(), tenders: [{ cashPlaceId: placeId!, amountCents: totalCents, ...(!isCash && reference.trim() ? { reference: reference.trim().slice(0, 40) } : {}) }] },
  });
  const record = () => run(async () => {
    const b = body();
    const pre = await api.qsPreview(b);
    const issues = [...pre.sale.issues, ...(pre.payment?.issues ?? [])];
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) throw new Error(errors.map((i) => i.message).join(' '));
    // Not enough pieces (sold meanwhile, at the POS or online): the sale stops; reload to see what is left.
    const short = issues.filter((i) => i.code === 'STOCK' || i.code === 'ITEM');
    if (short.length) { await load(); throw new Error(`${short.map((i) => i.message.replace(/ Record it if the pieces are here, then recount the stock\.$/, '')).join(' ')} Lower the quantity or remove it.`); }
    const warn = issues.filter((i) => i.level === 'warning');
    // Any other warning is shown once; pressing Record again records anyway.
    if (warn.length && JSON.stringify(warn) !== JSON.stringify(warnings)) { setWarnings(warn); return; }
    const r = await api.qsRecord(b, pre.totalCents, key);
    setDone({ id: r.sale.id, number: r.sale.number, change: isCash ? change : 0 });
    setCart([]); setInvoice(''); setCr(''); setTendered(''); setReference(''); setWarnings([]); setKey(newIdempotencyKey());
    await load();
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">POS</h1><p className="text-sm text-slate-600">Sell the shop's own-brand pieces at the counter. Each sale is a quick sale with its payment, and the pieces come off the stock.</p></div>
        {me.permissions.includes('shp.view') && <Link to="/shp" className="rounded-md bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-indigo-50">Products and stock</Link>}
      </div>
      {!canSell && <Notice>Your role opens the POS but cannot sell here yet. It also needs: {missing.map((k) => ({ 'shp.view': 'see the website shop products', 'cus.view': 'view customers', 'qs.create': 'prepare quick sales', 'qs.post': 'record quick sales' })[k]).join(', ')}. Ask the owner (Admin › Roles and permissions).</Notice>}
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">Recorded as <Link to={docPath('qs.sale', `/${done.id}`)} className="font-semibold underline">{done.number}</Link>.{done.change > 0 ? ` Give ${peso(done.change)} change.` : ''}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} max-w-xs`} placeholder="Search products" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button tone={category ? 'plain' : 'primary'} onClick={() => setCategory('')}>All</Button>
            {categories.map((c) => <Button key={c} tone={category === c ? 'primary' : 'plain'} onClick={() => setCategory(c)}>{c}</Button>)}
          </div>
          {items.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/70">No ready-stock products yet. Add them in Sales › Website shop (as "Ready stock") and record their pieces.</p>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((p) => {
              const left = (p.stock ?? []).reduce((n, s) => n + s.available, 0);
              return (
                <li key={p.id}><button type="button" disabled={left === 0} onClick={() => setPicking(p)} className="flex w-full flex-col rounded-xl bg-white p-2 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:ring-slate-200">
                  <span className="grid aspect-square place-items-center overflow-hidden rounded-md bg-slate-50"><ProductPicture product={p} colour={p.colours[0]?.hex ?? '#ccc'} className={p.photoUrl ? '' : 'w-3/4'} /></span>
                  <span className="mt-2 line-clamp-2 text-sm font-semibold">{p.name}</span>
                  <span className="flex items-center justify-between text-sm"><b>{peso(p.priceCents)}</b><span className={left ? 'text-slate-500' : 'font-semibold text-red-700'}>{left ? `${left} left` : 'Sold out'}</span></span>
                </button></li>);
            })}
          </ul>
        </section>

        <aside className="space-y-3 self-start rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 xl:sticky xl:top-20">
          <h2 className="font-bold">Sale</h2>
          {cart.length === 0 ? <p className="text-sm text-slate-500">Tap a product to add it.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">{cart.map((l) => (
              <li key={`${l.product.id}|${l.size}|${l.colour}`} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{l.product.name}</p><p className="text-xs text-slate-500">{l.colour} · {l.size} · {peso(l.product.priceCents)}</p></div>
                <div className="flex items-center rounded-md ring-1 ring-slate-200">
                  <button type="button" className="size-7" aria-label="One fewer" onClick={() => setQty(l, l.qty - 1)}>−</button>
                  <span className="w-7 text-center tabular-nums">{l.qty}</span>
                  <button type="button" className="size-7 disabled:opacity-30" aria-label="One more" disabled={l.qty >= leftOf(l.product, l.size, l.colour)} onClick={() => setQty(l, l.qty + 1)}>+</button>
                </div>
                <span className="w-20 text-right tabular-nums">{peso(l.qty * l.product.priceCents)}</span>
              </li>))}</ul>)}
          <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span className="tabular-nums">{peso(totalCents)}</span></div>
          <p className="text-xs text-slate-500">Prices include VAT. Customer: <b>{customer?.name ?? '—'}</b></p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Invoice no." required><input className={inputClass} inputMode="numeric" value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} /></Field>
            <Field label="CR no." required><input className={inputClass} inputMode="numeric" value={crNumber} onChange={(e) => setCr(e.target.value)} /></Field>
          </div>
          <Field label="Paid by" required>
            <select className={inputClass} value={placeId ?? ''} onChange={(e) => setPlaceId(Number(e.target.value) || null)}>
              {places.filter((p) => p.kind !== 'checks').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></Field>
          {isCash ? (
            <Field label="Cash received" hint={tendered.trim() && change >= 0 ? `Change: ${peso(change)}` : 'Leave empty for the exact amount.'}>
              <input className={inputClass} inputMode="decimal" placeholder={formatPesos(totalCents)} value={tendered} onChange={(e) => setTendered(e.target.value)} /></Field>
          ) : (
            <Field label="Reference no." hint="From the customer's transfer, e.g. GCash or bank reference."><input className={inputClass} maxLength={40} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          )}
          {warnings.length > 0 && <Notice tone="warning">{warnings.map((w) => w.message).join(' ')} Press Record again to record it anyway.</Notice>}
          {problems.length > 0 && cart.length > 0 && <ul className="list-disc pl-5 text-xs text-slate-500">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <Button tone="primary" className="w-full py-3 text-base" disabled={busy || !canSell || problems.length > 0} onClick={() => void record()}>{busy ? 'Recording…' : `Record sale · ${peso(totalCents)}`}</Button>
          {cart.length > 0 && <button type="button" className="w-full text-sm text-slate-500 hover:text-red-700" onClick={() => { setCart([]); setWarnings([]); }}>Clear the sale</button>}
        </aside>
      </div>
      {picking && <PickVariant product={picking} inCart={cart} onPick={(size, colour) => add(picking, size, colour)} onClose={() => setPicking(null)} />}
    </div>
  );
}

/** Sizes × colours with the pieces left; tapping one adds a piece (it can be tapped again for more). */
function PickVariant({ product, inCart, onPick, onClose }: { product: Item; inCart: CartLine[]; onPick: (size: string, colour: string) => void; onClose: () => void }) {
  return (
    <Dialog title={`${product.name} · ${peso(product.priceCents)}`} onClose={onClose}>
      <p className="text-sm text-slate-600">Tap the size and colour to add a piece. The number is how many are left (less what is already in this sale).</p>
      <div className="space-y-3">
        {product.colours.map((c) => (
          <div key={c.name}>
            <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><span className="size-4 rounded-full ring-1 ring-slate-300" style={{ background: c.hex }} />{c.name}</p>
            <div className="flex flex-wrap gap-2">{product.sizes.map((s) => {
              const taken = inCart.filter((l) => same(l, { product, size: s, colour: c.name })).reduce((n, l) => n + l.qty, 0);
              const left = leftOf(product, s, c.name) - taken;
              return (
                <button key={s} type="button" disabled={left <= 0} onClick={() => onPick(s, c.name)}
                  className={`min-w-16 rounded-md px-3 py-2 text-center text-sm ring-1 transition ${left > 0 ? 'bg-white ring-slate-300 hover:ring-indigo-500' : 'cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200'}`}>
                  <span className="block font-bold">{s}</span><span className="block text-xs">{left > 0 ? `${left} left` : 'none left'}</span>
                </button>);
            })}</div>
          </div>))}
      </div>
      <div className="flex justify-end"><Button tone="primary" onClick={onClose}>Done</Button></div>
    </Dialog>
  );
}
