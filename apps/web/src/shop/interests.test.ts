import { afterEach, describe, expect, it, vi } from 'vitest';
import { alike, forgetInterests, loadSeen, remember, suggest, type Seen } from './interests.ts';
import type { Product } from './products.ts';

const NOW = Date.UTC(2026, 9, 28);
const DAY = 86_400_000;
const item = (id: string, category: string, more: Partial<Product> = {}): Product => ({
  id, name: id, category, shape: 'tee', priceCents: 50_000, summary: '', features: [], colours: [{ name: 'White', hex: '#fff' }], sizes: ['M'],
  madeToOrder: true, minQty: 10, leadDays: 14, ...more,
} as Product);
const ids = (list: Product[]) => list.map((p) => p.id);

const products = [
  item('jersey', 'Jerseys'), item('jersey-ready', 'Jerseys', { madeToOrder: false }), item('jersey-out', 'Jerseys', { madeToOrder: false, stock: [{ size: 'M', colour: 'White', available: 0 }] }),
  item('polo', 'Polo shirts', { summary: 'An office polo' }), item('polo-2', 'Polo shirts'), item('jacket', 'Jackets', { badge: 'New' }), item('tee', 'Shirts', { madeToOrder: false }),
];

describe('Picked for you and Recently viewed (the owner\'s request, Oct 2026)', () => {
  it('shows nothing for a visitor who has done nothing yet, so the popular row shows instead', () => {
    expect(suggest([], products, NOW)).toEqual({ recent: [], picked: [] });
  });

  it('picks from the category they looked at, ready stock first, not what they already opened nor what is sold out', () => {
    const seen: Seen[] = [{ k: 'product', v: 'jersey', t: NOW - 1000 }];
    const { recent, picked } = suggest(seen, products, NOW);
    expect(ids(recent)).toEqual(['jersey']);
    expect(ids(picked).slice(0, 1)).toEqual(['jersey-ready']);
    expect(ids(picked)).not.toContain('jersey');
    expect(ids(picked)).not.toContain('jersey-out');
  });

  it('counts a search, a cart and the latest more than an old look; recently viewed is newest first, once each', () => {
    const seen: Seen[] = [
      { k: 'search', v: 'office', t: NOW - 1000 },
      { k: 'product', v: 'tee', t: NOW - 2000 },
      { k: 'product', v: 'jacket', t: NOW - 40 * DAY },
      { k: 'product', v: 'tee', t: NOW - 50 * DAY },
    ];
    const { recent, picked } = suggest(seen, products, NOW);
    expect(ids(recent)).toEqual(['tee', 'jacket']);
    expect(picked[0]!.id).toBe('polo');
  });

  it('fills a short pick with ready stock, then the badged ones', () => {
    const { picked } = suggest([{ k: 'category', v: 'Jackets', t: NOW }], products, NOW);
    expect(ids(picked)).toEqual(['jacket', 'jersey-ready', 'tee']);
  });

  it('suggests garments like the one open: same category first, ready stock first, none sold out', () => {
    expect(ids(alike(products[0]!, products))).toEqual(['jersey-ready', 'polo', 'polo-2', 'jacket']);
  });
});

describe('kept in this browser only', () => {
  afterEach(() => vi.unstubAllGlobals());
  const browser = () => { const kept = new Map<string, string>(); vi.stubGlobal('window', { localStorage: {
    getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) } }); return kept; };

  it('remembers garments, categories and searches (not pages), newest first, and forgets them on "Don\'t count me"', () => {
    browser();
    remember({ kind: 'page', page: '/' }, NOW);
    remember({ kind: 'product', productId: 'polo' }, NOW + 1);
    remember({ kind: 'search', query: ' Office Polo ' }, NOW + 2);
    expect(loadSeen(NOW + 3)).toEqual([{ k: 'search', v: 'office polo', t: NOW + 2 }, { k: 'product', v: 'polo', t: NOW + 1 }]);
    expect(loadSeen(NOW + 61 * DAY)).toEqual([]);
    forgetInterests();
    expect(loadSeen(NOW + 3)).toEqual([]);
  });
});
