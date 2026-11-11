/**
 * The order link without internet (the owner's request, Nov 2026): what the customer types is kept on their phone as they
 * type (a draft), and an answer sent without internet waits on the phone (the outbox) and goes by itself once the phone is
 * online again. The page and the link's own details open offline through the service worker (public/sw.js). Kept in this
 * browser only, for this link; cleared once the answer is sent.
 */
import { useEffect, useRef, useState } from 'react';

const read = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked: the page still works online */ } };
const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* nothing kept */ } };

/** Whether the phone says it is online, kept up to date. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** A draft kept as the customer types: read once on opening, written half a second after each change while `on`. */
export const readDraft = <T,>(key: string) => read<T>(key);
export const clearDraft = (key: string) => drop(key);
export function useDraft(key: string, value: unknown, on: boolean) {
  const last = useRef('');
  useEffect(() => {
    if (!on) return;
    const text = JSON.stringify(value);
    if (text === last.current) return;
    const t = setTimeout(() => { last.current = text; write(key, value); }, 500);
    return () => clearTimeout(t);
  }, [key, value, on]);
}

/** An answer waiting on the phone to be sent. */
export interface Pending { method: 'POST' | 'PUT'; url: string; body: unknown; at: string }
export const pendingOf = (key: string) => read<Pending>(key);
export const keepPending = (key: string, p: Pending) => write(key, p);
export const clearPending = (key: string) => drop(key);

/** A key made on the phone for a new answer, so a send repeated (by the phone, or once back online) is the same answer. */
export const newClientKey = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A network failure (no answer from the server at all), as the order link's `send` marks it. */
export const isOffline = (e: unknown) => !!(e as { offline?: boolean } | null)?.offline;

/**
 * Sends what waits on the phone once it is online: now, when the phone says it is back online, and every 30 seconds.
 * `onSent` gets the server's answer; `onRefused` a refusal from the server (the wait ends: something to fix on the form).
 */
export function useOutbox<T>(key: string, waiting: boolean, sendIt: (p: Pending) => Promise<T>, onSent: (r: T) => void, onRefused: (e: Error) => void) {
  const busy = useRef(false);
  const [trying, setTrying] = useState(false);
  const attempt = async () => {
    const p = pendingOf(key);
    if (!p || busy.current) return;
    busy.current = true; setTrying(true);
    try {
      const r = await sendIt(p);
      clearPending(key);
      onSent(r);
    } catch (e) {
      if (!isOffline(e)) { clearPending(key); onRefused(e as Error); }
    } finally { busy.current = false; setTrying(false); }
  };
  useEffect(() => {
    if (!waiting) return;
    void attempt();
    const on = () => void attempt();
    window.addEventListener('online', on);
    const t = setInterval(() => void attempt(), 30_000);
    return () => { window.removeEventListener('online', on); clearInterval(t); };
  }, [waiting, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { trying, retry: () => void attempt() };
}
