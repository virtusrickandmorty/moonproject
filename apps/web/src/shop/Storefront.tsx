/** The welcome page: a showcase store of the shop's garments, with filters and quick view (the cart lives in Site.tsx). */
import { formatPeso } from '@moonproject/shared';
import { track } from './insights.ts';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from '../router.tsx';
import { CategoryTiles, HeroSlider, ProductCard, ProductRail, PromoBanner, TrustStrip, isSoldOut } from './Home.tsx';
import { SIZES, categoriesOf, type Category, type Product, percentOff } from './products.ts';
import type { SiteControls } from './Site.tsx';
import { useShop } from './store.tsx';
import { useInterests } from './interests.ts';
import { Loading } from '../components/ui.tsx';

type Sort = 'featured' | 'price-low' | 'price-high' | 'name';
type Kind = 'all' | 'made' | 'ready';
interface Filters { text: string; categories: Category[]; sizes: string[]; colours: string[]; /** `maxCents`: null for no price limit. */
  maxCents: number | null; kind: Kind; saved: boolean; sale: boolean }
const NONE: Filters = { text: '', categories: [], sizes: [], colours: [], maxCents: null, kind: 'all', saved: false, sale: false };
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** The sizes the shop's products come in: the usual ones in their order, then any other typed size as first seen. */
const sizesOf = (products: readonly Product[]) => {
  const all = [...new Set(products.flatMap((p) => p.sizes))];
  const usual = SIZES.filter((s) => all.includes(s));
  return [...usual, ...all.filter((s) => !(usual as string[]).includes(s))];
};

/** Every filter except the one named, so each option can show how many products it would leave. */
function matches(p: Product, f: Filters, wishlist: string[], skip?: keyof Filters): boolean {
  const q = f.text.trim().toLowerCase();
  return (skip === 'text' || !q || `${p.name} ${p.category} ${p.summary}`.toLowerCase().includes(q))
    && (skip === 'categories' || !f.categories.length || f.categories.includes(p.category))
    && (skip === 'sizes' || !f.sizes.length || f.sizes.some((s) => p.sizes.includes(s)))
    && (skip === 'colours' || !f.colours.length || p.colours.some((c) => f.colours.includes(c.name)))
    && (f.maxCents === null || p.priceCents <= f.maxCents)
    && (f.kind === 'all' || (f.kind === 'made') === p.madeToOrder)
    && (!f.saved || wishlist.includes(p.id))
    && (!f.sale || percentOff(p) > 0);
}

/** A ready-stock item's pieces left, from the shop's stock (the samples have none to show). */
const stockWords = (p: Product) => {
  if (!p.stock) return 'Ready stock';
  const left = p.stock.reduce((n, s) => n + s.available, 0);
  return left === 0 ? 'Sold out' : left <= 5 ? `Only ${left} left` : 'In stock';
};

/** The grid in two parts, never mixed: ready stock first (its sold-out pieces last), then made to order. */
const groupsOf = (shown: readonly Product[], online: boolean) => {
  const ready = shown.filter((p) => !p.madeToOrder);
  return [
    { id: 'ready', title: 'Ready stock', dot: 'bg-emerald-500', items: [...ready.filter((p) => !isSoldOut(p)), ...ready.filter(isSoldOut)],
      text: online ? 'On the shelf now: order and pay online, or buy at the shop.' : 'On the shelf now, ready to wear.' },
    { id: 'made', title: 'Made to order', dot: 'bg-amber-500', items: shown.filter((p) => p.madeToOrder),
      text: 'Made for you, with your design or team name. Each has a minimum order and lead time; ask us for a quote.' },
  ].filter((g) => g.items.length);
};

/** How many garments a part of the grid shows at first, and how many more each "Show more" adds. */
const PAGE = 12;

const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm font-semibold transition ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`;

export function Store({ openPanel, view }: SiteControls) {
  const shop = useShop();
  const [f, setF] = useState<Filters>(NONE);
  const [sort, setSort] = useState<Sort>('featured');
  const [showFilters, setShowFilters] = useState(false);
  const { recent, picked } = useInterests(shop.products);
  // How many of each part are showing, kept for the filters and sort they were opened under: a new one starts both parts over.
  const [more, setMore] = useState<{ under: string; upTo: Record<string, number> }>({ under: '', upTo: {} });
  const under = JSON.stringify([f, sort]);
  const upTo = more.under === under ? more.upTo : {};
  const { products } = shop;
  // The header's search sends shoppers here with ?q=…: search for it and bring the results into view.
  const q = new URLSearchParams(useLocation().split('?')[1] ?? '').get('q');
  useEffect(() => {
    if (q === null) return;
    setF({ ...NONE, text: q });
    requestAnimationFrame(() => document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }));
  }, [q]);
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
  // What shoppers search for, a moment after they stop typing, with how many garments matched (none: a gap in the shop).
  useEffect(() => {
    const text = f.text.trim();
    if (text.length < 2) return;
    const t = setTimeout(() => track({ kind: 'search', query: text.slice(0, 60), results: shown.length }), 1500);
    return () => clearTimeout(t);
  }, [f.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (skip: keyof Filters, test: (p: Product) => boolean) => products.filter((p) => matches(p, f, shop.wishlist, skip) && test(p)).length;
  const active: [string, () => void][] = [
    ...f.categories.map((c): [string, () => void] => [c, () => setF({ ...f, categories: toggle(f.categories, c) })]),
    ...f.sizes.map((s): [string, () => void] => [`Size ${s}`, () => setF({ ...f, sizes: toggle(f.sizes, s) })]),
    ...f.colours.map((c): [string, () => void] => [c, () => setF({ ...f, colours: toggle(f.colours, c) })]),
    ...(f.maxCents !== null ? [[`Up to ${formatPeso(f.maxCents)}`, () => setF({ ...f, maxCents: null })] as [string, () => void]] : []),
    ...(f.kind !== 'all' ? [[f.kind === 'made' ? 'Made to order' : 'Ready stock', () => setF({ ...f, kind: 'all' })] as [string, () => void]] : []),
    ...(f.saved ? [['Saved only', () => setF({ ...f, saved: false })] as [string, () => void]] : []),
    ...(f.sale ? [['On sale', () => setF({ ...f, sale: false })] as [string, () => void]] : []),
  ];

  // Online ordering is open once the shop has set how customers pay (Website shop › Online payment) and shows its own products.
  const online = !!shop.payment && !shop.samples;
  const toShop = (kind: Kind) => { setF({ ...NONE, kind }); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); };

  return (
    <>
      <HeroSlider products={products} online={online} payment={shop.payment} toShop={toShop} look={shop.decor?.look} />
      <TrustStrip online={online} payment={shop.payment} />
      <PromoBanner products={products} payment={shop.payment} showSale={() => { setF({ ...NONE, sale: true }); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }} />
      <CategoryTiles products={products} categories={categories} pick={(c) => { setF({ ...NONE, categories: [c] }); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }} />
      {/* What this visitor looked at decides the rows (kept in their browser only); a first visit sees the popular ones. */}
      {picked.length ? <ProductRail eyebrow="For you" title="Picked for you" note="From what you looked at and searched for here." products={picked} online={online} view={view} />
        : <ProductRail eyebrow="Featured" title="Popular garments" products={products.filter((p) => p.badge && !isSoldOut(p)).sort((a, b) => Number(a.madeToOrder) - Number(b.madeToOrder)).slice(0, 8)} online={online} view={view} />}
      <ProductRail eyebrow="Your visit" title="Recently viewed" products={recent} online={online} view={view} />

      <section id="shop" className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-16 pt-16 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">The shop</p>
        <h2 className="mb-5 mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">All garments</h2>
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button type="button" className={chip(!f.categories.length)} onClick={() => setF({ ...f, categories: [] })}>All</button>
          {categories.map((c) => <button key={c} type="button" className={`${chip(f.categories.includes(c))} shrink-0`} onClick={() => { if (!f.categories.includes(c)) track({ kind: 'category', category: c.slice(0, 60) }); setF({ ...f, categories: toggle(f.categories, c) }); }}>{c} <span className="opacity-60">{count('categories', (p) => p.category === c)}</span></button>)}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[15rem_1fr]">
          <aside className={`${showFilters ? 'block' : 'hidden'} space-y-6 lg:block`} aria-label="Filters">
            <input type="search" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Search garments…" aria-label="Search garments" className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-500" />
            <fieldset><legend className="mb-2 text-sm font-bold">Type</legend>
              <div className="flex flex-wrap gap-2">{([['all', 'All'], ['ready', 'Ready stock'], ['made', 'Made to order']] as [Kind, string][]).map(([k, label]) =>
                <button key={k} type="button" className={chip(f.kind === k)} onClick={() => setF({ ...f, kind: k })}>{label}</button>)}</div>
            </fieldset>
            <fieldset><legend className="mb-2 flex w-full justify-between text-sm font-bold">Size <button type="button" onClick={() => openPanel('sizes')} className="font-semibold text-indigo-600 hover:underline">Guide</button></legend>
              <div className="grid grid-cols-4 gap-1.5">{sizesOf(products).map((s) => { const n = count('sizes', (p) => p.sizes.includes(s)); return (
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
            {!shop.ready ? <Loading label="Loading garments…" /> : shown.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-10 text-center">
                <p className="font-semibold">No garments match these filters.</p>
                <button type="button" onClick={() => setF(NONE)} className="mt-3 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white">Show everything</button>
              </div>
            ) : (
              <div className="mt-5 space-y-12">{groupsOf(shown, online).map((g) => (
                <section key={g.id} aria-labelledby={`kind-${g.id}`}>
                  <div className="border-b border-slate-200 pb-3">
                    <h3 id={`kind-${g.id}`} className="flex items-center gap-2 text-xl font-extrabold"><span className={`size-2.5 rounded-full ${g.dot}`} aria-hidden />{g.title} <span className="text-base font-semibold text-slate-400">{g.items.length}</span></h3>
                    <p className="mt-1 text-sm text-slate-600">{g.text}</p>
                  </div>
                  <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-5 xl:grid-cols-3">{g.items.slice(0, upTo[g.id] ?? PAGE).map((p) => (
                    <li key={p.id}><ProductCard p={p} online={online} view={view} colourHex={(f.colours.length ? p.colours.find((c) => f.colours.includes(c.name)) : undefined)?.hex} />
                      <p className="mt-1 px-1 text-xs text-slate-500">{p.madeToOrder ? `Min. ${p.minQty} pcs · ${p.leadDays} days` : stockWords(p)}</p></li>))}</ul>
                  {g.items.length > (upTo[g.id] ?? PAGE) && <div className="mt-8 text-center">
                    <p className="text-sm text-slate-500">Showing {upTo[g.id] ?? PAGE} of {g.items.length}</p>
                    <button type="button" onClick={() => setMore({ under, upTo: { ...upTo, [g.id]: (upTo[g.id] ?? PAGE) + PAGE } })} className="mt-2 rounded-full border border-slate-300 bg-white px-6 py-2.5 text-sm font-bold hover:border-slate-900">
                      Show {Math.min(PAGE, g.items.length - (upTo[g.id] ?? PAGE))} more {g.title.toLowerCase()}</button>
                  </div>}
                </section>))}</div>
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
