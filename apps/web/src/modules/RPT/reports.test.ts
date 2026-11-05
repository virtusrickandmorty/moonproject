import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../api.ts';
import * as Operations from './Operations.tsx';
import * as Production from './PayrollProduction.tsx';
import * as Sales from './SalesCollections.tsx';
import { BookTitle, GeneralJournal, GeneralLedger, TrialBalance, Tools } from './Books.tsx';
import { ArAging, CustomerStatement } from './Receivables.tsx';
import { IncomeStatement, BalanceSheet, ChangesInEquity } from './Statements.tsx';
import { CashFlow } from './CashFlow.tsx';
import { BirBooks } from './BirBooks.tsx';
import { MonthlyOwnersPack } from './MonthlyOwnersPack.tsx';
import { OverviewFigures, ReportsOverview, lastWholeMonth, type OverviewData } from './Overview.tsx';
import { PendingPeriod, ResultSummary, daysOverdue, periodLabel, statusWords } from './ReportParts.tsx';

const fixture = vi.hoisted(() => ({ data: null as any, paths: [] as (string | null)[], applied: '', loaded: null as any }));
vi.mock('./Books.tsx', async (original) => ({ ...await original<typeof import('./Books.tsx')>(),
  useToday: () => '2026-10-04',
  useReport: (path: string | null) => { fixture.paths.push(path); return { data: fixture.data, error: '' }; },
  usePagedReport: (path: string | null) => { fixture.paths.push(path); return { data: fixture.data, error: '', pager: null, pagerFor: () => null }; },
}));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: any) => actual.useState(initial === null && fixture.loaded ? fixture.loaded : fixture.applied && typeof initial === 'function'
    && typeof initial() === 'string' && initial().includes('=') ? fixture.applied : initial) };
});
const me = { permissions: ['rpt.books.view','rpt.signins.view','prd.view','pay.run.view'] } as Me;
const render = (component: ComponentType<{ me: Me }>) => renderToStaticMarkup(createElement(component, { me }));
const pl = (salesCents: number, netIncomeCents: number) => ({ salesCents, costOfSalesCents: 0, grossProfitCents: salesCents, operatingCents: 0, otherCents: 0, incomeBeforeTaxCents: netIncomeCents, incomeTaxCents: 0, netIncomeCents });
const ratios = { netIncomeCents: -5000, netMarginBp: null, grossMarginBp: 6000, collectionRateBp: 8000, daysToCollect: 12 };
const overview: OverviewData = { month: '2026-10', from: '2026-10-01', to: '2026-10-31', running: false, previousMonth: '2026-09', previousFrom: '2026-09-01', previousTo: '2026-09-30',
  now: ratios, previous: { ...ratios, daysToCollect: null }, cashMonths: 0.5, averagePaidCents: 20000,
  profit: { month: pl(10000, -5000), previous: pl(8000, 1000), yearToDate: pl(18000, -4000) }, cancelledExpenses: [{ number: 'EXP-1', amountCents: 3000 }],
  cash: { openingCents: 100, netChangeCents: 50, closingCents: 150, sections: [{ key: 'operating', title: 'Operating activities', totalCents: 50, lines: [{ key: 'customerCollections', name: 'Collections from customers', amountCents: 50 }] }] },
  trend: [{ ...pl(10000, -5000), month: '2026-10', from: '2026-10-01', to: '2026-10-31', cancelledExpenses: [] }],
  expenses: { totalCents: 4000, rows: [{ code: '6110', name: 'Made-up rent', amountCents: 4000, previousCents: 1000 }] },
  collect: { totalCents: 9000, overdueCents: 7000, customers: 1, rows: [{ customerName: 'Made-up customer', owedCents: 9000, overdueCents: 7000, daysOverdue: 33 }] },
  bills: { totalCents: 500, overdueCents: 0, bills: 1, rows: [{ number: 'BILL-1', supplierName: 'Made-up supplier', dueDate: '2026-11-20', balanceCents: 500, late: false, documentPath: '/docs/ap.bill/1' }] },
  customers: { totalCents: 10000, rows: [{ customerName: 'Made-up customer', salesCents: 10000, shareBp: 10000 }] },
  review: [{ key: 'exceptions', label: 'Exceptions', count: 2, amountCents: null, ok: false, href: '/rpt/exceptions' }, { key: 'cash', label: 'Cash flow ties to the balance sheet', count: null, amountCents: null, ok: true, href: '/rpt/cash-flow' }] };
describe('Reports overview', () => {
  const show = (permissions: string[]) => renderToStaticMarkup(createElement(OverviewFigures, { data: overview, me: { permissions } as Me, docTypes: [] }));
  it('reads the month as a manager does: ratios, profit and loss, cash, who to collect from, what to review', () => {
    const markup = show(['rpt.books.view']);
    for (const words of ['Gross margin', '60.0%', 'Days to collect', '12 days', 'Months of cash', 'Profit and loss', 'Year to date', 'Cash movement', 'Collect first', '33 days', 'Bills to pay', 'Top customers by sales', 'Before closing the month', '2 to review', 'All clear']) expect(markup).toContain(words);
    expect(markup).toContain('EXP-1');
    expect(markup).not.toContain('NaN');
  });
  it('reads the graphs out, so their details need no mouse', () => {
    const markup = show(['rpt.books.view']);
    expect(markup).toContain('aria-label="Net income by month"');
    expect(markup).toContain('aria-label="October 2026. Sales:');
    expect(markup).toContain('aria-label="Made-up rent. This month:');
  });
  it('links only the reports this person may open, and not itself', () => {
    const markup = show(['rpt.books.view']);
    expect(markup).toContain('href="/rpt/income-statement"');
    expect(markup).not.toContain('href="/rpt/payroll-register"');
    expect(markup).not.toContain('href="/rpt/overview"');
    expect(show(['rpt.books.view', 'pay.run.view'])).toContain('href="/rpt/payroll-register"');
  });
  it('asks the server for the month in the address', () => {
    vi.stubGlobal('location', { search: '?month=2026-09' });
    renderToStaticMarkup(createElement(ReportsOverview, { me, docTypes: [] }));
    expect(fixture.paths).toEqual(['overview?month=2026-09']);
  });
  it('opens on the last whole month', () => {
    expect(lastWholeMonth('2026-11-05')).toBe('2026-10');
    expect(lastWholeMonth('2026-01-15')).toBe('2025-12');
  });
});
beforeEach(() => { fixture.data = null; fixture.paths = []; fixture.applied = ''; fixture.loaded = null; vi.stubGlobal('location', { search: '' }); });
afterEach(() => vi.unstubAllGlobals());

describe('readable report columns', () => {
  it('keeps supplier names, linked document numbers, peso balances and aging words, and hides internal fields', () => {
    const html = renderToStaticMarkup(createElement(Operations.OperationsTable, { kind: 'apAging', data: { rows: [{
      id: 'private-doc-id', supplierId: 'private-supplier-id', docType: 'ap.bill', supplierName: 'Example Cloth', number: 'BILL-000001',
      documentPath: '/docs/ap.bill/private-doc-id', date: '2026-09-01', dueDate: '2026-09-15', bucket: 'days1to30', balanceCents: 123456,
    }], totalCents: 123456 } }));
    expect(html).toContain('Example Cloth'); expect(html).toContain('BILL-000001'); expect(html).toContain('₱1,234.56');
    expect(html).toContain('1–30 days overdue'); expect(html).toContain('Balance'); expect(html).toContain('Total');
    expect(html).not.toContain('supplier Id'); expect(html).not.toContain('private-supplier-id'); expect(html).not.toContain('balance Cents');
    expect(html).toContain('text-right tabular-nums');
  });
  it.each(['purchases','purchaseOrders','receivedNotBilled','cashPosition','transfers','cashCounts','assets','lateEntries','cancellations','exceptions','signIns'])
    ('uses chosen headings and gives an empty explanation before the %s table', (kind) => {
      const html = renderToStaticMarkup(createElement(Operations.OperationsTable, { kind, data: { rows: [{ unexpectedInternalId: 'do-not-display' }] } }));
      expect(html).not.toContain('do-not-display'); expect(html).not.toContain('unexpected Internal Id');
      const empty = renderToStaticMarkup(createElement(Operations.OperationsTable, { kind, data: { rows: [] } }));
      expect(empty.indexOf('No records')).toBeLessThan(empty.indexOf('<table'));
    });
  it('shows readable sign-in outcomes and a replacement link without its ID as text', () => {
    const signs = renderToStaticMarkup(createElement(Operations.OperationsTable, { kind: 'signIns', data: { rows: [{ username: 'example', success: 0 }, { success: 1 }] } }));
    expect(signs).toContain('Unsuccessful'); expect(signs).toContain('Successful');
    const cancels = renderToStaticMarkup(createElement(Operations.OperationsTable, { kind: 'cancellations', data: { rows: [{ number: 'JO-000001', replacementId: 'internal', replacementPath: '/docs/jo.job_order/internal', reason: 'Corrected sizes' }] } }));
    expect(cancels).toContain('Open replacement'); expect(cancels).not.toContain('>internal<'); expect(cancels).toContain('Corrected sizes');
  });
  it('aligns every payroll amount, uses plain headings and shows totals', () => {
    fixture.data = { rows: [{ number: 'PAY-000001', documentPath: '/docs/pay.run/example', employeeName: 'Example Worker', grossCents: 123456, netCents: 120000 }], totals: { grossCents: 123456, netCents: 120000 } };
    vi.stubGlobal('location', { search: '?month=2026-09' });
    const html = render(Production.PayrollRegister);
    expect(html).toContain('Employee share'); expect(html).toContain('Company share'); expect(html).toContain('Cash advance');
    expect(html).toContain('font-semibold border-t-2'); expect(html).toContain('text-right tabular-nums'); expect(html).toContain('₱1,234.56');
  });
  it('omits job-order IDs when the piece-work and labor-cost responses supply no document numbers', () => {
    vi.stubGlobal('location', { search: '?from=2026-09-01&to=2026-09-30' });
    fixture.data = { rows: [{ jobOrderId: 'internal-job', documentPath: '/docs/jo.job_order/internal-job', qty: 4, amountCents: 20000 }], byEmployee: [], byJobOrder: [{ jobOrderId: 'internal-job', qty: 4, amountCents: 20000 }] };
    for (const screen of [Production.LaborCost, Production.PieceWork]) { const html = render(screen); expect(html).not.toContain('internal-job'); expect(html).toContain('numbers are unavailable'); }
  });
});

describe('report periods and printing', () => {
  it.each([
    [Operations.Purchases, '?from=2026-09-01&to=2026-09-30', 'purchases?from=2026-09-01&to=2026-09-30', '2026-09-01 to 2026-09-30'],
    [Operations.CashPosition, '?asOf=2026-08-31', 'cash-position?asOf=2026-08-31', 'As of 2026-08-31'],
    [Production.PayrollRegister, '?month=2026-09', 'payroll-register?month=2026-09', '2026-09'],
    [Production.ThirteenthRegister, '?year=2025', 'thirteenth-register?year=2025', '2025'],
    [Production.LateJobs, '?asOf=2026-09-30', 'late-jobs?asOf=2026-09-30', 'As of 2026-09-30'],
    [Sales.CollectionsRegister, '?from=2026-09-01&to=2026-09-30', 'collections-register?from=2026-09-01&to=2026-09-30', '2026-09-01 to 2026-09-30'],
    [Sales.DepositsHeld, '?asOf=2026-08-31', 'deposits-held?asOf=2026-08-31', 'As of 2026-08-31'],
  ] as const)('loads and labels address dates for %s', (screen, search, path, dates) => {
    vi.stubGlobal('location', { search }); const html = render(screen);
    expect(fixture.paths).toContain(path); expect(html).toContain(dates);
  });
  it('keeps the applied period in the heading and export when controls have new dates', () => {
    vi.stubGlobal('location', { search: '?from=2026-10-01&to=2026-10-04' });
    fixture.applied = 'from=2026-09-01&to=2026-09-30';
    const html = render(Production.WorkerOutput);
    expect(html).toContain('<p>2026-09-01 to 2026-09-30</p>'); expect(html).toContain('not applied yet');
    expect(html).toContain('worker-output?from=2026-09-01&amp;to=2026-09-30&amp;format=csv');
  });
  it('does not warn for applied dates, warns for cleared dates, and keeps the warning out of print', () => {
    expect(renderToStaticMarkup(createElement(PendingPeriod, { applied: 'asOf=2026-09-30', values: { asOf: '2026-09-30' } }))).toBe('');
    const html = renderToStaticMarkup(createElement(PendingPeriod, { applied: 'asOf=2026-09-30', values: { asOf: '' } }));
    expect(html).toContain('not applied yet'); expect(html).toContain('print:hidden');
    expect(periodLabel('asOf=2026-09-30')).toBe('As of 2026-09-30'); expect(periodLabel('', '2026-10-04')).toContain('As of 2026-10-04');
  });
  it('prints only the page with a plain button label', () => {
    const html = renderToStaticMarkup(createElement(Tools, { path: 'journal?from=2026-09-01&to=2026-09-30' }));
    expect(html).toContain('Print this page'); expect(html).toContain('Export CSV');
  });
  it('uses the returned asset date for its heading instead of an edited control date', () => {
    fixture.data = { asOf: '2026-09-30', rows: [] }; vi.stubGlobal('location', { search: '?asOf=2026-10-04' }); fixture.applied = 'asOf=2026-09-30';
    expect(render(Operations.Assets)).toContain('<p>As of 2026-09-30</p>');
  });
  it('hides an old response immediately when Show requests a different period', async () => {
    const actual = await vi.importActual<typeof import('./Books.tsx')>('./Books.tsx');
    fixture.loaded = { path: 'journal?from=2026-09-01&to=2026-09-30', data: { label: 'September results' } };
    const Result = ({ path }: { path: string }) => createElement('p', null, actual.useReport<{ label: string }>(path).data?.label ?? 'Loading…');
    expect(renderToStaticMarkup(createElement(Result, { path: fixture.loaded.path }))).toContain('September results');
    expect(renderToStaticMarkup(createElement(Result, { path: 'journal?from=2026-10-01&to=2026-10-04' }))).toBe('<p>Loading…</p>');
  });
});

describe('report guidance and overdue results', () => {
  it.each([GeneralJournal,GeneralLedger,TrialBalance,ArAging,CustomerStatement,IncomeStatement,BalanceSheet,ChangesInEquity,CashFlow,BirBooks,MonthlyOwnersPack])
    ('keeps a purpose above the report controls for %s', (screen) => { const html = render(screen); expect(html).toMatch(/rpt-heading[\s\S]*text-sm text-slate-600/); });
  it('calculates whole overdue days across a month and leap day and marks late rows', () => {
    expect(daysOverdue('2026-09-30','2026-10-04')).toBe(4); expect(daysOverdue('2028-02-28','2028-03-01')).toBe(2);
    expect(daysOverdue('2026-10-05','2026-10-04')).toBe(0); expect(statusWords('in_production')).toBe('In production');
    vi.stubGlobal('location', { search: '?asOf=2026-10-04' }); fixture.data = { asOf: '2026-10-04', rows: [{ number: 'JO-000001', dueDate: '2026-09-30', stage: 'in_production', customerName: 'Example Customer' }] };
    const html = render(Production.LateJobs); expect(html).toContain('4 days overdue'); expect(html).toContain('In production');
  });
  it('summarizes counts and the visible page without suggesting a full-report subtotal', () => {
    expect(renderToStaticMarkup(createElement(ResultSummary, { count: 25, total: 60 }))).toContain('25 records on this page of 60');
    expect(renderToStaticMarkup(createElement(BookTitle, { title: 'Income statement', dates: '2026-09-01 to 2026-09-30' }))).toContain('See the income, costs and profit');
  });
});
