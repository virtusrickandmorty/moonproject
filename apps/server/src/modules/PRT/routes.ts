import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, conflict, forbidden, notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { printLinkBase } from '../../engine/security/tls/routes.ts';
import { requireStepUp } from '../../engine/security/sessions.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp } from '../../platform/clock.ts';
import { today } from '../../platform/clock.ts';
import { settingAt } from '../../engine/settings.ts';
import { certificatesToIssue } from '../TAX/public.ts';
import { customerStatement } from '../RPT/receivables.ts';
import { assetSchedule } from '../RPT/cash-assets.ts';
import { sizingProfile } from '../CUS/public.ts';
import { bookPrintRoutes, testBookPrints } from './book-routes.ts';
import { render2307, renderPrint, renderReportPrint, printField, printLineTable, printMoney, type Certificate2307, type Profile, type PrintHeader, type PrintKind } from './print.ts';

const profileInput = z.object({
  registeredName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().min(1).max(200),
  tin: z.string().trim().min(1).max(40),
  registeredAddress: z.string().trim().min(1).max(500),
  isVatRegistered: z.boolean(),
}).strict();
const printInput = z.object({ variant: z.enum(['document', 'job_ticket', 'thermal']).default('document'), employeeId: z.string().uuid().optional() }).strict();
const statementPrintInput = z.object({ customerId: z.string().min(1), from: z.iso.date(), to: z.iso.date() }).strict();
const sizingPrintInput = z.object({ personId: z.string().min(1) }).strict();
const assetPrintInput = z.object({ asOf: z.iso.date() }).strict();
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

const TEST_PROFILE: Profile = { registered_name: 'Sample Garments Company', trade_name: 'Sample Garments',
  tin: '000-000-000-000', registered_address: '123 Sample Street, Manila', is_vat_registered: 1, version: 1 };
const testHeader = (type: string): PrintHeader => ({ id: '00000000-0000-4000-8000-000000000000', number: 'TEST-000000',
  business_date: '2026-09-28', doc_type: type, status: 'posted' });
const quote = { customerName: 'Sample Customer', validUntil: '2026-10-13', documentDiscountCents: 5000, totalCents: 107000,
  lines: [{ description: 'Sample uniform', qty: 2, unit: 'pc', unitPriceCents: 56000, discountCents: 0, lineTotalCents: 112000 }] };
const job = { customerName: 'Sample Customer', dueDate: '2026-10-13', priority: 'normal', totalCents: 112000,
  requiredDownpaymentCents: 56000, paymentTerms: '50% downpayment', lines: [{ lineNo: 1, description: 'Sample uniform', qty: 2,
    unitPriceCents: 56000, discountCents: 0, lineTotalCents: 112000, roster: [{ wearerName: 'Sample Wearer', size: 'M', jerseyName: 'SAMPLE', jerseyNumber: '10', qty: 2 }] }] };
/** A journal voucher line for the sample print only (the house rule keeps posting lines in doctypes). */
const jvLine = (...[accountCode, accountName, debitCents, creditCents]: [string, string, number, number]) => ({ accountCode, accountName, debitCents, creditCents });
const TEST_PRINTS: readonly { id: string; label: string; paper: string; type: string; kind: PrintKind; doc: unknown }[] = [
  { id: 'quotation', label: 'Quotation', paper: 'A4', type: 'quo.quotation', kind: 'document', doc: quote },
  { id: 'job-order', label: 'Job Order (customer copy)', paper: 'A4', type: 'jo.job_order', kind: 'document', doc: job },
  { id: 'job-ticket', label: 'Job Ticket', paper: 'A4', type: 'jo.job_order', kind: 'job_ticket', doc: job },
  { id: 'release-slip', label: 'Release Slip', paper: 'A4 2-up', type: 'jo.release', kind: 'document', doc: { jobOrderId: '00000000-0000-4000-8000-000000000000', jobOrderNumber: 'TEST-JO-000000', customerName: 'Sample Customer', lines: [{ description: 'Sample uniform', qty: 2 }], claimedBy: 'Sample Customer', idSeen: 'Sample ID', balanceDueCents: 56000 } },
  { id: 'collection-a4', label: 'Collection Receipt', paper: 'A4 2-up', type: 'col.collection', kind: 'document', doc: { customerName: 'Sample Customer', applications: [{ jobOrderNumber: 'TEST-JO-000000', amountCents: 56000 }], sales: [], totalCents: 56000, cwtCents: 0, vatWithheldCents: 0, unappliedCents: 0, note: 'Sample payment' } },
  { id: 'collection-80mm', label: 'Collection Receipt', paper: '80 mm', type: 'col.collection', kind: 'thermal', doc: { customerName: 'Sample Customer', applications: [{ jobOrderNumber: 'TEST-JO-000000', amountCents: 56000 }], sales: [], totalCents: 56000, cwtCents: 0, vatWithheldCents: 0, unappliedCents: 0 } },
  { id: 'credit-memo', label: 'Credit Memo', paper: 'A4', type: 'col.credit_memo', kind: 'document', doc: { customerName: 'Sample Customer', invoice: { number: 'TEST-IR-000000' }, kind: 'allowance', reason: 'Sample adjustment', netCents: 10000, vatCents: 1200, totalCents: 11200 } },
  { id: 'purchase-order', label: 'Purchase Order', paper: 'A4', type: 'pur.po', kind: 'document', doc: { supplierId: 'sample', expectedDate: '2026-10-13', totalCents: 25000, lines: [{ supplyId: 'sample', qty: 5, unitCostCents: 5000, lineTotalCents: 25000 }] } },
  { id: 'payment-voucher', label: 'Payment Voucher', paper: 'A4 2-up', type: 'ap.payment', kind: 'document', doc: { supplierName: 'Sample Supplier', bills: [{ billNumber: 'TEST-BILL', supplierInvoiceNo: 'SAMPLE-1', amountCents: 25000 }], tenders: [{ cashPlaceName: 'Sample Bank', reference: 'TEST', amountCents: 25000 }], feeCents: 0, totalCents: 25000 } },
  { id: 'expense-voucher', label: 'Expense Voucher', paper: 'A4', type: 'exp.voucher', kind: 'document', doc: { payee: { name: 'Sample Payee' }, categoryName: 'Sample expense', description: 'Sample supplies', cashPlaceName: 'Sample Cash', totalCents: 11200, inputVatCents: 1200, ewtCents: 0, cashCents: 11200 } },
  { id: 'fund-transfer', label: 'Fund Transfer Slip', paper: 'A4', type: 'cash.transfer', kind: 'document', doc: { fromName: 'Sample Bank', toName: 'Sample Cash', amountSentCents: 100000, amountReceivedCents: 99000, feeCents: 1000, note: 'Sample transfer' } },
  { id: 'cash-count', label: 'Cash Count Sheet', paper: 'A4', type: 'cash.count', kind: 'document', doc: { placeName: 'Sample Cash', lines: [{ denominationCents: 100000, qty: 2, amountCents: 200000 }], countedCents: 200000, ledgerCents: 200000, differenceCents: 0 } },
  { id: 'journal-voucher', label: 'Journal Voucher', paper: 'A4', type: 'acc.jv', kind: 'document', doc: { memo: 'Sample entry', lines: [jvLine('1000', 'Sample debit', 10000, 0), jvLine('2000', 'Sample credit', 0, 10000)], totalCents: 10000 } },
  { id: 'payslip', label: 'Payslip', paper: 'A4 2-up', type: 'pay.run', kind: 'document', doc: { periodStart: '2026-09-01', periodEnd: '2026-09-15', employees: [{ code: 'SAMPLE', name: 'Sample Worker', lines: [{ description: 'Basic pay', amountCents: 100000 }], grossCents: 100000, sssEeCents: 5000, phicEeCents: 2500, hdmfEeCents: 2000, wtaxCents: 0, caCents: 0, netCents: 90500 }] } },
  { id: 'cash-advance', label: 'Cash Advance Slip', paper: 'A4 2-up', type: 'ca.advance', kind: 'document', doc: { employeeName: 'Sample Worker', cashPlaceName: 'Sample Cash', amountCents: 20000, installmentCents: 5000, note: 'Sample only' } },
  { id: 'count-sheet', label: 'Inventory Count Sheet', paper: 'A4', type: 'inv.count', kind: 'document', doc: { category: 'Sample materials', countDate: '2026-09-28', lines: [{ name: 'Sample cloth', unit: 'metre', qty: 10, unitCostCents: 10000, valueCents: 100000 }], countedCents: 100000, ledgerCents: 90000, adjustmentCents: 10000 } },
];
const NOT_BUILT: string[] = [];
const testReport = (id: string, label: string, body: string, legend = false) => ({ id, label, paper: 'A4',
  html: renderReportPrint(label as 'Statement of Account' | 'Sizing Profile' | 'Fixed Asset Schedule', body,
    TEST_PROFILE, '2026-09-28', 'Sample Owner', '2026-09-28T10:00:00+08:00', legend).replace('<article>', '<article><div class="test-print">TEST PRINT, NOT A REAL DOCUMENT</div>') });
const TEST_REPORTS = [
  testReport('statement-of-account', 'Statement of Account', printField('Customer', 'Sample Customer') +
    printLineTable(['Date', 'Document', 'Memo', 'Charge', 'Payment', 'Balance'], [['2026-09-28', 'TEST-000000', 'Sample sale', printMoney(112000), '', printMoney(112000)]]), true),
  testReport('sizing-profile', 'Sizing Profile', printField('Wearer', 'Sample Wearer') +
    printLineTable(['Measurement', 'Value', 'Unit'], [['Chest', 36, 'inch']])),
  testReport('fixed-asset-schedule', 'Fixed Asset Schedule', printField('As of', '2026-09-28') +
    printLineTable(['Code', 'Asset', 'Cost', 'Book value'], [['FA-SAMPLE', 'Sample sewing machine', printMoney(500000), printMoney(450000)]])),
];

export function prtRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry, practice } = deps;
  bookPrintRoutes(app, deps);
  const report = (title: 'Statement of Account' | 'Sizing Profile' | 'Fixed Asset Schedule', body: string,
    user: ReturnType<typeof currentUser>, legend = false) => {
    const profile = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
    if (!profile) throw conflict('COMPANY_PROFILE_REQUIRED', 'An owner must complete the company profile before printing.');
    const at = stamp(clock);
    return { html: renderReportPrint(title, body, profile, today(clock), user.displayName, at, legend) };
  };
  app.get('/api/prt/test-pack', { config: { permission: 'prt.test_pack' } }, async () => ({
    prints: [...TEST_PRINTS.map((item) => ({ id: item.id, label: item.label, paper: item.paper,
      html: renderPrint(db, testHeader(item.type), item.doc, TEST_PROFILE, item.kind, 'Sample Owner',
        '2026-09-28T10:00:00+08:00', 1, false, true, 'http://192.168.1.20/') })), { id: 'bir-2307', label: 'BIR Form 2307', paper: 'A4',
      html: render2307(TEST_PROFILE, 2026, 3, [{ supplierName: 'Sample Supplier Corporation', tin: '111-222-333-000', address: null,
        lines: [{ atc: 'WC120', months: [{ month: '2026-07', baseCents: 500_000 }, { month: '2026-08', baseCents: 750_000 }, { month: '2026-09', baseCents: 250_000 }], baseCents: 1_500_000, ewtCents: 30_000 }] }], true) }, ...TEST_REPORTS, ...testBookPrints(TEST_PROFILE)],
    notBuilt: NOT_BUILT,
  }));

  app.get<{ Querystring: { year?: string; quarter?: string; supplierId?: string } }>('/api/prt/2307',
    { config: { permission: 'tax.registers.view' } }, async (req) => {
      const { year: rawYear, quarter: rawQuarter, supplierId } = req.query;
      if (!/^\d{4}$/.test(rawYear ?? '') || !/^[1-4]$/.test(rawQuarter ?? '')) {
        throw new AppError('BAD_QUARTER', 'Pick a year and a quarter, like 2026 and 3.', 400);
      }
      const year = Number(rawYear), quarter = Number(rawQuarter) as 1 | 2 | 3 | 4;
      const report = certificatesToIssue(db, year, quarter);
      const lines = supplierId === undefined ? report.lines : report.lines.filter((line) => line.supplierId === supplierId);
      const grouped = new Map<string, Certificate2307>();
      for (const line of lines) {
        const key = line.supplierId ?? `tin:${line.tin ?? line.supplierName}`;
        const certificate = grouped.get(key) ?? { supplierName: line.supplierName, tin: line.tin, address: null, lines: [] };
        certificate.lines.push({ atc: line.atc ?? `To confirm (${line.atcChoices.join(' or ')})`,
          months: line.months.map((m) => ({ month: m.month, baseCents: m.baseCents })), baseCents: line.baseCents, ewtCents: line.ewtCents });
        grouped.set(key, certificate);
      }
      const profile = db.prepare('SELECT * FROM prt_company_profile WHERE id = 1').get() as Profile | undefined;
      if (!profile) throw conflict('COMPANY_PROFILE_REQUIRED', 'An owner must complete the company profile before printing.');
      return { html: render2307(profile, year, quarter, [...grouped.values()], false, practice), pages: grouped.size };
    });
  app.get('/api/prt/printable-types', { config: { permission: 'authenticated' } }, async (req) => {
    const user = currentUser(req);
    return [...PRINTABLE].filter(([key]) => {
      const def = registry.docType(key);
      return def && user.permissions.has(def.permissions.view);
    }).map(([key, variants]) => ({ key, variants }));
  });

  app.post('/api/prt/reports/statement', { config: { permission: 'rpt.books.view' } }, async (req) => {
    const input = statementPrintInput.parse(req.body);
    const data = customerStatement(db, input.customerId, input.from, input.to);
    if (!data) throw notFound('That customer');
    const rows = [['', 'Opening balance', '', '', '', printMoney(data.openingBalanceCents)],
      ...data.lines.map((line) => [line.businessDate, line.documentNumber ?? line.journalNumber, line.memo,
        printMoney(line.debitCents), printMoney(line.creditCents), printMoney(line.runningBalanceCents)]),
      ['', 'Closing balance', '', '', '', printMoney(data.closingBalanceCents)]];
    const deposits = [['', 'Opening deposits held', '', '', '', printMoney(data.openingDepositsHeldCents)],
      ...data.depositLines.map((line) => [line.businessDate, line.documentNumber ?? line.journalNumber, line.memo,
        printMoney(line.creditCents), printMoney(line.debitCents), printMoney(line.runningHeldCents)]),
      ['', 'Deposits held', '', '', '', printMoney(data.depositsHeldCents)]];
    return report('Statement of Account', printField('Customer', data.customerName) + printField('Period', `${data.from} to ${data.to}`) +
      printLineTable(['Date', 'Document', 'Memo', 'Charge', 'Payment', 'Balance'], rows) +
      '<h2>Deposits held</h2>' + printLineTable(['Date', 'Document', 'Memo', 'Received', 'Applied', 'Held'], deposits), currentUser(req), true);
  });

  app.post('/api/prt/reports/sizing-profile', { config: { permission: 'cus.measure.view' } }, async (req) => {
    const input = sizingPrintInput.parse(req.body), data = sizingProfile(db, input.personId) as any;
    if (!data) throw notFound('An active sizing profile for that wearer');
    const rows = Object.entries(data.values as Record<string, number | null>).filter(([, value]) => value != null)
      .map(([name, value]) => [name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`).replace(/^./, (c) => c.toUpperCase()), value, data.unit]);
    return report('Sizing Profile', printField('Wearer', data.wearer_name) + printField('Customer', data.customer_name) +
      printField('Group', data.group_name) + printField('Measured on', data.measured_on) +
      printField('Upper size', data.upper_size_label) + printField('Lower size', data.lower_size_label) +
      printLineTable(['Measurement', 'Value', 'Unit'], rows) + printField('Remarks', data.remarks), currentUser(req));
  });

  app.post('/api/prt/reports/fixed-assets', { config: { permission: 'rpt.books.view' } }, async (req) => {
    const input = assetPrintInput.parse(req.body), data = assetSchedule(db, input.asOf);
    const rows = data.rows.map((row: any) => [row.code, row.name, row.acquiredOn, printMoney(row.costCents),
      row.usefulLifeMonths, printMoney(row.monthlyChargeCents), printMoney(row.accumulatedDepreciationCents), printMoney(row.bookValueCents)]);
    return report('Fixed Asset Schedule', printField('As of', data.asOf) + printLineTable(
      ['Code', 'Asset', 'Acquired', 'Cost', 'Life (months)', 'Monthly charge', 'Accumulated depreciation', 'Book value'], rows) +
      printField('Total cost', printMoney(data.totalCostCents)) + printField('Total accumulated depreciation', printMoney(data.totalAccumulatedCents)) +
      printField('Total book value', printMoney(data.totalBookValueCents)), currentUser(req));
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
      const joinBase = printLinkBase(db, deps.network);
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
        const html = renderPrint(db, h, doc, profile, kind, user.displayName, at, copyNumber, practice, false, joinBase);
        db.prepare('INSERT INTO prt_print_log (document_id, user_id, printed_at, copy_number, print_kind) VALUES (?, ?, ?, ?, ?)')
          .run(id, user.userId, at, copyNumber, kind);
        appendAudit(db, { at, userId: user.userId, action: 'prt.print', entityType: 'document', entityId: id,
          data: { type, kind, copyNumber } });
        return { html, copyNumber };
      });
    });
}
