/** The about page: who Virtus Garments is, how the shop works and who it makes for. */
import { Link } from '../router.tsx';
import { GarmentArt } from './GarmentArt.tsx';
import { SHOP_CONTACT } from './products.ts';

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
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 md:grid-cols-[1.15fr_1fr] md:pt-16">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">About us</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">We make the garments that bring people together.</h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600">Virtus Garments is a made-to-order garment shop. Teams, schools and companies come to us for clothing that is made for them, not pulled off a rack.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/services" className="rounded-full bg-slate-900 px-7 py-3.5 font-bold text-white hover:bg-indigo-700">See what we do</Link>
            <Link to="/support" className="rounded-full border border-slate-300 px-7 py-3.5 font-bold hover:border-slate-900">Talk to us</Link>
          </div>
        </div>
        <div className="relative mx-auto grid w-full max-w-md grid-cols-2 gap-4" aria-hidden="true">
          <div className="grid aspect-square place-items-center rounded-3xl bg-indigo-50"><GarmentArt shape="jersey" colour="#1f3bb3" className="w-3/4" /></div>
          <div className="mt-10 grid aspect-square place-items-center rounded-3xl bg-amber-50"><GarmentArt shape="polo" colour="#d4a017" className="w-3/4" /></div>
          <div className="-mt-10 grid aspect-square place-items-center rounded-3xl bg-rose-50"><GarmentArt shape="jacket" colour="#7b2135" className="w-3/4" /></div>
          <div className="grid aspect-square place-items-center rounded-3xl bg-emerald-50"><GarmentArt shape="tee" colour="#2f5d46" className="w-3/4" /></div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Our story</h2>
            <p className="mt-3 text-sm font-semibold text-slate-500">Making garments since {ABOUT.founded}</p>
          </div>
          <div className="space-y-4 text-lg leading-relaxed text-slate-700">{ABOUT.story.map((p) => <p key={p}>{p}</p>)}</div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">What we stand for</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map(([title, detail], i) => (
            <div key={title} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
              <span className="text-sm font-extrabold text-indigo-600">0{i + 1}</span>
              <p className="mt-3 text-lg font-bold">{title}</p><p className="mt-2 text-slate-600">{detail}</p>
            </div>))}
        </div>
      </section>

      <section className="bg-slate-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Inside our workshop</h2>
          <p className="mt-3 max-w-2xl text-white/70">Every job order follows the same route through the shop, and each step is tracked so we always know where your order is.</p>
          <ol className="mt-8 flex flex-wrap gap-3">
            {STEPS.map((s, i) => <li key={s} className="flex items-center gap-3 rounded-full bg-white/10 py-2 pl-2 pr-5"><span className="grid size-8 place-items-center rounded-full bg-indigo-500 text-sm font-bold">{i + 1}</span><span className="font-semibold">{s}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">Who we make for</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {WHO.map(([title, detail]) => <div key={title} className="rounded-3xl border border-slate-200 p-6"><p className="text-lg font-bold">{title}</p><p className="mt-2 text-slate-600">{detail}</p></div>)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="grid gap-8 rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-900/5 sm:p-10 md:grid-cols-[1.2fr_1fr] md:items-center">
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
