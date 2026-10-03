import { afterEach, expect, it, vi } from 'vitest';
import { change, form, type } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { CustomerPicker } from '../COL/parts.tsx';
import { ItemSearch } from '../JO/parts.tsx';
import { QuotationForm } from './QuotationForm.tsx';

afterEach(() => vi.restoreAllMocks());
it('quotation search picks preserve the exact input and keep active discount/price exceptions visible', async () => {
  const preview = vi.spyOn(api, 'preview').mockResolvedValue({ totalCents: 24000, issues: [] } as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'quo1' } as never);
  const f = form(() => QuotationForm({ type: type('quo.quotation'), mode: { kind: 'new' } }));
  f.render().find((n) => n.type === CustomerPicker)!.props.onChange({ id: 'c1', name: 'Sample School' });
  f.render().find((n) => n.type === ItemSearch)!.props.onPick({ id: 'it1', name: 'Jersey', unit: 'pc' });
  expect(f.render().find((n) => n.type === CustomerPicker)!.props.value).toEqual({ id: 'c1', name: 'Sample School' });
  expect(f.find('children', 'Change item')).toBeDefined();
  change(f.field('Quantity'), '2');
  f.field('Line discount').props.onValue(1000);
  f.field('Override price').props.onValue(12500);
  change(f.field('Override reason'), ' Sample price ');
  expect(f.find('title', 'Add a line discount').props.active).toBe(true);
  expect(f.find('title', 'Change the usual price').props.active).toBe(true);
  expect(f.find('title', 'Add a document discount').props.active).toBe(false);
  await f.find('children', 'Record').props.onClick();
  const input = { customerId: 'c1', validForDays: 15, lines: [{ itemId: 'it1', description: 'Jersey', qty: 2, unit: 'pc', discountCents: 1000,
    overrideUnitPriceCents: 12500, overrideReason: 'Sample price' }], documentDiscountCents: 0 };
  expect(preview).toHaveBeenLastCalledWith('quo.quotation', input);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key');
  expect(post).toHaveBeenLastCalledWith('quo.quotation', input, 24000, 'test-key');
});
