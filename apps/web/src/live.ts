/**
 * Live changes (the owner's request, Oct 2026): one stream per signed-in browser (GET /api/live) says when anything was
 * recorded or changed, by anyone on any computer, and which kinds of record. Screens that show records reload what they
 * show (useLiveChange), quietly, a moment later; a form being typed in is never touched. After a dropped connection
 * (Wi-Fi, a sleeping laptop, the server restarting after an update) the stream comes back by itself and every screen
 * reloads once, to catch up.
 */
import { useEffect, useRef, useState } from 'react';

type Listener = (types: string[]) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let wanted = false;
let seen = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let waitMs = 0;

const tell = (types: string[]) => { for (const l of [...listeners]) l(types); };

/** The build of the app this page runs (its main script's name), and whether the server now serves another. */
const ownBuild = () => (typeof document === 'undefined' ? null : /assets\/index-[\w-]+\.js/.exec(document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src ?? '')?.[0] ?? null);
let updated = false;
const updateListeners = new Set<() => void>();
export const isAppUpdated = () => updated;
/** True once the server serves a newer app than this page runs (an update while the page stayed open). */
export function useAppUpdated(): boolean {
  const [on, setOn] = useState(updated);
  useEffect(() => { const l = () => setOn(true); updateListeners.add(l); return () => void updateListeners.delete(l); }, []);
  return on;
}

/**
 * After a stream gives up, the wait before opening a new one: 2 seconds, doubling to at most 30. A browser retries a
 * dropped stream by itself, but not one that got an error answer: while the server restarts after an update, Cloudflare
 * answers 502 for a few seconds, and every open screen then stayed still until reloaded (the owner's report, 26 Oct 2026).
 */
export const RETRY_FIRST_MS = 2_000;
export const RETRY_MOST_MS = 30_000;

function open(): void {
  const s = new EventSource('/api/live');
  source = s;
  s.addEventListener('change', (e) => {
    try { tell((JSON.parse((e as MessageEvent<string>).data) as { types: string[] }).types); } catch { tell(['*']); }
  });
  // The first hello opens the stream; a later one is a reconnect: what changed meanwhile is not known, so all reload.
  s.addEventListener('hello', (e) => {
    waitMs = 0; if (seen) tell(['*']); seen = true;
    try {
      const build = (JSON.parse((e as MessageEvent<string>).data) as { build?: string | null }).build;
      const mine = ownBuild();
      if (build && mine && build !== mine && !updated) { updated = true; for (const l of [...updateListeners]) l(); }
    } catch { /* an old server says no build */ }
  });
  s.addEventListener('error', () => {
    if (s.readyState !== EventSource.CLOSED || source !== s || !wanted) return; // still retrying by itself, or not ours any more
    s.close();
    source = null;
    waitMs = waitMs ? Math.min(waitMs * 2, RETRY_MOST_MS) : RETRY_FIRST_MS;
    retry = setTimeout(() => { retry = undefined; if (wanted && !source) open(); }, waitMs);
  });
}

/** Opens the stream (the shell does, once signed in), and keeps it open. Nothing happens where the browser has no EventSource (tests). */
export function startLive(): void {
  if (wanted || typeof EventSource === 'undefined') return;
  wanted = true;
  seen = false;
  waitMs = 0;
  open();
}

/** Closes the stream (signing out), and stops opening it again. */
export function stopLive(): void {
  wanted = false;
  clearTimeout(retry);
  retry = undefined;
  source?.close();
  source = null;
}

/** Hears every change; returns the way to stop hearing. */
export function onLiveChange(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/**
 * Runs `reload` a moment after a change (several changes close together run it once). `about`: only changes to these
 * kinds of record (a document type key like 'jo.job_order', or an audit entity type); none means any change.
 */
export function useLiveChange(reload: () => void, about?: readonly string[], delayMs = 400): void {
  const latest = useRef(reload);
  latest.current = reload;
  const kinds = about?.join('|') ?? '';
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wanted = kinds ? kinds.split('|') : null;
    const off = onLiveChange((types) => {
      if (wanted && !types.includes('*') && !types.some((t) => wanted.includes(t))) return;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), delayMs);
    });
    return () => { off(); clearTimeout(timer); };
  }, [kinds, delayMs]);
}

/**
 * A report's figures load again by themselves after a change (the owner's request, Oct 2026: the whole ERP live), with
 * the same dates and filters, once things have been quiet this long: a run of entries reloads it once, and what it shows
 * stays on screen until the new figures arrive.
 */
export const REPORT_QUIET_MS = 3_000;
/** A number that goes up a moment after each quiet change: a report's load depends on it to load again in place. */
export function useLiveTick(delayMs = REPORT_QUIET_MS): number {
  const [tick, setTick] = useState(0);
  useLiveChange(() => { if (!(typeof window !== 'undefined' && window.matchMedia?.('print').matches)) setTick((n) => n + 1); }, undefined, delayMs);
  return tick;
}

/**
 * A screen's own load, run again a moment after any change on any computer (the owner's report, Oct 2026: some screens
 * stayed as they were until reloaded). A failed reload is left quiet: the screen keeps what it showed. `when`: reload only
 * while it says so (a screen with changes not saved yet waits, so nothing typed is lost).
 */
export function useLiveReload(load: () => unknown, when: () => boolean = () => true): void {
  useLiveChange(() => {
    if (!when()) return;
    try { void Promise.resolve(load()).catch(() => undefined); } catch { /* the screen keeps what it showed */ }
  });
}
