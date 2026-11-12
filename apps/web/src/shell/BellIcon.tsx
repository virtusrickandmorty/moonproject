import { useEffect, useState, type CSSProperties } from 'react';

/**
 * The bell, alive (the owner's request, Nov 2026: "make it fun"): with unread notifications it rings every 12 seconds (it
 * swings, its clapper knocks, little sound waves go out). When a new one comes in it jumps and rings hard, a "+1" floats
 * up, sparks fly and the red count pops. With none it sleeps, and only wiggles under the mouse. index.css "bell-"; a
 * device set to reduce motion keeps it still.
 * Each ring is played once (`ring` counts them) and nothing moves in between, so the ERP is as quick as before: an
 * animation left running made the browser restyle the page every frame, all day.
 * The ERP's bell (Shell.tsx) and the floor app's (PRD/floor/FloorApp.tsx) are the same bell.
 */
export const BELL_EVERY = 12_000;
export function BellIcon({ ring, news, added }: { ring: number; news: number; added: number }) {
  return (
    <span className="relative block">
      <span key={news} className={`block ${news > 0 ? 'bell-excited' : ''}`}>
        {/* The clapper is its own picture over the bell, so the knock moves it without redrawing the bell. */}
        <span key={ring} className={`bell-body relative block size-6 ${ring > 0 ? 'bell-ringing' : ''}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="block size-6">
            <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0" />
          </svg>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="bell-clapper absolute inset-0 block size-6">
            <path d="M14.857 17.082a3 3 0 1 1-5.714 0" />
          </svg>
        </span>
      </span>
      {ring > 0 && <span key={`w${ring}`}>
        <svg aria-hidden="true" viewBox="0 0 6 12" className="bell-wave bell-wave-left absolute -left-2 top-1 h-3 w-1.5 text-amber-500"><path d="M5 1C2 3.5 2 8.5 5 11" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>
        <svg aria-hidden="true" viewBox="0 0 6 12" className="bell-wave bell-wave-right absolute -right-2 top-1 h-3 w-1.5 text-amber-500"><path d="M1 1c3 2.5 3 7.5 0 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>
      </span>}
      {news > 0 && <span key={`n${news}`} aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="bell-plus absolute -left-3 -top-3 text-[11px] font-extrabold text-[#f95f53]">+{added}</span>
        {['#f95f53', '#fbbf24', '#6366f1', '#34d399', '#f472b6', '#38bdf8'].map((c, i) => (
          <span key={c} className="bell-spark absolute left-1/2 top-1/2 size-1.5 rounded-full" style={{ background: c, '--a': `${i * 60 + 30}deg` } as CSSProperties} />
        ))}
      </span>}
    </span>
  );
}

/**
 * The ring count: rings now and every 12 seconds while `waiting` (something unread, its list closed), not while the tab is
 * hidden; coming back to the tab, it rings at once (the owner's report, Nov 2026: a tab switched to stayed still).
 */
export function useBellRing(waiting: boolean): number {
  const [ring, setRing] = useState(0);
  useEffect(() => {
    if (!waiting) return setRing(0);
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      setRing((r) => r + 1);
      clearInterval(t);
      t = setInterval(() => { if (!document.hidden) setRing((r) => r + 1); }, BELL_EVERY);
    };
    const back = () => { if (!document.hidden) start(); };
    start();
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [waiting]);
  return ring;
}
