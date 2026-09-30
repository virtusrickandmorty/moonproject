import type { FastifyInstance } from 'fastify';
import { AppError, csvPesos, toCsv, type CsvCell } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { comparativeTrialBalance, generalJournal, generalLedger, ledgerAccounts } from './books.ts';
import { balanceSheet, incomeStatement, type StatementSection } from './statements.ts';
import { arAging, customerStatement } from './receivables.ts';
import { statementCustomers } from '../CUS/public.ts';
import { collectionsRegister, depositsHeld, jobOrderFollowUp, salesByPeriod } from './sales-collections.ts';
import { birBookRoutes } from './bir-books.ts';
import { payrollProductionRoutes } from './payroll-production-routes.ts';
import { apAging, purchases, purchaseOrders, receivedNotBilled } from './suppliers.ts';
import { cashPosition, transfers, cashCounts, assetSchedule } from './cash-assets.ts';
import { lateEntries, cancellations, exceptions, signIns } from './control.ts';

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
function pesos(cents: number | null): string { return cents === null ? '' : csvPesos(cents); }
function sendCsv(reply: { header: (name: string, value: string) => unknown; type: (value: string) => unknown }, name: string, rows: CsvCell[][]) {
  reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
  reply.type('text/csv; charset=utf-8');
  return toCsv(rows);
}
/** A statement section as printed: each header, its accounts and subtotal, then the section total. */
function sectionRows(s: StatementSection): CsvCell[][] {
  const rows: CsvCell[][] = [[s.title, '', s.title, '']];
  for (const g of s.groups) {
    if (g.code) rows.push([s.title, g.code, g.name, '']);
    for (const l of g.lines) rows.push([s.title, l.code ?? '', l.name, csvPesos(l.amountCents)]);
    if (g.code) rows.push([s.title, '', `Total ${g.name}`, csvPesos(g.totalCents)]);
  }
  rows.push([s.title, '', `Total ${s.title.toLowerCase()}`, csvPesos(s.totalCents)]);
  return rows;
}
const STATEMENT_HEAD = ['Section', 'Account', 'Line', 'Amount PHP'];

export function rptRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  birBookRoutes(app, deps);
  payrollProductionRoutes(app, deps);
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
  app.get('/api/rpt/collections-register', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q); const result = collectionsRegister(db, from, to);
    if (q.format !== 'csv') return result;
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
    if (q.format !== 'csv') return result;
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
    if (q.format !== 'csv') return result;
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
    if (q.format !== 'csv') return result;
    const rows: CsvCell[][] = [['Customer', 'Document', 'Job order', 'Date', 'Due date', 'Current PHP',
      '1-30 PHP', '31-60 PHP', '61-90 PHP', 'Over 90 PHP', 'Total PHP']];
    for (const r of result.rows) rows.push([r.customerName, r.documentNumber, r.jobOrderNumber, r.date, r.dueDate,
      csvPesos(r.buckets.current), csvPesos(r.buckets.days1to30), csvPesos(r.buckets.days31to60),
      csvPesos(r.buckets.days61to90), csvPesos(r.buckets.over90), csvPesos(r.totalCents)]);
    rows.push(['TOTAL', '', '', '', '', csvPesos(result.buckets.current), csvPesos(result.buckets.days1to30),
      csvPesos(result.buckets.days31to60), csvPesos(result.buckets.days61to90), csvPesos(result.buckets.over90),
      csvPesos(result.totalCents)]);
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
    if (q.format !== 'csv') return result;
    const rows: CsvCell[][] = [['Date', 'Journal', 'Document type', 'Document', 'Posting', 'Account', 'Account name', 'Party type', 'Party ID', 'Debit PHP', 'Credit PHP', 'Memo']];
    for (const j of result.journals) for (const l of j.lines) rows.push([j.businessDate, j.journalNumber, j.documentType, j.documentNumber,
      j.postingKind, l.accountCode, l.accountName, l.partyType, l.partyId, pesos(l.debitCents), pesos(l.creditCents), l.memo ?? j.journalMemo]);
    rows.push(['TOTAL', '', '', '', '', '', '', '', '', pesos(result.totalDebitCents), pesos(result.totalCreditCents), '']);
    return sendCsv(reply, `general-journal-${result.from}-${result.to}`, rows);
  });
  app.get('/api/rpt/ledger', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = range(q);
    const id = q.accountId === undefined ? undefined : Number(q.accountId);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0 || !ledgerAccounts(db).some((a) => a.id === id)))
      throw new AppError('BAD_ACCOUNT', 'Choose an account from the list.', 400);
    const result = generalLedger(db, from, to, id);
    if (q.format !== 'csv') return result;
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
    const result = incomeStatement(db, from, to);
    if (q.format !== 'csv') return result;
    const [revenue, costOfSales, operatingExpenses, other, incomeTax] = result.sections as [StatementSection, StatementSection, StatementSection, StatementSection, StatementSection];
    const rows: CsvCell[][] = [STATEMENT_HEAD, ...sectionRows(revenue), ...sectionRows(costOfSales),
      ['Gross profit', '', 'Gross profit', csvPesos(result.grossProfitCents)],
      ...sectionRows(operatingExpenses), ...sectionRows(other),
      ['Income before tax', '', 'Income before tax', csvPesos(result.incomeBeforeTaxCents)],
      ...sectionRows(incomeTax), ['Net income', '', 'Net income', csvPesos(result.netIncomeCents)]];
    return sendCsv(reply, `income-statement-${from}-${to}`, rows);
  });
  app.get('/api/rpt/balance-sheet', { config: { permission: 'rpt.books.view' } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const result = balanceSheet(db, date(q.asOf));
    if (q.format !== 'csv') return result;
    const rows: CsvCell[][] = [STATEMENT_HEAD, ...result.sections.flatMap(sectionRows),
      ['Check', '', 'Total liabilities and equity', csvPesos(result.totalLiabilitiesAndEquityCents)],
      ['Check', '', 'Total assets less liabilities and equity', csvPesos(result.differenceCents)]];
    return sendCsv(reply, `balance-sheet-${result.asOf}`, rows);
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
