/**
 * What this visitor seems to like (the owner's request, Oct 2026): the garments they opened, wished for, put in the cart or
 * ordered, the categories they picked and what they searched for. Kept only in this browser, never sent anywhere, and only
 * while visit counting is on (insights.ts feeds it; "Don't count me" forgets it). From it the home page shows "Recently
 * viewed" and "Picked for you".
 */
import { matchesWords, searchWords } from '@moonproject/shared';
import { useMemo, useSyncExternalStore } from 'react';
import type { ShopEvent } from './insights.ts';
import { isSoldOut, type Product } from './products.ts';

type SeenKind = 'product' | 'wish' | 'cart' | 'order' | 'category' | 'search';
/** One thing the visitor did: what (a product id, a category or a search) and when (ms). */
export interface Seen { k: SeenKind; v: string; t: number }

const KEY = 'vg-interests';
const KEEP = 60; // the latest things done
const DAYS = 60; // older than this is forgotten
/** How much each thing says about the visitor's taste: an order more than a cart, a cart more than a look. */
const WEIGHT: Record<SeenKind, number> = { product: 1, category: 2, search: 2, wish: 3, cart: 4, order: 5 };
const DAY = 86_400_000;

const store = () => { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } };
let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; for (const l of listeners) l(); };

export function loadSeen(now = Date.now()): Seen[] {
  try {
    const list: unknown = JSON.parse(store()?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s): s is Seen => !!s && typeof s.k === 'string' && s.k in WEIGHT && typeof s.v === 'string' && typeof s.t === 'number' && now - s.t < DAYS * DAY) : [];
  } catch { return []; }
}

/** Keeps one thing the visitor did (called by track() while counting is on). */
export function remember(e: ShopEvent, now = Date.now()): void {
  const v = e.kind === 'category' ? e.category : e.kind === 'search' ? e.query?.trim().toLowerCase() : e.productId;
  if (!v || !(e.kind in WEIGHT)) return;
  const list = [{ k: e.kind as SeenKind, v, t: now }, ...loadSeen(now)].slice(0, KEEP);
  try { store()?.setItem(KEY, JSON.stringify(list)); } catch { /* private window: not kept */ }
  changed();
}

/** Forgets it all (the visitor said "Don't count me"). */
export function forgetInterests(): void {
  try { store()?.removeItem(KEY); } catch { /* nothing kept */ }
  changed();
}

/**
 * From what the visitor did: the garments they opened, newest first, and the ones picked for them. A garment scores for its
 * category (from the garments they looked at and the categories they picked) and for matching their searches, the latest
 * counting most (half as much every two weeks); ties go to ready stock. Garments already opened, and sold-out ones, are
 * not picked; a short pick is filled with ready stock, then the shop's badged ones. Nothing done yet: nothing to show.
 */
export function suggest(seen: readonly Seen[], products: readonly Product[], now = Date.now()): { recent: Product[]; picked: Product[] } {
  if (!seen.length) return { recent: [], picked: [] };
  const byId = new Map(products.map((p) => [p.id, p]));
  const recent = [...new Set(seen.filter((s) => s.k === 'product').map((s) => s.v))].flatMap((id) => byId.get(id) ?? []).slice(0, 8);
  const category = new Map<string, number>();
  const searches: [string[][], number][] = [];
  for (const s of seen) {
    const w = WEIGHT[s.k] * 0.5 ** ((now - s.t) / (14 * DAY));
    const c = s.k === 'category' ? s.v : s.k === 'search' ? undefined : byId.get(s.v)?.category;
    if (c) category.set(c, (category.get(c) ?? 0) + w);
    if (s.k === 'search') searches.push([searchWords(s.v), w]);
  }
  const score = (p: Product) => (category.get(p.category) ?? 0)
    + searches.reduce((n, [words, w]) => n + (matchesWords(`${p.name} ${p.category} ${p.summary}`, words) ? w : 0), 0);
  const open = new Set(recent.map((p) => p.id));
  const left = products.filter((p) => !open.has(p.id) && !isSoldOut(p));
  const readyFirst = (a: Product, b: Product) => Number(a.madeToOrder) - Number(b.madeToOrder);
  const picked = left.filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a) || readyFirst(a, b));
  const fill = [...left.filter((p) => !p.madeToOrder), ...left.filter((p) => p.badge).sort(readyFirst)];
  return { recent, picked: [...new Set([...picked, ...(picked.length < 4 ? fill : [])])].slice(0, 8) };
}

/** suggest() for this visitor, again whenever they do something new. */
export function useInterests(products: readonly Product[]) {
  const v = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => 0);
  return useMemo(() => suggest(loadSeen(), products), [v, products]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Garments like this one, for its window: the same category first, then the same kind; ready stock first, none sold out. */
export function alike(product: Product, products: readonly Product[]): Product[] {
  const rank = (p: Product) => (p.category === product.category ? 0 : p.madeToOrder === product.madeToOrder ? 1 : 2) * 2 + Number(p.madeToOrder);
  return products.filter((p) => p.id !== product.id && !isSoldOut(p) && rank(p) < 4).sort((a, b) => rank(a) - rank(b)).slice(0, 4);
}
