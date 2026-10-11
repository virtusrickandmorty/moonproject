/**
 * Sales › Price list (PLAN E2): the types and the calls the Catalog screen makes, kept apart from the page so a test can
 * send the same requests to the real server. Prices are set by the server's own routes; nothing here works out a price.
 */
import { parsePesos } from '@moonproject/shared';
import type { Me } from '../../api.ts';
import { masterRequest } from '../CUS/http.ts';

export type ItemClass = 'made_to_order_garment' | 'service' | 'ready_made_item';
export type Item = { id: string; code: string; name: string; class: ItemClass; garment_type: string | null; unit: 'pc' | 'set';
  set_components: number; is_active: number; version: number };
export type Price = { id: string; effectiveFrom: string; minQty: number; unitPriceCents: number; createdAt: string };
export type Detail = Item & { prices: Price[] };
export interface ItemValues { code: string; name: string; class: ItemClass; garmentType: string; unit: 'pc' | 'set'; setComponents: number }

export const CLASS_LABELS: Record<ItemClass, string> = { made_to_order_garment: 'Made-to-order garment', service: 'Service', ready_made_item: 'Ready-made item' };
export const PAGE_SIZE = 25;

/** A price typed by staff, in centavos; null when it is not a peso amount with at most two decimals. */
export const moneyCents = (text: string): number | null => {
  try { const cents = parsePesos(text); return cents >= 0 ? cents : null; }
  catch { return null; }
};

export const blankItem = (): ItemValues => ({ code: '', name: '', class: 'made_to_order_garment', garmentType: '', unit: 'pc', setComponents: 1 });
export const valuesOf = (row: Item): ItemValues => ({ code: row.code, name: row.name, class: row.class, garmentType: row.garment_type ?? '', unit: row.unit, setComponents: row.set_components });

/** The strict body of POST /api/cat/items and PUT /api/cat/items/:id: a garment type only for garments, one component for a piece, two (upper and lower) for a set; no code for the next one. */
export const itemBody = (v: ItemValues) => ({
  ...(v.code.trim() ? { code: v.code.trim() } : {}), name: v.name.trim(), class: v.class,
  garmentType: v.class === 'made_to_order_garment' ? v.garmentType.trim() : null,
  unit: v.unit, setComponents: v.unit === 'pc' ? 1 : 2, // a set is an upper and a lower part
});

/** The server refuses a change of type or unit once an item has prices (ITEM_IN_USE); the form says so instead of letting it try. */
export const typeLocked = (detail: Pick<Detail, 'prices'> | null) => (detail?.prices.length ?? 0) > 0;

/** What the screen sends. Changes carry the item's version as If-Match, as the routes require. */
export const catalogCalls = (me: Me) => ({
  list: (search: string, offset: number) => masterRequest<Item[]>(me, `/api/cat/items?${new URLSearchParams({ search, offset: String(offset), limit: String(PAGE_SIZE) })}`),
  open: (id: string) => masterRequest<Detail>(me, `/api/cat/items/${encodeURIComponent(id)}`),
  create: (v: ItemValues) => masterRequest<Item>(me, '/api/cat/items', 'POST', itemBody(v)),
  update: (row: Item, v: ItemValues) => masterRequest<Item>(me, `/api/cat/items/${encodeURIComponent(row.id)}`, 'PUT', itemBody(v), row.version),
  deactivate: (row: Item) => masterRequest<Item>(me, `/api/cat/items/${encodeURIComponent(row.id)}/deactivate`, 'POST', undefined, row.version),
  addPrice: (row: Item, price: { effectiveFrom: string; minQty: number; unitPriceCents: number }) =>
    masterRequest<unknown>(me, `/api/cat/items/${encodeURIComponent(row.id)}/prices`, 'POST', price, row.version),
});
