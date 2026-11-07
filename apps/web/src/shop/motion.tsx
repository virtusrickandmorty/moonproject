/**
 * The website's motion (the owner's request, Nov 2026), on phones and computers alike:
 * - Fade in on scroll: sections, cards and tiles fade and slide up as they come into view (useReveal, on the site's
 *   main area once, so every page and every card added later gets it), cards of a row one after another.
 * - Counting numbers: a figure counts up from zero the first time it is seen (CountUp).
 * - A tour of steps: a list lights its steps up one after another, on a loop, while it is on screen (useStepTour).
 * Hover and tap motion and the moving banner are CSS (index.css, "The website's motion"). A device set to reduce
 * motion gets none of it: everything shows at once, still.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const stillWanted = () => typeof matchMedia === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined';

/** What fades in: the cards of a grid or row, and a section's other blocks (its heading, a panel). Never the banners. */
function targets(main: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const section of main.querySelectorAll<HTMLElement>('section')) {
    if (section.querySelector('.hero-slide') || section.closest('[data-no-reveal]')) continue;
    const cards = [...section.querySelectorAll<HTMLElement>('ul > li')].filter((li) => /\b(grid|flex)\b/.test(li.parentElement!.className) && !li.closest('nav'));
    found.push(...cards);
    for (const block of section.children) if (block instanceof HTMLElement && !cards.some((c) => block.contains(c)) && !block.matches('.pointer-events-none, [aria-hidden="true"]')) found.push(block);
  }
  return found;
}

/** Fades the main area's blocks in as they scroll into view; watches for new ones (another page, more products). */
export function useReveal(main: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = main.current;
    if (!root || stillWanted()) return;
    const waiting = new Set<HTMLElement>();
    const show = (el: HTMLElement) => { el.dataset.shown = ''; seen.unobserve(el); waiting.delete(el); };
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) show(e.target as HTMLElement);
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    // A fast fling or a jump to a link can pass a block without it ever being seen: once above the screen, it is shown.
    let passing = 0;
    const passed = () => {
      passing = 0;
      for (const el of waiting) if (el.getBoundingClientRect().bottom < 0) show(el);
    };
    const onScroll = () => { if (!passing) passing = requestAnimationFrame(passed); };
    addEventListener('scroll', onScroll, { passive: true });
    let frame = 0;
    const scan = () => {
      frame = 0;
      for (const el of targets(root)) {
        if (el.dataset.reveal !== undefined) continue;
        // One after another along a row: the nth card waits a little longer (at most five steps).
        const i = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
        el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 70}ms`);
        el.dataset.reveal = '';
        waiting.add(el);
        seen.observe(el);
      }
    };
    scan();
    const changes = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    changes.observe(root, { childList: true, subtree: true });
    return () => { changes.disconnect(); seen.disconnect(); removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); cancelAnimationFrame(passing); };
  }, [main]);
}

const TOUR_STEP_MS = 2600;
/** The step after this one, back to the first after the last. */
export const nextStep = (step: number | null, count: number) => (step === null ? 0 : (step + 1) % count);

/**
 * Lights a list's steps up one after another, on a loop: only while it is on screen, and held while someone points at it to read.
 * `step` stays null on a device set to reduce motion, so nothing moves. `markerTop`: how far down the list the step is, in pixels,
 * for what travels beside it; the step is the element marked data-step.
 */
export function useStepTour<T extends HTMLElement>(count: number) {
  const box = useRef<T>(null);
  const held = useRef(false);
  const [step, setStep] = useState<number | null>(null);
  const [markerTop, setMarkerTop] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || stillWanted()) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(timer); timer = undefined; };
    const watch = new IntersectionObserver(([e]) => {
      stop();
      if (!e?.isIntersecting) return;
      setStep((s) => s ?? 0);
      timer = setInterval(() => { if (!held.current) setStep((s) => nextStep(s, count)); }, TOUR_STEP_MS);
    }, { threshold: 0.25 });
    watch.observe(el);
    return () => { stop(); watch.disconnect(); };
  }, [count]);
  useLayoutEffect(() => {
    const place = () => {
      const li = step === null ? null : box.current?.querySelectorAll<HTMLElement>('[data-step]')[step];
      if (li) setMarkerTop(li.offsetTop + li.offsetHeight / 2);
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [step]);
  return { box, step, markerTop, hold: { onPointerEnter: () => { held.current = true; }, onPointerLeave: () => { held.current = false; } } };
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A figure that counts up from zero the first time it comes into view; screen readers get the figure itself. */
export function CountUp({ value, decimals = 0, ms = 1200 }: { value: number; decimals?: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(() => (stillWanted() ? value : 0));
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || stillWanted() || done.current) return setShown(value);
    let frame = 0;
    const watch = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      watch.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        setShown(value * easeOut(t));
        if (t < 1) frame = requestAnimationFrame(step); else done.current = true;
      };
      frame = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    watch.observe(el);
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, [value, ms]);
  const text = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span ref={ref} className="tabular-nums"><span aria-hidden="true">{text(shown)}</span><span className="sr-only">{text(value)}</span></span>;
}
