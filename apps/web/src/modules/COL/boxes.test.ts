import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, id, invalid, recorder, type } from '../JO/entry-test.ts';
import { api, type CheckAtBank, type Me } from '../../api.ts';
import { CollectionForm } from './CollectionForm.tsx';
import { RefundForm } from './RefundForm.tsx';
import { DepositTransferForm } from './DepositTransferForm.tsx';
import { CreditMemoForm, CwtOnlyForm, ForfeitForm, WriteOffForm } from './CreditForms.tsx';
import { AddPdc, ChecksOnHand, PostDatedChecks, ReturnDialog } from './Checks.tsx';
import { ReasonDialog } from '../JO/ReasonDialog.tsx';
import { emptyCreditMemo, emptyCwtOnly, emptyForfeit, emptyWriteOff } from './credits.ts';
import { TenderRows } from './parts.tsx';
import { tenderFields } from './typing.ts';
import { useBoxes } from '../JO/boxes.ts';

afterEach(() => vi.restoreAllMocks());
const mode = { kind: 'new' } as const;
it('collection puts a bad CR number on its own box', () => {
  const f = form(() => CollectionForm({ type: type('col.collection'), mode }));
  change(f.field('CR number (from the booklet)'), '000'); blur(f.field('CR number (from the booklet)')); invalid(f, 'CR number (from the booklet)');
});
it('refund puts a short reason on its box', () => {
  const f = form(() => RefundForm({ type: type('col.refund'), mode }));
  change(f.field('Reason (at least 10 characters)'), 'short'); blur(f.field('Reason (at least 10 characters)')); invalid(f, 'Reason (at least 10 characters)');
});
it('refund preview and Record keep the source, trimmed reason and split cash values', async () => {
  const preview = vi.spyOn(api, 'preview').mockResolvedValue({ totalCents: 12550, issues: [] } as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: id(4) } as never);
  const f = form(() => RefundForm({ type: type('col.refund'), mode }), [[], { id: id(1), name: 'Sample' },
    { customerId: id(1), jobOrders: [], unappliedCents: 12550 }, undefined, '', 'unapplied', [{ cashPlaceId: '1', amount: '125.50', reference: ' Ref ' }], ' Customer requested a refund ']);
  f.find('children', 'Record').props.onClick(); await Promise.resolve();
  const input = { customerId: id(1), tenders: [{ cashPlaceId: 1, amountCents: 12550, reference: 'Ref' }], reason: 'Customer requested a refund' };
  expect(preview).toHaveBeenLastCalledWith('col.refund', input);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key'); expect(post).toHaveBeenLastCalledWith('col.refund', input, 12550, 'test-key');
});
it('deposit transfer marks bad amounts on Amount', () => {
  const f = form(() => DepositTransferForm({ type: type('col.deposit_transfer'), mode }));
  change(f.field('Amount'), 'oops'); blur(f.field('Amount')); invalid(f, 'Amount');
});
it('deposit transfer leaves the optional amount default and request sequence unchanged', async () => {
  const preview = vi.spyOn(api, 'preview').mockResolvedValue({ totalCents: 10000, issues: [] } as never);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: id(4) } as never);
  const f = form(() => DepositTransferForm({ type: type('col.deposit_transfer'), mode }), [{ id: id(1), name: 'Sample' },
    { customerId: id(1), held: [], jobOrders: [{ id: id(2), number: 'JO-2', status: 'posted', stage: 'open', stageLabel: 'Open', depositsHeldCents: 0, balanceDueCents: 10000 }], unappliedCents: 12550 },
    undefined, '', 'unapplied', id(2), '', ' Move balance ']);
  f.find('children', 'Record').props.onClick(); await Promise.resolve();
  const input = { customerId: id(1), toJobOrderId: id(2), amountCents: 10000, note: 'Move balance' };
  expect(preview).toHaveBeenLastCalledWith('col.deposit_transfer', input);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key'); expect(post).toHaveBeenLastCalledWith('col.deposit_transfer', input, 10000, 'test-key');
});
it.each([
  [CwtOnlyForm, 'col.cwt_only', 'Quarter on the 2307', '2026-Q9'],
  [CreditMemoForm, 'col.credit_memo', 'Why? (at least 10 characters)', 'short'],
  [WriteOffForm, 'col.write_off', 'Why is it written off? (at least 10 characters)', 'short'],
  [ForfeitForm, 'col.forfeit', 'Why is it kept? (at least 10 characters)', 'short'],
] as const)('%s places bad typing on its box', (screen, key, label, value) => {
  const f = form(() => screen({ type: type(key), mode })); change(f.field(label), value); blur(f.field(label)); invalid(f, label);
});
it('2307-only Record keeps the selected invoice, tax and quarter', () => {
  const f = form(() => CwtOnlyForm({ type: type('col.cwt_only'), mode }), [null, null, { ...emptyCwtOnly(), invoiceId: id(1), amount: '250.50', atc: 'WC160', period: '2026-q3', note: ' Certificate received ' }]);
  f.render()[0]!.props.onRecord(); expect(recorder.ask).toHaveBeenLastCalledWith({ invoiceId: id(1), cwtCents: 25050, atc: 'WC160', periodYear: 2026, periodQuarter: 3, note: 'Certificate received' }, []);
});
it('credit memo Record keeps form number leading zeros, amount and reason', () => {
  const f = form(() => CreditMemoForm({ type: type('col.credit_memo'), mode }), [null, null, { ...emptyCreditMemo(), invoiceId: id(1), kind: 'allowance', amount: '1120', formNumber: '0000000000000042', reason: ' Sample allowance approved ' }]);
  f.render()[0]!.props.onRecord(); expect(recorder.ask).toHaveBeenLastCalledWith({ invoiceId: id(1), kind: 'allowance', amountCents: 112000, formNumber: '0000000000000042', reason: 'Sample allowance approved' }, []);
});
it('write-off Record keeps the selected invoice and trimmed reason', () => {
  const f = form(() => WriteOffForm({ type: type('col.write_off'), mode }), [null, { ...emptyWriteOff(), invoiceId: id(1), reason: ' Sample debt uncollectible ' }]);
  f.render()[0]!.props.onRecord(); expect(recorder.ask).toHaveBeenLastCalledWith({ invoiceId: id(1), reason: 'Sample debt uncollectible' }, []);
});
it('forfeit Record keeps the selected job order, amount and reason', () => {
  const f = form(() => ForfeitForm({ type: type('col.forfeit'), mode }), [null, null, { ...emptyForfeit(), jobOrderId: id(1), amount: '5000', reason: ' Sample order abandoned ' }]);
  f.render()[0]!.props.onRecord(); expect(recorder.ask).toHaveBeenLastCalledWith({ jobOrderId: id(1), amountCents: 500000, reason: 'Sample order abandoned' }, []);
});
it('post-dated check shows an invalid check number on its box', () => {
  const f = form(() => AddPdc({ onAdded: () => undefined, onClose: () => undefined }));
  change(f.field('Check number'), 'bad/no'); blur(f.field('Check number')); invalid(f, 'Check number');
});
it('post-dated check Add keeps its selected jobs and trimmed check values', async () => {
  const add = vi.spyOn(api, 'addPdc').mockResolvedValue({} as never);
  const f = form(() => AddPdc({ onAdded: () => undefined, onClose: () => undefined }), [{ id: id(1), name: 'Sample' }, [], [id(2)],
    { bank: ' Sample Bank ', checkNumber: ' A-42 ', checkDate: '2026-10-10', amount: '250.50', note: ' Sample memo ' }]);
  await f.find('children', 'Add to the list').props.onClick(); expect(add).toHaveBeenLastCalledWith({ customerId: id(1), bank: 'Sample Bank', checkNumber: 'A-42', checkDate: '2026-10-10', amountCents: 25050, jobOrderIds: [id(2)], note: 'Sample memo' });
});
const me = { permissions: ['col.checks.deposit'] } as unknown as Me;
const checkList = { checks: [{ collectionId: id(1), lineNo: 1, checkNumber: '42', amountCents: 12550 }], totalCents: 12550, ledgerCents: null };
it('check deposit puts a bad bank selection on Bank', () => {
  const f = form(() => ChecksOnHand({ me }), [checkList]); change(f.field('Bank'), '0'); blur(f.field('Bank')); invalid(f, 'Bank');
});
it('check deposit keeps check references, bank and preview total through Record', async () => {
  const preview = vi.spyOn(api, 'checkDepositPreview').mockResolvedValue({ totalCents: 12550, issues: [] } as never);
  const post = vi.spyOn(api, 'checkDeposit').mockResolvedValue({ count: 1, transfer: { number: 'TRF-1' } } as never);
  vi.spyOn(api, 'checksOnHand').mockResolvedValue(checkList as never);
  const f = form(() => ChecksOnHand({ me }), [checkList, [], [], new Set([`${id(1)}:1`]), '2']);
  f.find('children', 'Deposit the ticked checks').props.onClick(); await Promise.resolve();
  expect(preview).toHaveBeenLastCalledWith([{ collectionId: id(1), lineNo: 1 }], 2);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('test-key'); expect(post).toHaveBeenLastCalledWith([{ collectionId: id(1), lineNo: 1 }], 2, 12550, 'test-key');
});
const returned = { collectionId: id(1), collectionNumber: 'CR-1', lineNo: 1, amountCents: 10000, checkNumber: '42', customerName: 'Sample', cashPlaceName: 'Sample bank' } as CheckAtBank;
it('returned-check charges put bad typing on the charge box', () => {
  const f = form(() => ReturnDialog({ check: returned, onDone: () => undefined, onClose: () => undefined }));
  change(f.field('Bank charge for the returned check'), 'oops'); blur(f.field('Bank charge for the returned check')); invalid(f, 'Bank charge for the returned check');
});
it('returned-check Record keeps the charge, reason, cancel choice and one idempotency key', async () => {
  const post = vi.spyOn(api, 'checkReturn').mockResolvedValue({ summary: 'Returned', transfer: { number: 'TRF-1' }, cancelled: true } as never);
  const f = form(() => ReturnDialog({ check: returned, onDone: () => undefined, onClose: () => undefined }));
  change(f.field('Bank charge for the returned check'), '250.50'); await f.render()[0]!.props.onConfirm('Drawn against insufficient funds');
  expect(post).toHaveBeenLastCalledWith({ collectionId: id(1), lineNo: 1, chargeCents: 25050, reason: 'Drawn against insufficient funds', cancelCollection: true }, expect.any(String));
});
it('tender errors keep their nested box; check inputs remain visible and disabled for a cash place', () => {
  const rows = [{ cashPlaceId: '1', amount: 'oops', reference: '' }];
  const f = form(() => TenderRows({ rows, onChange: () => undefined, places: [{ id: 1, kind: 'cash', name: 'Sample cash' }] as never, question: 'Where?', boxes: useBoxes(tenderFields(rows), JSON.stringify(rows), {}, true) }));
  invalid(f, 'Amount'); expect(f.field('Check number').props.disabled).toBe(true); expect(f.field('Bank of the check').props.disabled).toBe(true);
});
it('voiding a post-dated check uses the bounded reason form and sends the same id and reason', async () => {
  const post = vi.spyOn(api, 'voidPdc').mockResolvedValue({} as never); vi.spyOn(api, 'pdcs').mockResolvedValue([]);
  const f = form(() => PostDatedChecks({ me: { permissions: ['col.pdc.manage'] } as unknown as Me }), [[], false, { id: id(1), checkNumber: '42' }]);
  const dialog = f.render().find((n) => n.type === ReasonDialog)!; expect(dialog.props.max).toBe(300);
  await dialog.props.onConfirm('Customer replaced this check'); expect(post).toHaveBeenLastCalledWith(id(1), 'Customer replaced this check');
});
