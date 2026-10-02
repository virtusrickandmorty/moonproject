import type { FastifyInstance, FastifyRequest } from 'fastify';
import { badRequest, csvPesos, isBusinessDate, notFound, toCsv, type CsvCell } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { booklet, bookletUsage, listBooklets, registerBooklet, setBookletActive, type Who } from './booklets.ts';
import { salesRegister, withholdingReceivedRegister, type RegisterRow } from './registers.ts';
import { certificatesToIssue, ewtRegister, noVatPurchasesRegister, purchasesRegister, type PurchaseClass, type SupplierRow } from './purchases.ts';
import { addBacksDue, claimCandidates } from './uncollected-vat.ts';
import { settingAt } from '../../engine/settings.ts';
import { vatSummary } from './vat.ts';
import { vatReturnWorksheet, type WorksheetCheck } from './vat-return.ts';
import { quarterOf, returnDue, taxDeadlines, type Quarter } from './calendar.ts';
import { ewtMonthWorksheet, ewtQuarterWorksheet, type PaymentLine } from './ewt-return.ts';
import { parsePeriod, periodsDue } from './payments.ts';
import { finalTaxList } from './final-tax.ts';
import { markReceived } from './withholding.ts';
import { addIncomeTaxSettings, incomeTaxSettingsAt, incomeTaxSettingsHistory, incomeTaxWorksheet } from './income-tax.ts';
import { addDeductionSetting, annualIncomeTaxWorksheet, deductionAt, deductionHistory } from './annual-income-tax.ts';
import { ewtAnnualReturn } from './ewt-annual.ts';
import { classifySale, sawt, slspPurchases, slspSales, type Tie } from './slsp.ts';
import { changesAfterFiling } from './filed.ts';
import { addFiledReturn, FILED_FORMS, filedRegister, voidFiledReturn } from './filed-register.ts';
import { pageAsked, paged } from '../../platform/paging.ts';

export function taxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest): Who => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));
  /** Changing the register needs a fresh password: a booklet decides which paper counts as a real invoice. */
  const stepUp = (req: FastifyRequest) => requireStepUp(currentUser(req), clock);

  app.get('/api/tax/filed-returns', { config: { permission: 'tax.registers.view' } }, async () => ({
    rows: filedRegister(db), forms: FILED_FORMS, today: today(clock),
  }));
  app.post('/api/tax/filed-returns', { config: { permission: 'acc.settings.manage' } }, async (req) => {
    stepUp(req);
    return write(() => addFiledReturn(db, req.body, who(req), today(clock)));
  });
  app.post<{ Params: { id: string } }>('/api/tax/filed-returns/:id/void', { config: { permission: 'acc.settings.manage' } }, async (req) => {
    stepUp(req);
    return write(() => voidFiledReturn(db, Number(req.params.id), req.body, who(req)));
  });

  /** The register with each booklet's usage: numbers used, skipped and left. */
  app.get('/api/tax/booklets', { config: { permission: 'tax.booklets.view' } }, async () => listBooklets(db).map((b) => bookletUsage(db, b)));

  /** One booklet: every number used and by which document, and the skipped numbers. */
  app.get<{ Params: { id: string } }>('/api/tax/booklets/:id', { config: { permission: 'tax.booklets.view' } }, async (req) => {
    const b = booklet(db, req.params.id);
    if (!b) throw notFound('The booklet');
    return bookletUsage(db, b, true);
  });

  app.post('/api/tax/booklets', { config: { permission: 'tax.booklets.manage' } }, async (req) => {
    stepUp(req);
    return write(() => registerBooklet(db, req.body, who(req)));
  });

  app.post<{ Params: { id: string } }>('/api/tax/booklets/:id/retire', { config: { permission: 'tax.booklets.manage' } }, async (req) => {
    stepUp(req);
    return write(() => setBookletActive(db, req.params.id, req.headers['if-match'], false, req.body, who(req)));
  });

  app.post<{ Params: { id: string } }>('/api/tax/booklets/:id/activate', { config: { permission: 'tax.booklets.manage' } }, async (req) => {
    stepUp(req);
    return write(() => setBookletActive(db, req.params.id, req.headers['if-match'], true, req.body, who(req)));
  });

  // Tax registers (PLAN E12): JSON for the screens, or CSV for Excel with ?format=csv.
  type RangeQuery = { Querystring: { from?: string; to?: string; format?: string; limit?: string; offset?: string } };
  const range = (q: RangeQuery['Querystring']) => {
    if (!q.from || !q.to || !isBusinessDate(q.from) || !isBusinessDate(q.to)) throw badRequest('BAD_DATE', 'Pick the first and last dates, like 2026-07-01 and 2026-09-30.');
    if (q.to < q.from) throw badRequest('BAD_RANGE', 'The last date is before the first.');
    if (Number(q.to.slice(0, 4)) - Number(q.from.slice(0, 4)) > 5) throw badRequest('BAD_RANGE', 'Pick at most five years at a time.');
    return { from: q.from, to: q.to };
  };
  type QuarterQuery = { year?: string; quarter?: string };
  /** ?year=2026&quarter=3, or today's quarter when both are left out. */
  const quarterQuery = ({ year: y, quarter: q }: QuarterQuery): { year: number; quarter: Quarter } => {
    if (y === undefined && q === undefined) return quarterOf(today(clock));
    if (!/^\d{4}$/.test(y ?? '') || !/^[1-4]$/.test(q ?? '')) throw badRequest('BAD_QUARTER', 'Pick a year and a quarter, like 2026 and 3.');
    return { year: Number(y), quarter: Number(q) as Quarter };
  };
  const title = (docType: string | null) => (docType ? (deps.registry.docType(docType)?.title ?? docType) : 'Journal');
  const lead = (r: RegisterRow): CsvCell[] => [r.date, r.journalNumber, r.posting === 'reversal' ? 'Cancelled' : '', title(r.docType), r.documentNumber, r.formNumber, r.customerName, r.tin];
  const HEAD = ['Date', 'Journal', 'Cancel', 'Document', 'Number', 'Form no.', 'Customer', 'TIN'];
  const csv = (reply: { header(k: string, v: string): unknown; type(t: string): unknown }, name: string, rows: CsvCell[][]) => {
    reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
    reply.type('text/csv; charset=utf-8');
    return toCsv(rows);
  };

  /** A register as the screen gets it: a page of its rows when one is asked for (?limit&offset), each row with its document's title. */
  const register = <R extends { rows: { docType: string | null }[] }>(r: R, query: RangeQuery['Querystring']) => {
    const shown = paged(r, 'rows', pageAsked(query));
    return { ...shown, rows: shown.rows.map((x) => ({ ...x, docTitle: title(x.docType) })) };
  };

  app.get<RangeQuery>('/api/tax/registers/sales', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = salesRegister(db, from, to);
    if (req.query.format !== 'csv') return register(r, req.query);
    return csv(reply, `sales-register-${from}-${to}`, [
      [...HEAD, 'VATable sales', 'VAT', 'Total'],
      ...r.rows.map((x) => [...lead(x), csvPesos(x.netCents), csvPesos(x.vatCents), csvPesos(x.totalCents)]),
      ['Total', '', '', '', '', '', '', '', csvPesos(r.totals.netCents), csvPesos(r.totals.vatCents), csvPesos(r.totals.totalCents)],
    ]);
  });

  app.get<RangeQuery>('/api/tax/registers/withholding-received', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = withholdingReceivedRegister(db, from, to);
    if (req.query.format !== 'csv') return register(r, req.query);
    return csv(reply, `2307-received-${from}-${to}`, [
      [...HEAD, 'ATC', '2307', 'Received on', 'Opening 2307 for', 'CWT', 'VAT withheld'],
      ...r.rows.map((x) => [...lead(x), x.atc, x.certificate, x.receivedOn, x.period, csvPesos(x.cwtCents), csvPesos(x.vatWithheldCents)]),
      ['Total', '', '', '', '', '', '', '', '', '', '', '', csvPesos(r.totals.cwtCents), csvPesos(r.totals.vatWithheldCents)],
    ]);
  });

  /**
   * A customer's 2307 recorded as pending has come: { documentId, lineNo } names it (a collection's is line 0, an opening
   * withholding's its row). Dated today; the register shows it in hand and the next VAT close claims its VAT withheld.
   */
  app.post('/api/tax/2307s/received', { config: { permission: 'tax.2307.receive' } }, async (req) =>
    write(() => markReceived(db, req.body, { userId: currentUser(req).userId, at: stamp(clock), today: today(clock) })));

  const CLASS: Record<PurchaseClass, string> = { capital_goods: 'Capital goods', goods: 'Goods', services: 'Services' };
  const bought = (r: SupplierRow): CsvCell[] => [r.date, r.journalNumber, r.posting === 'reversal' ? 'Cancelled' : '', title(r.docType), r.documentNumber];
  const atcCell = (r: { ewtClass: string | null; atc: string | null; atcChoices: string[] }) => r.atc ?? (r.ewtClass ? `ATC to confirm (${r.atcChoices.join(' or ')})` : '');

  app.get<RangeQuery>('/api/tax/registers/purchases', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = purchasesRegister(db, from, to);
    if (req.query.format !== 'csv') return register(r, req.query);
    return csv(reply, `purchases-register-${from}-${to}`, [
      ['Date', 'Journal', 'Cancel', 'Document', 'Number', 'Supplier invoice', 'Supplier', 'TIN', 'Class', 'Amount before VAT', 'Input VAT', 'Total'],
      ...r.rows.map((x) => [
        ...bought(x), x.supplierInvoiceNo, x.supplierName, x.tin, x.purchaseClass ? CLASS[x.purchaseClass] : 'To classify',
        csvPesos(x.netCents), csvPesos(x.vatCents), csvPesos(x.totalCents),
      ]),
      ['Total', '', '', '', '', '', '', '', '', csvPesos(r.totals.netCents), csvPesos(r.totals.vatCents), csvPesos(r.totals.totalCents)],
    ]);
  });

  /** Purchases with no input VAT (bills, vouchers and assets bought): the SLP's exempt column and the 2550Q's purchases with no input tax. */
  app.get<RangeQuery>('/api/tax/registers/purchases-no-vat', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = noVatPurchasesRegister(db, from, to);
    if (req.query.format !== 'csv') return { ...r, rows: r.rows.map((x) => ({ ...x, docTitle: title(x.docType) })) };
    return csv(reply, `purchases-no-vat-${from}-${to}`, [
      ['Date', 'Journal', 'Cancel', 'Document', 'Number', 'Supplier invoice', 'Supplier', 'TIN', 'Class', 'Amount'],
      ...r.rows.map((x) => [...bought(x), x.supplierInvoiceNo, x.supplierName, x.tin, CLASS[x.purchaseClass], csvPesos(x.amountCents)]),
      ['Total', '', '', '', '', '', '', '', '', csvPesos(r.totals.amountCents)],
    ]);
  });

  /**
   * Output VAT on uncollected receivables (ACC-27): whether the accountant turned the claim on, the invoices whose time
   * to pay ended in an earlier quarter (claimable), and the claims whose customer has paid since (add-backs to record).
   */
  app.get('/api/tax/uncollected-vat', { config: { permission: 'tax.uncollected.view' } }, async () => {
    const on = today(clock);
    return { enabled: settingAt(db, 'tax.uncollected_vat_credit', on), claimable: claimCandidates(db, on), addBacksDue: addBacksDue(db, on) };
  });

  app.get<RangeQuery>('/api/tax/registers/ewt', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = ewtRegister(db, from, to);
    if (req.query.format !== 'csv') return register(r, req.query);
    return csv(reply, `ewt-register-${from}-${to}`, [
      ['Date', 'Journal', 'Cancel', 'Document', 'Number', 'Supplier', 'TIN', 'EWT class', 'ATC', 'Base', 'Rate', 'EWT'],
      ...r.rows.map((x) => [
        ...bought(x), x.supplierName, x.tin, x.ewtClass, atcCell(x),
        x.baseCents === null ? '' : csvPesos(x.baseCents), x.rateBp === null ? '' : `${x.rateBp / 100}%`, csvPesos(x.ewtCents),
      ]),
      ['Total', '', '', '', '', '', '', '', '', csvPesos(r.totals.baseCents), '', csvPesos(r.totals.ewtCents)],
    ]);
  });

  /** The 2307s to issue for a quarter (?year=2026&quarter=3, or today's quarter): per supplier and ATC, each month's base and EWT. */
  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/2307-to-issue', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { year, quarter } = quarterQuery(req.query);
    const r = certificatesToIssue(db, year, quarter);
    if (req.query.format !== 'csv') return r;
    return csv(reply, `2307-to-issue-${year}-Q${quarter}`, [
      ['Supplier', 'TIN', 'EWT class', 'ATC', ...r.months.flatMap((m) => [`${m} base`, `${m} EWT`]), 'Quarter base', 'Quarter EWT'],
      ...r.lines.map((l) => [
        l.supplierName, l.tin, l.ewtClass, atcCell(l), ...l.months.flatMap((m) => [csvPesos(m.baseCents), csvPesos(m.ewtCents)]), csvPesos(l.baseCents), csvPesos(l.ewtCents),
      ]),
      ['Total', '', '', '', ...r.months.flatMap(() => ['', '']), csvPesos(r.totals.baseCents), csvPesos(r.totals.ewtCents)],
    ]);
  });

  /** Tax deadlines due in a range (the calendar, and the accountant home's next 30 days). */
  app.get<RangeQuery>('/api/tax/calendar', { config: { permission: 'tax.calendar.view' } }, async (req) => {
    const { from, to } = range(req.query);
    return taxDeadlines(db, from, to);
  });

  /** The 2550Q worksheet of one quarter (?year=2026&quarter=3, or today's quarter): each item of the return, and the checks before filing. */
  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/2550q', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { year, quarter } = quarterQuery(req.query);
    const w = vatReturnWorksheet(db, year, quarter, today(clock));
    if (req.query.format !== 'csv') return w;
    return csv(reply, `2550Q-worksheet-${year}-Q${quarter}`, [
      ['Item', 'Amount', 'Tax'],
      ...w.lines.map((l) => [l.label, l.amountCents === null ? '' : csvPesos(l.amountCents), csvPesos(l.taxCents)]),
      ...w.checks.map((c) => [`Check: ${c.message}`, '', '']),
    ]);
  });

  // 0619-E and 1601-EQ worksheets: the EWT by ATC, the BIR payments made for it and what is left.
  const HEAD_EWT = ['Item', 'ATC', 'EWT class', 'Base', 'EWT'];
  const atcRows = (item: string, rows: { atc: string | null; ewtClass: string | null; atcChoices: string[]; baseCents: number; ewtCents: number }[]): CsvCell[][] =>
    rows.map((l) => [item, atcCell(l) || 'To classify', l.ewtClass, csvPesos(l.baseCents), csvPesos(l.ewtCents)]);
  const paidRow = (item: string, x: PaymentLine): CsvCell[] => [`${item} ${x.number} on ${x.date} (${x.reference})`, '', '', '', csvPesos(x.amountCents)];
  const amountRow = (item: string, cents: number): CsvCell[] => [item, '', '', '', csvPesos(cents)];
  const checkRows = (checks: WorksheetCheck[]): CsvCell[][] => checks.map((c) => [`Check: ${c.message}`, '', '', '', '']);
  /** What the opening tax payables left to pay with the return (a period before the cut-over date), if anything. */
  const openingRows = (w: { openingCents: number; openings: { number: string }[] }): CsvCell[][] =>
    w.openingCents ? [amountRow(`Left to pay by the old books (${[...new Set(w.openings.map((o) => o.number))].join(', ')})`, w.openingCents)] : [];

  /** The 0619-E worksheet of month 1 or 2 of a quarter (?month=2026-07). */
  app.get<{ Querystring: { month?: string; format?: string } }>('/api/tax/0619e', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const month = req.query.month ?? '';
    const p = parsePeriod(month);
    if (!p || p.kind !== 'month') throw badRequest('BAD_MONTH', 'Pick a month, like 2026-07.');
    if (p.month! % 3 === 0) throw badRequest('THIRD_MONTH', `${p.label} is the last month of a quarter, which has no 0619-E: its EWT goes on the 1601-EQ.`);
    const w = ewtMonthWorksheet(db, month, today(clock));
    if (req.query.format !== 'csv') return w;
    return csv(reply, `0619-E-worksheet-${month}`, [
      HEAD_EWT,
      ...atcRows('EWT withheld', w.atcs),
      ...openingRows(w),
      ['Total due', '', '', csvPesos(w.totals.baseCents), csvPesos(w.dueCents)],
      ...w.payments.map((x) => paidRow('Paid', x)),
      amountRow('Left to pay', w.leftCents),
      ...checkRows(w.checks),
    ]);
  });

  /** The 1601-EQ worksheet of a quarter (?year=2026&quarter=3, or today's quarter), with the QAP. */
  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/1601eq', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { year, quarter } = quarterQuery(req.query);
    const w = ewtQuarterWorksheet(db, year, quarter, today(clock));
    if (req.query.format !== 'csv') return w;
    return csv(reply, `1601-EQ-worksheet-${year}-Q${quarter}`, [
      HEAD_EWT,
      ...atcRows('EWT withheld in the quarter', w.atcs),
      ['Total EWT of the quarter', '', '', csvPesos(w.totals.baseCents), csvPesos(w.totals.ewtCents)],
      ...openingRows(w),
      ...w.remittances.flatMap((r) => (r.payments.length ? r.payments.map((x) => paidRow(`Less 0619-E for ${r.label}:`, x)) : [amountRow(`Less 0619-E for ${r.label}: none recorded`, 0)])),
      amountRow('Due with the 1601-EQ', w.dueCents),
      ...w.payments.map((x) => paidRow('Paid', x)),
      amountRow('Left to pay', w.leftCents),
      ...checkRows(w.checks),
      [],
      ['QAP'],
      ['TIN', 'Registered name', 'ATC', 'Base', 'Rate', 'EWT withheld'],
      ...w.qap.map((l) => [l.tin, l.registeredName, atcCell(l) || 'To classify', csvPesos(l.baseCents), l.rateBp === null ? '' : `${l.rateBp / 100}%`, csvPesos(l.ewtCents)]),
      ['Total', '', '', csvPesos(w.totals.baseCents), '', csvPesos(w.totals.ewtCents)],
    ]);
  });

  /**
   * The 1702Q worksheet of Q1, Q2 or Q3 (?year=2026&quarter=3; left out, today's quarter, or Q3 in Q4): the year to date
   * from the ledger in whole pesos, the tax at the regular rate or MCIT, the credits, what is left to pay, and the checks.
   */
  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/1702q', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const defaulted = req.query.year === undefined && req.query.quarter === undefined;
    const { year, quarter } = quarterQuery(req.query);
    if (quarter === 4 && !defaulted) throw badRequest('NO_Q4', `Q4 has no 1702Q: the annual income tax return (1702) covers ${year}.`);
    const w = incomeTaxWorksheet(db, year, quarter === 4 ? 3 : quarter, today(clock));
    if (req.query.format !== 'csv') return w;
    const row = (item: string, cents: number | null): CsvCell[] => [item, cents === null ? '' : csvPesos(cents)];
    return csv(reply, `1702Q-worksheet-${w.year}-Q${w.quarter}`, [
      ['Item', 'Amount'],
      ...w.lines.map((l) => row(l.label, l.cents)),
      ...(w.opening ? [row(`Left to pay by the old books (${w.opening.number})`, w.openingCents)] : []),
      row('Due with the 1702Q', w.dueCents),
      ...w.payments.map((x) => row(`Paid with ${x.number} on ${x.date} (${x.reference})`, x.amountCents)),
      row('Left to pay', w.leftCents),
      row(`Rates in force on ${w.to}: regular ${w.settings.regularRateBp / 100}%, MCIT ${w.settings.mcitRateBp / 100}%, operations began ${w.settings.operationsBeganYear ?? 'not confirmed'}`, null),
      ...w.checks.map((c) => row(`Check: ${c.message}`, null)),
    ]);
  });

  // SLSP and SAWT data of a quarter (?year=2026&quarter=3, or today's quarter): the columns in the BIR data-entry order
  // as best known (the accountant checks them against the current RELIEF and SAWT formats, ACC-25), then the ERP's own
  // columns, a total row, and how the totals tie to the registers and the books.
  const taxableMonth = (to: string) => `${to.slice(5, 7)}/${to.slice(8, 10)}/${to.slice(0, 4)}`;
  const tieRows = (ties: Tie[], width: number): CsvCell[][] => [
    [], ['Tie to the registers and the books', 'List', 'Books', 'Difference'],
    ...ties.map((t) => [t.label, csvPesos(t.listCents), csvPesos(t.bookCents), csvPesos(t.differenceCents), ...Array<string>(Math.max(width - 4, 0)).fill('')]),
  ];
  const NAMES = ['TIN', 'Registered name', 'Last name', 'First name', 'Middle name', 'Address 1', 'Address 2'];

  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/slsp/sales', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { year, quarter } = quarterQuery(req.query);
    const r = slspSales(db, year, quarter, today(clock));
    if (req.query.format !== 'csv') return { ...r, noVatSales: r.noVatSales.map((x) => ({ ...x, docTitle: title(x.docType) })) };
    const head = ['Taxable month', ...NAMES, 'Exempt sales', 'Zero-rated sales', 'Taxable sales', 'Output tax', 'Gross taxable sales', 'Still to classify', 'Customers', 'Flag'];
    return csv(reply, `slsp-sales-${year}-Q${quarter}`, [
      head,
      ...r.rows.map((x) => [
        taxableMonth(r.to), x.tin, x.registeredName, '', '', '', x.address, '', csvPesos(x.exemptCents), csvPesos(x.zeroRatedCents), csvPesos(x.vatableCents),
        csvPesos(x.outputTaxCents), csvPesos(x.grossTaxableCents), csvPesos(x.toClassifyCents), x.customers, x.tin ? '' : 'No TIN',
      ]),
      ['Total', '', '', '', '', '', '', '', csvPesos(r.totals.exemptCents), csvPesos(r.totals.zeroRatedCents), csvPesos(r.totals.vatableCents),
        csvPesos(r.totals.outputTaxCents), csvPesos(r.totals.grossTaxableCents), csvPesos(r.totals.toClassifyCents), '', ''],
      ...tieRows(r.ties, head.length),
    ]);
  });

  /** A sale with no output VAT (a journal voucher) is zero-rated, exempt or not a sale: { journalId, saleClass, reason }. Posts nothing. */
  app.post('/api/tax/slsp/sale-class', { config: { permission: 'tax.slsp.classify' } }, async (req) =>
    write(() => classifySale(db, req.body, { userId: currentUser(req).userId, at: stamp(clock) })));

  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/slsp/purchases', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { year, quarter } = quarterQuery(req.query);
    const r = slspPurchases(db, year, quarter, today(clock));
    if (req.query.format !== 'csv') return r;
    const head = ['Taxable month', ...NAMES, 'Exempt purchases', 'Zero-rated purchases', 'Services', 'Capital goods', 'Goods other than capital goods', 'Input tax',
      'Gross taxable purchases', 'Still to classify', 'Flag'];
    const t = r.totals;
    return csv(reply, `slsp-purchases-${year}-Q${quarter}`, [
      head,
      ...r.rows.map((x) => [
        taxableMonth(r.to), x.tin, x.registeredName, '', '', '', x.address, '', csvPesos(x.exemptCents), csvPesos(x.zeroRatedCents), csvPesos(x.servicesCents),
        csvPesos(x.capitalGoodsCents), csvPesos(x.goodsCents), csvPesos(x.inputTaxCents), csvPesos(x.grossTaxableCents), csvPesos(x.toClassifyCents), x.tin ? '' : 'No TIN',
      ]),
      ['Total', '', '', '', '', '', '', '', csvPesos(t.exemptCents), csvPesos(t.zeroRatedCents), csvPesos(t.servicesCents), csvPesos(t.capitalGoodsCents),
        csvPesos(t.goodsCents), csvPesos(t.inputTaxCents), csvPesos(t.grossTaxableCents), csvPesos(t.toClassifyCents), ''],
      ...tieRows(r.ties, head.length),
    ]);
  });

  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/sawt', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { year, quarter } = quarterQuery(req.query);
    const r = sawt(db, year, quarter, today(clock));
    if (req.query.format !== 'csv') return r;
    const head = ['Seq. no.', 'TIN', 'Registered name', 'Last name', 'First name', 'Middle name', 'ATC', 'Nature of income payment', 'Tax rate', 'Income payment',
      'Tax withheld', 'VAT withheld', '2307', 'Opening 2307 for', 'Documents', 'Flag'];
    const rate = (bp: number | null) => (bp === null ? '' : `${bp / 100}%`);
    const flag = (x: (typeof r.rows)[number]) =>
      [x.certificate === 'pending' ? '2307 pending' : '', x.certificate === null ? 'No 2307 recorded' : '', x.tin ? '' : 'No TIN'].filter(Boolean).join('; ');
    return csv(reply, `sawt-${year}-Q${quarter}`, [
      head,
      ...r.rows.map((x, i) => [
        i + 1, x.tin, x.registeredName, '', '', '', x.atc === 'other' ? '' : x.atc, x.nature, rate(x.rateBp),
        x.incomePaymentCents === null ? '' : csvPesos(x.incomePaymentCents), csvPesos(x.cwtCents), csvPesos(x.vatWithheldCents),
        x.certificate === 'received' ? 'In hand' : x.certificate === 'pending' ? 'Pending' : '', x.period, x.documents.join(' '), flag(x),
      ]),
      ['Total', '', '', '', '', '', '', '', '', csvPesos(r.totals.incomePaymentCents), csvPesos(r.totals.cwtCents), csvPesos(r.totals.vatWithheldCents), '', '', '', ''],
      ...tieRows(r.ties, head.length),
    ]);
  });

  /** The income tax settings (rates, year operations began): the version in force today and every version, newest first. */
  app.get('/api/tax/income-tax-settings', { config: { permission: 'tax.registers.view' } }, async () => ({
    current: incomeTaxSettingsAt(db, today(clock)), versions: incomeTaxSettingsHistory(db),
  }));

  /** A new version from today or later ({ effectiveFrom, value, reason }). Needs a fresh password, like every dated setting. */
  app.post('/api/tax/income-tax-settings', { config: { permission: 'acc.settings.manage' } }, async (req) => {
    requireStepUp(currentUser(req), clock);
    return write(() => addIncomeTaxSettings(db, req.body, { userId: currentUser(req).userId, at: stamp(clock), today: today(clock) }));
  });

  type YearQuery = { year?: string; format?: string };
  /** ?year=2026, or last year when left out (the annual returns are filed early the next year). */
  const yearQuery = ({ year }: YearQuery): number => {
    if (year === undefined) return Number(today(clock).slice(0, 4)) - 1;
    if (!/^\d{4}$/.test(year)) throw badRequest('BAD_YEAR', 'Pick a year, like 2026.');
    return Number(year);
  };

  /**
   * The 1702-RT worksheet of a year (?year=2026, or last year): the year from the ledger in whole pesos, the deductions
   * (itemized or the 40% optional standard deduction), the tax at the regular rate or MCIT, the credits, what is payable
   * or carried over; the provision, the settlement and the 1702 payments; and the checks.
   */
  app.get<{ Querystring: YearQuery }>('/api/tax/1702rt', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const year = yearQuery(req.query);
    const w = annualIncomeTaxWorksheet(db, year, today(clock));
    if (req.query.format !== 'csv') return w;
    const row = (item: string, cents: number | null): CsvCell[] => [item, cents === null ? '' : csvPesos(cents)];
    const ref = (what: string, d: { number: string; date: string } | null) => (d ? `${what} ${d.number} on ${d.date}` : `${what}: not recorded`);
    return csv(reply, `1702-RT-worksheet-${year}`, [
      ['Item', 'Amount'],
      ...w.lines.map((l) => row(l.label, l.cents)),
      row(ref('Provision', w.provision), w.provision?.amountCents ?? null),
      row(ref('Settlement', w.settlement), w.settlement?.payableCents ?? null),
      ...(w.opening ? [row(`Left to pay by the old books (${w.opening.number})`, w.dueCents)] : []),
      row('Due with the 1702', w.dueCents),
      ...w.payments.map((x) => row(`Paid with ${x.number} on ${x.date} (${x.reference})`, x.amountCents)),
      row('Left to pay', w.leftCents),
      row(`Rates in force on ${w.to}: regular ${w.settings.regularRateBp / 100}%, MCIT ${w.settings.mcitRateBp / 100}%, operations began ${w.settings.operationsBeganYear ?? 'not confirmed'}`, null),
      row(`Deductions: ${w.deduction.method === 'osd' ? 'optional standard deduction (40%)' : 'itemized'}${w.deduction.confirmed ? '' : ', the default, not confirmed'}`, null),
      ...w.checks.map((c) => row(`Check: ${c.message}`, null)),
    ]);
  });

  /** The deduction method of a year (?year=2026, or last year): the version in force today and every version, newest first. */
  app.get<{ Querystring: YearQuery }>('/api/tax/income-tax-deductions', { config: { permission: 'tax.registers.view' } }, async (req) => {
    const year = yearQuery(req.query);
    return { year, current: deductionAt(db, year, today(clock)), versions: deductionHistory(db, year) };
  });

  /** A new version for a year from today or later ({ year, method, effectiveFrom, reason }), with a fresh password. */
  app.post('/api/tax/income-tax-deductions', { config: { permission: 'acc.settings.manage' } }, async (req) => {
    requireStepUp(currentUser(req), clock);
    return write(() => addDeductionSetting(db, req.body, { userId: currentUser(req).userId, at: stamp(clock), today: today(clock) }));
  });

  /**
   * The 1604-E data of a year (?year=2026, or last year): the alphalist (EWT per payee and ATC, per quarter and for the
   * year) and its tie-out to the four quarters' QAP, 1601-EQ worksheets, EWT register and books, with what each quarter
   * paid and left.
   */
  app.get<{ Querystring: YearQuery }>('/api/tax/1604e', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const year = yearQuery(req.query);
    const r = ewtAnnualReturn(db, year, today(clock));
    if (req.query.format !== 'csv') return r;
    const ewt = (cents: number) => csvPesos(cents);
    return csv(reply, `1604-E-${year}`, [
      ['Alphalist of payees'],
      ['TIN', 'Registered name', 'ATC', 'Rate', 'Q1 EWT', 'Q2 EWT', 'Q3 EWT', 'Q4 EWT', 'Base', 'EWT withheld'],
      ...r.alphalist.map((p) => [
        p.tin, p.registeredName, atcCell(p) || 'To classify', p.rateBp === null ? '' : `${p.rateBp / 100}%`, ...p.quarters.map(ewt), ewt(p.baseCents), ewt(p.ewtCents),
      ]),
      ['Total', '', '', '', '', '', '', '', ewt(r.totals.baseCents), ewt(r.totals.ewtCents)],
      [],
      ['Tie-out to the quarters'],
      ['Quarter', 'QAP', '1601-EQ worksheet', 'EWT register', 'Books (2311)', 'Tied', 'Due', 'Paid with the 0619-E', 'Paid with the 1601-EQ', 'Left to pay'],
      ...r.quarters.map((q) => [
        `Q${q.quarter} ${year}`, ewt(q.qapCents), ewt(q.worksheetCents), ewt(q.registerCents), ewt(q.glCents), q.tied ? 'Yes' : 'No',
        ewt(q.dueCents), ewt(q.remittedCents), ewt(q.paidCents), ewt(q.leftCents),
      ]),
      [`Year ${year}`, ewt(r.quartersCents), '', ewt(r.registerCents), ewt(r.glCents), r.tied ? 'Yes' : 'No'],
      ...r.checks.map((c) => [`Check: ${c.message}`]),
    ]);
  });

  /**
   * The final tax withheld per stockholder, with TIN (PLAN D5 DIV): a quarter (?year=2026&quarter=3, the 1601-FQ) or a
   * year (?year=2026, the 1604-F alphalist), with what the books hold on 2312 and what the 1601-FQ payments paid.
   */
  app.get<{ Querystring: QuarterQuery & { format?: string } }>('/api/tax/final-tax', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const q = req.query;
    const w = q.year !== undefined && q.quarter === undefined && /^\d{4}$/.test(q.year) ? finalTaxList(db, Number(q.year), null) : (() => {
      const { year, quarter } = quarterQuery(q);
      return finalTaxList(db, year, quarter);
    })();
    const due = w.quarter ? returnDue(db, '1601-FQ', w.period, w.to) : returnDue(db, '1604-F', w.period, w.to);
    if (req.query.format !== 'csv') return { ...w, dueDate: due };
    const kind = (k: string) => (k === 'individual' ? 'Individual' : 'Domestic corporation');
    return csv(reply, `${w.quarter ? '1601-FQ' : '1604-F'}-final-tax-${w.period}`, [
      ['Date', 'Declaration', 'Board resolution', 'Stockholder', 'TIN', 'Kind', 'Shares', 'Dividend', 'Rate', 'Final tax', 'Net paid or payable'],
      ...w.rows.map((r) => [r.date, r.number, r.resolutionNumber, r.name, r.tin ?? 'No TIN', kind(r.holderKind), r.shares, csvPesos(r.grossCents), `${r.taxRateBp / 100}%`, csvPesos(r.taxCents), csvPesos(r.netCents)]),
      ['Total', '', '', '', '', '', '', csvPesos(w.totals.grossCents), '', csvPesos(w.totals.taxCents), csvPesos(w.totals.netCents)],
      ['Books (2312)', '', '', '', '', '', '', '', '', csvPesos(w.withheldCents), ''],
      ...(w.quarter ? [['Paid with the 1601-FQ', '', '', '', '', '', '', '', '', csvPesos(w.paidCents), ''], ['Left to pay', '', '', '', '', '', '', '', '', csvPesos(w.leftCents), '']] : []),
    ]);
  });

  /** Every return with something left to pay (a VAT close or an opening's 2550Q, EWT withheld or opened, a 1702Q or a 1702, a 1601-FQ), for the BIR payment form. */
  app.get('/api/tax/payments/due', { config: { permission: 'tax.payment.create' } }, async () => periodsDue(db, today(clock)));

  /** VAT of one quarter (?year=2026&quarter=3), or of today's quarter. */
  app.get<{ Querystring: QuarterQuery }>('/api/tax/vat-summary', { config: { permission: 'tax.registers.view' } }, async (req) => {
    const { year, quarter } = quarterQuery(req.query);
    return vatSummary(db, year, quarter);
  });

  /** ACC-22: documents dated in a filed period recorded or cancelled after its filing source was recorded (?format=csv). */
  app.get<{ Querystring: { format?: string } }>('/api/tax/changes-after-filing', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const rows = changesAfterFiling(db).map((r) => ({ ...r, docTitle: title(r.docType) }));
    if (req.query.format !== 'csv') return { rows };
    return csv(reply, `changes-after-filing-${today(clock)}`, [
      ['Date', 'Document', 'Number', 'What happened', 'Who', 'When', 'Return', 'Period', 'Paid with', 'Payment recorded'],
      ...rows.map((r) => [r.date, r.docTitle, r.number, r.what === 'recorded' ? 'Recorded' : 'Cancelled', r.userName, r.at, r.form, r.periodLabel, r.paymentNumber, r.paymentRecordedAt]),
    ]);
  });
}
