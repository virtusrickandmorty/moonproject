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
import { certificatesToIssue, ewtRegister, purchasesRegister, type PurchaseClass, type SupplierRow } from './purchases.ts';
import { vatSummary } from './vat.ts';
import { vatReturnWorksheet } from './vat-return.ts';
import { quarterOf, taxDeadlines, type Quarter } from './calendar.ts';

export function taxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;
  const who = (req: FastifyRequest): Who => ({ userId: currentUser(req).userId, at: stamp(clock) });
  const write = <T>(fn: () => T) => tx(db, () => (clockGuard({ db, clock }), fn()));
  /** Changing the register needs a fresh password: a booklet decides which paper counts as a real invoice. */
  const stepUp = (req: FastifyRequest) => requireStepUp(currentUser(req), clock);

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
  type RangeQuery = { Querystring: { from?: string; to?: string; format?: string } };
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

  app.get<RangeQuery>('/api/tax/registers/sales', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = salesRegister(db, from, to);
    if (req.query.format !== 'csv') return { ...r, rows: r.rows.map((x) => ({ ...x, docTitle: title(x.docType) })) };
    return csv(reply, `sales-register-${from}-${to}`, [
      [...HEAD, 'VATable sales', 'VAT', 'Total'],
      ...r.rows.map((x) => [...lead(x), csvPesos(x.netCents), csvPesos(x.vatCents), csvPesos(x.totalCents)]),
      ['Total', '', '', '', '', '', '', '', csvPesos(r.totals.netCents), csvPesos(r.totals.vatCents), csvPesos(r.totals.totalCents)],
    ]);
  });

  app.get<RangeQuery>('/api/tax/registers/withholding-received', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = withholdingReceivedRegister(db, from, to);
    if (req.query.format !== 'csv') return { ...r, rows: r.rows.map((x) => ({ ...x, docTitle: title(x.docType) })) };
    return csv(reply, `2307-received-${from}-${to}`, [
      [...HEAD, 'ATC', '2307', 'CWT', 'VAT withheld'],
      ...r.rows.map((x) => [...lead(x), x.atc, x.certificate, csvPesos(x.cwtCents), csvPesos(x.vatWithheldCents)]),
      ['Total', '', '', '', '', '', '', '', '', '', csvPesos(r.totals.cwtCents), csvPesos(r.totals.vatWithheldCents)],
    ]);
  });

  const CLASS: Record<PurchaseClass, string> = { capital_goods: 'Capital goods', goods: 'Goods', services: 'Services' };
  const bought = (r: SupplierRow): CsvCell[] => [r.date, r.journalNumber, r.posting === 'reversal' ? 'Cancelled' : '', title(r.docType), r.documentNumber];
  const atcCell = (r: { ewtClass: string | null; atc: string | null; atcChoices: string[] }) => r.atc ?? (r.ewtClass ? `ATC to confirm (${r.atcChoices.join(' or ')})` : '');

  app.get<RangeQuery>('/api/tax/registers/purchases', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = purchasesRegister(db, from, to);
    if (req.query.format !== 'csv') return { ...r, rows: r.rows.map((x) => ({ ...x, docTitle: title(x.docType) })) };
    return csv(reply, `purchases-register-${from}-${to}`, [
      ['Date', 'Journal', 'Cancel', 'Document', 'Number', 'Supplier invoice', 'Supplier', 'TIN', 'Class', 'Amount before VAT', 'Input VAT', 'Total'],
      ...r.rows.map((x) => [
        ...bought(x), x.supplierInvoiceNo, x.supplierName, x.tin, x.purchaseClass ? CLASS[x.purchaseClass] : 'To classify',
        csvPesos(x.netCents), csvPesos(x.vatCents), csvPesos(x.totalCents),
      ]),
      ['Total', '', '', '', '', '', '', '', '', csvPesos(r.totals.netCents), csvPesos(r.totals.vatCents), csvPesos(r.totals.totalCents)],
    ]);
  });

  app.get<RangeQuery>('/api/tax/registers/ewt', { config: { permission: 'tax.registers.view' } }, async (req, reply) => {
    const { from, to } = range(req.query);
    const r = ewtRegister(db, from, to);
    if (req.query.format !== 'csv') return { ...r, rows: r.rows.map((x) => ({ ...x, docTitle: title(x.docType) })) };
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

  /** VAT of one quarter (?year=2026&quarter=3), or of today's quarter. */
  app.get<{ Querystring: QuarterQuery }>('/api/tax/vat-summary', { config: { permission: 'tax.registers.view' } }, async (req) => {
    const { year, quarter } = quarterQuery(req.query);
    return vatSummary(db, year, quarter);
  });
}
