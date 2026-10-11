import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { change, form, type } from './entry-test.ts';
import { api, type GovLoan, type Me, type PayEmployee, type PayRunDoc, type PayThirteenthDoc, type Preview } from '../../api.ts';
import { RunForm } from './RunForm.tsx';
import { ThirteenthForm } from './ThirteenthForm.tsx';
import { GovLoans } from './Loans.tsx';
import { YearEndPage } from './YearEnd.tsx';
import { PayDetails, PayTotal, ThirteenthCalculation } from './entry.tsx';
import { runView, thirteenthView } from './views.tsx';

afterEach(() => vi.restoreAllMocks());
const mode = { kind: 'new' } as const;
const me = { permissions: ['pay.yearend.run', 'pay.loans.manage'] } as Me;
const person = { employeeId: 'e1', name: 'Sample Tailor', lines: [{ lineNo: 1, kind: 'allowance', description: 'Rice allowance', qty: 1, amountCents: 25000 }],
  grossCents: 100000, netCents: 90000, sssEeCents: 10000, phicEeCents: 0, hdmfEeCents: 0, wtaxCents: 0, caCents: 0,
  sssErCents: 10000, sssEcCents: 1000, phicErCents: 0, hdmfErCents: 0, thirteenthCents: 8333,
  loans: [{ loanId: 'l1', kind: 'SSS_SALARY', loanNo: '123-45', dueCents: 5000, amountCents: 0, balanceAfterCents: 10000 }] } as PayEmployee;
const run = { employees: [person], grossCents: 100000, netCents: 90000 } as PayRunDoc;
const thirteenth = { employees: [{ employeeId: 'e1', name: 'Sample Tailor', basicCents: 1200000, earlierBasicCents: 0, dueCents: 100000, accruedCents: 99996,
  amountCents: 110000, wtaxCents: 10000, netCents: 100000 }], totalCents: 110000, netCents: 100000 } as PayThirteenthDoc;
const preview = { totalCents: 100000, issues: [], summary: 'Sample calculation', doc: run } as Preview;

it('payroll preview and Record keep exact inputs, overrides, reasons, year-end flags and book date', async () => {
  const pre = vi.spyOn(api, 'preview').mockResolvedValue(preview);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'run1' } as never);
  const f = form(() => RunForm({ type: type('pay.run'), mode, me }), ['WEEKLY_PIECE', [{ periodStart: '2026-12-21', periodEnd: '2026-12-26', bookOn: '2026-12-26' }],
    '2026-12-21', [{ employeeId: 'e1', kind: 'allowance', amount: '250', reason: ' Rice allowance ' }], { e1: '0' }, { e2: ' On leave ' },
    { l1: { amount: '0', reason: ' Already paid ' } }, true, true, null, false, '', run, { e1: 'Sample Tailor' }], preview);
  expect(f.find('title', 'Deductions and changes').props.active).toBe(true);
  expect(f.find('title', 'Add allowances or adjustments').props.active).toBe(true);
  change(f.find('aria-label', 'Amount'), '275.50');
  f.find('children', 'Record').props.onClick();
  await Promise.resolve();
  const expected = { payGroup: 'WEEKLY_PIECE', periodStart: '2026-12-21', lines: [{ employeeId: 'e1', kind: 'allowance', amountCents: 27550, reason: 'Rice allowance' }],
    advances: [{ employeeId: 'e1', amountCents: 0 }], skip: [{ employeeId: 'e2', reason: 'On leave' }], loans: [{ loanId: 'l1', amountCents: 0, reason: 'Already paid' }], yearEnd: true, unusedLeave: true };
  expect(pre).toHaveBeenLastCalledWith('pay.run', expected, '2026-12-26');
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('key');
  expect(post).toHaveBeenLastCalledWith('pay.run', expected, preview.totalCents, 'key', '2026-12-26');
  expect(f.render().filter((n) => n.type === 'section')).toHaveLength(1);
  expect(f.render().some((n) => n.type === 'table')).toBe(false);
  expect(renderToStaticMarkup(f.find('title', 'Review pay'))).toContain('₱250.00');
});

it('13th-month preview and Record keep changed amounts, exclusions and the separated employee', async () => {
  const pre = vi.spyOn(api, 'preview').mockResolvedValue(preview);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'th1' } as never);
  const f = form(() => ThirteenthForm({ type: type('pay.thirteenth'), mode }), ['SEMI_MONTHLY', { years: [2026], recorded: [] }, 2026,
    { e1: { amount: '1100', reason: ' Includes earlier pay ' } }, { e2: ' Paid separately ' }, 'e1', null, false, '', thirteenth, { e1: 'Sample Tailor' }]);
  expect(f.find('title', 'Change this amount').props.active).toBe(true);
  change(f.find('aria-label', 'Sample Tailor 13th-month amount'), '1,200.50');
  f.find('children', 'Record').props.onClick();
  await Promise.resolve();
  const expected = { payGroup: 'SEMI_MONTHLY', year: 2026, amounts: [{ employeeId: 'e1', amountCents: 120050, reason: 'Includes earlier pay' }],
    skip: [{ employeeId: 'e2', reason: 'Paid separately' }], employeeId: 'e1' };
  expect(pre).toHaveBeenLastCalledWith('pay.thirteenth', expected);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('key');
  expect(post).toHaveBeenLastCalledWith('pay.thirteenth', expected, preview.totalCents, 'key');
  expect(f.render().findIndex((n) => n.props.label === 'To pay now')).toBeLessThan(f.render().findIndex((n) => n.type === ThirteenthCalculation));
});

it('payroll and 13th-month Record retain required reason checks', () => {
  const pre = vi.spyOn(api, 'preview');
  const payroll = form(() => RunForm({ type: type('pay.run'), mode }), ['SEMI_DAILY', [], '2026-09-16', [], {}, { e1: 'x' }]);
  payroll.find('children', 'Record').props.onClick();
  expect(pre).not.toHaveBeenCalled();
  const th = form(() => ThirteenthForm({ type: type('pay.thirteenth'), mode }), ['SEMI_MONTHLY', { years: [2026], recorded: [] }, 2026, { e1: { amount: '100', reason: '' } }]);
  th.find('children', 'Record').props.onClick();
  expect(pre).not.toHaveBeenCalled();
});

it('government-loan registration and editing retain exact amounts, fields and version checks', async () => {
  const add = vi.spyOn(api, 'addGovLoan').mockResolvedValue({} as never);
  const update = vi.spyOn(api, 'updateGovLoan').mockResolvedValue({} as never);
  const outer = form(() => GovLoans({ me }));
  const newNode = outer.render().find((n) => typeof n.type === 'function' && n.type.name === 'NewLoan')!;
  const f = form(() => (newNode.type as Function)({ ...newNode.props, onSaved: async () => undefined }));
  for (const [label, value] of [['Employee', 'e1'], ['Loan number', ' 123-45 '], ['Monthly deduction', '1,500.25'], ['First month deducted', '2026-10'], ['Last month deducted', '2027-09'], ['Note (optional)', ' Agency statement ']]) change(f.field(label!), value!);
  await f.find('children', 'Register loan').props.onClick();
  expect(add).toHaveBeenLastCalledWith({ employeeId: 'e1', kind: 'SSS_SALARY', loanNo: '123-45', amortizationCents: 150025, firstMonth: '2026-10', lastMonth: '2027-09', note: 'Agency statement' });
  const loan = { id: 'l1', employeeId: 'e1', kind: 'SSS_SALARY', loanNo: '123-45', amortizationCents: 150025, firstMonth: '2026-10', lastMonth: '2027-09', note: 'Agency statement', version: 3, deductedCents: 0, leftCents: 1800300, status: 'running' } as GovLoan;
  const page = form(() => GovLoans({ me }), [false, [loan]]);
  const table = page.render().find((n) => typeof n.type === 'function' && n.type.name === 'LoanTable')!;
  const tableForm = form(() => (table.type as Function)({ ...table.props, onSaved: async () => undefined }), [loan]);
  const edit = tableForm.render().find((n) => typeof n.type === 'function' && n.type.name === 'EditLoan')!;
  const editForm = form(() => (edit.type as Function)(edit.props));
  change(editForm.field('Monthly deduction'), '1600');
  await editForm.find('children', 'Save').props.onClick();
  expect(update).toHaveBeenLastCalledWith('l1', 3, { amortizationCents: 160000 });
});

it('unused detail is folded, requested detail opens, active exceptions cannot be hidden, and totals stay visible', () => {
  const f = form(() => PayDetails({ title: 'Deductions', children: 'Fields' }));
  expect(f.render()[0]!.props.open).toBe(false);
  f.render()[0]!.props.onToggle({ currentTarget: { open: true } });
  expect(f.render()[0]!.props.open).toBe(true);
  const active = form(() => PayDetails({ title: 'Changed rate', active: true, children: 'Reason' }));
  const target = { open: false };
  active.render()[0]!.props.onToggle({ currentTarget: target });
  expect(target.open).toBe(true);
  expect(renderToStaticMarkup(createElement(PayTotal, { total: 100000, label: 'To pay now' }))).toContain('sticky top-0');
});

it('recorded payroll and 13th month use employee cards with expandable figures; government access uses plain words', () => {
  const payNode = runView.extra!({ doc: run, header: { id: 'run1', status: 'cancelled' } } as never) as any;
  const pay = form(() => payNode.type(payNode.props));
  expect(pay.render().filter((n) => n.type === 'section')).toHaveLength(1);
  expect(pay.find('title', 'Earnings and deductions')).toBeDefined();
  const thNode = thirteenthView.extra!({ doc: thirteenth, header: { id: 'th1', status: 'cancelled' } } as never) as any;
  const th = form(() => thNode.type(thNode.props));
  expect(th.find('label', 'To pay now').props.total).toBe(100000);
  const calculation = form(() => ThirteenthCalculation({ employee: thirteenth.employees[0]! }));
  expect(renderToStaticMarkup(calculation.render()[0]!)).toContain('₱100.04');
  const yearEnd = form(() => YearEndPage({ me: { permissions: [] } as unknown as Me }));
  expect(yearEnd.render().some((n) => typeof n.props.children === 'string' && n.props.children.startsWith('Your role cannot view government numbers'))).toBe(true);
});

it('payroll period: Date from or Date to picks the pay group period holding that day; a recorded one is only shown', () => {
  const periods = [
    { periodStart: '2026-09-16', periodEnd: '2026-09-30', employees: 3, recorded: null, bookOn: null },
    { periodStart: '2026-09-01', periodEnd: '2026-09-15', employees: 3, recorded: { id: 'r1', number: 'PR-000001' }, bookOn: null },
  ];
  const f = form(() => RunForm({ type: type('pay.run'), mode }), ['SEMI_DAILY', periods, '']);
  change(f.find('aria-label', 'Date to'), '2026-09-22'); // a day inside the second half
  expect(f.find('aria-label', 'Date from').props.value).toBe('2026-09-16');
  expect(f.find('aria-label', 'Date to').props.value).toBe('2026-09-30');
  change(f.find('aria-label', 'Date from'), '2026-09-03'); // already recorded: not chosen
  expect(f.find('aria-label', 'Date from').props.value).toBe('');
  expect(renderToStaticMarkup(f.render()[0]!)).toContain('already recorded as PR-000001');
});
