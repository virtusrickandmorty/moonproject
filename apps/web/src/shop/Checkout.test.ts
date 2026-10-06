import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { MyOrders, OrderStatus, rememberedOrders } from './Checkout.tsx';

/** The same hook/event approach used by the ERP screen tests, with no browser dependency. */
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (current: unknown) => { const i = hooks.cursor++; return hooks.values[i] ??= { current }; },
  useCallback: (fn: () => unknown, deps: unknown[]) => {
    const i = hooks.cursor++; const old = hooks.values[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) hooks.values[i] = { deps, fn };
    return hooks.values[i].fn;
  },
  useEffect: (run: () => (() => void) | void, deps: unknown[] = []) => {
    const i = hooks.cursor++; const old = hooks.values[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) {
      hooks.values[i] = { deps };
      hooks.effects.push(() => { old?.cleanup?.(); const cleanup = run(); hooks.values[i].cleanup = cleanup; if (cleanup) hooks.cleanups.push(cleanup); });
    }
  },
}));
vi.mock('../router.tsx', () => ({ navigate: vi.fn(), Link: ({ children }: { children: ReactNode }) => children }));

const KEY = 'moonproject.shop.orders';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-06T00:00:00Z');
const saved = (number: string, days: number) => ({ number, token: `token-${number}`, savedOn: now - days * DAY });
const order = (number: string) => ({ number, status: 'confirmed', name: 'Sample Buyer', fulfilment: 'pickup', address: null,
  totalCents: 50000, holdUntil: '2026-10-07T00:00:00Z', deliveryOption: null, deliveryFeeCents: 0,
  paymentReference: null, saleNumber: null, lines: [], events: [], payment: null, reviewed: [] });
type Node = ReactElement<Record<string, any>>;
function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const n = root as Node;
  return [n, ...nodes(n.props.children)];
}
function render(run: () => ReactNode) {
  hooks.cursor = 0;
  const result = nodes(run());
  hooks.effects.splice(0).forEach((effect) => effect());
  return result;
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = [];
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => order(url.split('/').pop()!.split('?')[0]!) })));
  vi.stubGlobal('window', { scrollTo: vi.fn(), location: new URL('https://shop.example/order/WEB-000001?t=link-token&from=email#progress') });
  vi.stubGlobal('setInterval', vi.fn(() => 1));
  vi.stubGlobal('clearInterval', vi.fn());
  vi.stubGlobal('history', { state: { marker: 'kept' }, replaceState: vi.fn() });
});
afterEach(() => { hooks.cleanups.forEach((c) => c()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('saved buyer links', () => {
  it('ignores orders older than 30 days, undated entries and malformed storage', async () => {
    localStorage.setItem(KEY, JSON.stringify([saved('OLD', 31), saved('RECENT', 29), saved('BOUNDARY', 30), { number: 'UNDATED', token: 'old' }]));
    expect(rememberedOrders().map((m) => m.number)).toEqual(['RECENT', 'BOUNDARY']);
    render(MyOrders); await settle();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/shp/orders/RECENT?t=token-RECENT', '/api/shp/orders/BOUNDARY?t=token-BOUNDARY']);
    for (const value of ['null', '{}', 'broken']) { localStorage.setItem(KEY, value); expect(rememberedOrders()).toEqual([]); }
  });

  it('the Forget button removes displayed orders and their saved tokens', async () => {
    localStorage.setItem(KEY, JSON.stringify([saved('WEB-000001', 1)]));
    render(MyOrders); await settle();
    const shown = render(MyOrders);
    expect(shown.some((n) => n.props.to?.startsWith('/order/WEB-000001'))).toBe(true);
    shown.find((n) => n.type === 'button' && n.props.children === 'Forget these orders on this device')!.props.onClick();
    expect(rememberedOrders()).toEqual([]);
    expect(render(MyOrders).some((n) => n.props.to?.startsWith('/order/'))).toBe(false);
  });

  it('the Forget button clears the saved list and stays empty if a pending load finishes', async () => {
    localStorage.setItem(KEY, JSON.stringify([saved('WEB-000001', 1)]));
    let resolve!: (value: any) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((ok) => { resolve = ok; }));
    const button = render(MyOrders).find((n) => n.type === 'button' && n.props.children === 'Forget these orders on this device');
    expect(button).toBeDefined();
    button!.props.onClick();
    expect(rememberedOrders()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    resolve({ ok: true, json: async () => order('WEB-000001') }); await settle();
    expect(render(MyOrders).some((n) => n.props.to?.startsWith('/order/'))).toBe(false);
  });

  it('saves a loaded link, removes only its token from the address, and retains the token for later loads', async () => {
    const page = () => OrderStatus({ number: 'WEB-000001', query: '?t=link-token&from=email' });
    render(page); await settle(); render(page);
    expect(history.replaceState).toHaveBeenCalledWith({ marker: 'kept' }, '', '/order/WEB-000001?from=email#progress');
    expect(rememberedOrders()).toEqual([{ number: 'WEB-000001', token: 'link-token', savedOn: now }]);
    render(() => OrderStatus({ number: 'WEB-000001', query: '?from=email' })); await settle();
    const poll = vi.mocked(setInterval).mock.calls[0]![0] as () => void;
    vi.mocked(Date.now).mockReturnValue(now + DAY);
    poll(); await settle();
    expect(rememberedOrders()[0]!.savedOn).toBe(now);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('?t=link-token'))).toBe(true);
  });

  it('does not save or strip a link that failed to load', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    render(() => OrderStatus({ number: 'WEB-000001', query: '?t=link-token' })); await settle();
    expect(history.replaceState).not.toHaveBeenCalled(); expect(rememberedOrders()).toEqual([]);
  });
});
