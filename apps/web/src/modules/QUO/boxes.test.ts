import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, invalid, type } from '../JO/entry-test.ts';
import { MoneyField, QuotationForm } from './QuotationForm.tsx';
afterEach(() => vi.restoreAllMocks());
it('quotation validity errors mark their own box and an unused override reason is disabled', () => {
  const f = form(() => QuotationForm({ type: type('quo.quotation'), mode: { kind: 'new' } }));
  expect(f.field('Override reason').props.disabled).toBe(true);
  change(f.field('Valid for days'), '366'); blur(f.field('Valid for days')); invalid(f, 'Valid for days');
});
it('quotation amounts preserve good centavos and represent bad typing as invalid instead of silently retaining the old amount', () => {
  const onValue = vi.fn(); const f = form(() => MoneyField({ value: 100, onValue }));
  change(f.render()[0]!, '125.50'); expect(onValue).toHaveBeenLastCalledWith(12550);
  change(f.render()[0]!, 'oops'); expect(onValue).toHaveBeenLastCalledWith(NaN); expect(f.render()[0]!.props.value).toBe('oops');
});
