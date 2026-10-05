import { afterEach, expect, it, vi } from 'vitest';
import { change, form, type } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { QuickSaleForm } from './QuickSaleForm.tsx';

afterEach(() => vi.restoreAllMocks());
it('quick sale keeps the exact sale and payment body through preview and Record', async () => {
  const preview = vi.spyOn(api, 'qsPreview').mockResolvedValue({ totalCents: 24000 } as never);
  const post = vi.spyOn(api, 'qsRecord').mockResolvedValue({ sale: { id: 'sale1' } } as never);
  const f = form(() => QuickSaleForm({ type: type('qs.sale'), mode: { kind: 'new' } }));
  f.render().find((n) => n.props.value === null && n.props.onChange)!.props.onChange({ id: 'c1', name: 'Walk-in' });
  change(f.find('aria-label', 'What'), ' Hem trousers ');
  change(f.find('aria-label', 'Qty'), '2');
  change(f.find('aria-label', 'Price each'), '125.00');
  expect(f.find('title', 'Add a line discount').props.active).toBe(false);
  change(f.find('aria-label', 'Discount'), '10.00');
  expect(f.find('title', 'Add a line discount').props.active).toBe(true);
  change(f.field('Invoice number (from the booklet)'), ' 0011 ');
  change(f.field('CR number (from the booklet)'), ' 0022 ');
  f.find('question', 'Where did the money go?').props.onChange([{ cashPlaceId: '1', amount: '', reference: ' Ref-1 ' }]);
  await f.find('children', 'Record').props.onClick();
  const body = { sale: { customerId: 'c1', invoiceNumber: '0011', lines: [{ kind: 'service', description: 'Hem trousers', qty: 2, unitPriceCents: 12500, discountCents: 1000 }] },
    payment: { crNumber: '0022', tenders: [{ cashPlaceId: 1, amountCents: 24000, reference: 'Ref-1' }] } };
  expect(preview).toHaveBeenLastCalledWith(body);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key');
  expect(post).toHaveBeenLastCalledWith(body, 24000, 'test-key');
});
