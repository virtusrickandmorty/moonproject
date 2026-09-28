import type { FastifyInstance, FastifyRequest } from 'fastify';
import { badRequest, csvPesos, isBusinessDate, notFound, toCsv, type CsvCell } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { clockGuard } from '../../engine/documents/lifecycle.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { booklet, bookletUsage, listBooklets, registerBooklet, setBookletActive, type Who } from './booklets.ts';
import { salesRegister, withholdingReceivedRegister, type RegisterRow } from './registers.ts';

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
    return { from: q.from, to: q.to };
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
}
