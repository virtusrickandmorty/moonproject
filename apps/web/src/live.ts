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

/** No one has touched this tab for this long (the server signs out at 60 minutes): it stops asking the server anything. */
const AWAY_MS = 55 * 60_000;
let lastInput = Date.now();
let unattended = false;
let missed = false;
/** A screen left on by design (the TV board, the floor tablet): it keeps reloading with nobody at it. */
export const setUnattended = (on: boolean) => { unattended = on; };
/** Nobody is at this screen. Background reloads stop, so the idle sign-out works; the first touch brings everything up to date. */
export const userAway = () => !unattended && Date.now() - lastInput > AWAY_MS;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const back = () => { lastInput = Date.now(); if (missed) { missed = false; tell(['*']); } };
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(e, back, { passive: true, capture: true });
}

const hear = (types: string[]) => {
  if (userAway()) { missed = true; return; }
  for (const l of [...listeners]) l(types);
};
/** What the tab holding the stream passes on to the others (see share). */
let channel: BroadcastChannel | null = null;
const tell = (types: string[]) => { channel?.postMessage({ types }); hear(types); };

/** The build of the app this page runs (its main script's name), and whether the server now serves another. */
const ownBuild = () => (typeof document === 'undefined' ? null : /assets\/index-[\w-]+\.js/.exec(document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src ?? '')?.[0] ?? null);
let updated = false;
const updateListeners = new Set<() => void>();
export const isAppUpdated = () => updated;
/**
 * A part of the app that would not load because this page is from before an update and the part is gone (the owner's
 * report, Nov 2026: Download PSD failed). Each browser words it its own way. A build keeps earlier parts for a month
 * (vite.config.ts), so this is rare; the words say what to do.
 */
export const stalePart = (e: unknown) => /dynamically imported module|importing a module script failed|failed to load module script|unable to preload/i.test(e instanceof Error ? e.message : String(e));
export const STALE_PART = 'This page is from before an update of the ERP, so this step could not load. Download what you want to keep, then reload the page and try again.';

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
      channel?.postMessage({ build });
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
  if (!share()) open();
}

/**
 * One stream for every tab of this browser: a browser allows six connections to a site, and each stream holds one for as
 * long as the tab is open, so a seventh tab would never load. The tab holding the lock keeps the stream and passes what it
 * hears to the others; when it closes, the next one takes over and every screen catches up. False where the browser has
 * neither (then each tab keeps its own).
 */
function share(): boolean {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' || !navigator.locks) return false;
  const stop = new AbortController();
  const here = new BroadcastChannel('moonproject-live');
  channel = here;
  here.onmessage = (e: MessageEvent<{ types?: string[]; build?: string | null }>) => {
    if (e.data.types) hear(e.data.types);
    const mine = ownBuild();
    if (e.data.build && mine && e.data.build !== mine && !updated) { updated = true; for (const l of [...updateListeners]) l(); }
  };
  void navigator.locks.request('moonproject-live', { signal: stop.signal }, () => new Promise<void>((release) => {
    seen = sharedBefore; // taking over from a tab that closed: what changed meanwhile is not known
    open();
    leave = () => { release(); };
  })).catch(() => undefined);
  sharedBefore = true;
  leave = () => stop.abort();
  return true;
}
let sharedBefore = false;
let leave: (() => void) | null = null;

/** Closes the stream (signing out), and stops opening it again. */
export function stopLive(): void {
  wanted = false;
  clearTimeout(retry);
  retry = undefined;
  source?.close();
  source = null;
  leave?.();
  leave = null;
  channel?.close();
  channel = null;
  sharedBefore = false;
}

/** Hears every change; returns the way to stop hearing. */
export function onLiveChange(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/**
 * Notifications marked read (the owner's report, Nov 2026: a duplicated tab's bell went quiet while the first tab kept
 * ringing for the same ones). A read mark writes no audit row, so the stream above does not carry it: the screen that
 * marked some read says so (`toldRead`), and every bell and list of that kind loads again (`useReadElsewhere`), in this
 * tab and in this browser's other tabs. A tab coming back into view loads them again too, for what was read meanwhile on
 * another computer or phone. 'dash': the ERP's bell and notifications; 'floor': the floor app's bell.
 */
export type ReadKind = 'dash' | 'floor';
const readListeners = new Map<ReadKind, Set<() => void>>();
let readChannel: BroadcastChannel | null | undefined;
const heardRead = (kind: ReadKind) => { for (const l of [...(readListeners.get(kind) ?? [])]) l(); };
const readTabs = () => {
  if (readChannel === undefined) {
    readChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('moonproject-read');
    if (readChannel) {
      readChannel.onmessage = (e: MessageEvent<ReadKind>) => heardRead(e.data);
      (readChannel as { unref?: () => void }).unref?.(); // where tests run (Node), an open channel must not keep them running
    }
  }
  return readChannel;
};
/** Some notifications of this kind were just marked read here. */
export function toldRead(kind: ReadKind): void {
  readTabs()?.postMessage(kind);
  heardRead(kind);
}
/** Runs `reload` when notifications of this kind are marked read in this tab or another, and when the tab comes back into view. */
export function useReadElsewhere(kind: ReadKind, reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    readTabs();
    const l = () => latest.current();
    const set = readListeners.get(kind) ?? new Set<() => void>();
    readListeners.set(kind, set);
    set.add(l);
    const back = () => { if (!document.hidden) l(); };
    document.addEventListener('visibilitychange', back);
    return () => { set.delete(l); document.removeEventListener('visibilitychange', back); };
  }, [kind]);
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
