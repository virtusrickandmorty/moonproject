/**
 * The shop's home page sections, in a modern tech-lifestyle style: a sliding hero banner, a trust strip, category tiles,
 * a row of featured garments and the product card the whole shop uses. All built from the shop's own data (products,
 * categories, stock, payment and delivery settings); nothing here is made up.
 */
import { formatPeso } from '@moonproject/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from '../router.tsx';
import { ProductPicture } from './GarmentArt.tsx';
import { WishButton } from './Panels.tsx';
import { Stars } from './Stars.tsx';
import { deliveryWords, percentOff, type Product } from './products.ts';
import { useShop, type OnlinePayment } from './store.tsx';

export const isSoldOut = (p: Product) => !!p.stock && p.stock.every((s) => s.available === 0);
const piecesLeft = (p: Product) => (p.stock ?? []).reduce((n, s) => n + s.available, 0);

/** The product card: picture (a second colour or a closer look on hover), badge, wish, quick add, price and colours. */
export function ProductCard({ p, colourHex, online, view }: { p: Product; colourHex?: string; online: boolean; view: (p: Product) => void }) {
  const soldOut = isSoldOut(p);
  const buy = online && !p.madeToOrder && !!p.stock;
  const first = colourHex ?? p.colours[0]!.hex;
  const second = p.colours.find((c) => c.hex !== first)?.hex;
  const left = piecesLeft(p);
  const { average, count } = useShop().ratingOf(p.id);
  return (
    <article className="group flex h-full flex-col">
      <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-gradient-to-b from-slate-100 to-slate-200/70">
        <button type="button" onClick={() => view(p)} className="absolute inset-0 grid place-items-center" aria-label={`View ${p.name}`}>
          {/* A photo zooms in; a drawing turns to the next colour, as a second view. */}
          <span className={`absolute inset-0 grid place-items-center transition duration-500 ${p.photoUrl ? 'group-hover:scale-105' : second ? 'group-hover:opacity-0' : 'group-hover:scale-105'}`}>
            <ProductPicture product={p} colour={first} className={p.photoUrl ? '' : 'w-3/4'} />
          </span>
          {!p.photoUrl && second && <span className="absolute inset-0 grid place-items-center opacity-0 transition duration-500 group-hover:opacity-100"><ProductPicture product={p} colour={second} className="w-3/4" /></span>}
        </button>
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
          {!soldOut && percentOff(p) > 0 && <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">Sale −{percentOff(p)}%</span>}
          {soldOut ? <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">Sold out</span>
            : p.badge && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-900 shadow-sm">{p.badge}</span>}
          {buy && !soldOut && left > 0 && left <= 5 && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-900">Only {left} left</span>}
        </div>
        <WishButton product={p} className="absolute right-3 top-3" />
        <button type="button" disabled={buy && soldOut} onClick={() => view(p)}
          className={`absolute inset-x-3 bottom-3 rounded-full py-2.5 text-sm font-bold shadow-lg transition duration-300 disabled:cursor-not-allowed disabled:bg-white/80 disabled:text-slate-400 sm:translate-y-3 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:focus:translate-y-0 sm:focus:opacity-100 ${buy ? 'bg-slate-900 text-white hover:bg-indigo-600' : 'bg-white text-slate-900 hover:bg-slate-900 hover:text-white'}`}>
          {soldOut && buy ? 'Sold out' : buy ? '+ Quick add' : 'Get a quote'}
        </button>
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{p.category}</p>
        <h3 className="mt-1 font-semibold leading-snug"><button type="button" onClick={() => view(p)} className="text-left hover:text-indigo-700">{p.name}</button></h3>
        {count > 0 && <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Stars rating={average} className="size-3.5" />{average.toFixed(1)} ({count})</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <p className="font-bold">{p.madeToOrder && <span className="text-xs font-semibold text-slate-500">From </span>}
            <span className={percentOff(p) ? 'text-rose-600' : ''}>{formatPeso(p.priceCents)}</span>
            {percentOff(p) > 0 && <s className="ml-1.5 text-xs font-medium text-slate-400">{formatPeso(p.regularPriceCents!)}</s>}</p>
          <div className="flex -space-x-1">{p.colours.slice(0, 5).map((c) => <span key={c.name} className="size-4 rounded-full ring-2 ring-white" style={{ background: c.hex, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .12)' }} title={c.name} />)}</div>
        </div>
      </div>
    </article>
  );
}

interface Slide { eyebrow: string; title: ReactNode; text: string; actions: [string, () => void, 'primary' | 'ghost'][]; product?: Product; tone: string }

/** The banner across the top: slides that turn by themselves (paused while pointed at), with dots and arrows. */
export function HeroSlider({ products, online, payment, toShop }: { products: readonly Product[]; online: boolean; payment: OnlinePayment | null; toShop: (kind: 'ready' | 'made' | 'all') => void }) {
  const ready = products.find((p) => !p.madeToOrder && !isSoldOut(p)) ?? products.find((p) => !p.madeToOrder);
  const made = products.find((p) => p.madeToOrder);
  const slides: Slide[] = [
    ...(online ? [{
      eyebrow: 'Own brand · ready to wear', title: <>Wear it today.<br /><span className="text-indigo-300">Order online.</span></>,
      text: 'Our own-brand pieces, in stock and ready. Pay online, then pick up or get it delivered.',
      actions: [['Shop ready-to-wear', () => toShop('ready'), 'primary'], ['How it works', () => document.getElementById('trust')?.scrollIntoView({ behavior: 'smooth' }), 'ghost']],
      product: ready, tone: 'from-slate-950 via-slate-900 to-indigo-950',
    } as Slide] : []),
    {
      eyebrow: 'Made to order · for teams', title: <>Team wear,<br /><span className="text-amber-300">made for you.</span></>,
      text: 'Jerseys, uniforms and custom prints for leagues, schools and offices. Send your list and get a quotation with a design proof.',
      actions: [['Get a team quote', () => navigate('/support?type=quotation'), 'primary'], ['Browse made-to-order', () => toShop('made'), 'ghost']],
      product: made, tone: 'from-indigo-950 via-indigo-900 to-slate-900',
    },
    {
      eyebrow: 'Every order, step by step', title: <>Where is<br /><span className="text-emerald-300">my order?</span></>,
      text: 'Type your order or job order number to see where it is: in production, ready for release, or on its way.',
      actions: [['Track an order', () => navigate('/track'), 'primary'], ['Our services', () => navigate('/services'), 'ghost']],
      product: products[2] ?? ready, tone: 'from-emerald-950 via-slate-900 to-slate-950',
    },
  ];
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = setInterval(() => setAt((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [paused, slides.length]);
  const s = slides[at % slides.length]!;
  const go = (d: number) => setAt((i) => (i + d + slides.length) % slides.length);

  return (
    <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6" aria-roledescription="carousel" aria-label="Highlights" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className={`relative overflow-hidden rounded-[2rem] bg-gradient-to-br ${s.tone} text-white transition-colors duration-700`}>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div key={at} className="hero-slide relative grid min-h-[30rem] items-center gap-6 px-6 pb-24 pt-12 sm:px-12 md:grid-cols-[1.1fr_0.9fr] md:py-16" aria-roledescription="slide" aria-label={`${(at % slides.length) + 1} of ${slides.length}`}>
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/15">{s.eyebrow}</p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[0.98] tracking-tight sm:text-7xl">{s.title}</h1>
            <p className="mt-5 max-w-lg text-lg text-white/70">{s.text}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {s.actions.map(([label, act, kind]) => <button key={label} type="button" onClick={act}
                className={kind === 'primary' ? 'rounded-full bg-white px-7 py-3.5 font-bold text-slate-900 transition hover:-translate-y-0.5 hover:bg-indigo-100' : 'rounded-full px-7 py-3.5 font-bold text-white ring-1 ring-white/30 transition hover:bg-white/10'}>{label}</button>)}
            </div>
          </div>
          {s.product && (
            <div className="relative mx-auto hidden aspect-square w-full max-w-md md:block">
              <div className="absolute inset-6 rounded-full bg-white/10 ring-1 ring-white/10" />
              <div className="relative grid size-full place-items-center overflow-hidden rounded-full">
                <ProductPicture product={s.product} colour={s.product.colours[0]!.hex} className={s.product.photoUrl ? 'rounded-full' : 'w-3/4 drop-shadow-2xl'} />
              </div>
              <div className="absolute bottom-6 left-0 rounded-2xl bg-white/95 px-4 py-3 text-slate-900 shadow-xl">
                <p className="text-xs font-semibold text-slate-500">{s.product.category}</p>
                <p className="font-bold">{s.product.name}</p>
                <p className="text-sm font-semibold text-indigo-700">{s.product.madeToOrder ? 'From ' : ''}{formatPeso(s.product.priceCents)}</p>
              </div>
            </div>
          )}
        </div>
        {slides.length > 1 && <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-3 sm:justify-end sm:pr-10">
          <button type="button" onClick={() => go(-1)} aria-label="Previous slide" className="grid size-10 place-items-center rounded-full bg-white/10 text-xl ring-1 ring-white/20 hover:bg-white/20">‹</button>
          {slides.map((_, i) => <button key={i} type="button" onClick={() => setAt(i)} aria-label={`Slide ${i + 1}`} aria-current={i === at % slides.length}
            className={`h-2 rounded-full transition-all ${i === at % slides.length ? 'w-8 bg-white' : 'w-2 bg-white/40 hover:bg-white/70'}`} />)}
          <button type="button" onClick={() => go(1)} aria-label="Next slide" className="grid size-10 place-items-center rounded-full bg-white/10 text-xl ring-1 ring-white/20 hover:bg-white/20">›</button>
        </div>}
      </div>
    </section>
  );
}

const ICON: Record<string, string> = {
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7zM7 18a1.5 1.5 0 1 0 0-.01M17 18a1.5 1.5 0 1 0 0-.01',
  needle: 'M4 20 15.5 8.5M14 4l6 6M12.5 5.5l6 6',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
};
/** What a buyer gets from this shop, from its own settings: QR payment, the delivery fees, made in-house, tracking. */
export function TrustStrip({ online, payment }: { online: boolean; payment: OnlinePayment | null }) {
  const delivery = deliveryWords(payment?.deliveryOptions ?? []);
  const items: [string, string, string][] = [
    ['qr', online ? 'Pay Online' : 'Pay at the shop', online ? 'Pay first, we confirm by hand, then prepare it.' : 'Cash, bank or e-wallet at the counter.'],
    ['truck', delivery?.headline ?? 'Pickup at the shop', delivery?.detail ?? 'Ready when we tell you.'],
    ['needle', 'Made in our workshop', 'Cut, printed and sewn in-house, checked before it leaves.'],
    ['pin', 'Track every order', 'Online orders and job orders, step by step.'],
  ];
  return (
    <section id="trust" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-6 sm:px-6" aria-label="Why buy from us">
      <ul className="grid gap-3 rounded-[2rem] bg-white p-4 ring-1 ring-slate-900/5 sm:grid-cols-2 lg:grid-cols-4 lg:p-6">
        {items.map(([icon, title, text]) => (
          <li key={title} className="flex gap-3 rounded-2xl p-2">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white"><svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d={ICON[icon]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <div><p className="font-bold">{title}</p><p className="text-sm text-slate-500">{text}</p></div>
          </li>))}
      </ul>
    </section>
  );
}

/**
 * The promotion banner: free delivery (when an area is free) and the sale (when products are on sale, up to the biggest
 * real discount). Each half shows only when it is true; with neither, no banner.
 */
export function PromoBanner({ products, payment, showSale }: { products: readonly Product[]; payment: OnlinePayment | null; showSale: () => void }) {
  const delivery = deliveryWords(payment?.deliveryOptions ?? []);
  const free = delivery && payment!.deliveryOptions.some((d) => d.feeCents === 0) ? delivery : null;
  const onSale = products.filter((p) => percentOff(p) > 0 && !isSoldOut(p));
  const most = Math.max(0, ...onSale.map(percentOff));
  if (!free && !onSale.length) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6" aria-label="Offers">
      <div className={`grid gap-3 ${free && onSale.length ? 'md:grid-cols-2' : ''}`}>
        {free && (
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-emerald-600 to-teal-500 p-6 text-white sm:p-8">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute -right-4 -top-4 size-40 text-white/10" aria-hidden="true"><path d={ICON.truck} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/80">Free shipping</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{free.headline}</p>
            <p className="mt-2 text-white/85">On every online order. {free.detail}.</p>
          </div>
        )}
        {onSale.length > 0 && (
          <button type="button" onClick={showSale} className="group relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-rose-600 to-orange-500 p-6 text-left text-white sm:p-8">
            <span className="pointer-events-none absolute -right-2 -top-6 text-[9rem] font-black leading-none text-white/10" aria-hidden="true">%</span>
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-white/80">Sale</span>
            <span className="mt-2 block text-3xl font-extrabold tracking-tight sm:text-4xl">Up to {most}% off</span>
            <span className="mt-2 block text-white/85">{onSale.length} item{onSale.length === 1 ? '' : 's'} on sale, while stocks last. <b className="underline-offset-4 group-hover:underline">Shop the sale →</b></span>
          </button>
        )}
      </div>
    </section>
  );
}

/** Big tiles, one per category, with a garment from it and how many there are. */
export function CategoryTiles({ products, categories, pick }: { products: readonly Product[]; categories: string[]; pick: (category: string) => void }) {
  if (categories.length < 2) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Categories</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Shop by category</h2></div></div>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {categories.map((c) => {
          const inIt = products.filter((p) => p.category === c);
          const p = inIt.find((x) => x.photoUrl) ?? inIt[0];
          return (
            <li key={c}><button type="button" onClick={() => pick(c)} className={`group relative flex aspect-[4/5] w-full flex-col overflow-hidden rounded-3xl bg-slate-100 p-4 text-left ring-1 ring-slate-900/5 transition hover:bg-slate-200/70`}>
              <span className="relative z-10 text-lg font-extrabold leading-tight">{c}</span>
              <span className="relative z-10 text-sm text-slate-600">{inIt.length} item{inIt.length === 1 ? '' : 's'}</span>
              {p && <span className={`absolute grid place-items-center overflow-hidden transition duration-500 group-hover:scale-105 ${p.photoUrl ? 'inset-x-3 bottom-3 top-20 rounded-2xl' : 'inset-x-0 bottom-0 top-14'}`}><ProductPicture product={p} colour={p.colours[0]!.hex} className={p.photoUrl ? '' : 'w-3/4'} /></span>}
              <span className="absolute bottom-3 right-3 z-10 grid size-9 place-items-center rounded-full bg-white text-lg shadow transition group-hover:bg-slate-900 group-hover:text-white" aria-hidden="true">→</span>
            </button></li>);
        })}
      </ul>
    </section>
  );
}

/** The banner at the top of the website's other pages (services, about us, support, tracking), in the shop hero's style. */
export function PageHero({ eyebrow, title, text, children, side }: { eyebrow: string; title: ReactNode; text: ReactNode; children?: ReactNode; side?: ReactNode }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className={`hero-slide relative grid items-center gap-8 px-6 py-12 sm:px-12 md:py-16 ${side ? 'md:grid-cols-[1.15fr_1fr]' : ''}`}>
          <div>
            <p className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/15">{eyebrow}</p>
            <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">{title}</h1>
            <p className="mt-5 max-w-2xl text-lg text-white/70">{text}</p>
            {children}
          </div>
          {side}
        </div>
      </div>
    </section>
  );
}

/** A section's small coloured label and big heading, as on the shop's home page. */
export function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{eyebrow}</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2></div>
      {children}
    </div>
  );
}

/** A row of featured garments that scrolls sideways: the shop's badged ones first ("Best seller", "New"). */
export function ProductRail({ title, eyebrow, products, online, view }: { title: string; eyebrow: string; products: Product[]; online: boolean; view: (p: Product) => void }) {
  if (!products.length) return null;
  const scroll = (d: number) => document.getElementById('rail')?.scrollBy({ left: d * 320, behavior: 'smooth' });
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{eyebrow}</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2></div>
        <div className="hidden gap-2 sm:flex">
          <button type="button" onClick={() => scroll(-1)} aria-label="Scroll back" className="grid size-11 place-items-center rounded-full ring-1 ring-slate-300 hover:bg-slate-900 hover:text-white">‹</button>
          <button type="button" onClick={() => scroll(1)} aria-label="Scroll on" className="grid size-11 place-items-center rounded-full ring-1 ring-slate-300 hover:bg-slate-900 hover:text-white">›</button>
        </div>
      </div>
      <ul id="rail" className="-mx-4 mt-6 flex snap-x gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {products.map((p) => <li key={p.id} className="w-[70%] shrink-0 snap-start sm:w-[45%] md:w-[31%] lg:w-[23%]"><ProductCard p={p} online={online} view={view} /></li>)}
      </ul>
    </section>
  );
}
