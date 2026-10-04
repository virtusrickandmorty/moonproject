/** The services page: what the shop makes and decorates, and how an order goes. Each service leads to a quotation request. */
import { Link } from '../router.tsx';
import { PageHero, SectionHead } from './Home.tsx';

interface Service { id: string; name: string; tagline: string; detail: string; bestFor: string[]; send: string; lead: string; min: string; icon: string; tone: string }

/** 24×24 line icons, drawn here so the page never fetches an image. */
const ICONS: Record<string, string> = {
  needle: 'M4 20 15.5 8.5M14 4l6 6M12.5 5.5l6 6M4 20c2-6 6-9 9-9M7 17c3 0 5-2 6-5',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11ZM9 15a3 3 0 0 0 3 3',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.5 7.5 20 19M8.5 16.5 20 5',
  shirt: 'M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  badge: 'M12 3 14.5 8l5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9L9.5 8 12 3Z',
  ruler: 'M3 17 17 3l4 4L7 21l-4-4Zm4-4 2 2m1-5 2 2m1-5 2 2',
  pen: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
};

/**
 * TPL (third-party logistics) for schools: the highlighted service. We make the uniforms and also handle getting them to
 * every student, so the school does not run a uniform store.
 */
export const SCHOOL_TPL = {
  id: 'school-tpl', name: 'TPL service for schools', tagline: 'Uniforms made, sized, packed and delivered to every student',
  detail: 'Third-party logistics for your school uniforms. We make them, then handle everything after: sizing days at your school, packing per student with their name and section, keeping your stock, and handing them out at school or delivering to parents. Re-orders and size exchanges through the school year go through us too.',
  steps: [
    ['Sizing at your school', 'We bring sizing sets on scheduled days and record every student\'s size.'],
    ['Made in our workshop', 'Cut, printed and sewn to your approved uniform design.'],
    ['Packed per student', 'Each set is labelled with the student\'s name, grade and section.'],
    ['Distributed or delivered', 'Handed out at school on set days, or delivered to parents.'],
    ['All year support', 'Re-orders, new enrollees and size exchanges, from your kept stock.'],
  ] as [string, string][],
  bestFor: ['Private and public schools', 'Colleges and universities', 'Uniform re-orders every school year'],
  send: 'Your uniform design and number of students', lead: 'Planned with you before enrolment', min: 'For a whole school or grade level',
};

export const SERVICES: Service[] = [
  { id: 'embroidery', name: 'Embroidery', tagline: 'Logos stitched to last', icon: 'needle', tone: 'bg-indigo-50 text-indigo-700',
    detail: 'Computerized embroidery for logos, names and badges on polos, caps, jackets and uniforms. We digitize your logo for a clean, raised finish.',
    bestFor: ['Corporate polos', 'School and office uniforms', 'Caps and jackets'], send: 'Your logo (any picture; vector is best)', lead: '7 to 12 days', min: 'From 12 pieces' },
  { id: 'sublimation', name: 'Full sublimation', tagline: 'Edge-to-edge colour that never cracks', icon: 'drop', tone: 'bg-sky-50 text-sky-700',
    detail: 'Your design printed into the fabric itself, all over the garment, in any number of colours. Names and numbers for every player included.',
    bestFor: ['Basketball and volleyball jerseys', 'Esports and fun-run shirts', 'Team uniform sets'], send: 'Your design or a reference picture', lead: '10 to 14 days', min: 'From 10 pcs' },
  { id: 'cut-and-sew', name: 'Cut and sew', tagline: 'Made from scratch to your pattern', icon: 'scissors', tone: 'bg-amber-50 text-amber-700',
    detail: 'We cut and sew garments from fabric you choose: uniforms, jackets, scrubs and team wear, in standard sizes or measured per person.',
    bestFor: ['School and company uniforms', 'Varsity jackets', 'Custom team wear'], send: 'A sample, sketch or photo of the garment', lead: '14 to 25 days', min: 'From 10 pcs' },
  { id: 'printing', name: 'T-shirt printing', tagline: 'Bold prints for any crowd', icon: 'shirt', tone: 'bg-rose-50 text-rose-700',
    detail: 'Screen printing for big runs with solid, bright colours; front, back and sleeve prints on cotton or dri-fit shirts.',
    bestFor: ['Org and event shirts', 'Family reunions', 'Merchandise'], send: 'Your artwork and print positions', lead: '5 to 7 days', min: 'From 24 pieces' },
  { id: 'heat-transfer', name: 'DTF and heat transfer', tagline: 'Full colour, even for small orders', icon: 'layers', tone: 'bg-emerald-50 text-emerald-700',
    detail: 'Direct-to-film and vinyl heat transfer for photos, gradients and personalised names and numbers, in full colour.',
    bestFor: ['Org and event batches', 'Names and numbers', 'Photo prints'], send: 'A high-resolution picture', lead: '2 to 5 days', min: 'From 20 pcs' },
  { id: 'patches', name: 'Patches and badges', tagline: 'Woven, embroidered or chenille', icon: 'badge', tone: 'bg-violet-50 text-violet-700',
    detail: 'Custom patches sewn or pressed onto jackets, bags and uniforms, including chenille letters for varsity jackets.',
    bestFor: ['Varsity jackets', 'Club and school badges', 'Uniform name tags'], send: 'Your badge design and size', lead: '10 to 14 days', min: 'From 20 pieces' },
  { id: 'pattern', name: 'Pattern making and sizing', tagline: 'The right fit for everyone', icon: 'ruler', tone: 'bg-slate-100 text-slate-700',
    detail: 'We make and grade patterns for your design, lend sizing sets for your group to try on, or measure each person for a made-to-measure fit.',
    bestFor: ['Schools and big teams', 'Re-orders that must match', 'Hard-to-fit sizes'], send: 'A sample garment or your size list', lead: 'Set during the quotation', min: 'Any order' },
  { id: 'design', name: 'Design and mock-ups', tagline: 'From an idea to a ready proof', icon: 'pen', tone: 'bg-orange-50 text-orange-700',
    detail: 'Not sure how it should look? Our artists turn your idea, colours and logo into a design and show you a mock-up before anything is made.',
    bestFor: ['Teams without a designer', 'Refreshing an old uniform', 'Matching your brand colours'], send: 'Your logo, colours and ideas', lead: '2 to 4 days per proof', min: 'With any order' },
];

const STEPS: [string, string][] = [
  ['Send your request', 'Tell us the service, garment, quantity and sizes, with pictures of your design.'],
  ['Get a quotation and proof', 'We reply with the price, a design mock-up and the delivery date.'],
  ['Approve and pay the downpayment', 'Production is scheduled once you approve the proof.'],
  ['We make it', 'Cutting, printing, sewing and checking, step by step.'],
  ['Release', 'Pick up at the shop or have it delivered, with the balance paid on release.'],
];

export function Services() {
  return (
    <>
      <PageHero eyebrow="Our services" title={<>Everything your team wears, <span className="text-indigo-300">under one roof.</span></>}
        text="From one embroidered polo to a whole league in sublimated jerseys: tell us what you have in mind and we will quote it.">
        <nav className="mt-8 flex flex-wrap gap-2" aria-label="Services on this page">
          <a href={`#${SCHOOL_TPL.id}`} className="rounded-full bg-amber-400 px-3.5 py-1.5 text-sm font-bold text-slate-900 hover:bg-amber-300">★ {SCHOOL_TPL.name}</a>
          {SERVICES.map((s) => <a key={s.id} href={`#${s.id}`} className="rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white hover:text-slate-900">{s.name}</a>)}
        </nav>
      </PageHero>

      <SchoolTpl />

      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6"><SectionHead eyebrow="What we do" title="Pick a service" /></section>
      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-6 pt-6 sm:px-6 md:grid-cols-2">
        {SERVICES.map((s) => (
          <article key={s.id} id={s.id} className="group flex scroll-mt-24 flex-col rounded-3xl bg-white p-6 ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 hover:shadow-xl sm:p-7">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white transition group-hover:bg-indigo-600">
                <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true"><path d={ICONS[s.icon]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div><h2 className="text-xl font-extrabold">{s.name}</h2><p className="text-sm font-semibold text-slate-500">{s.tagline}</p></div>
            </div>
            <p className="mt-4 text-slate-600">{s.detail}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{s.bestFor.map((b) => <span key={b} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{b}</span>)}</div>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-sm">
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Send us</dt><dd className="mt-1 text-slate-700">{s.send}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Usually</dt><dd className="mt-1 text-slate-700">{s.lead}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Minimum</dt><dd className="mt-1 text-slate-700">{s.min}</dd></div>
            </dl>
            <Link to={`/support?type=quotation&service=${s.id}`} className="mt-6 self-start rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">Get a quote for {s.name.toLowerCase()} →</Link>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
        <div className="rounded-[2rem] bg-white p-6 ring-1 ring-slate-900/5 sm:p-10">
          <SectionHead eyebrow="Step by step" title="How an order works" />
          <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(([title, detail], i) => (
              <li key={title} className="relative rounded-2xl bg-slate-50 p-5">
                <span className="grid size-9 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white">{i + 1}</span>
                <p className="mt-3 font-bold">{title}</p><p className="mt-1 text-sm text-slate-600">{detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

/** The highlighted service: TPL for schools, its steps from sizing to delivery, and a quotation request for it. */
function SchoolTpl() {
  const t = SCHOOL_TPL;
  return (
    <section id={t.id} className="mx-auto max-w-7xl scroll-mt-24 px-4 pt-10 sm:px-6" aria-label={t.name}>
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-amber-300 via-amber-200 to-orange-200 p-6 ring-1 ring-amber-400/40 sm:p-10">
        <span className="pointer-events-none absolute -right-6 -top-10 text-[12rem] font-black leading-none text-white/30" aria-hidden="true">★</span>
        <div className="relative grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="inline-flex rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Featured · for schools</p>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{t.name}</h2>
            <p className="mt-2 text-lg font-semibold text-slate-800">{t.tagline}</p>
            <p className="mt-4 text-slate-800">{t.detail}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{t.bestFor.map((b) => <span key={b} className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-800">{b}</span>)}</div>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-900/10 pt-4 text-sm">
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-600">Send us</dt><dd className="mt-1 text-slate-900">{t.send}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-600">Timing</dt><dd className="mt-1 text-slate-900">{t.lead}</dd></div>
              <div><dt className="text-xs font-bold uppercase tracking-wider text-slate-600">Minimum</dt><dd className="mt-1 text-slate-900">{t.min}</dd></div>
            </dl>
            <Link to={`/support?type=quotation&service=${t.id}`} className="mt-6 inline-block rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-indigo-700">Talk to us about your school →</Link>
          </div>
          <ol className="relative space-y-3 self-center">
            <span className="absolute bottom-6 left-[1.4rem] top-6 w-0.5 bg-slate-900/20" aria-hidden="true" />
            {t.steps.map(([title, text], i) => (
              <li key={title} className="relative flex gap-4 rounded-2xl bg-white/80 p-4 shadow-sm backdrop-blur">
                <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white">{i + 1}</span>
                <div><p className="font-bold text-slate-900">{title}</p><p className="text-sm text-slate-700">{text}</p></div>
              </li>))}
          </ol>
        </div>
      </div>
    </section>
  );
}
