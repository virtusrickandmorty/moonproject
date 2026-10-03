/** The welcome page: a showcase store of the shop's garments, with filters and quick view (the cart lives in Site.tsx). */
import { formatPeso } from '@moonproject/shared';
import { useMemo, useState } from 'react';
import { Link } from '../router.tsx';
import { ProductPicture } from './GarmentArt.tsx';
import { WishButton } from './Panels.tsx';
import { SIZES, categoriesOf, type Category, type Product } from './products.ts';
import type { SiteControls } from './Site.tsx';
import { useShop } from './store.tsx';

type Sort = 'featured' | 'price-low' | 'price-high' | 'name';
type Kind = 'all' | 'made' | 'ready';
interface Filters { text: string; categories: Category[]; sizes: string[]; colours: string[]; /** `maxCents`: null for no price limit. */
  maxCents: number | null; kind: Kind; saved: boolean }
const NONE: Filters = { text: '', categories: [], sizes: [], colours: [], maxCents: null, kind: 'all', saved: false };
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Every filter except the one named, so each option can show how many products it would leave. */
function matches(p: Product, f: Filters, wishlist: string[], skip?: keyof Filters): boolean {
  const q = f.text.trim().toLowerCase();
  return (skip === 'text' || !q || `${p.name} ${p.category} ${p.summary}`.toLowerCase().includes(q))
    && (skip === 'categories' || !f.categories.length || f.categories.includes(p.category))
    && (skip === 'sizes' || !f.sizes.length || f.sizes.some((s) => p.sizes.includes(s)))
    && (skip === 'colours' || !f.colours.length || p.colours.some((c) => f.colours.includes(c.name)))
    && (f.maxCents === null || p.priceCents <= f.maxCents)
    && (f.kind === 'all' || (f.kind === 'made') === p.madeToOrder)
    && (!f.saved || wishlist.includes(p.id));
}

const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`;

export function Store({ openPanel, view }: SiteControls) {
  const shop = useShop();
  const [f, setF] = useState<Filters>(NONE);
  const [sort, setSort] = useState<Sort>('featured');
  const [showFilters, setShowFilters] = useState(false);
  const { products } = shop;
  // The filters offer what the shop's products have: their categories, colours and price range.
  const { categories, colours, low, high } = useMemo(() => ({
    categories: categoriesOf(products),
    colours: [...new Map(products.flatMap((p) => p.colours).map((c) => [c.name, c])).values()],
    low: Math.floor(Math.min(...products.map((p) => p.priceCents), 0) / 1000) * 1000,
    high: Math.max(...products.map((p) => p.priceCents), 0),
  }), [products]);

  const shown = useMemo(() => {
    const list = products.filter((p) => matches(p, f, shop.wishlist));
    if (sort === 'price-low') return [...list].sort((a, b) => a.priceCents - b.priceCents);
    if (sort === 'price-high') return [...list].sort((a, b) => b.priceCents - a.priceCents);
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, f, sort, shop.wishlist]);
  const count = (skip: keyof Filters, test: (p: Product) => boolean) => products.filter((p) => matches(p, f, shop.wishlist, skip) && test(p)).length;
  const active: [string, () => void][] = [
    ...f.categories.map((c): [string, () => void] => [c, () => setF({ ...f, categories: toggle(f.categories, c) })]),
    ...f.sizes.map((s): [string, () => void] => [`Size ${s}`, () => setF({ ...f, sizes: toggle(f.sizes, s) })]),
    ...f.colours.map((c): [string, () => void] => [c, () => setF({ ...f, colours: toggle(f.colours, c) })]),
    ...(f.maxCents !== null ? [[`Up to ${formatPeso(f.maxCents)}`, () => setF({ ...f, maxCents: null })] as [string, () => void]] : []),
    ...(f.kind !== 'all' ? [[f.kind === 'made' ? 'Made to order' : 'Ready stock', () => setF({ ...f, kind: 'all' })] as [string, () => void]] : []),
    ...(f.saved ? [['Saved only', () => setF({ ...f, saved: false })] as [string, () => void]] : []),
  ];

  return (
    <>
      <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 pb-10 pt-10 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-16">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Virtus Garments · made to order</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">Team wear, uniforms and custom prints, <span className="text-indigo-600">made for you.</span></h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600">Pick your garments, set the sizes for everyone, and send us the list. We reply with a quotation and a design proof. No payment online.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#shop" className="rounded-full bg-slate-900 px-7 py-3.5 font-bold text-white hover:bg-indigo-700">Browse garments</a>
            <button type="button" onClick={() => openPanel('sizes')} className="rounded-full border border-slate-300 px-7 py-3.5 font-bold hover:border-slate-900">Find your size</button>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-3">
          {products.slice(0, 3).map((p, i) => (
            <button key={p.id} type="button" onClick={() => view(p)} className={`grid aspect-[3/4] place-items-center overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-900/5 transition hover:-translate-y-1 ${i === 1 ? 'mt-10' : ''}`} aria-label={`Quick view: ${p.name}`}>
              <ProductPicture product={p} colour={p.colours[i % p.colours.length]!.hex} className={p.photoUrl ? '' : 'w-4/5'} />
            </button>))}
        </div>
      </section>

      <section id="shop" className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-16 sm:px-6">
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button type="button" className={chip(!f.categories.length)} onClick={() => setF({ ...f, categories: [] })}>All</button>
          {categories.map((c) => <button key={c} type="button" className={`${chip(f.categories.includes(c))} shrink-0`} onClick={() => setF({ ...f, categories: toggle(f.categories, c) })}>{c} <span className="opacity-60">{count('categories', (p) => p.category === c)}</span></button>)}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[15rem_1fr]">
          <aside className={`${showFilters ? 'block' : 'hidden'} space-y-6 lg:block`} aria-label="Filters">
            <input type="search" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Search garments…" aria-label="Search garments" className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-500" />
            <fieldset><legend className="mb-2 text-sm font-bold">Type</legend>
              <div className="flex flex-wrap gap-2">{([['all', 'All'], ['made', 'Made to order'], ['ready', 'Ready stock']] as [Kind, string][]).map(([k, label]) =>
                <button key={k} type="button" className={chip(f.kind === k)} onClick={() => setF({ ...f, kind: k })}>{label}</button>)}</div>
            </fieldset>
            <fieldset><legend className="mb-2 flex w-full justify-between text-sm font-bold">Size <button type="button" onClick={() => openPanel('sizes')} className="font-semibold text-indigo-600 hover:underline">Guide</button></legend>
              <div className="grid grid-cols-4 gap-1.5">{SIZES.map((s) => { const n = count('sizes', (p) => p.sizes.includes(s)); return (
                <button key={s} type="button" disabled={!n && !f.sizes.includes(s)} onClick={() => setF({ ...f, sizes: toggle(f.sizes, s) })}
                  className={`rounded-lg border py-1.5 text-sm font-semibold disabled:opacity-30 ${f.sizes.includes(s) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-400'}`}>{s}</button>); })}</div>
            </fieldset>
            <fieldset><legend className="mb-2 text-sm font-bold">Colour</legend>
              <div className="flex flex-wrap gap-2">{colours.map((c) => { const n = count('colours', (p) => p.colours.some((x) => x.name === c.name)); return (
                <button key={c.name} type="button" disabled={!n && !f.colours.includes(c.name)} title={`${c.name} (${n})`} aria-label={`${c.name}, ${n} products`} aria-pressed={f.colours.includes(c.name)}
                  onClick={() => setF({ ...f, colours: toggle(f.colours, c.name) })}
                  className={`size-8 rounded-full ring-2 ring-offset-2 disabled:opacity-25 ${f.colours.includes(c.name) ? 'ring-indigo-600' : 'ring-transparent hover:ring-slate-300'}`} style={{ background: c.hex, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .15)' }} />); })}</div>
            </fieldset>
            <fieldset><legend className="mb-2 text-sm font-bold">Price per piece</legend>
              <input type="range" min={low} max={high} step={1_000} value={f.maxCents ?? high} onChange={(e) => { const v = Number(e.target.value); setF({ ...f, maxCents: v >= high ? null : v }); }} className="w-full accent-indigo-600" aria-label="Highest price per piece" />
              <p className="text-sm text-slate-600">{f.maxCents === null ? 'Any price' : `Up to ${formatPeso(f.maxCents)}`}</p>
            </fieldset>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.saved} onChange={(e) => setF({ ...f, saved: e.target.checked })} className="size-4 accent-indigo-600" /> Saved to wishlist only</label>
          </aside>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600" aria-live="polite">{shop.ready ? <><b className="text-slate-900">{shown.length}</b> of {products.length} garments</> : 'Loading…'}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowFilters(!showFilters)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold lg:hidden" aria-expanded={showFilters}>Filters{active.length ? ` (${active.length})` : ''}</button>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">
                  <option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option>
                </select>
              </div>
            </div>
            {active.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
              {active.map(([label, clear]) => <button key={label} type="button" onClick={clear} className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-800 hover:bg-indigo-100">{label} ✕</button>)}
              <button type="button" onClick={() => setF({ ...NONE, text: f.text })} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Clear all</button>
            </div>}

            {shop.samples && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">These are sample garments. The shop's own products will appear here once they are published.</p>}
            {!shop.ready ? <p className="mt-6 text-sm text-slate-500">Loading garments…</p> : shown.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-10 text-center">
                <p className="font-semibold">No garments match these filters.</p>
                <button type="button" onClick={() => setF(NONE)} className="mt-3 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white">Show everything</button>
              </div>
            ) : (
              <ul className="mt-5 grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-3">{shown.map((p) => (
                <li key={p.id} className="group relative flex flex-col rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-900/5 transition hover:shadow-md">
                  <div className="relative grid aspect-square place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100">
                    <ProductPicture product={p} colour={(f.colours.length ? p.colours.find((c) => f.colours.includes(c.name)) : undefined)?.hex ?? p.colours[0]!.hex} className={`transition duration-300 group-hover:scale-105 ${p.photoUrl ? '' : 'w-3/4'}`} />
                    {p.badge && <span className="absolute left-2 top-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-800 shadow-sm">{p.badge}</span>}
                    <WishButton product={p} className="absolute right-2 top-2" />
                    <button type="button" onClick={() => view(p)} className="absolute inset-x-2 bottom-2 rounded-full bg-slate-900/90 py-2 text-sm font-bold text-white opacity-100 transition sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:focus:translate-y-0 sm:focus:opacity-100">Quick view</button>
                  </div>
                  <div className="flex flex-1 flex-col px-1 pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{p.category}</p>
                    <h3 className="mt-0.5 font-bold leading-snug"><button type="button" onClick={() => view(p)} className="text-left hover:text-indigo-700">{p.name}</button></h3>
                    <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                      <p className="text-sm"><span className="text-slate-500">from </span><b>{formatPeso(p.priceCents)}</b></p>
                      <div className="flex -space-x-1">{p.colours.map((c) => <span key={c.name} className="size-3.5 rounded-full ring-2 ring-white" style={{ background: c.hex }} title={c.name} />)}</div>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{p.madeToOrder ? `Min. ${p.minQty} pcs · ${p.leadDays} days` : 'Ready stock'}</p>
                  </div>
                </li>))}</ul>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-16 sm:px-6 md:grid-cols-2">
        <Link to="/services" className="group rounded-3xl bg-slate-900 p-8 text-white transition hover:bg-indigo-800">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">Our services</p>
          <h2 className="mt-3 text-2xl font-extrabold">Embroidery, sublimation, cut and sew, printing</h2>
          <p className="mt-2 text-white/70">See everything we make and decorate for teams, schools and companies.</p>
          <span className="mt-5 inline-block font-bold">See the services <span className="inline-block transition group-hover:translate-x-1">→</span></span>
        </Link>
        <Link to="/support" className="group rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-900/5 transition hover:ring-indigo-300">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Customer support</p>
          <h2 className="mt-3 text-2xl font-extrabold">Questions, feedback or a quotation?</h2>
          <p className="mt-2 text-slate-600">Send us a message with your design pictures and we will get back to you.</p>
          <span className="mt-5 inline-block font-bold text-indigo-700">Contact us <span className="inline-block transition group-hover:translate-x-1">→</span></span>
        </Link>
      </section>
    </>
  );
}
