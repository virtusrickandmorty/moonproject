/**
 * The website shop's products (from the ERP, or the samples until the shop publishes its own), and the cart and
 * wishlist. Those live in this browser only (localStorage) and hold product ids, sizes and quantities, never customer
 * or business data. Lines for a product, size or colour the shop no longer shows are left out.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { SAMPLE_PRODUCTS, type Product } from './products.ts';

export interface CartLine { productId: string; size: string; colour: string; qty: number }
interface State { cart: CartLine[]; wishlist: string[] }
type Action =
  | { type: 'add'; lines: CartLine[] }
  | { type: 'setQty'; line: CartLine; qty: number }
  | { type: 'remove'; line: CartLine }
  | { type: 'clearCart' }
  | { type: 'replace'; state: State }
  | { type: 'toggleWish'; productId: string };

const KEY = 'moonproject.shop.v1';
const MAX_QTY = 999;
const sameLine = (a: CartLine, b: CartLine) => a.productId === b.productId && a.size === b.size && a.colour === b.colour;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const cart = [...state.cart];
      for (const line of action.lines) {
        if (line.qty < 1) continue;
        const at = cart.findIndex((l) => sameLine(l, line));
        if (at >= 0) cart[at] = { ...cart[at]!, qty: Math.min(MAX_QTY, cart[at]!.qty + line.qty) };
        else cart.push({ ...line, qty: Math.min(MAX_QTY, line.qty) });
      }
      return { ...state, cart };
    }
    case 'setQty':
      return { ...state, cart: state.cart.map((l) => (sameLine(l, action.line) ? { ...l, qty: Math.max(1, Math.min(MAX_QTY, action.qty)) } : l)) };
    case 'remove': return { ...state, cart: state.cart.filter((l) => !sameLine(l, action.line)) };
    case 'clearCart': return { ...state, cart: [] };
    case 'replace': return action.state;
    case 'toggleWish': return { ...state, wishlist: state.wishlist.includes(action.productId)
      ? state.wishlist.filter((id) => id !== action.productId) : [...state.wishlist, action.productId] };
  }
}

/** The saved cart and wishlist, as far as they are well formed; which products still exist is checked against the list. */
function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<State> | null;
    const cart = (Array.isArray(saved?.cart) ? saved.cart : []).filter((l): l is CartLine =>
      typeof l?.productId === 'string' && typeof l.size === 'string' && typeof l.colour === 'string' && Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= MAX_QTY);
    const wishlist = (Array.isArray(saved?.wishlist) ? saved.wishlist : []).filter((id): id is string => typeof id === 'string');
    return { cart, wishlist: [...new Set(wishlist)] };
  } catch {
    return { cart: [], wishlist: [] };
  }
}

/** The shop's own products, or the samples when it has none yet or cannot be reached. */
function useProducts(): { products: readonly Product[]; samples: boolean; ready: boolean } {
  const [got, setGot] = useState<{ products: readonly Product[]; samples: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/shp/products', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Product[]>) : Promise.reject(new Error(String(r.status)))))
      .then((list) => live && setGot(list.length ? { products: list, samples: false } : { products: SAMPLE_PRODUCTS, samples: true }))
      .catch(() => live && setGot({ products: SAMPLE_PRODUCTS, samples: true }));
    return () => { live = false; };
  }, []);
  return got ? { ...got, ready: true } : { products: [], samples: false, ready: false };
}

interface Shop extends State {
  /** The products shown; `samples` when they are the made-up ones; `ready` once they have loaded. */
  products: readonly Product[]; samples: boolean; ready: boolean; productById: (id: string) => Product | undefined;
  add: (lines: CartLine[]) => void; setQty: (line: CartLine, qty: number) => void; remove: (line: CartLine) => void;
  clearCart: () => void; toggleWish: (productId: string) => void; cartCount: number; cartTotalCents: number;
}
const ShopContext = createContext<Shop | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const { products, samples, ready } = useProducts();
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window: the cart lasts this visit */ } }, [state]);
  // Another tab changed the cart: follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) dispatch({ type: 'replace', state: load() }); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const value = useMemo<Shop>(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const cart = state.cart.filter((l) => { const p = byId.get(l.productId); return !!p && p.sizes.includes(l.size) && p.colours.some((c) => c.name === l.colour); });
    return {
      cart, wishlist: state.wishlist.filter((id) => byId.has(id)), products, samples, ready, productById: (id) => byId.get(id),
      add: (lines) => dispatch({ type: 'add', lines }),
      setQty: (line, qty) => dispatch({ type: 'setQty', line, qty }),
      remove: (line) => dispatch({ type: 'remove', line }),
      clearCart: () => dispatch({ type: 'clearCart' }),
      toggleWish: (productId) => dispatch({ type: 'toggleWish', productId }),
      cartCount: cart.reduce((n, l) => n + l.qty, 0),
      cartTotalCents: cart.reduce((n, l) => n + l.qty * byId.get(l.productId)!.priceCents, 0),
    };
  }, [state, products, samples, ready]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error('useShop needs a ShopProvider');
  return shop;
}
