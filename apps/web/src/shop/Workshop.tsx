/**
 * The workshop's route on the About us page: seven steps from design to release, each with a picture, joined by a line so
 * they read as one flow. The pictures are drawings for now; a photo per step can take a drawing's place later (`photo`).
 */
import type { ReactNode } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** 120 × 90 drawings in one line style; a second colour (the accent) marks what the step adds. */
const DRAWINGS: Record<string, ReactNode> = {
  design: <>
    <rect x="18" y="12" width="84" height="56" rx="5" {...S} /><path d="M50 78h20M60 68v10" {...S} />
    <path d="M48 26l-10 6 4 9 4-2v17h28V39l4 2 4-9-10-6a8 8 0 0 1-24 0Z" {...S} className="text-sky-300" />
    <path d="M86 58l12-12 4 4-12 12-6 2z" {...S} className="text-amber-300" />
  </>,
  cutting: <>
    <path d="M10 66 30 22h80L90 66z" {...S} />
    <path d="M42 30l-8 5 3 7 3-1v14h22V41l3 1 3-7-8-5a6 6 0 0 1-18 0Z" {...S} strokeDasharray="3 4" className="text-sky-300" />
    <circle cx="88" cy="74" r="6" {...S} className="text-amber-300" /><circle cx="104" cy="74" r="6" {...S} className="text-amber-300" />
    <path d="M92 69 112 44M100 69 80 44" {...S} className="text-amber-300" />
  </>,
  printing: <>
    <rect x="22" y="14" width="76" height="16" rx="4" {...S} /><path d="M60 8v6" {...S} />
    <rect x="22" y="58" width="76" height="12" rx="3" {...S} /><path d="M34 70v10M86 70v10" {...S} />
    <path d="M30 50h60" {...S} strokeDasharray="2 6" className="text-rose-300" />
    <path d="M44 34c0 4-4 5-4 9M60 34c0 4-4 5-4 9M76 34c0 4-4 5-4 9" {...S} className="text-amber-300" />
  </>,
  sewing: <>
    <path d="M18 70h84M28 70V30a8 8 0 0 1 8-8h52a8 8 0 0 1 8 8v12H48v28" {...S} />
    <path d="M84 42v14M80 56h8" {...S} className="text-amber-300" />
    <path d="M52 62h40" {...S} strokeDasharray="4 4" className="text-sky-300" />
    <circle cx="80" cy="30" r="3" {...S} />
  </>,
  embroidery: <>
    <circle cx="60" cy="45" r="30" {...S} /><circle cx="60" cy="45" r="25" {...S} />
    <path d="M86 26l10-8" {...S} />
    <path d="M60 30l4.4 9 9.6 1.4-7 6.8 1.7 9.6L60 52.3l-8.7 4.5 1.7-9.6-7-6.8 9.6-1.4z" {...S} strokeDasharray="3 2" className="text-amber-300" />
  </>,
  check: <>
    <path d="M38 18l-14 8 5 12 5-2v34h36V36l5 2 5-12-14-8a10 10 0 0 1-28 0Z" {...S} />
    <circle cx="82" cy="56" r="13" {...S} className="text-sky-300" /><path d="M91 65l10 10" {...S} className="text-sky-300" />
    <path d="M76 56l4 4 8-8" {...S} className="text-emerald-300" />
  </>,
  release: <>
    <path d="M14 38l30-14 30 14v32L44 84 14 70z" {...S} /><path d="M14 38l30 14 30-14M44 52v32" {...S} />
    <path d="M78 46h18l10 10v14H78z" {...S} className="text-amber-300" />
    <circle cx="86" cy="72" r="4" {...S} className="text-amber-300" /><circle cx="100" cy="72" r="4" {...S} className="text-amber-300" />
  </>,
};

export const WORKSHOP_STEPS: { key: keyof typeof DRAWINGS; title: string; text: string; photo?: string }[] = [
  { key: 'design', title: 'Design', text: 'Your idea, logo and colours become a design proof you approve.' },
  { key: 'cutting', title: 'Cutting', text: 'Patterns are laid out and the fabric is cut per size.' },
  { key: 'printing', title: 'Printing and sublimation', text: 'Designs are printed and heat-pressed into the fabric.' },
  { key: 'sewing', title: 'Sewing', text: 'The pieces are sewn together into the garment.' },
  { key: 'embroidery', title: 'Embroidery', text: 'Logos, names and badges are stitched on.' },
  { key: 'check', title: 'Quality check', text: 'Every piece is checked before it is packed.' },
  { key: 'release', title: 'Release', text: 'Packed per order, then picked up or delivered.' },
];

/** The steps in a row joined by a line on wide screens, and down a line on a phone. */
export function WorkshopFlow() {
  return (
    <ol className="relative mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-7 lg:gap-3">
      {/* The line that joins the steps: across the number dots on wide screens, down them on a phone. */}
      <span className="absolute left-[1.15rem] top-4 bottom-4 w-0.5 bg-gradient-to-b from-indigo-400 via-sky-300 to-emerald-300 sm:hidden lg:block lg:left-[7%] lg:right-[7%] lg:top-[1.15rem] lg:bottom-auto lg:h-0.5 lg:w-auto lg:bg-gradient-to-r" aria-hidden="true" />
      {WORKSHOP_STEPS.map((s, i) => (
        <li key={s.key} className="relative flex gap-4 lg:flex-col lg:items-center lg:gap-3 lg:text-center">
          <span className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-white text-sm font-extrabold text-slate-900 ring-4 ring-slate-900">{i + 1}</span>
          <div className="flex-1 lg:w-full">
            <div className="overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
              {s.photo
                ? <img src={s.photo} alt={s.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                : <svg viewBox="0 0 120 90" className="aspect-[4/3] w-full p-3 text-white/85" role="img" aria-label={`${s.title} (drawing)`}>{DRAWINGS[s.key]}</svg>}
            </div>
            <p className="mt-2 font-bold">{s.title}</p>
            <p className="text-sm text-white/65">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
