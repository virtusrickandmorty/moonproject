import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, forbidden, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { settingAt } from '../../engine/settings.ts';
import { renderPrint, type Profile, type PrintHeader, type PrintKind } from './print.ts';

const profileInput = z.object({
  registeredName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().min(1).max(200),
  tin: z.string().trim().min(1).max(40),
  registeredAddress: z.string().trim().min(1).max(500),
  isVatRegistered: z.boolean(),
}).strict();
const printInput = z.object({ variant: z.enum(['document', 'job_ticket', 'thermal']).default('document'), employeeId: z.string().uuid().optional() }).strict();
const PRINTABLE: ReadonlyMap<string, readonly PrintKind[]> = new Map([
  ['quo.quotation', ['document']],
  ['jo.job_order', ['document', 'job_ticket']],
  ['jo.release', ['document']],
  ['pur.po', ['document']],
  ['col.collection', ['document', 'thermal']],
  ['col.credit_memo', ['document']],
  ['ap.payment', ['document']],
  ['exp.voucher', ['document']],
  ['cash.transfer', ['document']],
  ['cash.count', ['document']],
  ['acc.jv', ['document']],
  ['pay.run', ['document']],
  ['ca.advance', ['document']],
  ['inv.count', ['document']],
]);
const out = (r: Profile) => ({ registeredName: r.registered_name, tradeName: r.trade_name, tin: r.tin,
  registeredAddress: r.registered_address, isVatRegistered: !!r.is_vat_registered, version: r.version });

export function prtRoutes(app: FastifyInstance, { db, clock, registry, practice }: AppDeps): void {
  app.get('/api/prt/printable-types', { config: { permission: 'authenticated' } }, async (req) => {
    const user = currentUser(req);
    return [...PRINTABLE].filter(([key]) => {
      const def = registry.docType(key);
      return def && user.permissions.has(def.permissions.view);
    }).map(([key, variants]) => ({ key, variants }));
  });

  app.get('/api/prt/company-profile', { config: { permission: 'prt.profile.view' } }, async () => {
    const row = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
    return row ? out(row) : { registeredName: '', tradeName: '', tin: '', registeredAddress: '', isVatRegistered: false, version: 0 };
  });

  app.get('/api/prt/company-profile/history', { config: { permission: 'prt.profile.manage' } }, async () =>
    (db.prepare('SELECT * FROM prt_company_profile_history ORDER BY version DESC').all() as (Profile & { superseded_at: string })[])
      .map((r) => ({ ...out(r), supersededAt: r.superseded_at })));

  app.put('/api/prt/company-profile', { config: { permission: 'prt.profile.manage' } }, async (req) => {
    const user = currentUser(req);
    requireStepUp(user, clock);
    const raw = req.headers['if-match'];
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new AppError('VERSION_REQUIRED', 'Reload the company profile before saving.', 428);
    const input = profileInput.parse(req.body);
    return tx(db, () => {
      const before = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
      const expected = before?.version ?? 0;
      if (Number(raw) !== expected) throw conflict('VERSION_CHANGED', 'Someone changed the company profile. Reload and review their changes.');
      const after = { registered_name: input.registeredName, trade_name: input.tradeName, tin: input.tin,
        registered_address: input.registeredAddress, is_vat_registered: Number(input.isVatRegistered), version: expected + 1 };
      const changedFields = Object.keys(after).filter((key) => key !== 'version' && before?.[key as keyof Profile] !== after[key as keyof typeof after]);
      if (before && changedFields.length === 0) throw new AppError('NO_CHANGES', 'Nothing changed.', 400);
      const at = stamp(clock);
      if (before) {
        db.prepare(`INSERT INTO prt_company_profile_history
          (registered_name, trade_name, tin, registered_address, is_vat_registered, version, superseded_at, superseded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(before.registered_name, before.trade_name, before.tin,
          before.registered_address, before.is_vat_registered, before.version, at, user.userId);
        db.prepare(`UPDATE prt_company_profile SET registered_name = ?, trade_name = ?, tin = ?, registered_address = ?,
          is_vat_registered = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = 1`).run(
          after.registered_name, after.trade_name, after.tin, after.registered_address,
          after.is_vat_registered, after.version, at, user.userId);
      } else {
        db.prepare(`INSERT INTO prt_company_profile
          (id, registered_name, trade_name, tin, registered_address, is_vat_registered, version, updated_at, updated_by)
          VALUES (1, ?, ?, ?, ?, ?, 1, ?, ?)`).run(after.registered_name, after.trade_name,
          after.tin, after.registered_address, after.is_vat_registered, at, user.userId);
      }
      appendAudit(db, { at, userId: user.userId, action: 'prt.company_profile_edit', entityType: 'prt.company_profile',
        entityId: '1', data: { fromVersion: expected, toVersion: after.version, changedFields } });
      return out(after);
    });
  });

  app.post<{ Params: { type: string; id: string } }>('/api/prt/print/:type/:id',
    { config: { permission: 'authenticated' } }, async (req) => {
      const user = currentUser(req);
      const { type, id } = req.params;
      const input = printInput.parse(req.body ?? {});
      const kind = input.variant as PrintKind;
      const def = registry.docType(type);
      if (!def || !PRINTABLE.get(type)?.includes(kind)) throw notFound('That printout');
      if (!user.permissions.has(def.permissions.view)) throw forbidden(def.permissions.view);
      return tx(db, () => {
        const h = db.prepare('SELECT id, number, business_date, doc_type, status FROM documents WHERE id = ? AND doc_type = ?').get(id, type) as PrintHeader | undefined;
        if (!h) throw notFound('The document');
        if (type === 'col.collection' && settingAt(db, 'col.cr_mode', h.business_date).mode !== 'system') {
          throw conflict('BOOKLET_CR_NOT_PRINTABLE', 'Collection receipts cannot be printed in booklet mode. Use the pre-printed receipt booklet.');
        }
        const profile = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
        if (!profile) throw conflict('COMPANY_PROFILE_REQUIRED', 'An owner must complete the company profile before printing.');
        const loaded: any = def.load(db, id);
        const doc = type === 'pay.run' && input.employeeId
          ? { ...loaded, employees: loaded.employees.filter((e: any) => e.employeeId === input.employeeId) }
          : loaded;
        if (type === 'pay.run' && input.employeeId && doc.employees.length === 0) throw notFound('That employee on this payroll run');
        const copyNumber = (db.prepare('SELECT COALESCE(MAX(copy_number), 0) + 1 AS n FROM prt_print_log WHERE document_id = ? AND print_kind = ?')
          .get(id, kind) as { n: number }).n;
        const at = stamp(clock);
        const html = renderPrint(db, h, doc, profile, kind, user.displayName, at, copyNumber, practice);
        db.prepare('INSERT INTO prt_print_log (document_id, user_id, printed_at, copy_number, print_kind) VALUES (?, ?, ?, ?, ?)')
          .run(id, user.userId, at, copyNumber, kind);
        appendAudit(db, { at, userId: user.userId, action: 'prt.print', entityType: 'document', entityId: id,
          data: { type, kind, copyNumber } });
        return { html, copyNumber };
      });
    });
}
