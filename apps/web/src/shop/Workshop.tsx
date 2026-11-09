/**
 * The workshop's route on the About us page: seven steps from design to release, each with a picture, joined by a line so
 * they read as one flow. The pictures are drawings for now; a photo per step can take a drawing's place later (`photo`).
 *
 * In motion (the owner's request, Nov 2026: "make it fancy"): the shop works through the steps one after another, on a loop,
 * while the card is on screen. A glow travels from dot to dot, the line fills up behind it, the step it is on lifts and lights,
 * and its drawing comes to life: the pen sketches, the scissors cut, the ink drips, the needle sews, the star is stitched, the
 * piece is checked and the van drives off. A device set to reduce motion shows the steps still, just as before.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useStepTour } from './motion.tsx';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** A stitched line that runs along while its step is lit: `period` is the length of one dash and gap, so the run is seamless. */
const run = (period: number) => ({ '--dash': -period * 2 }) as CSSProperties;
/** 120 × 90 drawings in one line style; a second colour (the accent) marks what the step adds. The ws- parts move (index.css). */
const DRAWINGS: Record<string, ReactNode> = {
  design: <>
    <rect x="18" y="12" width="84" height="56" rx="5" {...S} /><path d="M50 78h20M60 68v10" {...S} />
    <path d="M48 26l-10 6 4 9 4-2v17h28V39l4 2 4-9-10-6a8 8 0 0 1-24 0Z" {...S} pathLength={1} className="ws-draw text-sky-300" />
    <path d="M86 58l12-12 4 4-12 12-6 2z" {...S} className="ws-pen text-amber-300" />
  </>,
  cutting: <>
    <path d="M10 66 30 22h80L90 66z" {...S} />
    <path d="M42 30l-8 5 3 7 3-1v14h22V41l3 1 3-7-8-5a6 6 0 0 1-18 0Z" {...S} strokeDasharray="3 4" className="ws-run text-sky-300" style={run(7)} />
    <g className="ws-snip text-amber-300">
      <circle cx="88" cy="74" r="6" {...S} /><circle cx="104" cy="74" r="6" {...S} />
      <path d="M92 69 112 44M100 69 80 44" {...S} />
    </g>
  </>,
  printing: <>
    <rect x="22" y="14" width="76" height="16" rx="4" {...S} /><path d="M60 8v6" {...S} />
    <rect x="22" y="58" width="76" height="12" rx="3" {...S} /><path d="M34 70v10M86 70v10" {...S} />
    <path d="M30 50h60" {...S} strokeDasharray="2 6" className="ws-run text-rose-300" style={run(8)} />
    <path d="M44 34c0 4-4 5-4 9M60 34c0 4-4 5-4 9M76 34c0 4-4 5-4 9" {...S} className="ws-drip text-amber-300" />
  </>,
  sewing: <>
    <path d="M18 70h84M28 70V30a8 8 0 0 1 8-8h52a8 8 0 0 1 8 8v12H48v28" {...S} />
    <path d="M84 42v14M80 56h8" {...S} className="ws-needle text-amber-300" />
    <path d="M52 62h40" {...S} strokeDasharray="4 4" className="ws-run ws-fast text-sky-300" style={run(8)} />
    <circle cx="80" cy="30" r="3" {...S} className="ws-wheel" />
  </>,
  embroidery: <>
    <g className="ws-hoop"><circle cx="60" cy="45" r="30" {...S} /><circle cx="60" cy="45" r="25" {...S} /></g>
    <path d="M86 26l10-8" {...S} className="ws-needle" />
    <path d="M60 30l4.4 9 9.6 1.4-7 6.8 1.7 9.6L60 52.3l-8.7 4.5 1.7-9.6-7-6.8 9.6-1.4z" {...S} strokeDasharray="3 2" className="ws-run ws-pulse text-amber-300" style={run(5)} />
  </>,
  check: <>
    <path d="M38 18l-14 8 5 12 5-2v34h36V36l5 2 5-12-14-8a10 10 0 0 1-28 0Z" {...S} />
    <g className="ws-scan text-sky-300"><circle cx="82" cy="56" r="13" {...S} /><path d="M91 65l10 10" {...S} /></g>
    <path d="M76 56l4 4 8-8" {...S} pathLength={1} className="ws-draw ws-late text-emerald-300" />
  </>,
  release: <>
    <g className="ws-bob"><path d="M14 38l30-14 30 14v32L44 84 14 70z" {...S} /><path d="M14 38l30 14 30-14M44 52v32" {...S} /></g>
    <g className="ws-drive text-amber-300">
      <path d="M78 46h18l10 10v14H78z" {...S} />
      <circle cx="86" cy="72" r="4" {...S} /><circle cx="100" cy="72" r="4" {...S} />
      <path d="M70 52h-6M72 60h-10" {...S} className="ws-speed" />
    </g>
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

/** The steps in a row joined by a line on wide screens, and down a line on a phone; the shop works through them in turn. */
export function WorkshopFlow() {
  const { box, step, at, hold } = useStepTour<HTMLOListElement>(WORKSHOP_STEPS.length);
  return (
    <ol ref={box} {...hold} className="relative mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-7 lg:gap-3">
      {/* The line that joins the steps: across the number dots on wide screens, down them on a phone. */}
      <span className={`absolute left-[1.15rem] top-4 bottom-4 w-0.5 bg-gradient-to-b from-indigo-400 via-sky-300 to-emerald-300 transition-opacity duration-700 sm:hidden lg:block lg:left-[7%] lg:right-[7%] lg:top-[1.15rem] lg:bottom-auto lg:h-0.5 lg:w-auto lg:bg-gradient-to-r ${step === null ? '' : 'opacity-35'}`} aria-hidden="true" />
      {step !== null && <>
        {/* How far the work has come: the line lit up to the step, down it on a phone and across it on wide screens. */}
        <span className="absolute left-[1.15rem] top-4 w-0.5 rounded-full bg-gradient-to-b from-indigo-300 via-sky-200 to-amber-300 shadow-[0_0_12px_2px] shadow-amber-300/60 transition-[height] duration-700 ease-out sm:hidden" style={{ height: `max(0px, calc(${at.y}px - 1rem))` }} aria-hidden="true" />
        <span className="absolute left-[7%] top-[1.15rem] hidden h-0.5 rounded-full bg-gradient-to-r from-indigo-300 via-sky-200 to-amber-300 shadow-[0_0_12px_2px] shadow-amber-300/60 transition-[width] duration-700 ease-out lg:block" style={{ width: `max(0px, calc(${at.x}px - 7%))` }} aria-hidden="true" />
        {/* The glow that travels from dot to dot. */}
        <span data-testid="workshop-glow" className="pointer-events-none absolute z-0 size-16 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-700 ease-out" style={{ left: at.x, top: at.y }} aria-hidden="true">
          <span className="ws-glow block size-full rounded-full bg-amber-300/40 blur-md" />
        </span>
      </>}
      {WORKSHOP_STEPS.map((s, i) => {
        const here = step === i, done = step !== null && i < step;
        return (
          <li key={s.key} data-step="" data-active={here ? '' : undefined} className="ws-step relative flex gap-4 lg:flex-col lg:items-center lg:gap-3 lg:text-center">
            <span data-dot="" className={`relative z-10 grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold ring-4 transition duration-500 ${here ? 'scale-110 bg-amber-300 text-slate-900 ring-amber-300/30' : done ? 'bg-indigo-200 text-slate-900 ring-slate-900' : 'bg-white text-slate-900 ring-slate-900'}`}>
              {here && <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/60" aria-hidden="true" />}
              <span className="relative">{i + 1}</span>
            </span>
            <div className="flex-1 lg:w-full">
              <div className={`relative overflow-hidden rounded-2xl ring-1 transition duration-500 ${here ? '-translate-y-1 bg-white/10 shadow-[0_12px_40px_-12px] shadow-amber-300/50 ring-amber-300/70' : 'bg-white/5 ring-white/10'}`}>
                {s.photo
                  ? <img src={s.photo} alt={s.title} loading="lazy" className={`aspect-[4/3] w-full object-cover transition duration-700 ${here ? 'scale-105' : ''}`} />
                  : <svg viewBox="0 0 120 90" className={`aspect-[4/3] w-full p-3 transition-colors duration-500 ${here ? 'text-white' : 'text-white/85'}`} role="img" aria-label={`${s.title} (drawing)`}>{DRAWINGS[s.key]}</svg>}
                {/* A sheen that sweeps across the picture as the step lights up. */}
                {here && <span className="ws-sheen pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-transparent via-white/20 to-transparent" aria-hidden="true" />}
              </div>
              <p className={`mt-2 font-bold transition-colors duration-500 ${here ? 'text-amber-200' : ''}`}>{s.title}</p>
              <p className={`text-sm transition-colors duration-500 ${here ? 'text-white/90' : 'text-white/65'}`}>{s.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
