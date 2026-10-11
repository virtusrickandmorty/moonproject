import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { change, form, recorder, type } from './entry-test.ts';
import { api, type JoStatus, type Me } from '../../api.ts';
import { JobOrderForm } from './JobOrderForm.tsx';
import { ReleaseForm } from './ReleaseForm.tsx';
import { InvoiceRecordForm } from './InvoiceRecordForm.tsx';
import { emptyJo, emptyJoLine } from './forms.ts';
import { Exception, SalesActions } from './entry.tsx';
import { PrintedDateField } from '../../generic/PrintedDate.tsx';

afterEach(() => vi.restoreAllMocks());
const mode = { kind: 'new' } as const;

it('job order Record keeps the exact input, including discount and a manually changed price', () => {
  const f = form(() => JobOrderForm({ type: type('jo.job_order'), mode }), [{ ...emptyJo(), customer: { id: 'c1', name: 'Sample school' }, paymentTerms: 'dp50',
    lines: [{ ...emptyJoLine(), description: ' Jerseys ', qty: '2', price: '120.00', listCents: 15000, discount: '10.00' }] }]);
  // The item is in the breakdown; Edit puts it back in the item form, Update item puts the change back.
  f.find('aria-label', 'Edit item 1').props.onClick();
  expect(f.find('aria-label', 'Item price each').props.value).toBe('120.00');
  expect(f.find('aria-label', 'Item discount').props.value).toBe('10.00');
  change(f.find('aria-label', 'Item price each'), 'abc');
  f.find('children', 'Record').props.onClick(); // an incomplete change stops Record, which sends nothing
  expect(recorder.fail).toHaveBeenCalled();
  expect(recorder.ask).not.toHaveBeenCalled();
  change(f.find('aria-label', 'Item price each'), '125.00');
  f.find('children', 'Update item').props.onClick();
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ customerId: 'c1', dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description: 'Jerseys', qty: 2, unitPriceCents: 12500, discountCents: 1000, roster: [] }] }, []);
  expect(f.render().findIndex((n) => n.props.title === 'So far')).toBeLessThan(f.render().findIndex((n) => n.type === SalesActions));
});

it('job order items join the breakdown from the item form, are checked first, and come off with Remove', () => {
  const f = form(() => JobOrderForm({ type: type('jo.job_order'), mode }), [{ ...emptyJo(), lines: [], customer: { id: 'c1', name: 'Sample school' }, paymentTerms: 'full' }]);
  f.find('children', '+ Add to order').props.onClick(); // nothing typed: refused with the item's own words
  expect(f.render().some((n) => n.props.list?.includes('Pick an item from the price list or say what is made.') && n.props.show === true)).toBe(true);
  change(f.find('aria-label', 'Item description'), 'Team shorts');
  change(f.find('aria-label', 'Item pieces'), '3');
  change(f.find('aria-label', 'Item price each'), '200.00');
  f.find('children', '+ Add to order').props.onClick();
  expect(f.find('aria-label', 'Item description').props.value).toBe(''); // the form is ready for the next item
  change(f.find('aria-label', 'Item description'), 'Caps');
  change(f.find('aria-label', 'Item price each'), '50.00');
  f.find('children', '+ Add to order').props.onClick();
  f.find('aria-label', 'Remove item 1').props.onClick();
  // A complete item still in the form goes in with Record, as if Add to order was pressed.
  change(f.find('aria-label', 'Item description'), 'Socks');
  change(f.find('aria-label', 'Item price each'), '80.00');
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ customerId: 'c1', dueInDays: 15, priority: 'normal', paymentTerms: 'full',
    lines: [{ kind: 'made_to_order', description: 'Caps', qty: 1, unitPriceCents: 5000, discountCents: 0, roster: [] },
      { kind: 'made_to_order', description: 'Socks', qty: 1, unitPriceCents: 8000, discountCents: 0, roster: [] }] }, []);
});

it('release preview and final Record keep the same pieces, claimant and booklet input', async () => {
  const status = { stage: 'ready', stageLabel: 'Ready', jobOrder: { number: 'JO-1', dueDate: '2026-10-10' }, money: { balanceDueCents: 0 },
    lines: [{ lineNo: 1, description: 'Jersey', qty: 4, releasedQty: 1, leftQty: 3 }] } as JoStatus;
  vi.spyOn(api, 'joStatus').mockResolvedValue(status);
  const preview = vi.spyOn(api, 'joReleasePreview').mockResolvedValue({ release: { totalCents: 60000 } } as never);
  const post = vi.spyOn(api, 'joRelease').mockResolvedValue({ release: { id: 'rel1' } } as never);
  const f = form(() => ReleaseForm({ type: type('jo.release'), mode, me: { permissions: [] } as unknown as Me }));
  await f.render().find((n) => typeof n.props.onChange === 'function' && n.props.value === null)!.props.onChange({ id: 'jo1' });
  change(f.find('aria-label', 'Pieces of line 1'), '2');
  change(f.field('Claimed by'), ' Sample Person ');
  f.find('aria-checked', false).props.onClick();
  change(f.field('Invoice number (from the booklet)'), ' 0012 ');
  await f.find('children', 'Record').props.onClick();
  const release = { jobOrderId: 'jo1', lines: [{ lineNo: 1, qty: 2 }], claimedBy: 'Sample Person', idSeen: 'government_id' };
  expect(preview).toHaveBeenLastCalledWith(release);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key');
  expect(post).toHaveBeenLastCalledWith({ release, invoice: { invoiceNumber: '0012' } }, 60000, 'test-key');
});

it('invoice record keeps release, trimmed booklet number and note in Record', async () => {
  vi.spyOn(api, 'joReleaseInfo').mockResolvedValue({ release: { id: 'rel1', number: 'REL-1', status: 'posted', invoice: null }, lines: [], booklet: {}, depositAppliedCents: 0 } as never);
  const f = form(() => InvoiceRecordForm({ type: type('jo.invoice_record'), mode }));
  await f.render().find((n) => n.props.preset === '')!.props.onChange({ id: 'rel1' });
  change(f.field('Invoice number (from the booklet)'), ' 0042 ');
  change(f.field('Note'), ' Booklet 3 ');
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ releaseId: 'rel1', invoiceNumber: '0042', note: 'Booklet 3' }, [], undefined);
  // The date on the booklet invoice goes with it (blank is today); a date that does not exist stops it here.
  f.render().find((n) => n.type === PrintedDateField)!.props.onChange('2026-09-20');
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ releaseId: 'rel1', invoiceNumber: '0042', note: 'Booklet 3' }, [], '2026-09-20');
  f.render().find((n) => n.type === PrintedDateField)!.props.onChange('2026-09-31');
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith(expect.anything(), ['Type the date printed on the document like 2026-09-30, or leave it empty for today.'], undefined);
});

it('unused exceptions start folded, active exceptions stay open, and the phone action includes the total', () => {
  const f = form(() => Exception({ title: 'Add a line discount', active: false, children: 'Fields' }));
  expect(f.render()[0]!.props.open).toBe(false);
  f.render()[0]!.props.onToggle({ currentTarget: { open: true } });
  expect(f.render()[0]!.props.open).toBe(true);
  const active = form(() => Exception({ title: 'Change the usual price', active: true, children: 'Fields' }));
  const target = { open: false };
  active.render()[0]!.props.onToggle({ currentTarget: target });
  expect(target.open).toBe(true);
  const html = renderToStaticMarkup(createElement(SalesActions, { total: 12500, children: 'Record' }));
  expect(html).toContain('₱125.00');
  expect(html).toContain('fixed inset-x-0 bottom-0');
  expect(html).toContain('sm:static');
});
