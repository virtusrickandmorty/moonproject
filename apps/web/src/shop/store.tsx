/**
 * Cart and wishlist for the welcome-page store. They live in this browser only (localStorage) and hold showcase
 * product ids, sizes and quantities, never customer or business data. A stale or broken saved copy is dropped quietly.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { productById } from './products.ts';

export interface CartLine { productId: string; size: string; colour: string; qty: number }
interface State { cart: CartLine[]; wishlist: string[] }
type Action =
  | { type: 'add'; lines: CartLine[] }
  | { type: 'setQty'; index: number; qty: number }
  | { type: 'remove'; index: number }
  | { type: 'clearCart' }
  | { type: 'toggleWish'; productId: string }
  | { type: 'replace'; state: State };

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
      return { ...state, cart: state.cart.map((l, i) => (i === action.index ? { ...l, qty: Math.max(1, Math.min(MAX_QTY, action.qty)) } : l)) };
    case 'remove': return { ...state, cart: state.cart.filter((_, i) => i !== action.index) };
    case 'clearCart': return { ...state, cart: [] };
    case 'replace': return action.state;
    case 'toggleWish': return { ...state, wishlist: state.wishlist.includes(action.productId)
      ? state.wishlist.filter((id) => id !== action.productId) : [...state.wishlist, action.productId] };
  }
}

/** Keeps only lines and wishes that still match a showcase product, size and colour. */
function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<State> | null;
    const cart = (Array.isArray(saved?.cart) ? saved.cart : []).filter((l): l is CartLine => {
      const p = productById(l?.productId);
      return !!p && p.sizes.includes(l.size) && p.colours.some((c) => c.name === l.colour) && Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= MAX_QTY;
    });
    const wishlist = (Array.isArray(saved?.wishlist) ? saved.wishlist : []).filter((id): id is string => typeof id === 'string' && !!productById(id));
    return { cart, wishlist: [...new Set(wishlist)] };
  } catch {
    return { cart: [], wishlist: [] };
  }
}

interface Shop extends State {
  add: (lines: CartLine[]) => void; setQty: (index: number, qty: number) => void; remove: (index: number) => void;
  clearCart: () => void; toggleWish: (productId: string) => void; cartCount: number; cartTotalCents: number;
}
const ShopContext = createContext<Shop | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window: the cart lasts this visit */ } }, [state]);
  // Another tab changed the cart: follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) dispatch({ type: 'replace', state: load() }); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const value = useMemo<Shop>(() => ({
    ...state,
    add: (lines) => dispatch({ type: 'add', lines }),
    setQty: (index, qty) => dispatch({ type: 'setQty', index, qty }),
    remove: (index) => dispatch({ type: 'remove', index }),
    clearCart: () => dispatch({ type: 'clearCart' }),
    toggleWish: (productId) => dispatch({ type: 'toggleWish', productId }),
    cartCount: state.cart.reduce((n, l) => n + l.qty, 0),
    cartTotalCents: state.cart.reduce((n, l) => n + l.qty * (productById(l.productId)?.priceCents ?? 0), 0),
  }), [state]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error('useShop needs a ShopProvider');
  return shop;
}
