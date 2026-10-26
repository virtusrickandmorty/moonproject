/**
 * Terms and conditions (the owner's request, 26 Oct 2026): ordering, payment, deposits, changes, production, sizes,
 * claiming, online orders, returns and exchanges, refunds, designs, care and privacy. The words live in terms.ts; this
 * page lays them out: the gist of each part at the top, a contents list that stays in view on a wide screen, then each
 * part in full.
 */
import { Link } from '../router.tsx';
import { PageHero } from './Home.tsx';
import { SHOP_CONTACT } from './products.ts';
import { TERMS, TERMS_UPDATED } from './terms.ts';

const longDate = (d: string) => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, day).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }); };
const KEY_POINTS = ['quotations', 'payment', 'deposits', 'online', 'returns'];

export function Terms() {
  return (
    <>
      <PageHero eyebrow="Terms and conditions" title={<>How we work <span className="text-indigo-300">with you.</span></>}
        text={<>Plain terms for quotations, orders, payment, claiming, returns and exchanges. Last updated {longDate(TERMS_UPDATED)}.</>}>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#returns" className="rounded-full bg-white px-7 py-3.5 font-bold text-slate-900 transition hover:-translate-y-0.5 hover:bg-indigo-100">Returns and exchanges</a>
          <Link to="/support" className="rounded-full px-7 py-3.5 font-bold text-white ring-1 ring-white/30 transition hover:bg-white/10">Ask us a question</Link>
        </div>
      </PageHero>

      <section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6" aria-label="The terms at a glance">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {TERMS.filter((t) => KEY_POINTS.includes(t.id)).map((t) => (
            <a key={t.id} href={`#${t.id}`} className="rounded-3xl bg-white p-5 ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 hover:shadow-xl">
              <p className="text-sm font-bold text-indigo-700">{t.title}</p>
              <p className="mt-2 text-sm text-slate-600">{t.summary}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 pt-12 sm:px-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Contents" className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Contents</p>
          <ol className="mt-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {TERMS.map((t, i) => (
              <li key={t.id}><a href={`#${t.id}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-slate-600 hover:bg-white hover:text-slate-900"><span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{i + 1}.</span>{t.title}</a></li>
            ))}
          </ol>
        </nav>

        <div className="space-y-6">
          {TERMS.map((t, i) => (
            <article key={t.id} id={t.id} className="scroll-mt-24 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5 sm:p-8">
              <h2 className="flex items-baseline gap-3 text-2xl font-extrabold tracking-tight">
                <span className="text-base font-bold tabular-nums text-indigo-600">{String(i + 1).padStart(2, '0')}</span>{t.title}
              </h2>
              <p className="mt-2 font-semibold text-slate-700">{t.summary}</p>
              <ul className="mt-4 space-y-3 text-slate-700">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-3 leading-relaxed"><span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-slate-400" />{p}</li>
                ))}
              </ul>
            </article>
          ))}
          <p className="text-sm text-slate-500">Questions? Email {SHOP_CONTACT.email}, call or text {SHOP_CONTACT.phone} ({SHOP_CONTACT.hours}), or <Link to="/support" className="font-semibold text-indigo-700 underline">send us a message</Link>.</p>
        </div>
      </section>
    </>
  );
}
