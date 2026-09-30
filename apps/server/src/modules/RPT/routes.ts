import type { FastifyInstance } from 'fastify';
import { AppError, csvPesos, toCsv, type CsvCell } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { comparativeTrialBalance, generalJournal, generalJournalCsv, generalLedger, ledgerAccounts } from './books.ts';
import { balanceSheet, compareSections, comparisonDates, incomeStatement, type Comparison, type StatementSection } from './statements.ts';
import { arAging, customerStatement } from './receivables.ts';
import { statementCustomers } from '../CUS/public.ts';
import { collectionsRegister, depositsCrossingQuarter, depositsHeld, jobOrderFollowUp, salesByPeriod } from './sales-collections.ts';
import { birBookRoutes } from './bir-books.ts';
import { payrollProductionRoutes } from './payroll-production-routes.ts';
import { apAging, purchases, purchaseOrders, receivedNotBilled } from './suppliers.ts';
import { cashPosition, transfers, cashCounts, assetSchedule } from './cash-assets.ts';
import { lateEntries, cancellations, exceptions, signIns } from './control.ts';
import { cashFlowStatement } from './cash-flow.ts';
import { pageAsked, paged, pagedLedger } from '../../platform/paging.ts';
import { monthlyOwnersPack, monthlyOwnersPackBody } from './monthly-pack.ts';
import { companyProfile, renderReportPrint } from '../PRT/public.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { stamp, today } from '../../platform/clock.ts';

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('BAD_DATE', 'Use a date in YYYY-MM-DD format.', 400);
  const d = new Date(`${value}T00:00:00Z`);
  const [year, month, day] = value.split('-').map(Number);
  if (Number.isNaN(d.valueOf()) || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day)
    throw new AppError('BAD_DATE', 'Enter a valid calendar date.', 400);
  return value;
}
function range(q: Record<string, unknown>) {
  const from = date(q.from);
  const to = date(q.to);
  if (from > to) throw new AppError('BAD_RANGE', 'The first date must be on or before the last date.', 400);
  return { from, to };
}
function comparison(value: unknown): Comparison | undefined {
  if (value === undefined || value === '' || value === 'none') return undefined;
  if (value !== 'previous_month' && value !== 'last_year') throw new AppError('BAD_COMPARISON', 'Choose no comparison, previous month, or same period last year.', 400);
  return value;
}
const comparedAmount = (amountCents: number, compareAmountCents: number) => ({ amountCents, compareAmountCents,
  differenceCents: amountCents - compareAmountCents,
  percentChange: compareAmountCents === 0 ? null : (amountCents - compareAmountCents) / Math.abs(compareAmountCents) * 100 });
function pesos(cents: number | null): string { return cents === null ? '' : csvPesos(cents); }
function sendCsv(reply: { header: (name: string, value: string) => unknown; type: (value: string) => unknown }, name: string, rows: CsvCell[][]) {
  reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
  reply.type('text/csv; charset=utf-8');
  return toCsv(rows);
}
/** A statement section as printed: each header, its accounts and subtotal, then the section total. */
function sectionRows(s: StatementSection, comparative = false): CsvCell[][] {
  const values = (amount: number, compareAmount?: number): CsvCell[] => comparative
    ? [csvPesos(amount), csvPesos(compareAmount ?? 0), csvPesos(amount - (compareAmount ?? 0)), compareAmount === 0 ? '' : ((amount - (compareAmount ?? 0)) / Math.abs(compareAmount ?? 0) * 100).toFixed(2)]
    : [csvPesos(amount)];
  const blanks = comparative ? ['', '', '', ''] : [''];
  const rows: CsvCell[][] = [[s.title, '', s.title, ...blanks]];
  for (const g of s.groups) {
    if (g.code) rows.push([s.title, g.code, g.name, ...blanks]);
    for (const l of g.lines) rows.push([s.title, l.code ?? '', l.name, ...values(l.amountCents, l.compareAmountCents)]);
    if (g.code) rows.push([s.title, '', `Total ${g.name}`, ...values(g.totalCents, g.compareAmountCents)]);
  }
  rows.push([s.title, '', `Total ${s.title.toLowerCase()}`, ...values(s.totalCents, s.compareAmountCents)]);
  return rows;
}
const STATEMENT_HEAD = ['Section', 'Account', 'Line', 'Amount PHP'];

export function rptRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  birBookRoutes(app, deps);
  payrollProductionRoutes(app, deps);
  app.post('/api/rpt/monthly-owners-pack', { config: { permission: 'rpt.books.view' } }, async (req) => {
    const month = (req.body as { month?: unknown } | null)?.month;
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new AppError('BAD_MONTH', 'Pick a month in YYYY-MM format.', 400);
    const profile = companyProfile(db);
    if (!profile) throw new AppError('COMPANY_PROFILE_REQUIRED', 'An owner must complete the company profile before printing.', 409);
    const data = monthlyOwnersPack(db, month), user = currentUser(req);
    return { data, html: renderReportPrint("Monthly Owners' Pack", monthlyOwnersPackBody(data), profile,
      today(clock), user.displayName, stamp(clock)) };
  });
  app.get('/api/rpt/deposits-held', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const result = depositsHeld(db, date(q.asOf));
    if (q.format !== 'csv') return result;
    return sendCsv(reply, `deposits-held-${result.asOf}`, [
      ['Customer', 'Job order', 'Deposits held PHP', 'Document link'],
      ...result.rows.map((r): CsvCell[] => [r.customerName, r.jobOrderNumber, csvPesos(r.heldCents), r.documentPath]),
      ['TOTAL', '', csvPesos(result.totalCents), ''],
    ]);
  });
  app.get('/api/rpt/deposits-crossing-quarter', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    if (typeof q.quarter !== 'string' || !/^\d{4}-Q[1-4]$/.test(q.quarter))
      throw new AppError('BAD_QUARTER', 'Choose a quarter in YYYY-Q1 format.', 400);
    const [year, quarter] = q.quarter.replace('Q', '').split('-').map(Number) as [number, number];
    const result = depositsCrossingQuarter(db, year, quarter);
    if (q.format !== 'csv') return result;
    return sendCsv(reply, `deposits-crossing-${q.quarter}`, [
      ['Customer', 'Job order', 'Deposit document', 'Deposit date', 'Quarter received', 'Amount PHP', 'Held at quarter end PHP', 'Quarter applied', 'Deposit VAT mode', 'Output VAT declared PHP', 'Document link'],
      ...result.rows.map((r): CsvCell[] => [r.customerName, r.jobOrderNumber, r.depositDocumentNumber, r.depositDate,
        r.quarterReceived, csvPesos(r.amountCents), csvPesos(r.heldAtQuarterEndCents), r.quarterApplied ?? '', r.mode,
        csvPesos(r.outputVatCents), r.depositDocumentPath]),
      ['TOTAL', '', '', '', '', csvPesos(result.totals.amountCents), csvPesos(result.totals.heldAtQuarterEndCents), '', '', csvPesos(result.totals.outputVatCents), ''],
    ]);
  });
  app.get('/api/rpt/collections-register', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q); const result = collectionsRegister(db, from, to);
    if (q.format !== 'csv') return paged(result, 'rows', pageAsked(q));
    return sendCsv(reply, `collections-register-${from}-${to}`, [
      ['Date', 'Collection', 'Customer', 'Cash place', 'Tender PHP', 'CWT PHP', 'Recorded by', 'Status', 'Document link'],
      ...result.rows.map((r): CsvCell[] => [r.date, r.number, r.customerName, r.cashPlaceName ?? '',
        csvPesos(r.tenderCents ?? 0), csvPesos(r.cwtCents), r.recordedByName, r.status, r.documentPath]),
      ['TOTAL', '', '', '', csvPesos(result.tenderCents), '', '', '', ''],
    ]);
  });
  app.get('/api/rpt/sales-by-period', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q); const result = salesByPeriod(db, from, to);
    if (q.format !== 'csv') return paged(result, 'rows', pageAsked(q));
    return sendCsv(reply, `sales-by-period-${from}-${to}`, [
      ['Date', 'Document', 'Customer', 'Item', 'Class', 'Garment type', 'Quantity', 'Net sales PHP', 'Document link'],
      ...result.rows.map((r): CsvCell[] => [r.date, r.number, r.customerName, r.description, r.kind,
        r.garmentType, r.qty, csvPesos(r.salesCents), r.documentPath]),
      ['TOTAL', '', '', '', '', '', '', csvPesos(result.totalCents), ''],
    ]);
  });
  app.get('/api/rpt/job-order-follow-up', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const result = jobOrderFollowUp(db);
    // A page of the orders, and (its own page, `balanceOffset`) of the released orders that still owe.
    if (q.format !== 'csv') return paged(paged(result, 'rows', pageAsked(q)), 'releasedWithBalance', pageAsked(q, 'balanceOffset'), 'balancePage');
    return sendCsv(reply, 'job-order-follow-up', [
      ['Job order', 'Customer', 'Status', 'Due date', 'Balance PHP', 'Document link'],
      ...result.rows.map((r): CsvCell[] => [r.number, r.customerName, r.stage, r.dueDate,
        csvPesos(r.balanceDueCents), r.documentPath]), [],
      ['Release to invoice', 'Job order', 'Customer', 'Date', 'Released PHP', 'Document link'],
      ...result.awaitingInvoice.map((r): CsvCell[] => [r.number, r.jobOrderNumber, r.customerName, r.date,
        csvPesos(r.releasedCents), r.documentPath]),
    ]);
  });
  app.get('/api/rpt/customers', { config: { permission: 'rpt.books.view' } }, async () => statementCustomers(db));
  app.get('/api/rpt/ar-aging', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const result = arAging(db, date(q.asOf));
    // A page of the invoices, and (its own page, `memoOffset`) of the job orders not yet invoiced.
    if (q.format !== 'csv') return paged(paged(result, 'rows', pageAsked(q)), 'memo', pageAsked(q, 'memoOffset'), 'memoPage');
    const rows: CsvCell[][] = [['Customer', 'Document', 'Job order', 'Date', 'Due date', 'Current PHP',
      '1-30 PHP', '31-60 PHP', '61-90 PHP', 'Over 90 PHP', 'Total PHP']];
    for (const r of result.rows) rows.push([r.customerName, r.documentNumber, r.jobOrderNumber, r.date, r.dueDate,
      csvPesos(r.buckets.current), csvPesos(r.buckets.days1to30), csvPesos(r.buckets.days31to60),
      csvPesos(r.buckets.days61to90), csvPesos(r.buckets.over90), csvPesos(r.totalCents)]);
    rows.push(['TOTAL', '', '', '', '', csvPesos(result.buckets.current), csvPesos(result.buckets.days1to30),
      csvPesos(result.buckets.days31to60), csvPesos(result.buckets.days61to90), csvPesos(result.buckets.over90),
      csvPesos(result.totalCents)]);
    for (const r of result.allowance) rows.push([r.customerName, 'Less allowance for credit losses', '', '', '', '', '', '', '', '', csvPesos(-r.allowanceCents)]);
    rows.push(['LESS ALLOWANCE FOR CREDIT LOSSES', '', '', '', '', '', '', '', '', '', csvPesos(-result.allowanceCents)]);
    rows.push(['NET RECEIVABLES', '', '', '', '', '', '', '', '', '', csvPesos(result.netCents)]);
    rows.push([]);
    rows.push(['Uninvoiced job orders (memo, excluded from AR total)', 'Job order', 'Due date', 'Amount PHP']);
    for (const r of result.memo) rows.push([r.customerName, r.jobOrderNumber, r.dueDate, csvPesos(r.notInvoicedCents)]);
    rows.push(['MEMO TOTAL', '', '', csvPesos(result.memoTotalCents)]);
    return sendCsv(reply, `ar-aging-${result.asOf}`, rows);
  });
  app.get('/api/rpt/customer-statement', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    if (typeof q.customerId !== 'string' || !q.customerId) throw new AppError('BAD_CUSTOMER', 'Choose a customer.', 400);
    const result = customerStatement(db, q.customerId, from, to);
    if (!result) throw new AppError('BAD_CUSTOMER', 'Choose a customer from the list.', 400);
    if (q.format !== 'csv') return result;
    const rows: CsvCell[][] = [['Customer', result.customerName], ['From', from], ['To', to], [],
      ['Date', 'Document', 'Memo', 'Debit PHP', 'Credit PHP', 'Balance PHP'],
      ['', 'Opening balance', '', '', '', csvPesos(result.openingBalanceCents)]];
    for (const line of result.lines) rows.push([line.businessDate, line.documentNumber ?? line.journalNumber,
      line.memo, csvPesos(line.debitCents), csvPesos(line.creditCents), csvPesos(line.runningBalanceCents)]);
    rows.push(['', 'Closing balance', '', '', '', csvPesos(result.closingBalanceCents)]);
    rows.push([]);
    rows.push(['Date', 'Deposit document', 'Memo', 'Received PHP', 'Applied PHP', 'Held PHP']);
    rows.push(['', 'Opening deposits held', '', '', '', csvPesos(result.openingDepositsHeldCents)]);
    for (const line of result.depositLines) rows.push([line.businessDate, line.documentNumber ?? line.journalNumber,
      line.memo, csvPesos(line.creditCents), csvPesos(line.debitCents), csvPesos(line.runningHeldCents)]);
    rows.push(['', 'Deposits held', '', '', '', csvPesos(result.depositsHeldCents)]);
    return sendCsv(reply, `customer-statement-${from}-${to}`, rows);
  });
  app.get('/api/rpt/accounts', { config: { permission: 'rpt.books.view' } }, async () => ledgerAccounts(db));
  app.get('/api/rpt/journal', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    const result = generalJournal(db, from, to);
    if (q.format !== 'csv') return paged(result, 'journals', pageAsked(q));
    return sendCsv(reply, `general-journal-${result.from}-${result.to}`, generalJournalCsv(result));
  });
  app.get('/api/rpt/ledger', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    const id = q.accountId === undefined ? undefined : Number(q.accountId);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0 || !ledgerAccounts(db).some((a) => a.id === id)))
      throw new AppError('BAD_ACCOUNT', 'Choose an account from the list.', 400);
    const result = generalLedger(db, from, to, id);
    if (q.format !== 'csv') return pagedLedger(result, pageAsked(q));
    const rows: CsvCell[][] = [['Account', 'Account name', 'Date', 'Journal', 'Document type', 'Document', 'Party type', 'Party ID', 'Debit PHP', 'Credit PHP', 'Balance PHP', 'Memo']];
    for (const a of result.accounts) {
      rows.push([a.code, a.name, from, '', '', '', '', '', '', '', pesos(a.openingBalanceCents), 'Opening balance']);
      for (const l of a.lines) rows.push([a.code, a.name, l.businessDate, l.journalNumber, l.documentType, l.documentNumber,
        l.partyType, l.partyId, pesos(l.debitCents), pesos(l.creditCents), pesos(l.runningBalanceCents), l.memo ?? l.journalMemo]);
      rows.push([a.code, a.name, to, '', '', '', '', '', '', '', pesos(a.closingBalanceCents), 'Closing balance']);
    }
    return sendCsv(reply, `general-ledger-${from}-${to}`, rows);
  });
  app.get('/api/rpt/trial-balance', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const asOf = date(q.asOf);
    const compareTo = q.compareTo === undefined || q.compareTo === '' ? undefined : date(q.compareTo);
    const result = comparativeTrialBalance(db, asOf, compareTo);
    if (q.format !== 'csv') return result;
    const rows: CsvCell[][] = [['Account', 'Account name', `Debit PHP ${asOf}`, `Credit PHP ${asOf}`,
      `Debit PHP ${compareTo ?? ''}`, `Credit PHP ${compareTo ?? ''}`]];
    for (const a of result.rows) rows.push([a.code, a.name, pesos(a.debitCents), pesos(a.creditCents),
      compareTo ? pesos(a.compareDebitCents) : '', compareTo ? pesos(a.compareCreditCents) : '']);
    rows.push(['TOTAL', '', pesos(result.totalDebitCents), pesos(result.totalCreditCents), pesos(result.compareTotalDebitCents), pesos(result.compareTotalCreditCents)]);
    return sendCsv(reply, `trial-balance-${asOf}`, rows);
  });
  app.get('/api/rpt/income-statement', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    const compare = comparison(q.compare);
    const current = incomeStatement(db, from, to);
    const otherDates = compare ? comparisonDates(compare, from, to) as { from: string; to: string } : undefined;
    const otherStatement = otherDates ? incomeStatement(db, otherDates.from, otherDates.to) : undefined;
    const result = otherStatement ? { ...current, sections: compareSections(current.sections, otherStatement.sections), comparison: { kind: compare, ...otherDates },
      grossProfit: comparedAmount(current.grossProfitCents, otherStatement.grossProfitCents),
      incomeBeforeTax: comparedAmount(current.incomeBeforeTaxCents, otherStatement.incomeBeforeTaxCents),
      netIncome: comparedAmount(current.netIncomeCents, otherStatement.netIncomeCents) } : current;
    if (q.format !== 'csv') return result;
    const [revenue, costOfSales, operatingExpenses, other, incomeTax] = result.sections as [StatementSection, StatementSection, StatementSection, StatementSection, StatementSection];
    const head = compare ? ['Section', 'Account', 'Line', `${from} to ${to} PHP`, `${otherDates!.from} to ${otherDates!.to} PHP`, 'Difference PHP', 'Difference %'] : STATEMENT_HEAD;
    const totals = (label: string, value: number, compared?: ReturnType<typeof comparedAmount>): CsvCell[] => compare
      ? [label, '', label, csvPesos(value), csvPesos(compared!.compareAmountCents), csvPesos(compared!.differenceCents), compared!.percentChange === null ? '' : compared!.percentChange.toFixed(2)]
      : [label, '', label, csvPesos(value)];
    const rows: CsvCell[][] = [head, ...sectionRows(revenue, !!compare), ...sectionRows(costOfSales, !!compare),
      totals('Gross profit', result.grossProfitCents, 'grossProfit' in result ? result.grossProfit : undefined),
      ...sectionRows(operatingExpenses, !!compare), ...sectionRows(other, !!compare),
      totals('Income before tax', result.incomeBeforeTaxCents, 'incomeBeforeTax' in result ? result.incomeBeforeTax : undefined),
      ...sectionRows(incomeTax, !!compare), totals('Net income', result.netIncomeCents, 'netIncome' in result ? result.netIncome : undefined)];
    return sendCsv(reply, `income-statement-${from}-${to}`, rows);
  });
  app.get('/api/rpt/balance-sheet', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const asOf = date(q.asOf); const compare = comparison(q.compare);
    const current = balanceSheet(db, asOf);
    const compareAsOf = compare ? comparisonDates(compare, asOf).from : undefined;
    const other = compareAsOf ? balanceSheet(db, compareAsOf) : undefined;
    const result = other ? { ...current, sections: compareSections(current.sections, other.sections), comparison: { kind: compare, asOf: compareAsOf },
      totalAssets: comparedAmount(current.totalAssetsCents, other.totalAssetsCents),
      totalLiabilitiesAndEquity: comparedAmount(current.totalLiabilitiesAndEquityCents, other.totalLiabilitiesAndEquityCents), comparisonBalanced: other.balanced } : current;
    if (q.format !== 'csv') return result;
    const head = compare ? ['Section', 'Account', 'Line', `${asOf} PHP`, `${compareAsOf} PHP`, 'Difference PHP', 'Difference %'] : STATEMENT_HEAD;
    const check = (label: string, currentAmount: number, otherAmount: number): CsvCell[] => compare
      ? ['Check', '', label, csvPesos(currentAmount), csvPesos(otherAmount), csvPesos(currentAmount - otherAmount), otherAmount === 0 ? '' : ((currentAmount - otherAmount) / Math.abs(otherAmount) * 100).toFixed(2)]
      : ['Check', '', label, csvPesos(currentAmount)];
    const rows: CsvCell[][] = [head, ...result.sections.flatMap((s) => sectionRows(s, !!compare)),
      check('Trade receivables less the allowance for credit losses', result.receivables.netCents, other?.receivables.netCents ?? 0),
      check('Total liabilities and equity', result.totalLiabilitiesAndEquityCents, other?.totalLiabilitiesAndEquityCents ?? 0),
      check('Total assets less liabilities and equity', result.differenceCents, other?.differenceCents ?? 0)];
    return sendCsv(reply, `balance-sheet-${result.asOf}`, rows);
  });
  app.get('/api/rpt/cash-flow', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>; const { from, to } = range(q); const result = cashFlowStatement(db, from, to);
    if (q.format !== 'csv') return result;
    const rows: CsvCell[][] = [['Section', 'Line', 'Amount PHP'], ['Opening', 'Opening cash', csvPesos(result.openingCashCents)]];
    for (const section of result.sections) {
      for (const line of section.lines) rows.push([section.title, line.name, csvPesos(line.amountCents)]);
      rows.push([section.title, `Net cash from ${section.title.toLowerCase()}`, csvPesos(section.totalCents)]);
    }
    rows.push(['Change', 'Net change in cash', csvPesos(result.netChangeCents)], ['Closing', 'Closing cash', csvPesos(result.closingCashCents)],
      ['Check', 'Cash accounts on balance sheet', csvPesos(result.balanceSheetCashCents)], ['Check', 'Difference', csvPesos(result.checkDifferenceCents)]);
    return sendCsv(reply, `cash-flow-${from}-${to}`, rows);
  });
  const simple = (url: string, name: string, get: (q: Record<string, unknown>) => Record<string, unknown>) =>
    app.get(url, { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
      const q=req.query as Record<string,unknown>, result=get(q); if(q.format!=='csv') return result;
      const rows=(result.rows??[]) as Record<string,unknown>[]; const keys=[...new Set(rows.flatMap(Object.keys))];
      return sendCsv(reply,name,[keys,...rows.map(r=>keys.map(k=>k.endsWith('Cents')&&typeof r[k]==='number'?csvPesos(r[k] as number):String(r[k]??'')))]);
    });
  simple('/api/rpt/ap-aging','ap-aging',q=>apAging(db,date(q.asOf)));
  simple('/api/rpt/purchases','purchases',q=>{const r=range(q);return purchases(db,r.from,r.to)});
  simple('/api/rpt/purchase-orders','purchase-orders',()=>purchaseOrders(db));
  simple('/api/rpt/received-not-billed','received-not-billed',()=>receivedNotBilled(db));
  simple('/api/rpt/cash-position','cash-position',q=>cashPosition(db,date(q.asOf)));
  simple('/api/rpt/transfers','transfers',q=>{const r=range(q);return transfers(db,r.from,r.to)});
  simple('/api/rpt/cash-counts','cash-counts',q=>{const r=range(q);return cashCounts(db,r.from,r.to)});
  simple('/api/rpt/assets','fixed-assets',q=>assetSchedule(db,date(q.asOf)));
  simple('/api/rpt/late-entries','late-entries',()=>lateEntries(db));
  simple('/api/rpt/cancellations','cancellations',()=>cancellations(db));
  simple('/api/rpt/exceptions','exceptions',q=>exceptions(db,date(q.asOf)));
  app.get('/api/rpt/sign-ins', { config: { permission: 'rpt.signins.view' } }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const dates = range(query);
    const result = signIns(db, dates.from, dates.to);
    if (query.format !== 'csv') return result;
    return sendCsv(reply, 'sign-ins', [
      ['at', 'username', 'success', 'ip'],
      ...result.rows.map((row) => [row.at, row.username, String(row.success), row.ip]),
    ]);
  });

}
