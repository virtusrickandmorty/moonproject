/**
 * The website's seasonal look (the owner's request, Oct 2026: the shop is decorated by the season of the month). The
 * server says which season shows (Automatic by its calendar, Off, or one the owner picked: SHP seasons.ts); this file
 * gives each one its banner slide (words, colours and a drawing), the line in the top bar, and a light shower of
 * decorations over the banner (bats, snow, hearts), still for anyone who asked their device for less motion. The shop's
 * own events (SHP season-events.ts) are built from the same pieces: a colour theme, a picture or a drawing, a shower.
 */
import type { ReactNode } from 'react';

export type SeasonKey = 'halloween' | 'christmas' | 'valentines' | 'summer' | 'school';
/** What a banner button does: a quotation request, the made-to-order or ready-to-wear garments, or the services page. */
export type HeroAction = 'quote' | 'made' | 'ready' | 'services';

export interface SeasonLook {
  /** The top bar: its colours and its first message. */
  bar: string; news: string;
  /** The banner slide shown first while the season lasts. */
  eyebrow: string; title: ReactNode; text: string; tone: string;
  /** primary: what its first button does. */
  primary: [HeroAction, string]; ghost: [HeroAction, string];
  art: () => ReactNode;
  shower?: 'bats' | 'snow' | 'hearts' | 'confetti' | 'stars';
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

const CONFETTI = ['#f472b6', '#facc15', '#38bdf8', '#a3e635', '#c084fc', '#fb923c'];

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

/** Little shapes drifting across the banner: bats fly, snow and confetti fall, hearts rise, stars twinkle. Placed the same way every visit. */
export function Shower({ kind }: { kind: NonNullable<SeasonLook['shower']> }) {
  const shape = (i: number) => kind === 'snow'
    ? <svg viewBox="0 0 10 10" className="size-full"><circle cx="5" cy="5" r={2 + (i % 3)} fill="white" opacity="0.6" /></svg>
    : kind === 'confetti'
      ? <svg viewBox="0 0 10 10" className="size-full"><rect x="2" y="3.5" width="6" height="3" rx="0.6" fill={CONFETTI[i % CONFETTI.length]} /></svg>
    : kind === 'stars'
      ? <svg viewBox="-12 -12 24 24" className="size-full"><path fill="#fde68a" d="M0-11 2.6-2.6 11 0 2.6 2.6 0 11-2.6 2.6-11 0-2.6-2.6Z" /></svg>
    : kind === 'hearts'
      ? <svg viewBox="-20 -30 40 62" className="size-full"><path fill="#fda4af" opacity="0.8" d="M0 30C-40 4-36-26-16-28-6-29 0-20 0-14 0-20 6-29 16-28 36-26 40 4 0 30Z" /></svg>
      : <svg viewBox="-60 -12 120 40" className="size-full"><path fill="#000" opacity="0.55" d="M0 0c-6-8-16-12-30-10 6 4 8 10 6 16-6-4-14-4-20 0 8 2 14 8 16 16 6-6 16-8 24-4l4-6 4 6c8-4 18-2 24 4 2-8 8-14 16-16-6-4-14-4-20 0-2-6 0-12 6-16-14-2-24 2-30 10Z" /></svg>;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: kind === 'snow' || kind === 'confetti' ? 18 : 10 }, (_, i) => {
        const size = kind === 'snow' ? 6 + (i * 7) % 9 : kind === 'confetti' ? 10 + (i * 7) % 8 : kind === 'bats' ? 26 + (i * 13) % 22 : 14 + (i * 11) % 16;
        return (
          <span key={i} className={`season-${kind} absolute block`}
            style={{ left: `${(i * 37) % 100}%`, top: kind === 'bats' || kind === 'stars' ? `${8 + (i * 23) % 80}%` : undefined, width: size, height: size, animationDelay: `${-(i * 1.7) % 12}s`,
              animationDuration: `${(kind === 'snow' || kind === 'confetti' ? 9 : kind === 'stars' ? 3 : 14) + (i * 3) % 7}s` }}>
            {shape(i)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Doodles for the cards (the owner's request, Oct 2026): small hand-drawn line drawings of the season in a card's
 * corners, in the season's colour, behind everything that can be clicked. Each card gets its own pick (by `seed`).
 */
export type DoodleSet = SeasonKey | 'party';
const DOODLES: Record<DoodleSet, { colour: string; light: string; paths: string[] }> = {
  party: {
    colour: 'text-fuchsia-500', light: 'text-fuchsia-100',
    paths: [
      'M24 6l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1Z', // star
      'M24 6c8 0 13 6 13 13s-6 14-13 14-13-7-13-14 5-13 13-13ZM24 33l-2 4h4ZM24 37q-4 4 0 8', // balloon
      'M8 20h32v8H8ZM11 28h26v14H11ZM24 20v22M24 20c-4-8-12-8-10-2 1 2 6 2 10 2ZM24 20c4-8 12-8 10-2-1 2-6 2-10 2Z', // gift
      'M8 42l8-24 16 16ZM14 24l10 10M22 14q2-6 8-6M32 18q6-2 8 2M30 6v2M40 12h2M38 26l2 2', // party popper
      'M6 10q6 6 0 12t0 12M18 8l4 4M30 6q4 8 10 6M26 24h6M38 30l4 6M20 38q6-4 10 2', // streamers
    ],
  },
  halloween: {
    colour: 'text-orange-500', light: 'text-orange-200',
    paths: [
      'M24 13c2-4 5-6 8-6M12 24c0-7 5-11 12-11s12 4 12 11-5 14-12 14-12-7-12-14ZM24 13c-4 4-4 21 0 25M24 13c4 4 4 21 0 25', // pumpkin
      'M4 26c6-7 12-7 14 0 2-3 4-4 6-4s4 1 6 4c2-7 8-7 14 0-5-1-8 1-9 4-2-2-5-2-7 0-1-2-3-3-4-3s-3 1-4 3c-2-2-5-2-7 0-1-3-4-5-9-4Z', // bat
      'M4 4l28 28M4 4l34 10M4 4l10 34M10 10q8-2 14 4M10 10q-2 8 4 14M18 18q8-1 13 4M18 18q-1 8 4 13', // spider web
      'M16 24a8 8 0 1 0 16 0a8 8 0 1 0-16 0M16 24l-8-6v12ZM32 24l8-6v12Z', // candy
      'M24 8c7 0 12 6 12 14v18l-4-3-4 3-4-3-4 3-4-3-4 3V22c0-8 5-14 12-14ZM20 20v2M28 20v2', // ghost
    ],
  },
  christmas: {
    colour: 'text-emerald-600', light: 'text-emerald-100',
    paths: [
      'M24 6v36M8 15l32 18M8 33l32-18M20 10l4 4 4-4M20 38l4-4 4 4', // snowflake
      'M10 30c4-8 10-10 14-6-6 0-8 6-14 6ZM38 30c-4-8-10-10-14-6 6 0 8 6 14 6ZM21 20a3 3 0 1 0 6 0a3 3 0 1 0-6 0', // holly
      'M24 6l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1Z', // star
      'M30 44V18a8 8 0 0 0-16 0v5M30 24l-6 4M30 31l-6 4M30 38l-6 4M17 11l5 5', // candy cane
      'M24 6l10 16h-6l8 12h-8l6 8H14l6-8h-8l8-12h-6Z', // tree
    ],
  },
  valentines: {
    colour: 'text-rose-400', light: 'text-rose-100',
    paths: [
      'M24 40C8 28 6 16 14 12c5-2 9 1 10 5 1-4 5-7 10-5 8 4 6 16-10 28Z', // heart
      'M16 30C6 22 5 14 10 11c3-1 6 1 6 3 1-2 4-4 7-3 5 2 4 10-7 19ZM34 38c-7-5-8-11-4-13 2-1 4 0 4 2 1-2 3-3 5-2 3 2 2 8-5 13Z', // two hearts
      'M8 40L40 8M32 8h8v8M8 40l4-8M8 40l8-4M18 22c-4-3-4-7-1-8 2 0 3 1 3 2 0-1 2-2 3-1 2 2 0 5-5 7Z', // arrow and heart
    ],
  },
  summer: {
    colour: 'text-amber-500', light: 'text-amber-100',
    paths: [
      'M24 18a6 6 0 1 0 0 12a6 6 0 1 0 0-12M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4 4M33 33l4 4M37 11l-4 4M15 33l-4 4', // sun
      'M4 22q5-6 10 0t10 0 10 0 10 0M4 32q5-6 10 0t10 0 10 0 10 0', // waves
      'M24 44V22M24 22c-6-6-14-4-16 0M24 22c6-6 14-4 16 0M24 22c-2-8-8-10-12-10M24 22c2-8 8-10 12-10', // palm
      'M14 20a10 10 0 0 1 20 0ZM14 20l10 24 10-24M18 26l12 7M30 26l-12 7', // ice cream
    ],
  },
  school: {
    colour: 'text-sky-500', light: 'text-sky-100',
    paths: [
      'M10 38l4-12 20-20 8 8-20 20ZM14 26l8 8M30 10l8 8', // pencil
      'M6 22L42 8 30 40 22 28ZM22 28L42 8', // paper plane
      'M8 34L34 8l6 6-26 26ZM14 28l3 3M19 23l3 3M24 18l3 3M29 13l3 3', // ruler
      'M24 6l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1Z', // star
      'M8 12h14a4 4 0 0 1 4 4v24a4 4 0 0 0-4-4H8ZM40 12H26a4 4 0 0 0-4 4v24a4 4 0 0 1 4-4h14Z', // open book
    ],
  },
};
const SPOT: Record<'tl' | 'tr' | 'bl' | 'br' | 'ml' | 'mr', string> = {
  tl: 'left-3 top-3', tr: 'right-3 top-3', bl: 'bottom-3 left-3', br: 'bottom-3 right-3', ml: 'left-2 top-1/2 -translate-y-1/2', mr: 'right-2 top-1/2 -translate-y-1/2',
};
export type DoodleSpot = keyof typeof SPOT;

export function Doodles({ set, seed, spots, size = 'size-10', light = false }: { set: DoodleSet; seed: number; spots: DoodleSpot[]; size?: string; light?: boolean }) {
  const d = DOODLES[set];
  return (
    <>
      {spots.map((spot, i) => (
        <svg key={spot} viewBox="0 0 48 48" aria-hidden="true"
          className={`pointer-events-none absolute ${SPOT[spot]} ${size} ${light ? d.light : d.colour} ${light ? 'opacity-50' : 'opacity-70'}`}
          style={{ rotate: `${((seed + i * 7) % 5) * 9 - 18}deg` }}>
          <path d={d.paths[(seed + i * 3) % d.paths.length]} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </>
  );
}

/** A small number from a text, so the same card always gets the same doodles. */
export const seedOf = (text: string) => [...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7);

/** The shop's own event as the website gets it (SHP season-events.ts): what shows instead of the season while it lasts. */
export interface ShopEventShown {
  id: string; version: number; eyebrow: string; title: string; highlight: string; text: string; barText: string;
  theme: keyof typeof THEMES; art: 'none' | 'picture' | SeasonKey; shower: 'none' | NonNullable<SeasonLook['shower']>;
  doodles: 'none' | DoodleSet; button: HeroAction; buttonLabel: string; hasPicture: boolean;
}

/** The colour themes an event can take: the banner's colours, its highlighted words and the top bar. */
export const THEMES = {
  night: { label: 'Night blue', tone: 'from-slate-950 via-slate-900 to-indigo-950', accent: 'text-indigo-300', bar: 'bg-slate-950 text-indigo-100' },
  purple: { label: 'Purple', tone: 'from-purple-950 via-violet-900 to-fuchsia-950', accent: 'text-fuchsia-300', bar: 'bg-purple-950 text-fuchsia-100' },
  festive: { label: 'Red and green', tone: 'from-red-900 via-rose-900 to-emerald-950', accent: 'text-emerald-300', bar: 'bg-red-900 text-red-50' },
  rose: { label: 'Rose pink', tone: 'from-rose-900 via-pink-800 to-rose-950', accent: 'text-pink-200', bar: 'bg-rose-900 text-rose-50' },
  ocean: { label: 'Ocean blue', tone: 'from-sky-950 via-cyan-900 to-blue-950', accent: 'text-cyan-300', bar: 'bg-sky-950 text-cyan-50' },
  gold: { label: 'Black and gold', tone: 'from-stone-950 via-amber-950 to-yellow-900', accent: 'text-amber-300', bar: 'bg-stone-950 text-amber-100' },
  sunset: { label: 'Sunset orange', tone: 'from-orange-900 via-rose-900 to-purple-950', accent: 'text-orange-200', bar: 'bg-orange-900 text-orange-50' },
  emerald: { label: 'Emerald green', tone: 'from-emerald-950 via-teal-900 to-slate-950', accent: 'text-emerald-300', bar: 'bg-emerald-950 text-emerald-50' },
} as const;

/** The event's picture on the banner; its version makes a changed picture load again. */
export const eventPictureUrl = (e: Pick<ShopEventShown, 'id' | 'version'>) => `/api/shp/season/events/${e.id}/picture?v=${e.version}`;

/** An event's banner slide and top-bar line, built like a season's. */
export function eventLook(e: ShopEventShown): SeasonLook {
  const theme = THEMES[e.theme] ?? THEMES.night;
  return {
    bar: theme.bar, news: e.barText, eyebrow: e.eyebrow, text: e.text, tone: theme.tone,
    title: e.highlight ? <>{e.title}<br /><span className={theme.accent}>{e.highlight}</span></> : e.title,
    primary: [e.button, e.buttonLabel],
    ghost: e.button === 'quote' ? ['made', 'Browse made-to-order'] : ['quote', 'Get a quote'],
    // The shop's own picture in a round frame, or a season's drawing, or none (the slide shows a garment then).
    art: () => e.art === 'picture'
      ? (e.hasPicture ? <div className="size-full overflow-hidden rounded-full bg-white ring-8 ring-white/15"><img src={eventPictureUrl(e)} alt="" className="size-full object-cover" /></div> : null)
      : e.art !== 'none' && e.art in SEASONS ? SEASONS[e.art].art() : null,
    shower: e.shower === 'none' ? undefined : e.shower,
  };
}

/** How the website is decorated now: the banner slide and top bar, and the cards' doodles (or none). */
export interface Decor { look: SeasonLook; doodles: DoodleSet | null }
export function decorOf(season: SeasonKey | null, event: ShopEventShown | null): Decor | null {
  if (event) return { look: eventLook(event), doodles: event.doodles === 'none' || !(event.doodles in DOODLES) ? null : event.doodles };
  return season && season in SEASONS ? { look: SEASONS[season], doodles: season } : null;
}
