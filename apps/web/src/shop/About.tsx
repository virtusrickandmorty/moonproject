/** The about page: who Virtus Garments is, how the shop works, who it makes for, and what buyers say (every shown review). */
import { useState } from 'react';
import { Link } from '../router.tsx';
import { GarmentArt } from './GarmentArt.tsx';
import { PageHero, SectionHead } from './Home.tsx';
import { SHOP_CONTACT } from './products.ts';
import { ReviewCard, Stars } from './Stars.tsx';
import { useShop } from './store.tsx';

/**
 * The shop's own facts. Placeholders: the owner fills these in (in square brackets until then) before the site is
 * shown to customers; nothing on this page is meant to be read as a real figure until it is.
 */
export const ABOUT = {
  founded: '[year founded]',
  address: '[shop address, city]',
  story: [
    'Virtus Garments began as a small sewing shop making uniforms for teams and schools nearby. Word spread one jersey at a time, and today we make and decorate garments for leagues, schools, offices and organisations.',
    'Everything is made to order in our own workshop: we cut, sew, print, sublimate and embroider under one roof, so we can keep an eye on every piece from the first design to the final stitch.',
  ],
};

const VALUES: [string, string][] = [
  ['Made with care', 'Every order is checked at each step, from cutting to packing, before it leaves the shop.'],
  ['Honest prices', 'You get a clear quotation before anything is made. The price you approve is the price you pay.'],
  ['On time', 'We give you a delivery date with your quotation and follow every job through production to keep it.'],
  ['Made to fit', 'Sizing sets to try on, or measurements per person, so the whole team gets the right fit.'],
];
const WHO: [string, string][] = [
  ['Sports teams and leagues', 'Jerseys, uniform sets, warmers and jackets with names and numbers.'],
  ['Schools', 'School uniforms, PE wear and org shirts, kept on pattern for every re-order.'],
  ['Companies and offices', 'Embroidered polos, corporate uniforms and event shirts in your brand colours.'],
  ['Groups and events', 'Fun runs, reunions, outreach and church events, in small or big batches.'],
];
const STEPS = ['Design', 'Cutting', 'Printing and sublimation', 'Sewing', 'Embroidery', 'Quality check', 'Release'];

export function About() {
  return (
    <>
      <PageHero eyebrow="About us" title={<>We make the garments that <span className="text-indigo-300">bring people together.</span></>}
        text="Virtus Garments is a made-to-order garment shop. Teams, schools and companies come to us for clothing that is made for them, not pulled off a rack."
        side={
          <div className="mx-auto grid w-full max-w-sm grid-cols-2 gap-4" aria-hidden="true">
            <div className="grid aspect-square place-items-center rounded-3xl bg-white/10 ring-1 ring-white/10"><GarmentArt shape="jersey" colour="#3b5bdb" className="w-3/4" /></div>
            <div className="mt-10 grid aspect-square place-items-center rounded-3xl bg-white/10 ring-1 ring-white/10"><GarmentArt shape="polo" colour="#f1f5f9" className="w-3/4" /></div>
            <div className="-mt-10 grid aspect-square place-items-center rounded-3xl bg-white/10 ring-1 ring-white/10"><GarmentArt shape="jacket" colour="#94a3b8" className="w-3/4" /></div>
            <div className="grid aspect-square place-items-center rounded-3xl bg-white/10 ring-1 ring-white/10"><GarmentArt shape="tee" colour="#1e293b" className="w-3/4" /></div>
          </div>}>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/services" className="rounded-full bg-white px-7 py-3.5 font-bold text-slate-900 transition hover:-translate-y-0.5 hover:bg-indigo-100">See what we do</Link>
          <a href="#reviews" className="rounded-full px-7 py-3.5 font-bold text-white ring-1 ring-white/30 transition hover:bg-white/10">What buyers say</a>
        </div>
      </PageHero>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className="grid gap-10 rounded-[2rem] bg-white p-6 ring-1 ring-slate-900/5 sm:p-10 md:grid-cols-[1fr_1.4fr]">
          <div>
            <SectionHead eyebrow="Our story" title="Made by hand, close to home" />
            <p className="mt-3 text-sm font-semibold text-slate-500">Making garments since {ABOUT.founded}</p>
          </div>
          <div className="space-y-4 text-lg leading-relaxed text-slate-700">{ABOUT.story.map((p) => <p key={p}>{p}</p>)}</div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <SectionHead eyebrow="Our values" title="What we stand for" />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map(([title, detail], i) => (
            <div key={title} className="rounded-3xl bg-white p-6 ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 hover:shadow-xl">
              <span className="grid size-10 place-items-center rounded-2xl bg-slate-900 text-sm font-extrabold text-white">0{i + 1}</span>
              <p className="mt-3 text-lg font-bold">{title}</p><p className="mt-2 text-slate-600">{detail}</p>
            </div>))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">The workshop</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Inside our workshop</h2>
          <p className="mt-3 max-w-2xl text-white/70">Every job order follows the same route through the shop, and each step is tracked so we always know where your order is.</p>
          <ol className="mt-8 flex flex-wrap gap-3">
            {STEPS.map((s, i) => <li key={s} className="flex items-center gap-3 rounded-full bg-white/10 py-2 pl-2 pr-5"><span className="grid size-8 place-items-center rounded-full bg-white text-sm font-bold text-slate-900">{i + 1}</span><span className="font-semibold">{s}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <SectionHead eyebrow="Our customers" title="Who we make for" />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WHO.map(([title, detail]) => <div key={title} className="rounded-3xl bg-white p-6 ring-1 ring-slate-900/5"><p className="text-lg font-bold">{title}</p><p className="mt-2 text-slate-600">{detail}</p></div>)}
        </div>
      </section>

      <Reviews />

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className="grid gap-8 rounded-[2rem] bg-white p-7 ring-1 ring-slate-900/5 sm:p-10 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Visit the shop</h2>
            <p className="mt-3 text-slate-600">See fabric samples, try on our sizing sets and talk through your design with us in person.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/support?type=inquiry" className="rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-indigo-700">Send us a message</Link>
              <Link to="/" className="rounded-full border border-slate-300 px-6 py-3 font-bold hover:border-slate-900">Browse garments</Link>
            </div>
          </div>
          <dl className="space-y-4 text-sm">
            <div><dt className="font-bold">Address</dt><dd className="text-slate-600">{ABOUT.address}</dd></div>
            <div><dt className="font-bold">Hours</dt><dd className="text-slate-600">{SHOP_CONTACT.hours}</dd></div>
            <div><dt className="font-bold">Call or text</dt><dd className="text-slate-600">{SHOP_CONTACT.phone}</dd></div>
            <div><dt className="font-bold">Email</dt><dd className="text-slate-600">{SHOP_CONTACT.email}</dd></div>
          </dl>
        </div>
      </section>
    </>
  );
}

/** Every review the website shows, newest first: the average, how the stars spread, and the reviews themselves (with the item). */
function Reviews() {
  const { reviews, ready } = useShop();
  const [showing, setShowing] = useState(9);
  const [stars, setStars] = useState(0);
  const average = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : 0;
  const list = stars ? reviews.filter((r) => r.rating === stars) : reviews;
  return (
    <section id="reviews" className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-16 sm:px-6">
      <SectionHead eyebrow="Reviews" title="What our buyers say" />
      {reviews.length === 0 ? (
        <div className="mt-8 rounded-[2rem] bg-white p-8 text-center ring-1 ring-slate-900/5">
          <p className="font-bold">{ready ? 'No reviews yet.' : 'Loading reviews…'}</p>
          <p className="mt-1 text-slate-600">Buyers rate their items from their order page once the order is completed.</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="self-start rounded-[2rem] bg-white p-6 ring-1 ring-slate-900/5">
            <p className="text-5xl font-extrabold">{average.toFixed(1)}</p>
            <Stars rating={average} className="size-5" />
            <p className="mt-1 text-sm text-slate-500">From {reviews.length} verified buyer{reviews.length === 1 ? '' : 's'}</p>
            <ul className="mt-5 space-y-1.5">{[5, 4, 3, 2, 1].map((n) => {
              const count = reviews.filter((r) => r.rating === n).length;
              return <li key={n}><button type="button" disabled={!count} onClick={() => { setStars(stars === n ? 0 : n); setShowing(9); }} aria-pressed={stars === n}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-sm disabled:opacity-40 ${stars === n ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}>
                <span className="w-6 font-semibold">{n}★</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${(count / reviews.length) * 100}%` }} /></span>
                <span className="w-6 text-right tabular-nums">{count}</span></button></li>; })}</ul>
            {stars > 0 && <button type="button" onClick={() => setStars(0)} className="mt-3 text-sm font-semibold text-indigo-700 hover:underline">Show all reviews</button>}
          </aside>
          <div>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list.slice(0, showing).map((r) => <li key={r.id}><ReviewCard r={r} showProduct /></li>)}</ul>
            {list.length > showing && <button type="button" onClick={() => setShowing(showing + 9)} className="mt-6 rounded-full px-6 py-3 font-bold ring-1 ring-slate-300 hover:bg-slate-900 hover:text-white">Show more reviews</button>}
          </div>
        </div>
      )}
    </section>
  );
}
