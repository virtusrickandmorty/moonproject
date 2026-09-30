import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { stamp, today } from '../../platform/clock.ts';
import { tx } from '../../platform/db/driver.ts';
import { runMonth, thirteenthMonth } from '../PAY/public.ts';
import { UPLOAD, buildUpload, employerNumbers, isUploadScheme, setEmployerNumber } from './agency.ts';
import { exposureReport } from './exposure.ts';
import { SCHEMES, isMonth, remittedForRun, schemeCheck, statMonths } from './ledger.ts';
import { monthLists } from './lists.ts';

export function statRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock } = deps;

  /** The remittance check of the latest 12 months with payrolls or remittances: per scheme, recorded, remitted and left. */
  app.get('/api/stat/months', { config: { permission: 'stat.view' } }, async () =>
    statMonths(db).slice(0, 12).map((month) => ({ month, check: SCHEMES.map((s) => schemeCheck(db, s, month)) })),
  );

  /** One month's SSS, PhilHealth and Pag-IBIG lists, the 1601-C worksheet and the remittance check. */
  app.get<{ Params: { month: string } }>('/api/stat/months/:month', { config: { permission: 'stat.view' } }, async (req) => {
    if (!isMonth(req.params.month)) throw badRequest('MONTH', 'Use a month like 2026-09.');
    return monthLists(db, req.params.month, currentUser(req).permissions.has('emp.view_ids'));
  });

  /**
   * The month's upload file for an agency (SSS, PhilHealth or Pag-IBIG) as CSV, cut from the same figures as the lists. It
   * carries government ID numbers, so it needs emp.view_ids as well; each download is audited. Refused in plain words when
   * the employer's number is not set or an employee on the list has no ID number.
   */
  app.get<{ Params: { month: string; scheme: string } }>('/api/stat/months/:month/upload/:scheme', { config: { permission: 'stat.upload' } }, async (req, reply) => {
    const user = currentUser(req);
    if (!user.permissions.has('emp.view_ids')) throw forbidden('emp.view_ids');
    const scheme = req.params.scheme.toUpperCase();
    if (!isMonth(req.params.month)) throw badRequest('MONTH', 'Use a month like 2026-09.');
    if (!isUploadScheme(scheme)) throw badRequest('SCHEME', 'Pick SSS, PhilHealth (phic) or Pag-IBIG (hdmf).');
    const up = buildUpload(db, req.params.month, scheme);
    appendAudit(db, { at: stamp(clock), userId: user.userId, action: 'stat.upload_download', entityType: 'stat.upload', entityId: `${scheme}:${up.month}`, data: { scheme, month: up.month, rows: up.rows, totalCents: up.totalCents } });
    reply.header('Content-Disposition', `attachment; filename="${up.filename}"`);
    reply.header('X-Upload-Rows', String(up.rows));
    reply.header('X-Upload-Total-Cents', String(up.totalCents));
    reply.type('text/csv; charset=utf-8');
    return up.csv;
  });

  /** The employer's number at each agency, for the upload files (null: not set yet). */
  app.get('/api/stat/employer-numbers', { config: { permission: 'stat.view' } }, async () => {
    const n = employerNumbers(db);
    return (Object.keys(UPLOAD) as (keyof typeof UPLOAD)[]).map((scheme) => ({ scheme, label: UPLOAD[scheme].label, employerLabel: UPLOAD[scheme].employerLabel, number: n[scheme]?.number ?? null, since: n[scheme]?.since ?? null }));
  });

  /** Sets the employer's number at an agency (a fresh password; the old number stays as history). */
  app.put<{ Params: { scheme: string } }>('/api/stat/employer-numbers/:scheme', { config: { permission: 'stat.agency.manage' } }, async (req) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const scheme = req.params.scheme.toUpperCase();
    if (!isUploadScheme(scheme)) throw badRequest('SCHEME', 'Pick SSS, PhilHealth (phic) or Pag-IBIG (hdmf).');
    const { number } = z.object({ number: z.string().trim().min(1, 'Type the number.').max(40) }).strict().parse(req.body);
    return tx(db, () => {
      const at = stamp(clock);
      const changed = setEmployerNumber(db, scheme, number, user.userId, at);
      if (changed) appendAudit(db, { at, userId: user.userId, action: 'stat.employer_number_set', entityType: 'stat.employer_number', entityId: scheme, data: { scheme } });
      return { scheme, number, changed };
    });
  });

  /** ACC-05: months since the cut-over with pay but no contribution recorded, per employee and scheme, with estimated shares and penalties. Posts nothing. */
  app.get('/api/stat/exposure', { config: { permission: 'stat.view' } }, async () => exposureReport(db, today(clock)));

  /** D6: what of a payroll run's month is already remitted, for the warning on the run's screen before a cancel. */
  app.get<{ Params: { id: string } }>('/api/stat/runs/:id/remitted', { config: { permission: 'pay.run.view' } }, async (req) => {
    const run = runMonth(db, req.params.id);
    if (!run) throw notFound('The payroll run');
    return { month: run.contributionMonth, remitted: run.status === 'posted' ? remittedForRun(db, req.params.id, run.contributionMonth) : [] };
  });

  /** D6: what of a 13th-month pay's own month is already remitted, for the warning on its screen before a cancel. */
  app.get<{ Params: { id: string } }>('/api/stat/thirteenths/:id/remitted', { config: { permission: 'pay.thirteenth.view' } }, async (req) => {
    const t = thirteenthMonth(db, req.params.id);
    if (!t) throw notFound('The 13th-month pay');
    return { month: t.month, remitted: t.status === 'posted' ? remittedForRun(db, req.params.id, t.month) : [] };
  });
}
