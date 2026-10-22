/**
 * The website's seasonal look (the owner's request, Oct 2026: the shop is decorated by the season of the month). The
 * server says which season shows (Automatic by its calendar, Off, or one the owner picked: SHP seasons.ts); this file
 * gives each one its banner slide (words, colours and a drawing), the line in the top bar, and a light shower of
 * decorations over the banner (bats, snow, hearts), still for anyone who asked their device for less motion.
 */
import type { ReactNode } from 'react';

export type SeasonKey = 'halloween' | 'christmas' | 'valentines' | 'summer' | 'school';

export interface SeasonLook {
  /** The top bar: its colours and its first message. */
  bar: string; news: string;
  /** The banner slide shown first while the season lasts. */
  eyebrow: string; title: ReactNode; text: string; tone: string;
  /** primary: what its first button does. */
  primary: ['quote' | 'made' | 'services', string]; ghost: ['quote' | 'made' | 'services', string];
  art: () => ReactNode;
  shower?: 'bats' | 'snow' | 'hearts';
}

const Pumpkin = ({ x, y, s }: { x: number; y: number; s: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-4-58c2-14 10-22 20-24" stroke="#3f6212" strokeWidth="9" strokeLinecap="round" fill="none" />
    <ellipse cx="-38" cy="0" rx="40" ry="56" fill="#ea580c" />
    <ellipse cx="38" cy="0" rx="40" ry="56" fill="#ea580c" />
    <ellipse cx="0" cy="0" rx="42" ry="60" fill="#f97316" />
    <path d="M-34-14 -18-34-6-14Z M6-14 18-34 34-14Z" fill="#facc15" />
    <path d="M-44 16q44 40 88 0l-12 4-10-10-10 12-12-12-12 12-10-12-10 10Z" fill="#facc15" />
  </g>
);
const Bat = ({ x, y, s }: { x: number; y: number; s: number }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} fill="#0b0613"
    d="M0 0c-6-8-16-12-30-10 6 4 8 10 6 16-6-4-14-4-20 0 8 2 14 8 16 16 6-6 16-8 24-4l4-6 4 6c8-4 18-2 24 4 2-8 8-14 16-16-6-4-14-4-20 0-2-6 0-12 6-16-14-2-24 2-30 10Z" />
);
const Snowflake = ({ x, y, s }: { x: number; y: number; s: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} stroke="#e0f2fe" strokeWidth="3" strokeLinecap="round">
    {[0, 60, 120].map((r) => <g key={r} transform={`rotate(${r})`}><path d="M0-14V14M-5-10 0-5 5-10M-5 10 0 5 5 10" fill="none" /></g>)}
  </g>
);
const Heart = ({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} fill={fill} d="M0 30C-40 4-36-26-16-28-6-29 0-20 0-14 0-20 6-29 16-28 36-26 40 4 0 30Z" />
);

export const SEASONS: Record<SeasonKey, SeasonLook> = {
  halloween: {
    bar: 'bg-[#1a0b2e] text-orange-100', news: 'Happy Halloween! Costume and party shirts, made to order',
    eyebrow: 'Halloween · Undas', title: <>Spooky good<br /><span className="text-orange-400">team shirts.</span></>,
    text: 'Costume shirts, family Halloween tees and trick-or-treat prints, made in our own workshop. Order early for your party.',
    tone: 'from-[#12061f] via-[#2d1546] to-[#1c0f07]', primary: ['quote', 'Get a quote'], ghost: ['made', 'Browse made-to-order'], shower: 'bats',
    art: () => (
      <svg viewBox="0 0 400 400" className="size-full" aria-hidden="true">
        {/* A crescent moon: the full moon with a circle cut out of it. */}
        <defs><mask id="season-moon"><rect width="400" height="400" fill="white" /><circle cx="305" cy="100" r="66" fill="black" /></mask></defs>
        <circle cx="270" cy="120" r="78" fill="#fde68a" opacity="0.18" />
        <circle cx="270" cy="120" r="70" fill="#fde68a" mask="url(#season-moon)" />
        <Bat x={110} y={90} s={1.4} /><Bat x={210} y={60} s={0.9} /><Bat x={320} y={200} s={1.1} />
        <path d="M150 300c0-40 18-70 40-70s40 30 40 70l-12-10-14 12-14-12-14 12-14-12Z" fill="#f8fafc" opacity="0.92" />
        <circle cx="180" cy="270" r="6" fill="#1e1b4b" /><circle cx="202" cy="270" r="6" fill="#1e1b4b" />
        <Pumpkin x={110} y={330} s={0.85} /><Pumpkin x={290} y={320} s={1.05} />
      </svg>
    ),
  },
  christmas: {
    bar: 'bg-emerald-950 text-amber-100', news: 'Merry Christmas! Book your Christmas party shirts early',
    eyebrow: 'Christmas season', title: <>Merry shirts<br /><span className="text-amber-300">for the whole team.</span></>,
    text: 'Christmas party shirts, family tees, office giveaways and uniforms for the new year. December is our busiest month: book early.',
    tone: 'from-emerald-950 via-[#0b3b2a] to-[#3b0a0a]', primary: ['quote', 'Book a Christmas order'], ghost: ['made', 'Browse made-to-order'], shower: 'snow',
    art: () => (
      <svg viewBox="0 0 400 400" className="size-full" aria-hidden="true">
        {/* A parol: the star lantern of a Filipino Christmas. */}
        <g transform="translate(200 175)">
          <circle r="120" fill="#fbbf24" opacity="0.12" />
          <path d="M0-110 26-36 104-34 42 12 64 88 0 44-64 88-42 12-104-34-26-36Z" fill="#dc2626" stroke="#fde68a" strokeWidth="6" strokeLinejoin="round" />
          <path d="M0-62 14-20 58-19 23 7 36 49 0 25-36 49-23 7-58-19-14-20Z" fill="#fde68a" />
          <circle r="16" fill="#16a34a" />
          {[-30, -10, 10, 30].map((x, i) => <path key={x} d={`M${x} 80q${i % 2 ? 8 : -8} 40 ${i % 2 ? -4 : 4} 90`} stroke={i % 2 ? '#fde68a' : '#dc2626'} strokeWidth="5" fill="none" strokeLinecap="round" />)}
        </g>
        <Snowflake x={70} y={80} s={1.6} /><Snowflake x={335} y={110} s={1.2} /><Snowflake x={60} y={300} s={1} /><Snowflake x={340} y={320} s={1.5} />
        {[[90, 200, '#dc2626'], [320, 230, '#fbbf24'], [120, 350, '#16a34a']].map(([x, y, c]) => <circle key={`${x}`} cx={x as number} cy={y as number} r="12" fill={c as string} stroke="#fde68a" strokeWidth="3" />)}
      </svg>
    ),
  },
  valentines: {
    bar: 'bg-rose-950 text-pink-100', news: "Valentine's couple shirts, made to order",
    eyebrow: "Valentine's Day", title: <>Made for<br /><span className="text-pink-300">two.</span></>,
    text: 'Couple shirts and custom prints with your names and your date, made in our own workshop.',
    tone: 'from-rose-950 via-pink-900 to-slate-950', primary: ['quote', 'Get a quote'], ghost: ['made', 'Browse made-to-order'], shower: 'hearts',
    art: () => (
      <svg viewBox="0 0 400 400" className="size-full" aria-hidden="true">
        <Heart x={185} y={200} s={4.2} fill="#f43f5e" /><Heart x={255} y={230} s={3} fill="#fb7185" />
        <Heart x={90} y={110} s={1.2} fill="#fda4af" /><Heart x={330} y={90} s={1} fill="#fecdd3" /><Heart x={320} y={330} s={1.3} fill="#fda4af" />
      </svg>
    ),
  },
  summer: {
    bar: 'bg-sky-950 text-yellow-100', news: 'Summer league jerseys and outing shirts, made to order',
    eyebrow: 'Summer leagues and outings', title: <>Summer,<br /><span className="text-yellow-300">game on.</span></>,
    text: 'Jerseys for summer leagues, outing and reunion shirts, and dri-fit tees for the heat. Send your list for a quotation.',
    tone: 'from-sky-900 via-cyan-800 to-amber-900', primary: ['quote', 'Get a team quote'], ghost: ['made', 'Browse made-to-order'],
    art: () => (
      <svg viewBox="0 0 400 400" className="size-full" aria-hidden="true">
        <g transform="translate(220 150)">
          {Array.from({ length: 12 }, (_, i) => <path key={i} transform={`rotate(${i * 30})`} d="M0-100v-34" stroke="#fde047" strokeWidth="10" strokeLinecap="round" />)}
          <circle r="80" fill="#facc15" />
        </g>
        {/* The sea inside a round frame, so it has no square edges. */}
        <defs><clipPath id="season-sea"><circle cx="200" cy="200" r="190" /></clipPath></defs>
        <g clipPath="url(#season-sea)">
          <path d="M0 290q50-30 100 0t100 0 100 0 100 0V400H0Z" fill="#0ea5e9" opacity="0.85" />
          <path d="M0 320q50-30 100 0t100 0 100 0 100 0V400H0Z" fill="#0284c7" />
        </g>
      </svg>
    ),
  },
  school: {
    bar: 'bg-slate-950 text-sky-100', news: 'Back to school: uniforms measured, sewn and packed per student',
    eyebrow: 'Back to school', title: <>Ready for<br /><span className="text-sky-300">the first day.</span></>,
    text: 'School uniforms measured, sewn and packed per student, PE shirts and org shirts. Ask about our TPL service for schools.',
    tone: 'from-slate-950 via-sky-950 to-indigo-950', primary: ['services', 'Our school service'], ghost: ['quote', 'Get a quote'],
    art: () => (
      <svg viewBox="0 0 400 400" className="size-full" aria-hidden="true">
        <g transform="translate(200 210) rotate(-8)">
          <rect x="-120" y="-90" width="110" height="160" rx="8" fill="#0ea5e9" /><rect x="10" y="-90" width="110" height="160" rx="8" fill="#38bdf8" />
          <path d="M-10-90v160" stroke="#0c4a6e" strokeWidth="6" />
          {[-60, -30, 0, 30].map((y) => <path key={y} d={`M-100 ${y}h70M30 ${y}h70`} stroke="#e0f2fe" strokeWidth="5" strokeLinecap="round" />)}
        </g>
        <g transform="translate(300 90) rotate(35)">
          <rect x="-12" y="-80" width="24" height="130" fill="#facc15" /><path d="M-12 50 0 80 12 50Z" fill="#fde68a" /><path d="M-4 70 0 80 4 70Z" fill="#1f2937" />
          <rect x="-12" y="-96" width="24" height="16" rx="3" fill="#f472b6" />
        </g>
        <circle cx="90" cy="90" r="34" fill="#ef4444" /><path d="M90 58q4-14 16-18" stroke="#3f6212" strokeWidth="6" fill="none" strokeLinecap="round" />
      </svg>
    ),
  },
};

/** Little shapes drifting across the banner: bats fly, snow falls, hearts rise. Placed the same way every visit. */
export function Shower({ kind }: { kind: NonNullable<SeasonLook['shower']> }) {
  const shape = (i: number) => kind === 'snow'
    ? <svg viewBox="0 0 10 10" className="size-full"><circle cx="5" cy="5" r={2 + (i % 3)} fill="white" opacity="0.6" /></svg>
    : kind === 'hearts'
      ? <svg viewBox="-20 -30 40 62" className="size-full"><path fill="#fda4af" opacity="0.8" d="M0 30C-40 4-36-26-16-28-6-29 0-20 0-14 0-20 6-29 16-28 36-26 40 4 0 30Z" /></svg>
      : <svg viewBox="-60 -12 120 40" className="size-full"><path fill="#000" opacity="0.55" d="M0 0c-6-8-16-12-30-10 6 4 8 10 6 16-6-4-14-4-20 0 8 2 14 8 16 16 6-6 16-8 24-4l4-6 4 6c8-4 18-2 24 4 2-8 8-14 16-16-6-4-14-4-20 0-2-6 0-12 6-16-14-2-24 2-30 10Z" /></svg>;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: kind === 'snow' ? 18 : 10 }, (_, i) => {
        const size = kind === 'snow' ? 6 + (i * 7) % 9 : kind === 'bats' ? 26 + (i * 13) % 22 : 14 + (i * 11) % 16;
        return (
          <span key={i} className={`season-${kind} absolute block`}
            style={{ left: `${(i * 37) % 100}%`, top: kind === 'bats' ? `${8 + (i * 23) % 60}%` : undefined, width: size, height: size, animationDelay: `${-(i * 1.7) % 12}s`, animationDuration: `${(kind === 'snow' ? 9 : 14) + (i * 3) % 7}s` }}>
            {shape(i)}
          </span>
        );
      })}
    </div>
  );
}
