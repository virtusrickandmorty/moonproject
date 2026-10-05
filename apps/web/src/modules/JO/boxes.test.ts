import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, id, invalid, recorder, type } from './entry-test.ts';
import { api, ApiError, type JoStatus, type Me } from '../../api.ts';
import { AddCustomer, JobOrderForm, RosterGrid } from './JobOrderForm.tsx';
import { OpeningJobOrderForm } from './OpeningForm.tsx';
import { DpInvoiceForm } from './DpInvoiceForm.tsx';
import { InvoiceRecordForm } from './InvoiceRecordForm.tsx';
import { ReleaseForm } from './ReleaseForm.tsx';
import { ReasonDialog } from './ReasonDialog.tsx';
import { emptyJo, emptyJoLine } from './forms.ts';
import { emptyOpening } from './opening.ts';
import { boxRefusals, generalRefusal, rowFields, useBoxes } from './boxes.ts';
import { Field } from '../../components/ui.tsx';
import { createElement } from 'react';

afterEach(() => vi.restoreAllMocks());
const mode = { kind: 'new' } as const;
it('job-order due days stay quiet until edited and blurred, then mark their own box', () => {
  const f = form(() => JobOrderForm({ type: type('jo.job_order'), mode }));
  expect(f.find('label', 'Payment terms').props.error).toBeUndefined();
  change(f.field('Due in (days)'), '366'); blur(f.field('Due in (days)')); invalid(f, 'Due in (days)');
});
it('job-order Record marks an empty description, and accepts the server quantity limit unchanged', () => {
  const f = form(() => JobOrderForm({ type: type('jo.job_order'), mode }), [{ ...emptyJo(), customer: { id: id(1), name: 'Sample school' }, paymentTerms: 'full',
    lines: [{ ...emptyJoLine(), description: 'Jersey', qty: '10000', price: '1' }] }]);
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ customerId: id(1), dueInDays: 15, priority: 'normal', paymentTerms: 'full',
    lines: [{ kind: 'made_to_order', description: 'Jersey', qty: 10000, unitPriceCents: 100, discountCents: 0, roster: [] }] }, []);
  change(f.find('aria-label', 'Line 1 description'), ''); f.find('children', 'Record').props.onClick(); invalid(f, 'Description');
});
it('opening due date rejects a nonexistent day on its box', () => {
  const f = form(() => OpeningJobOrderForm({ type: type('jo.opening_job_order'), mode }));
  change(f.field('Due date'), '2026-02-30'); blur(f.field('Due date')); invalid(f, 'Due date');
});
it('opening Record keeps balances, old references, customer and cut-over date', () => {
  const f = form(() => OpeningJobOrderForm({ type: type('jo.opening_job_order'), mode }), [{ ...emptyOpening(), oldNumber: ' OLD-4 ', dueDate: '2026-10-01',
    paymentTerms: 'cod', deposits: '50', depositsMemo: ' Old CR ', receivable: '250.50', oldInvoices: ' 0005 ' }, { id: id(1), name: 'Sample' }, { cutoverDate: '2026-10-05' }]);
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ customerId: id(1), oldNumber: 'OLD-4', dueDate: '2026-10-01', priority: 'normal', paymentTerms: 'cod',
    lines: [], depositsCents: 5000, depositsMemo: 'Old CR', receivableCents: 25050, oldInvoices: '0005' }, [], '2026-10-05');
});
it.each([[InvoiceRecordForm, 'jo.invoice_record'], [DpInvoiceForm, 'jo.dp_invoice']] as const)('%s shows a wrong booklet number on its box', (screen, key) => {
  const f = form(() => screen({ type: type(key), mode }));
  change(f.field('Invoice number (from the booklet)'), '000'); blur(f.field('Invoice number (from the booklet)')); invalid(f, 'Invoice number (from the booklet)');
});
it('downpayment Record keeps the amount, note and booklet number', () => {
  const info = { dpInvoices: [], jobOrder: { id: id(1), number: 'JO-1' }, depositVat: { mode: 'C', setting: 'C' }, requiredDownpaymentCents: 10000, dpInvoicedCents: 0, depositsHeldCents: 0 };
  const f = form(() => DpInvoiceForm({ type: type('jo.dp_invoice'), mode }), [info, '125.50', ' 00042 ', ' Booklet 2 ']);
  f.find('children', 'Record').props.onClick();
  expect(recorder.ask).toHaveBeenLastCalledWith({ jobOrderId: id(1), invoiceNumber: '00042', amountCents: 12550, note: 'Booklet 2' }, []);
});
it('release claimant problems sit under Claimed by and unused override boxes are disabled', () => {
  const f = form(() => ReleaseForm({ type: type('jo.release'), mode, me: { permissions: ['jo.release_override', 'jo.release_with_balance'] } as unknown as Me }));
  expect(f.field("Owner's reason to release it now").props.disabled).toBe(true);
  expect(f.field('Pay within (days)').props.disabled).toBe(true);
  change(f.field('Claimed by'), 'x'.repeat(121)); blur(f.field('Claimed by')); invalid(f, 'Claimed by');
});
it('release named preview refusals return to the corresponding box without opening confirmation', async () => {
  vi.spyOn(api, 'joStatus').mockResolvedValue({ stage: 'ready', stageLabel: 'Ready', jobOrder: { number: 'JO-1' }, money: { balanceDueCents: 0 },
    lines: [{ lineNo: 1, qty: 1, leftQty: 1, releasedQty: 0 }] } as JoStatus);
  vi.spyOn(api, 'joReleasePreview').mockResolvedValue({ release: { doc: {}, issues: [{ level: 'error', field: 'claimedBy', message: 'Use the claimant’s full name.' }] } } as never);
  const f = form(() => ReleaseForm({ type: type('jo.release'), mode, me: { permissions: [] } as unknown as Me }));
  await f.render().find((n) => n.props.onChange && n.props.value === null)!.props.onChange({ id: id(1) });
  change(f.field('Claimed by'), 'Sample'); f.find('aria-checked', false).props.onClick(); change(f.field('Invoice number (from the booklet)'), '1');
  f.find('children', 'Record').props.onClick(); await Promise.resolve(); invalid(f, 'Claimed by');
  expect(f.render().some((n) => n.props.onRecord)).toBe(false);
});
it('inline customer errors are boxed and good names keep their trimmed request', async () => {
  const add = vi.spyOn(api, 'addCustomer').mockResolvedValue({ id: id(1), display_name: 'Sample', duplicateWarnings: [] } as never);
  const f = form(() => AddCustomer({ onAdded: () => undefined, onClose: () => undefined }));
  change(f.field("New customer's name"), 'x'.repeat(201)); blur(f.field("New customer's name")); invalid(f, "New customer's name");
  change(f.field("New customer's name"), ' Sample '); f.find('children', 'Add customer').props.onClick(); await Promise.resolve();
  expect(add).toHaveBeenLastCalledWith({ kind: 'organization', displayName: 'Sample' });
});
it('roster paste errors mark the pasted box; good rows are appended without changing their values', () => {
  const onChange = vi.fn();
  const f = form(() => RosterGrid({ boxes: useBoxes({}, ''), index: 0, n: 1, line: emptyJoLine(), people: null, sizes: ['M'], onChange }));
  f.find('children', 'Paste from Excel').props.onClick(); change(f.field('Pasted rows'), 'Sample\tM\tSAM\t7\tx');
  f.find('children', 'Add these').props.onClick(); invalid(f, 'Pasted rows'); expect(onChange).not.toHaveBeenCalled();
  change(f.field('Pasted rows'), 'Sample\tM\tSAM\t7\t2'); f.find('children', 'Add these').props.onClick();
  expect(onChange).toHaveBeenLastCalledWith([{ personId: '', name: 'Sample', sizeMode: 'preset', size: 'M', jerseyName: 'SAM', jerseyNumber: '7', qty: '2' }]);
});
it('reason dialogs box short reasons and keep the existing trimmed confirmation value', async () => {
  const confirm = vi.fn();
  const f = form(() => ReasonDialog({ title: 'Edit sample', explain: '', confirmLabel: 'Continue', onConfirm: confirm, onClose: () => undefined }));
  change(f.field('Reason (at least 10 characters)'), 'short'); blur(f.field('Reason (at least 10 characters)')); invalid(f, 'Reason (at least 10 characters)');
  change(f.field('Reason (at least 10 characters)'), ' Correct the sample roster '); await f.find('children', 'Continue').props.onClick();
  expect(confirm).toHaveBeenLastCalledWith('Correct the sample roster');
});
it('refusals keep nested paths and only general problems belong above the button', () => {
  const e = new ApiError('INVALID_INPUT', 'Check your entries', 400, [{ field: 'payment.tenders.1.check.number', message: 'Bad check number' }]);
  expect(boxRefusals(e)).toEqual({ 'tenders.1.check.number': 'Bad check number' }); expect(generalRefusal(e)).toBe('');
  expect(generalRefusal(new Error('Connection lost'))).toBe('Connection lost');
});
it('a live refusal stays quiet on a pristine box, appears after blur, and is cleared when its input changes', () => {
  let boxes: ReturnType<typeof useBoxes>;
  let key = 'old';
  const f = form(() => { boxes = useBoxes({}, key); return createElement(Field, { label: 'Check number', error: boxes.error('tenders.1.check.number'),
    children: createElement('input', boxes.box('tenders.1.check.number')) }); });
  f.render(); boxes!.capture(new ApiError('CHECK', 'Check entries', 422, [{ field: 'tenders.1.check.number', message: 'Check number is already used.' }]));
  expect(f.find('label', 'Check number').props.error).toBeUndefined();
  f.field('Check number').props.onInput(); blur(f.field('Check number')); invalid(f, 'Check number');
  key = 'new'; expect(f.find('label', 'Check number').props.error).toBeUndefined();
});
it('request row refusals follow the used screen rows when empty rows were omitted', () => {
  expect(rowFields({ 'lines.0.roster.1.size': 'Pick a size.', 'lines.1.qty': 'Too many pieces.' }, 'lines', [1, 3]))
    .toEqual({ 'lines.1.roster.1.size': 'Pick a size.', 'lines.3.qty': 'Too many pieces.' });
});
it('check reason dialogs enforce the same 300-character limit and preserve accepted reason text', async () => {
  const confirm = vi.fn(); const f = form(() => ReasonDialog({ title: 'Void check', explain: '', max: 300, confirmLabel: 'Void it', onConfirm: confirm, onClose: () => undefined }));
  change(f.field('Reason (at least 10 characters)'), 'x'.repeat(301)); blur(f.field('Reason (at least 10 characters)')); invalid(f, 'Reason (at least 10 characters)');
  change(f.field('Reason (at least 10 characters)'), ' Customer replaced this check '); await f.find('children', 'Void it').props.onClick(); expect(confirm).toHaveBeenLastCalledWith('Customer replaced this check');
});
