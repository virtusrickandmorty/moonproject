/**
 * Live changes (the owner's request, Oct 2026): one stream per signed-in browser (GET /api/live) says when anything was
 * recorded or changed, by anyone on any computer, and which kinds of record. Screens that show records reload what they
 * show (useLiveChange), quietly, a moment later; a form being typed in is never touched. After a dropped connection
 * (Wi-Fi, a sleeping laptop) the stream comes back by itself and every screen reloads once, to catch up.
 */
import { useEffect, useRef } from 'react';

type Listener = (types: string[]) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

const tell = (types: string[]) => { for (const l of [...listeners]) l(types); };

/** Opens the stream (the shell does, once signed in). Nothing happens where the browser has no EventSource (tests). */
export function startLive(): void {
  if (source || typeof EventSource === 'undefined') return;
  let seen = false;
  source = new EventSource('/api/live');
  source.addEventListener('change', (e) => {
    try { tell((JSON.parse((e as MessageEvent<string>).data) as { types: string[] }).types); } catch { tell(['*']); }
  });
  // The first hello opens the stream; a later one is a reconnect: what changed meanwhile is not known, so all reload.
  source.addEventListener('hello', () => { if (seen) tell(['*']); seen = true; });
}

/** Closes the stream (signing out). */
export function stopLive(): void {
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
