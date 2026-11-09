/**
 * /r/<link>: the customer rates their order (the owner's request, Nov 2026), without signing in: 1 to 5 stars, a comment and
 * their name if they like. Once rated, it thanks them; a low rating says the shop will call.
 */
import { useEffect, useState } from 'react';
import { SHOP_CONTACT } from '../../shop/products.ts';

interface PublicRating { jobOrderNumber: string; lines: { description: string; qty: number }[]; rating: { stars: number; comment?: string; name?: string; at: string } | null }

const box = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const WORDS = ['', 'Poor', 'Not good', 'Okay', 'Good', 'Excellent'];

async function send<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch { throw new Error('Cannot reach us right now. Check your connection and try again.'); }
  const data = await res.json().catch(() => null) as (T & { message?: string }) | null;
  if (!res.ok) throw Object.assign(new Error(data?.message ?? 'That did not go through. Please try again.'), { status: res.status });
  return data as T;
}

export function Stars({ value, size = 'text-4xl' }: { value: number; size?: string }) {
  return <span className={`${size} tracking-wider text-amber-400`} aria-label={`${value} of 5 stars`}>{'★'.repeat(value)}<span className="text-slate-300">{'★'.repeat(5 - value)}</span></span>;
}

export function RatingPage({ token }: { token: string }) {
  const [page, setPage] = useState<PublicRating | null>(null);
  const [missing, setMissing] = useState('');
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const base = `/api/fbk/r/${encodeURIComponent(token)}`;
  useEffect(() => {
    document.title = 'Rate your order · Virtus Garments';
    send<PublicRating>('GET', base).then(setPage, (e: Error & { status?: number }) => setMissing(e.status === 404 ? 'We cannot find this link. Check that you opened the whole link.' : e.message));
  }, [base]);

  const submit = async () => {
    setProblem('');
    if (!stars) return setProblem('Tap the stars to rate.');
    setBusy(true);
    try { setPage(await send<PublicRating>('POST', base, { stars, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(name.trim() ? { name: name.trim() } : {}) })); setFresh(true); }
    catch (e) { setProblem((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 px-4 pb-8 pt-6 text-white">
        <div className="mx-auto max-w-xl">
          <p className="text-sm font-semibold tracking-wide text-emerald-300">Virtus Garments · Rate your order</p>
          {page && <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">How did we do on {page.jobOrderNumber}?</h1>}
        </div>
      </header>
      <main className="mx-auto -mt-4 max-w-xl space-y-4 px-4 pb-12">
        {missing && <p role="alert" className="rounded-2xl bg-rose-50 p-5 text-rose-800">{missing}</p>}
        {!page && !missing && <p className="p-6 text-center text-slate-500">Loading…</p>}
        {page?.rating && (
          <section className="space-y-3 rounded-3xl bg-white p-6 text-center ring-1 ring-slate-900/5" aria-live="polite">
            <Stars value={page.rating.stars} />
            <p className="text-2xl font-extrabold">{fresh ? 'Thank you!' : 'You rated this order'}</p>
            <p className="text-slate-600">{page.rating.stars <= 3 ? `We are sorry it was not better. Someone from the shop will call you to make it right${fresh ? '' : ''}.` : 'We are glad you liked it. See you on your next order!'}</p>
            {page.rating.comment && <p className="rounded-2xl bg-slate-50 p-4 text-left text-slate-700">“{page.rating.comment}”</p>}
          </section>
        )}
        {page && !page.rating && (
          <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5">
            {page.lines.length > 0 && <ul className="divide-y divide-slate-100 text-sm">{page.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-1.5"><span>{l.description}</span><span className="font-semibold tabular-nums">{l.qty} pcs</span></li>)}</ul>}
            <div className="text-center">
              <div role="radiogroup" aria-label="Your rating" className="inline-flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}: ${WORDS[n]}`} onClick={() => setStars(n)}
                    className={`text-5xl leading-none transition hover:scale-110 ${n <= stars ? 'text-amber-400' : 'text-slate-300'}`}>★</button>
                ))}
              </div>
              <p className="mt-1 h-5 text-sm font-semibold text-slate-600">{WORDS[stars]}</p>
            </div>
            <label className="block text-sm font-semibold">{stars && stars <= 3 ? 'What went wrong? (we will call you)' : 'Anything to tell us? (optional)'}
              <textarea className={`${box} mt-1 min-h-24`} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            <label className="block text-sm font-semibold">Your name (optional)<input className={`${box} mt-1`} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
            {problem && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{problem}</p>}
            <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-full bg-slate-900 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">Send my rating</button>
          </section>
        )}
      </main>
      <footer className="pb-8 text-center text-xs text-slate-500">Questions? Call or text {SHOP_CONTACT.phone} · {SHOP_CONTACT.email}</footer>
    </div>
  );
}
