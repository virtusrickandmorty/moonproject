import { afterEach, it, vi } from 'vitest';
import { blur, change, form, invalid, type } from '../JO/entry-test.ts';
import { QuickSaleForm } from './QuickSaleForm.tsx';
afterEach(() => vi.restoreAllMocks());
it('quick-sale quantity errors mark Qty after editing and leaving it', () => {
  const f = form(() => QuickSaleForm({ type: type('qs.sale'), mode: { kind: 'new' } }));
  change(f.find('aria-label', 'What'), 'Hem trousers'); change(f.find('aria-label', 'Qty'), '10001'); blur(f.find('aria-label', 'Qty')); invalid(f, 'Qty');
});
