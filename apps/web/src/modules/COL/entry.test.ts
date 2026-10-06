import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { change, form, type } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { CollectionForm } from './CollectionForm.tsx';
import { PrintedDateField } from '../../generic/PrintedDate.tsx';
import { TenderRows } from './parts.tsx';

afterEach(() => vi.restoreAllMocks());
it('collection keeps cash, allocations and active 2307 values through preview and Record', async () => {
  const preview = vi.spyOn(api, 'preview').mockResolvedValue({ totalCents: 10000 } as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'col1' } as never);
  const f = form(() => CollectionForm({ type: type('col.collection'), mode: { kind: 'new' } }), [[], null,
    { customerId: 'c1', jobOrders: [{ id: 'jo1', number: 'JO-1', dueDate: '2026-10-10', balanceDueCents: 10000 }], quickSales: [], unappliedCents: 0 }]);
  f.render().find((n) => n.props.value === null && n.props.onChange)!.props.onChange({ id: 'c1', name: 'Sample School' });
  change(f.field('CR number (from the booklet)'), ' 0055 ');
  f.find('question', 'Where did the money go?').props.onChange([{ cashPlaceId: '1', amount: '95.00', reference: '' }]);
  expect(f.find('title', 'Customer withheld tax (2307)').props.active).toBe(false);
  change(f.field('Amount withheld'), '5.00');
  change(f.field('Tax code (ATC)'), 'WC158');
  change(f.field('2307 certificate'), 'received');
  expect(f.find('title', 'Customer withheld tax (2307)').props.active).toBe(true);
  const rendered = f.render();
  expect(rendered.findIndex((n) => n.props.title === 'What is it for?')).toBeLessThan(rendered.findIndex((n) => n.props.title === 'Where did the money go?'));
  await f.find('children', 'Record').props.onClick();
  const input = { customerId: 'c1', crNumber: '0055', applications: [{ jobOrderId: 'jo1', amountCents: 10000 }], tenders: [{ cashPlaceId: 1, amountCents: 9500 }],
    withholding: { cwtCents: 500, atc: 'WC158', certificate: 'received' } };
  expect(preview).toHaveBeenLastCalledWith('col.collection', input, undefined);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key');
  expect(post).toHaveBeenLastCalledWith('col.collection', input, 10000, 'test-key', undefined);
  // The date on the CR goes with the preview and the record (blank is today).
  f.render().find((n) => n.type === PrintedDateField)!.props.onChange('2026-09-20');
  await f.find('children', 'Record').props.onClick();
  expect(preview).toHaveBeenLastCalledWith('col.collection', input, '2026-09-20');
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key-2');
  expect(post).toHaveBeenLastCalledWith('col.collection', input, 10000, 'test-key-2', '2026-09-20');
});

it('payment cards retain visible labels for amounts, references and checks', () => {
  const html = renderToStaticMarkup(createElement(TenderRows, { rows: [{ cashPlaceId: '1', amount: '10.00', reference: '' }], onChange: () => undefined,
    places: [{ id: 1, kind: 'checks', name: 'Checks on hand' }] as never, question: 'Where did the money go?' }));
  for (const label of ['Amount', 'Reference', 'Check number', 'Bank of the check', 'Date on the check']) expect(html).toContain(`>${label}<`);
  expect(html).toContain('sm:grid-cols-[10rem_minmax(0,1fr)_auto]');
});
