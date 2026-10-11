import { afterEach, expect, it, vi } from 'vitest';
import { change, form, type } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { CustomerPicker } from '../COL/parts.tsx';
import { ItemSearch } from '../JO/parts.tsx';
import { QuotationForm } from './QuotationForm.tsx';

afterEach(() => vi.restoreAllMocks());
it('the quotation item form keeps the exact input: picked item, quantity, discount, changed price with its reason', async () => {
  const preview = vi.spyOn(api, 'preview').mockResolvedValue({ totalCents: 24000, issues: [] } as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'quo1' } as never);
  const f = form(() => QuotationForm({ type: type('quo.quotation'), mode: { kind: 'new' } }));
  f.render().find((n) => n.type === CustomerPicker)!.props.onChange({ id: 'c1', name: 'Sample School' });
  f.render().find((n) => n.type === ItemSearch)!.props.onPick({ id: 'it1', name: 'Jersey', unit: 'pc' });
  expect(f.render().find((n) => n.type === CustomerPicker)!.props.value).toEqual({ id: 'c1', name: 'Sample School' });
  expect(f.find('children', 'Change item')).toBeDefined();
  change(f.find('aria-label', 'Item quantity'), '2');
  f.find('label', 'Item discount').props.onValue(1000);
  f.find('label', 'Item price each').props.onValue(12500);
  f.find('children', '+ Add to order').props.onClick(); // a changed price needs its reason first
  expect(f.render().some((n) => n.props.list?.includes('Say why the price is changed.') && n.props.show === true)).toBe(true);
  change(f.find('aria-label', 'Item price reason'), ' Sample price ');
  f.find('children', '+ Add to order').props.onClick();
  expect(f.find('aria-label', 'Item description').props.value).toBe(''); // ready for the next item
  // Edit brings it back; Record sends the same input.
  f.find('aria-label', 'Edit item 1').props.onClick();
  expect(f.find('aria-label', 'Item quantity').props.value).toBe(2);
  f.find('children', 'Update item').props.onClick();
  await f.find('children', 'Record').props.onClick();
  const input = { customerId: 'c1', validForDays: 15, lines: [{ itemId: 'it1', description: 'Jersey', qty: 2, unit: 'pc', discountCents: 1000,
    overrideUnitPriceCents: 12500, overrideReason: 'Sample price' }], documentDiscountCents: 0 };
  expect(preview).toHaveBeenLastCalledWith('quo.quotation', input);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key');
  expect(post).toHaveBeenLastCalledWith('quo.quotation', input, 24000, 'test-key');
});

it('Record takes a complete item still in the quotation item form with it', async () => {
  const preview = vi.spyOn(api, 'preview').mockResolvedValue({ totalCents: 5000, issues: [] } as never);
  const f = form(() => QuotationForm({ type: type('quo.quotation'), mode: { kind: 'new' } }));
  f.render().find((n) => n.type === CustomerPicker)!.props.onChange({ id: 'c1', name: 'Sample School' });
  f.render().find((n) => n.type === ItemSearch)!.props.onPick({ id: 'it2', name: 'Cap', unit: 'pc' });
  await f.find('children', 'Record').props.onClick();
  expect(preview).toHaveBeenLastCalledWith('quo.quotation', { customerId: 'c1', validForDays: 15,
    lines: [{ itemId: 'it2', description: 'Cap', qty: 1, unit: 'pc', discountCents: 0 }], documentDiscountCents: 0 });
});
