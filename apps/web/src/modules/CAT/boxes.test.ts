import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, id, invalid } from '../JO/entry-test.ts';
import { ItemDetail, ItemEditor } from './Catalog.tsx';
import * as http from '../CUS/http.ts';
import type { Me } from '../../api.ts';
const me = { permissions: ['cat.price.manage'] } as unknown as Me;
afterEach(() => vi.restoreAllMocks());
const editor = () => ItemEditor({ me, row: 'new', onClose: () => undefined, onSaved: async () => undefined });
it('catalog code refusal is shown on the Code box after editing and leaving it', () => {
  const f = form(editor); change(f.field('Code'), 'bad code'); blur(f.field('Code')); invalid(f, 'Code');
});
it('catalog Save keeps trimming and the existing piece/service defaults', async () => {
  const request = vi.spyOn(http, 'masterRequest').mockResolvedValue({ id: id(1) });
  const f = form(editor); change(f.field('Code'), ' HEM '); change(f.field('Name'), ' Hem trousers '); change(f.field('Class'), 'service');
  expect(f.field('Garment type').props.disabled).toBe(true);
  await f.find('children', 'Save').props.onClick();
  expect(request).toHaveBeenCalledWith(me, '/api/cat/items', 'POST', { code: 'HEM', name: 'Hem trousers', class: 'service', garmentType: null, unit: 'pc', setComponents: 1 });
});
const detail = () => ItemDetail({ me, data: { id: id(1), name: 'Sample jersey', class: 'service', unit: 'pc', version: 2, is_active: 1, prices: [] } as never,
  onClose: () => undefined, onEdit: () => undefined, onRefresh: async () => undefined });
it('a bad price is shown under Price per unit', () => {
  const f = form(detail); change(f.field('Price per unit'), 'oops'); blur(f.field('Price per unit')); invalid(f, 'Price per unit');
});
it('price Save keeps its effective date, quantity and centavos', async () => {
  const request = vi.spyOn(http, 'masterRequest').mockResolvedValue({});
  const f = form(detail); change(f.field('Effective from'), '2026-10-05'); change(f.field('Minimum quantity'), '10'); change(f.field('Price per unit'), '250.50');
  await f.find('children', 'Save price').props.onClick();
  expect(request).toHaveBeenCalledWith(me, `/api/cat/items/${id(1)}/prices`, 'POST', { effectiveFrom: '2026-10-05', minQty: 10, unitPriceCents: 25050 }, 2);
});
