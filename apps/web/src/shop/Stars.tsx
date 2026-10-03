/** Star ratings for the shop's reviews: the stars shown, and the five to pick from when rating an item. */
import { useState } from 'react';
import type { Review } from './store.tsx';

/** Stars for a rating (halves round to the nearest whole star); `size` in Tailwind units. */
export function Stars({ rating, className = 'size-4' }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex text-amber-400" role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <svg key={i} viewBox="0 0 20 20" className={`${className} ${i <= full ? '' : 'text-slate-300'}`} aria-hidden="true"><path fill="currentColor" d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5Z" /></svg>)}
    </span>
  );
}

/** Pick 1 to 5 stars (with the keyboard too: they are radio buttons). */
export function StarPicker({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  const [hover, setHover] = useState(0);
  const words = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <div className="flex items-center gap-2">
      <div className="flex" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <label key={i} className="cursor-pointer p-0.5" onMouseEnter={() => setHover(i)}>
            <input type="radio" name={name} value={i} checked={value === i} onChange={() => onChange(i)} className="sr-only" aria-label={`${i} star${i > 1 ? 's' : ''}`} />
            <svg viewBox="0 0 20 20" className={`size-7 transition ${(hover || value) >= i ? 'text-amber-400' : 'text-slate-300'}`} aria-hidden="true"><path fill="currentColor" d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5Z" /></svg>
          </label>))}
      </div>
      <span className="text-sm font-semibold text-slate-600">{words[hover || value]}</span>
    </div>
  );
}

/** One review as the website shows it: stars, title, words, the buyer's first name and initial, the date, and the item. */
export function ReviewCard({ r, showProduct = false }: { r: Review; showProduct?: boolean }) {
  return (
    <figure className="flex h-full flex-col rounded-3xl bg-white p-5 ring-1 ring-slate-900/5">
      <Stars rating={r.rating} />
      {r.title && <p className="mt-3 font-bold">{r.title}</p>}
      <blockquote className="mt-2 flex-1 whitespace-pre-line text-slate-600">{r.body}</blockquote>
      <figcaption className="mt-4 flex items-center gap-3 text-sm">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-900 font-bold text-white" aria-hidden="true">{r.name[0]}</span>
        <span><b>{r.name}</b> <span className="text-xs font-semibold text-emerald-700">· Verified buyer</span><br />
          <span className="text-slate-500">{new Date(r.at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}{showProduct && ` · ${r.productName}`}</span></span>
      </figcaption>
    </figure>
  );
}
