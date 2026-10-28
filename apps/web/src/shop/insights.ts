/**
 * The website's visitor counting (the owner's request, Oct 2026; server: SHP insights.ts). Anonymous: a random id kept
 * in this browser (not a cookie), what the visitor does on the website, nothing that names them. Not counted: a visitor
 * who chose "Don't count me", a browser that asks sites not to track it, and staff looking at the website.
 */
import { forgetInterests, remember } from './interests.ts';

type Kind = 'page' | 'product' | 'cart' | 'wish' | 'search' | 'category' | 'checkout' | 'order' | 'quote';
export interface ShopEvent { kind: Kind; page?: string; productId?: string; query?: string; results?: number; category?: string; source?: string }

const CHOICE = 'vg-counting'; // 'yes' | 'no': the visitor's answer to the notice
const VISITOR = 'vg-visitor';
const SESSION = 'vg-session';
let staff = false;
let queue: ShopEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

const read = (store: Storage | undefined, key: string) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
const write = (store: Storage | undefined, key: string, value: string) => { try { store?.setItem(key, value); } catch { /* private window: not kept */ } };
const randomId = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32);
const idIn = (store: Storage | undefined, key: string) => { let v = read(store, key); if (!v || !/^[a-z0-9]{8,40}$/.test(v)) { v = randomId(); write(store, key, v); } return v; };
const local = () => (typeof window === 'undefined' ? undefined : window.localStorage);
const sessionStore = () => (typeof window === 'undefined' ? undefined : window.sessionStorage);

/** Staff looking at the website are not counted. */
export const setStaff = (on: boolean) => { staff = on; };
/** The visitor's answer to the notice: null while they have not answered. */
export const countingChoice = (): 'yes' | 'no' | null => { const v = read(local(), CHOICE); return v === 'yes' || v === 'no' ? v : null; };
export const setCountingChoice = (v: 'yes' | 'no') => { write(local(), CHOICE, v); if (v === 'no') { queue = []; forgetInterests(); } };
/** A browser asking sites not to track it (Do Not Track, Global Privacy Control). */
export const browserSaysNo = () => typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
const counting = () => !staff && countingChoice() !== 'no' && !browserSaysNo();

function flush(useBeacon = false) {
  clearTimeout(timer); timer = undefined;
  if (!queue.length || !counting()) { queue = []; return; }
  const body = JSON.stringify({ visitor: idIn(local(), VISITOR), session: idIn(sessionStore(), SESSION), events: queue.splice(0, 25) });
  if (useBeacon && navigator.sendBeacon?.('/api/shp/events', new Blob([body], { type: 'application/json' }))) return;
  void fetch('/api/shp/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => undefined);
}

/** Counts one thing a visitor did; sent in small batches, and when the page closes. */
export function track(e: ShopEvent): void {
  if (!counting()) return;
  remember(e); // this visitor's own suggestions, kept in this browser only
  queue.push(e);
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(() => flush(), 15_000);
}

/** Where the visit came from, on its first page: another website's name, or a link's utm_source. */
export function sourceOfVisit(): string | undefined {
  if (read(sessionStore(), 'vg-source-sent')) return undefined;
  write(sessionStore(), 'vg-source-sent', '1');
  const utm = new URLSearchParams(window.location.search).get('utm_source');
  if (utm) return utm.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 60) || undefined;
  try {
    const host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
    return host && host !== window.location.hostname ? host.slice(0, 60) : undefined;
  } catch { return undefined; }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => flush(true));
