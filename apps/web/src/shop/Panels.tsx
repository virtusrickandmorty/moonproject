/** The store's pop-ups: quick view, size guide, cart (which becomes a quotation request) and wishlist. */
import { formatPeso } from '@moonproject/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ProductPicture } from './GarmentArt.tsx';
import { navigate } from '../router.tsx';
import { SIZE_CHART, type Product, percentOff } from './products.ts';
import { useShop, type CartLine } from './store.tsx';
import { ReviewCard, Stars } from './Stars.tsx';

/** Open overlays, newest last: Escape closes only the top one. */
const open: string[] = [];

/** A modal (centred) or a drawer (from the right). Escape or the backdrop closes it; focus returns where it was. */
function Overlay({ title, onClose, side, children }: { title: string; onClose: () => void; side?: boolean; children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    open.push(id);
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open.at(-1) === id) close.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; open.splice(open.indexOf(id), 1); before?.focus(); };
  }, [id]);
  return (
    <div className={`fixed inset-0 z-50 flex bg-slate-900/45 backdrop-blur-[2px] ${side ? 'justify-end' : 'items-center justify-center p-4'}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id}
        className={`flex flex-col bg-white shadow-2xl outline-none ${side ? 'h-full w-full max-w-md' : 'max-h-[92vh] w-full max-w-5xl rounded-2xl'}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id={id} className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-xl text-slate-500 hover:bg-slate-100" aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

const Heart = ({ on }: { on: boolean }) => <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.2 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.4h2c.8-1.3 2.2-2.4 4.2-2.4 3.6 0 5.6 3.7 4 6.9C19 15.6 12 20 12 20Z" fill={on ? '#e11d48' : 'none'} stroke={on ? '#e11d48' : 'currentColor'} strokeWidth="1.8" /></svg>;
export function WishButton({ product, className = '' }: { product: Product; className?: string }) {
  const { wishlist, toggleWish } = useShop();
  const on = wishlist.includes(product.id);
  return <button type="button" onClick={() => toggleWish(product.id)} aria-pressed={on} aria-label={on ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
    className={`grid size-10 place-items-center rounded-full bg-white/90 text-slate-600 shadow-sm ring-1 ring-slate-900/5 transition hover:scale-105 hover:text-rose-600 ${className}`}><Heart on={on} /></button>;
}

/** Product details with a quantity per size, so a team can order its whole size run in one go. */
export function QuickView({ product, onClose, onSizeGuide, onAdded }: { product: Product; onClose: () => void; onSizeGuide: () => void; onAdded: () => void }) {
  const { add, reviews, ratingOf } = useShop();
  const mine = reviews.filter((r) => r.productId === product.id);
  const rating = ratingOf(product.id);
  // A ready-stock item from the shop knows its pieces left per size and colour: those cap what can go in the cart.
  const left = (size: string, c: string) => (product.stock ? product.stock.find((x) => x.size === size && x.colour === c)?.available ?? 0 : 999);
  const firstIn = (c: string) => product.sizes.find((s) => left(s, c) > 0);
  const startColour = product.colours.find((c) => !product.stock || firstIn(c.name)) ?? product.colours[0]!;
  const [colour, setColour] = useState(startColour);
  const startQty = (c: string): Record<string, number> => { const s = product.madeToOrder ? undefined : (product.stock ? firstIn(c) : product.sizes[2] ?? product.sizes[0]); return s ? { [s]: 1 } : {}; };
  const [qty, setQty] = useState<Record<string, number>>(() => startQty(startColour.name));
  const total = Object.values(qty).reduce((n, q) => n + q, 0);
  const short = product.madeToOrder && total > 0 && total < product.minQty;
  const set = (size: string, n: number) => setQty((q) => ({ ...q, [size]: Math.max(0, Math.min(left(size, colour.name), Number.isFinite(n) ? Math.floor(n) : 0)) }));
  const pickColour = (c: typeof colour) => { setColour(c); if (product.stock) setQty(startQty(c.name)); };
  const soldOut = !!product.stock && product.sizes.every((s) => left(s, colour.name) === 0);
  const addAll = () => {
    add(Object.entries(qty).filter(([, n]) => n > 0).map(([size, n]): CartLine => ({ productId: product.id, size, colour: colour.name, qty: n })));
    onAdded();
  };
  return (
    <Overlay title="Quick view" onClose={onClose}>
      <div className="grid gap-6 p-5 md:grid-cols-[0.9fr_1.1fr] md:p-7">
        <div className="relative grid aspect-square place-items-center self-start overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100">
          <ProductPicture product={product} colour={colour.hex} className={product.photoUrl ? '' : 'w-4/5'} />
          <WishButton product={product} className="absolute right-3 top-3" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{product.category}</p>
          <h3 className="mt-1 text-2xl font-bold text-slate-900">{product.name}</h3>
          {rating.count > 0 && <a href="#reviews" onClick={(e) => { e.preventDefault(); document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' }); }} className="mt-1 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <Stars rating={rating.average} /> <b>{rating.average.toFixed(1)}</b> · {rating.count} review{rating.count === 1 ? '' : 's'}</a>}
          <p className="mt-2 text-xl font-semibold">{product.madeToOrder ? 'from ' : ''}<span className={percentOff(product) ? 'text-rose-600' : ''}>{formatPeso(product.priceCents)}</span>
            {percentOff(product) > 0 && <><s className="ml-2 text-base font-medium text-slate-400">{formatPeso(product.regularPriceCents!)}</s> <span className="ml-1 rounded-full bg-rose-600 px-2 py-0.5 align-middle text-xs font-bold text-white">−{percentOff(product)}%</span></>}
            {' '}<span className="text-sm font-normal text-slate-500">a piece</span></p>
          <p className="mt-3 text-slate-600">{product.summary}</p>
          <ul className="mt-3 space-y-1 text-sm text-slate-600">{product.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
          <p className="mt-4 text-sm font-semibold">Colour: <span className="font-normal">{colour.name}</span></p>
          <div className="mt-2 flex gap-2">{product.colours.map((c) => <button key={c.name} type="button" onClick={() => pickColour(c)} aria-label={c.name} aria-pressed={c === colour}
            className={`size-8 rounded-full ring-2 ring-offset-2 transition ${c === colour ? 'ring-indigo-600' : 'ring-transparent hover:ring-slate-300'}`} style={{ background: c.hex, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .15)' }} />)}</div>
          <div className="mt-5 flex items-center justify-between">
            <p className="text-sm font-semibold">Quantity per size</p>
            <button type="button" onClick={onSizeGuide} className="text-sm font-semibold text-indigo-600 underline-offset-2 hover:underline">Size guide</button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">{product.sizes.map((s) => {
            const n = left(s, colour.name), out = !!product.stock && n === 0;
            return (
              <label key={s} className={`rounded-lg border p-1.5 text-center ${out ? 'border-slate-100 bg-slate-50 opacity-60' : qty[s] ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'}`}>
                <span className="block text-xs font-bold text-slate-700">{s}</span>
                <input type="number" min={0} max={product.stock ? n : 999} inputMode="numeric" value={qty[s] || ''} placeholder={out ? '–' : '0'} disabled={out} onChange={(e) => set(s, e.target.valueAsNumber)}
                  className="mt-1 w-full rounded border-0 bg-transparent p-0 text-center text-sm outline-none [appearance:textfield]" aria-label={`Quantity in size ${s}`} />
                {product.stock && <span className={`block text-[10px] ${out ? 'text-red-700' : 'text-slate-500'}`}>{out ? 'Sold out' : `${n} left`}</span>}
              </label>);
          })}</div>
          <p className={`mt-3 text-sm ${short ? 'text-amber-700' : 'text-slate-500'}`}>
            {product.madeToOrder ? `Made to order · minimum ${product.minQty} pieces · about ${product.leadDays} days` : soldOut ? `${colour.name} is sold out for now.` : product.stock ? 'Ready stock · order and pay online, or buy at the shop' : `Ready stock · ready in about ${product.leadDays} days`}
            {short && ` · add ${product.minQty - total} more to reach the minimum`}
          </p>
          <button type="button" disabled={total === 0} onClick={addAll}
            className="mt-4 w-full rounded-full bg-slate-900 px-6 py-3.5 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {total ? `Add ${total} to cart · ${formatPeso(total * product.priceCents)}` : 'Pick sizes to add'}
          </button>
        </div>
      </div>
      {mine.length > 0 && (
        <section id="reviews" className="border-t border-slate-100 bg-slate-50 p-5 md:p-7" aria-label="Reviews">
          <h4 className="flex items-center gap-3 text-lg font-bold">What buyers say <Stars rating={rating.average} /> <span className="text-sm font-semibold text-slate-500">{rating.average.toFixed(1)} of 5 · {rating.count}</span></h4>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">{mine.slice(0, 6).map((r) => <li key={r.id}><ReviewCard r={r} /></li>)}</ul>
        </section>
      )}
    </Overlay>
  );
}

export function SizeGuide({ onClose }: { onClose: () => void }) {
  const [cm, setCm] = useState(false);
  const show = (inches: number) => (cm ? (inches * 2.54).toFixed(0) : String(inches));
  return (
    <Overlay title="Size guide" onClose={onClose}>
      <div className="p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Body measurements for our standard tops. Between sizes? Pick the larger one.</p>
          <div className="flex rounded-full bg-slate-100 p-1 text-sm font-semibold" role="group" aria-label="Units">
            {[false, true].map((v) => <button key={String(v)} type="button" aria-pressed={cm === v} onClick={() => setCm(v)} className={`rounded-full px-4 py-1.5 ${cm === v ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{v ? 'cm' : 'inches'}</button>)}
          </div>
        </div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-slate-500">{['Size', 'Chest', 'Length', 'Shoulder'].map((h) => <th key={h} className="py-2 pr-4 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{SIZE_CHART.map((r) => <tr key={r.size} className="border-b border-slate-100"><td className="py-2.5 pr-4 font-bold">{r.size}</td><td className="pr-4 tabular-nums">{show(r.chest)}</td><td className="pr-4 tabular-nums">{show(r.length)}</td><td className="tabular-nums">{show(r.shoulder)}</td></tr>)}</tbody>
        </table></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[['Chest', 'Around the fullest part, under the arms, tape level.'], ['Length', 'From the highest point of the shoulder down to where the hem should fall.'], ['Shoulder', 'Across the back, from one shoulder tip to the other.']].map(([t, d]) =>
            <div key={t} className="rounded-xl bg-slate-50 p-4"><p className="font-bold">{t}</p><p className="mt-1 text-sm text-slate-600">{d}</p></div>)}
        </div>
        <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">Ordering for a team or a school? We can lend you a sizing set to try on, or measure each person for a made-to-measure fit.</p>
      </div>
    </Overlay>
  );
}

/** The cart as plain lines, for the quotation request on the support page. */
export const cartText = (cart: CartLine[], byId: (id: string) => Product | undefined) => cart.map((l) => `${l.qty} × ${byId(l.productId)!.name} (${l.colour}, size ${l.size})`).join('\n');

export function CartDrawer({ onClose }: { onClose: () => void }) {
  const { cart, setQty, remove, clearCart, productById, orderable, payment } = useShop();
  // Ready-stock pieces are ordered and paid online; made-to-order items (and everything while online ordering is closed) are quoted.
  const online = cart.filter(orderable), quoted = cart.filter((l) => !orderable(l));
  const sum = (lines: typeof cart) => lines.reduce((n, l) => n + l.qty * (productById(l.productId)?.priceCents ?? 0), 0);
  const leftOf = (l: (typeof cart)[number]) => productById(l.productId)?.stock?.find((s) => s.size === l.size && s.colour === l.colour)?.available;
  return (
    <Overlay title={`Your cart (${cart.length})`} side onClose={onClose}>
      {cart.length === 0 ? <p className="p-8 text-center text-slate-500">Your cart is empty. Open a product and pick sizes to start a list.</p> : (
        <div className="flex h-full flex-col">
          <ul className="flex-1 divide-y divide-slate-100 px-5">{cart.map((l) => { const p = productById(l.productId)!; const hex = p.colours.find((c) => c.name === l.colour)?.hex ?? '#ccc'; const left = leftOf(l); return (
            <li key={`${l.productId}-${l.size}-${l.colour}`} className="flex gap-3 py-4">
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50"><ProductPicture product={p} colour={hex} className={p.photoUrl ? '' : 'w-12'} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p><p className="text-sm text-slate-500">{l.colour} · size {l.size}</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex items-center rounded-full border border-slate-200">
                    <button type="button" onClick={() => setQty(l, l.qty - 1)} className="size-8 text-lg" aria-label="One fewer">−</button>
                    <span className="w-8 text-center text-sm tabular-nums">{l.qty}</span>
                    <button type="button" disabled={left !== undefined && l.qty >= left} onClick={() => setQty(l, l.qty + 1)} className="size-8 text-lg disabled:opacity-30" aria-label="One more">+</button>
                  </div>
                  <button type="button" onClick={() => remove(l)} className="text-sm text-slate-500 hover:text-rose-600">Remove</button>
                </div>
                {left !== undefined && l.qty > left && <p className="mt-1 text-xs font-semibold text-rose-700">{left ? `Only ${left} left: lower the quantity.` : 'Sold out: remove it.'}</p>}
                <p className="mt-1 text-xs text-slate-500">{orderable(l) ? 'Order and pay online' : p.madeToOrder ? 'Made to order: for a quotation' : 'For a quotation or at the shop'}</p>
              </div>
              <p className="font-semibold tabular-nums">{formatPeso(l.qty * p.priceCents)}</p>
            </li>); })}</ul>
          <div className="space-y-4 border-t border-slate-100 p-5">
            {online.length > 0 && <div>
              <div className="flex justify-between text-lg font-bold"><span>Order online</span><span className="tabular-nums">{formatPeso(sum(online))}</span></div>
              <p className="mt-1 text-xs text-slate-500">Pay online first; we confirm your payment, then prepare your order.</p>
              <button type="button" disabled={online.some((l) => (leftOf(l) ?? 0) < l.qty)} onClick={() => { onClose(); navigate('/checkout'); }}
                className="mt-3 w-full rounded-full bg-indigo-600 px-6 py-3.5 font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300">Check out and pay online</button>
            </div>}
            {quoted.length > 0 && <div>
              <div className="flex justify-between font-bold"><span>For a quotation</span><span className="tabular-nums">{formatPeso(sum(quoted))}</span></div>
              <p className="mt-1 text-xs text-slate-500">Starting prices. Your quotation confirms the price for your design and quantity.</p>
              <button type="button" onClick={() => { onClose(); navigate('/support?type=quotation&from=cart'); }} className="mt-3 w-full rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-700">Request a quotation</button>
            </div>}
            <button type="button" onClick={clearCart} className="w-full py-1 text-sm text-slate-500 hover:text-rose-600">Empty the cart</button>
          </div>
        </div>)}
    </Overlay>
  );
}

export function WishlistDrawer({ onClose, onOpen }: { onClose: () => void; onOpen: (p: Product) => void }) {
  const { wishlist, toggleWish, products } = useShop();
  const saved = products.filter((p) => wishlist.includes(p.id));
  return (
    <Overlay title={`Wishlist (${saved.length})`} side onClose={onClose}>
      {saved.length === 0 ? <p className="p-8 text-center text-slate-500">Tap the heart on any product to save it here.</p> : (
        <ul className="divide-y divide-slate-100 px-5">{saved.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-4">
            <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50"><ProductPicture product={p} colour={p.colours[0]!.hex} className={p.photoUrl ? '' : 'w-12'} /></div>
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.name}</p><p className="text-sm text-slate-500">from {formatPeso(p.priceCents)}</p></div>
            <button type="button" onClick={() => onOpen(p)} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">View</button>
            <button type="button" onClick={() => toggleWish(p.id)} className="text-sm text-slate-500 hover:text-rose-600" aria-label={`Remove ${p.name}`}>✕</button>
          </li>))}</ul>)}
    </Overlay>
  );
}
