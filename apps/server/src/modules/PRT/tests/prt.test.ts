import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatPeso } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, idem, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { renderPrint, renderReportPrint, printLineTable, printMoney, type PrintHeader, type Profile } from '../print.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
const value = { registeredName: 'Example Garments Corp.', tradeName: 'Example Garments', tin: '000-111-222',
  registeredAddress: '1 Sample Street, Manila', isVatRegistered: true };
const profile: Profile = { registered_name: value.registeredName, trade_name: value.tradeName,
  tin: value.tin, registered_address: value.registeredAddress, is_vat_registered: 1, version: 1 };
const header = (type: string): PrintHeader => ({ id: '00000000-0000-4000-8000-000000000001', number: 'TEST-000001',
  business_date: '2026-09-28', doc_type: type, status: 'posted' });

beforeEach(async () => { env = await createTestEnv(); owner = await env.as('owner'); encoder = await env.as('encoder'); });
afterEach(async () => { await env.app.close(); env.db.close(); });

describe('company profile', () => {
  it('requires owner, step-up and If-Match; keeps each old version and audits edits', async () => {
    const path = '/api/prt/company-profile';
    expect((await encoder.put(path, value, { 'if-match': '0' })).statusCode).toBe(403);
    expect((await owner.put(path, value, { 'if-match': '0' })).json().code).toBe('STEP_UP_REQUIRED');
    expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    expect((await owner.put(path, value)).statusCode).toBe(428);
    expect((await owner.put(path, value, { 'if-match': '0' })).json()).toMatchObject({ version: 1, registeredName: value.registeredName });
    expect((await owner.put(path, { ...value, tradeName: 'New Trade Name' }, { 'if-match': '0' })).statusCode).toBe(409);
    expect((await owner.put(path, { ...value, tradeName: 'New Trade Name' }, { 'if-match': '1' })).json()).toMatchObject({ version: 2 });
    expect((await owner.get(`${path}/history`)).json()).toMatchObject([{ version: 1, tradeName: value.tradeName }]);
    expect(() => env.db.prepare('UPDATE prt_company_profile_history SET trade_name = ? WHERE version = 1').run('changed')).toThrow(/IMMUTABLE/);
    expect((env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'prt.company_profile_edit'").get() as { n: number }).n).toBe(2);
  });
});

describe('print base', () => {
  it('prints the 2307 list figures by supplier, omits suppliers with no withholding, and keeps the list permission', async () => {
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    await owner.put('/api/prt/company-profile', value, { 'if-match': '0' });
    const supplier = async (name: string, tin: string, ewtClass?: string) => (await owner.post('/api/pur/suppliers', {
      name, registeredName: `${name} Corporation`, tin, isVatRegistered: false, ...(ewtClass ? { ewtClass } : {}),
    })).json().id as string;
    const printer = await supplier('Sample Printer', '111-222-333-000', 'contractor_2');
    const auditor = await supplier('Sample Auditor', '222-333-444-000', 'prof_firm_10');
    const empty = await supplier('Sample Empty', '333-444-555-000');
    const categoryId = env.db.prepare("SELECT c.id FROM exp_categories c JOIN accounts a ON a.id = c.account_id WHERE a.code = '6190'").pluck().get() as number;
    const cashPlace = cashPlaceId(env.db, '1111');
    for (const [supplierId, amountCents, description] of [[printer, 500_000, 'Sample printing'], [auditor, 1_120_000, 'Sample audit']] as const) {
      const response = await owner.post('/api/docs/exp.voucher/post', { input: { supplierId, categoryId, cashPlaceId: cashPlace, amountCents, description }, expectedTotalCents: amountCents }, idem());
      expect(response.statusCode, response.body).toBe(200);
    }
    const list = (await owner.get('/api/tax/2307-to-issue?year=2026&quarter=3')).json();
    const all = await owner.get('/api/prt/2307?year=2026&quarter=3');
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json().pages).toBe(2);
    expect(all.json().html).toContain('For the period 2026-07-01 to 2026-09-30');
    expect(all.json().html).toContain('<th>July</th><th>August</th><th>September</th>');
    expect(all.json().html).not.toContain('PRACTICE ONLY');
    for (const line of list.lines) {
      expect(all.json().html).toContain(line.supplierName);
      expect(all.json().html).toContain(formatPeso(line.baseCents));
      expect(all.json().html).toContain(formatPeso(line.ewtCents));
    }
    expect((await owner.get(`/api/prt/2307?year=2026&quarter=3&supplierId=${empty}`)).json().pages).toBe(0);
    expect((await encoder.get('/api/prt/2307?year=2026&quarter=3')).statusCode).toBe(403);
  });

  it('renders the complete owner-only test pack without writing any table', async () => {
    const tableCounts = () => Object.fromEntries((env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
      .map(({ name }) => [name, (env.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n]));
    const before = tableCounts();
    const response = await owner.get('/api/prt/test-pack');
    expect(response.statusCode, response.body).toBe(200);
    const pack = response.json() as { prints: { id: string; label: string; paper: string; html: string }[]; notBuilt: string[] };
    expect(pack.prints).toHaveLength(21);
    expect(new Set(pack.prints.map((p) => p.id)).size).toBe(pack.prints.length);
    for (const item of pack.prints) {
      expect(item.html, item.id).toContain('TEST PRINT, NOT A REAL DOCUMENT');
      if (!['statement-of-account', 'sizing-profile', 'fixed-asset-schedule', 'monthly-owners-pack', 'bir-2307'].includes(item.id)) expect(item.html, item.id).toContain('TEST-000000');
      expect(item.html, item.id).toMatch(/<h1>(QUOTATION|JOB ORDER|JOB TICKET|RELEASE SLIP|COLLECTION RECEIPT|CREDIT MEMO|PURCHASE ORDER|PAYMENT VOUCHER|EXPENSE VOUCHER|FUND TRANSFER|CASH COUNT|JOURNAL VOUCHER|PAYSLIP|CASH ADVANCE SLIP|INVENTORY COUNT SHEET|STATEMENT OF ACCOUNT|SIZING PROFILE|FIXED ASSET SCHEDULE|MONTHLY OWNERS&#39; PACK|CERTIFICATE OF CREDITABLE TAX WITHHELD AT SOURCE)<\/h1>/);
    }
    const publicPrints = ['quotation', 'job-order', 'release-slip', 'collection-a4', 'collection-80mm', 'credit-memo', 'purchase-order', 'payment-voucher', 'statement-of-account'];
    for (const item of pack.prints) expect(item.html.includes('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.')).toBe(publicPrints.includes(item.id));
    expect(pack.prints.find((p) => p.id === 'collection-80mm')?.html).toContain('@page{size:80mm auto');
    expect(pack.prints.filter((p) => p.paper === 'A4 2-up').every((p) => p.html.includes('sheet two-up'))).toBe(true);
    expect(pack.prints.find((p) => p.id === 'bir-2307')?.html).toContain('Sample Supplier Corporation');
    expect(pack.notBuilt).toEqual(['Books layouts']);
    expect(tableCounts()).toEqual(before);
    for (const role of ['encoder', 'accountant', 'production', 'tv'] as const) {
      expect((await (await env.as(role)).get('/api/prt/test-pack')).statusCode).toBe(403);
    }
  });

  it('renders report figures, exact catalogue titles and the statement-only legend', async () => {
    const body = printLineTable(['Description', 'Amount'], [['Made-up balance', printMoney(12345)]]);
    for (const [title, legend] of [['Statement of Account', true], ['Sizing Profile', false], ['Fixed Asset Schedule', false]] as const) {
      const html = renderReportPrint(title, body, profile, '2026-09-28', 'Example Owner', '2026-09-28T10:00:00+08:00', legend);
      expect(html).toContain(`<h1>${title.toUpperCase()}</h1>`);
      expect(html).toContain('<td>₱123.45</td>');
      expect(html.includes('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.')).toBe(legend);
      expect(html).toContain(value.registeredName);
      expect(html).toContain('Date <b>2026-09-28</b>');
      expect(html).toContain('Printed by Example Owner at');
    }
  });

  it('denies report prints to a role without each screen permission', async () => {
    const tv = await env.as('tv');
    expect((await tv.post('/api/prt/reports/statement', { customerId: 'sample', from: '2026-09-01', to: '2026-09-28' })).statusCode).toBe(403);
    expect((await tv.post('/api/prt/reports/sizing-profile', { personId: 'sample' })).statusCode).toBe(403);
    expect((await tv.post('/api/prt/reports/fixed-assets', { asOf: '2026-09-28' })).statusCode).toBe(403);
  });

  it('places the legend on public printouts and omits it on the production ticket', () => {
    const quote = { customerName: 'Sample Buyer', validUntil: '2026-10-13', totalCents: 10000, documentDiscountCents: 0,
      lines: [{ description: 'Sample item', qty: 1, unit: 'pc', unitPriceCents: 10000, discountCents: 0, lineTotalCents: 10000 }] };
    const jo = { customerName: 'Sample Buyer', dueDate: '2026-10-13', priority: 'normal', totalCents: 10000,
      requiredDownpaymentCents: 5000, paymentTerms: 'dp50', lines: [{ lineNo: 1, description: 'Sample item', qty: 1,
        unitPriceCents: 10000, discountCents: 0, lineTotalCents: 10000, roster: [] }] };
    const release = { jobOrderNumber: 'JO-000001', customerName: 'Sample Buyer', lines: [{ description: 'Sample item', qty: 1 }],
      claimedBy: 'Sample Buyer', idSeen: 'none', balanceDueCents: 0 };
    const po = { supplierId: 'none', totalCents: 10000, lines: [{ supplyId: 'none', qty: 1, unitCostCents: 10000, lineTotalCents: 10000 }] };
    const render = (type: string, doc: unknown, kind: 'document' | 'job_ticket' = 'document') =>
      renderPrint(env.db, header(type), doc, profile, kind, 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
    for (const [type, doc, copies] of [
      ['quo.quotation', quote, 1], ['jo.job_order', jo, 1], ['jo.release', release, 2], ['pur.po', po, 1],
    ] as const) {
      const html = render(type, doc);
      expect(html.match(/THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX\./g)?.length).toBe(copies);
      expect(html).toContain(value.registeredName);
      expect(html).toContain(value.tin);
      expect(html).toContain(value.registeredAddress);
      expect(html).toContain('Printed by Example Owner at');
    }
    const ticket = render('jo.job_order', jo, 'job_ticket');
    expect(ticket).toContain('<h1>JOB TICKET</h1>');
    expect(ticket).not.toContain('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.');
    expect(ticket).not.toContain('₱');
  });

  it('shows line and document discounts so quotation amounts reconcile to the total', () => {
    const quote = { customerName: 'Sample Buyer', totalCents: 8500, documentDiscountCents: 500,
      lines: [{ description: 'Sample item', qty: 1, unit: 'pc', unitPriceCents: 10000,
        discountCents: 1000, lineTotalCents: 9000 }] };
    const html = renderPrint(env.db, header('quo.quotation'), quote, profile, 'document', 'Example Owner',
      '2026-09-28T10:00:00+08:00', 1);
    expect(html).toContain('Line discount');
    expect(html).toContain('<td>₱10.00</td><td>₱90.00</td>');
    expect(html).toContain('Subtotal:</b> ₱90.00');
    expect(html).toContain('Document discount:</b> −₱5.00');
    expect(html).toContain('Total:</b> ₱85.00');
  });

  it('marks cancelled copies directly under the title, including both release-slip halves', () => {
    const quote = { customerName: 'Sample Buyer', documentDiscountCents: 0, totalCents: 10000,
      lines: [{ description: 'Sample item', qty: 1, unit: 'pc', unitPriceCents: 10000,
        discountCents: 0, lineTotalCents: 10000 }] };
    const release = { jobOrderNumber: 'JO-000001', customerName: 'Sample Buyer', lines: [], balanceDueCents: 0 };
    const render = (type: string, doc: unknown) => renderPrint(env.db, { ...header(type), status: 'cancelled' }, doc,
      profile, 'document', 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
    expect(render('quo.quotation', quote)).toContain('<h1>QUOTATION</h1><p class="cancelled">CANCELLED</p>');
    expect(render('jo.release', release).match(/<p class="cancelled">CANCELLED<\/p>/g)).toHaveLength(2);
  });

  it('lists server-supported print variants only for viewable document types', async () => {
    const listed = (await encoder.get('/api/prt/printable-types')).json() as { key: string; variants: string[] }[];
    const viewable = (await encoder.get('/api/doc-types')).json() as { key: string }[];
    expect(listed).toContainEqual({ key: 'jo.job_order', variants: ['document', 'job_ticket'] });
    expect(listed).toContainEqual({ key: 'cash.transfer', variants: ['document'] });
    expect(listed.every((item) => viewable.some((type) => type.key === item.key))).toBe(true);
    const production = await env.as('production');
    const productionKeys = ((await production.get('/api/prt/printable-types')).json() as { key: string }[]).map((item) => item.key);
    expect(productionKeys).not.toContain('quo.quotation');
  });

  it('renders the remaining document printouts with their catalogue title, paper layout, escaping and reprint mark', () => {
    const cases: [string, unknown, string, boolean, boolean][] = [
      ['col.collection', { customerName: '<Buyer>', applications: [], sales: [], totalCents: 100, cwtCents: 0, vatWithheldCents: 0, unappliedCents: 0 }, 'COLLECTION RECEIPT', true, true],
      ['col.credit_memo', { customerName: '<Buyer>', invoice: { number: 'IR-1' }, kind: 'allowance', reason: '<late>', netCents: 90, vatCents: 10, totalCents: 100 }, 'CREDIT MEMO', true, false],
      ['ap.payment', { supplierName: '<Supplier>', bills: [], tenders: [], feeCents: 0, totalCents: 100 }, 'PAYMENT VOUCHER', true, true],
      ['exp.voucher', { payee: { name: '<Payee>' }, categoryName: 'Rent', description: '<office>', cashPlaceName: 'Bank', totalCents: 100, inputVatCents: 0, ewtCents: 0, cashCents: 100 }, 'EXPENSE VOUCHER', false, false],
      ['cash.transfer', { fromName: '<Bank>', toName: 'Cash', amountSentCents: 100, amountReceivedCents: 100, feeCents: 0 }, 'FUND TRANSFER', false, false],
      ['cash.count', { placeName: '<Till>', lines: [], countedCents: 100, ledgerCents: 100, differenceCents: 0 }, 'CASH COUNT', false, false],
      ['acc.jv', { memo: '<Accrual>', lines: [], totalCents: 100 }, 'JOURNAL VOUCHER', false, false],
      ['pay.run', { periodStart: '2026-09-01', periodEnd: '2026-09-15', employees: [{ code: 'E1', name: '<Worker>', lines: [], grossCents: 100, sssEeCents: 0, phicEeCents: 0, hdmfEeCents: 0, wtaxCents: 0, caCents: 0, netCents: 100 }] }, 'PAYSLIP', false, true],
      ['ca.advance', { employeeName: '<Worker>', cashPlaceName: 'Cash', amountCents: 100, installmentCents: 50 }, 'CASH ADVANCE SLIP', false, true],
      ['inv.count', { category: 'materials', countDate: '2026-09-28', lines: [], countedCents: 100, ledgerCents: 100, adjustmentCents: 0 }, 'INVENTORY COUNT SHEET', false, false],
    ];
    for (const [type, doc, title, legend, twoUp] of cases) {
      const html = renderPrint(env.db, header(type), doc, profile, 'document', '<Owner>', '2026-09-28T10:00:00+08:00', 2);
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html.includes('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.')).toBe(legend);
      expect(html).toContain('&lt;');
      expect(html).not.toContain('<Owner>');
      expect(html).toContain('REPRINT no. 1');
      expect(html.includes('sheet two-up')).toBe(twoUp);
    }
  });

  it('increments the reprint counter and returns 403 when the user cannot view the document', async () => {
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.put('/api/prt/company-profile', value, { 'if-match': '0' })).statusCode).toBe(200);
    const item = await owner.post('/api/cat/items', { code: 'PRT-SAMPLE', name: 'Sample patch', class: 'service', garmentType: null, unit: 'pc', setComponents: 1 });
    const itemId = item.json().id;
    expect((await owner.post(`/api/cat/items/${itemId}/prices`, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 10000 }, { 'if-match': '1' })).statusCode).toBe(200);
    const input = { prospectName: 'Sample Buyer', lines: [{ itemId, description: 'Sample patch', qty: 1, unit: 'pc' }] };
    const posted = await encoder.post('/api/docs/quo.quotation/post', { input, expectedTotalCents: 10000 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    const path = `/api/prt/print/quo.quotation/${posted.json().id}`;
    const one = await encoder.post(path, {});
    const two = await encoder.post(path, {});
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json()).toMatchObject({ copyNumber: 1 });
    expect(two.json()).toMatchObject({ copyNumber: 2 });
    expect(two.json().html).toContain('REPRINT no. 1');
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM prt_print_log').get() as { n: number }).n).toBe(2);
    expect(() => env.db.prepare('UPDATE prt_print_log SET copy_number = 99').run()).toThrow(/IMMUTABLE/);
    expect((await encoder.post(`/api/docs/quo.quotation/${posted.json().id}/cancel`,
      { reason: 'Customer cancelled this quotation.' }, idem())).statusCode).toBe(200);
    const cancelled = await encoder.post(path, {});
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().html).toContain('<h1>QUOTATION</h1><p class="cancelled">CANCELLED</p>');
    const production = await env.as('production');
    expect((await production.post(path, {})).statusCode).toBe(403);
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM prt_print_log').get() as { n: number }).n).toBe(3);
  });
});
