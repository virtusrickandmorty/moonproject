/**
 * Where an order is, made fun (the owner's request, Nov 2026: "put an animation for track order status, make it fun"). On
 * the Track order page and on the customer's own order status (order link, design proof):
 * - A scene of what is happening now, drawn like the workshop steps on About us (WorkshopFlow), and moving: the pen writes
 *   the order down, the needle sews, the magnifier checks, the van drives off, the gift sparkles.
 * - A little shirt with a face hops along the steps from the first and lands on where the order is. Each step it passes
 *   gets its tick, the road behind it fills with a running stitch, and the step it is on pulses.
 * - When the order is done (released, completed): confetti. Tapping the shirt makes it flip, with more confetti.
 * A device set to reduce motion shows the shirt on its step, still, and no confetti.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { DRAWINGS } from './Workshop.tsx';

export type FlowKind = 'job_order' | 'online';
/** The steps each kind of order goes through, and where its status sits on them. */
export const STEPS: Record<FlowKind, { steps: string[]; at: Record<string, number> }> = {
  job_order: { steps: ['Order received', 'In production', 'Ready for release', 'Released'], at: { open: 0, in_production: 1, ready: 2, partially_released: 3, released: 3, closed: 3 } },
  online: { steps: ['Order placed', 'Payment sent', 'Paid · being prepared', 'Ready / sent', 'Completed'], at: { awaiting_payment: 0, payment_sent: 1, confirmed: 2, ready: 3, completed: 4 } },
};
/** The statuses where the order is all done: confetti. */
const DONE = new Set(['released', 'closed', 'completed']);

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** More drawings in the workshop's style (120 × 90, the ws- parts move): the order written down, the payment, the gift. */
const MORE: Record<string, ReactNode> = {
  received: <>
    <rect x="30" y="14" width="52" height="68" rx="5" {...S} /><rect x="44" y="9" width="24" height="10" rx="3" {...S} />
    <path d="M40 34h32" {...S} pathLength={1} className="ws-draw text-sky-300" />
    <path d="M40 46h32" {...S} pathLength={1} className="ws-draw text-sky-300" />
    <path d="M40 58h18" {...S} pathLength={1} className="ws-draw ws-late text-sky-300" />
    <path d="M86 58l12-12 4 4-12 12-6 2z" {...S} className="ws-pen text-amber-300" />
  </>,
  pay: <>
    <rect x="34" y="10" width="40" height="72" rx="6" {...S} /><path d="M50 74h8" {...S} />
    <path d="M45 44l7 7 12-13" {...S} pathLength={1} className="ws-draw ws-late text-emerald-300" />
    <g className="ws-bob text-amber-300"><circle cx="94" cy="32" r="11" {...S} /><circle cx="94" cy="32" r="6" {...S} /></g>
    <path d="M84 52l-6 4M88 58l-4 6" {...S} className="ws-speed text-amber-300" />
  </>,
  party: <>
    <g className="ws-bob"><path d="M30 44h60v34H30zM26 34h68v10H26zM60 34v44" {...S} />
      <path d="M60 34c-6-12-20-12-16-2 2 4 10 3 16 2Zm0 0c6-12 20-12 16-2-2 4-10 3-16 2Z" {...S} className="text-rose-300" /></g>
    <path d="M18 18l3 6 6 3-6 3-3 6-3-6-6-3 6-3z" {...S} className="ws-glow text-amber-300" />
    <path d="M100 12l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" {...S} className="ws-glow text-sky-300" />
    <path d="M104 52l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" {...S} className="ws-glow text-emerald-300" />
  </>,
};
/** The scene for each step. */
const SCENES: Record<FlowKind, string[]> = { job_order: ['received', 'sewing', 'check', 'release'], online: ['received', 'pay', 'sewing', 'release', 'party'] };

/** What the shirt says, in plain words, at each status. */
function says(kind: FlowKind, status: string, fulfilment?: 'pickup' | 'delivery'): string {
  if (kind === 'online') {
    if (status === 'awaiting_payment') return 'Order placed! We are waiting for your payment.';
    if (status === 'payment_sent') return 'Payment sent! We are checking it now.';
    if (status === 'confirmed') return 'Paid! We are getting your order ready.';
    if (status === 'ready') return fulfilment === 'delivery' ? 'On its way to you!' : fulfilment === 'pickup' ? 'Ready! Come pick it up at the shop.' : 'Ready, or on its way to you!';
    return 'All done. Enjoy, and thank you for ordering!';
  }
  if (status === 'open') return 'Got it! Your order is lined up for the workshop.';
  if (status === 'in_production') return 'Being made! Cutting, printing and sewing are on.';
  if (status === 'ready') return 'All made, checked and packed. Ready for release!';
  if (status === 'partially_released') return 'Some pieces are out. The rest are coming!';
  return 'Released. Wear it proud, and thank you!';
}

const stillWanted = () => typeof window === 'undefined' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const COLOURS = ['#6366f1', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'];

/** The order's little shirt, with a face. */
function Shirt() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 drop-shadow-md" aria-hidden="true">
      <path d="M14 5 4 10l3.5 8 4.5-2v20h16V16l4.5 2L36 10 26 5a6 6 0 0 1-12 0Z" fill="#4f46e5" stroke="#312e81" strokeWidth="1.5" strokeLinejoin="round" />
      <g className="tj-blink"><circle cx="16.5" cy="21" r="1.8" fill="#fff" /><circle cx="23.5" cy="21" r="1.8" fill="#fff" /></g>
      <circle cx="13.6" cy="25" r="1.4" fill="#f9a8d4" /><circle cx="26.4" cy="25" r="1.4" fill="#f9a8d4" />
      <path d="M16.8 25.6q3.2 2.8 6.4 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** A burst of confetti from the shirt. */
function Confetti() {
  return (
    <span className="pointer-events-none absolute left-1/2 top-4 z-30" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2 + (i % 3) * 0.3, far = 55 + ((i * 37) % 70);
        const style = {
          '--x': `${Math.round(Math.cos(angle) * far)}px`, '--y': `${Math.round(Math.sin(angle) * far * 0.6 - 45)}px`, '--r': `${(i % 2 ? 1 : -1) * (240 + i * 23)}deg`,
          background: COLOURS[i % COLOURS.length], animationDelay: `${(i % 4) * 40}ms`,
        } as CSSProperties;
        return <span key={i} className={`tj-confetti absolute block ${i % 3 === 0 ? 'size-2 rounded-full' : 'h-1.5 w-2.5 rounded-sm'}`} style={style} />;
      })}
    </span>
  );
}

const Tick = ({ style }: { style?: CSSProperties }) => (
  <svg viewBox="0 0 16 16" className="tj-pop size-3.5" style={style} aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function StatusJourney({ kind, status, fulfilment }: { kind: FlowKind; status: string; fulfilment?: 'pickup' | 'delivery' }) {
  const flow = STEPS[kind];
  const at = flow.at[status] ?? -1;
  const finished = DONE.has(status);
  const [still] = useState(stillWanted);
  const [go, setGo] = useState(still); // the shirt sets off from the first step
  const [arrived, setArrived] = useState(still);
  const [party, setParty] = useState(0); // each burst of confetti (and flip) so far
  const travel = still ? 0 : 500 + 450 * Math.max(0, at);

  useEffect(() => {
    if (at < 0 || still) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setGo(true)); });
    const t = setTimeout(() => { setArrived(true); if (finished) setParty(1); }, travel + 60);
    return () => { cancelAnimationFrame(frame); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (at < 0) return null;
  const n = flow.steps.length;
  const pos = (i: number) => `${((i + 0.5) / n) * 100}%`;
  const scene = finished ? 'party' : SCENES[kind][at] ?? 'received';
  const move = (what: string) => (still ? 'none' : `${what} ${travel}ms linear`);
  return (
    <div className="relative overflow-hidden" data-testid="status-journey">
      <div data-active="" className="ws-step flex items-center gap-3 rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-800 to-slate-900 p-3 pr-4 text-white">
        <svg viewBox="0 0 120 90" className="h-16 w-20 shrink-0 sm:h-20 sm:w-28" aria-hidden="true">{DRAWINGS[scene] ?? MORE[scene]}</svg>
        <p className="font-semibold leading-snug">{says(kind, status, fulfilment)}</p>
      </div>

      <div className="relative pt-11">
        {/* The road: grey all along, filled with a running stitch up to the shirt. */}
        <span className="absolute top-[3.45rem] h-1.5 rounded-full bg-slate-200" style={{ left: pos(0), right: pos(0) }} aria-hidden="true" />
        <span className="absolute top-[3.45rem] h-1.5 overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400" style={{ left: pos(0), width: go ? `${(at / n) * 100}%` : 0, transition: move('width') }} aria-hidden="true">
          <span className="tj-stitch absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
        </span>

        {/* The shirt: tap it for a flip and confetti. */}
        <button type="button" onClick={() => setParty((p) => p + 1)} title="Tap me!" aria-label="Tap the shirt for a little celebration"
          className="absolute top-1 z-20 -translate-x-1/2 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" style={{ left: go ? pos(at) : pos(0), transition: move('left') }}>
          <span key={party} className={`block ${party > 0 && !still ? 'tj-jump' : ''}`}>
            <span className={`block ${arrived ? 'tj-idle' : 'tj-hop'}`}><Shirt /></span>
          </span>
          {party > 0 && !still && <Confetti key={party} />}
        </button>

        <ol className="relative grid gap-1 text-center text-[11px] font-semibold sm:text-xs" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-label="Order steps">
          {flow.steps.map((s, i) => {
            const passed = go && (i < at || (i === at && finished));
            const here = go && i === at && !finished;
            const when = { transitionDelay: `${at > 0 ? Math.round((travel * i) / at) : 0}ms` };
            return (
              <li key={s} aria-current={i === at ? 'step' : undefined} className={i <= at ? 'text-indigo-700' : 'text-slate-400'}>
                <span className={`relative z-10 mx-auto mb-1 grid size-7 place-items-center rounded-full ring-4 ring-white transition-colors duration-300 ${passed ? 'bg-emerald-500 text-white' : here ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-400'}`} style={when}>
                  {here && arrived && <span className="absolute inset-0 rounded-full bg-indigo-400/50 motion-safe:animate-ping motion-reduce:hidden" aria-hidden="true" />}
                  {passed ? <Tick style={{ animationDelay: when.transitionDelay }} /> : <span className="relative block size-2 rounded-full bg-current" aria-hidden="true" />}
                </span>
                {s}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
