import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { renderPrint, type PrintHeader, type Profile } from '../print.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
const value = { registeredName: 'Example Garments Corp.', tradeName: 'Example Garments', tin: '000-111-222',
  registeredAddress: '1 Sample Street, Manila', isVatRegistered: true };
const profile: Profile = { registered_name: value.registeredName, trade_name: value.tradeName,
  tin: value.tin, registered_address: value.registeredAddress, is_vat_registered: 1, version: 1 };
const header = (type: string): PrintHeader => ({ id: '00000000-0000-4000-8000-000000000001', number: 'TEST-000001',
  business_date: '2026-09-28', doc_type: type });

beforeEach(async () => { env = await createTestEnv(); owner = await env.as('owner'); encoder = await env.as('encoder'); });
afterEach(async () => { await env.app.close(); env.db.close(); });

describe('company profile', () => {
  it('requires owner, step-up and If-Match; keeps each old version and audits edits', async () => {
    const path = '/api/prn/company-profile';
    expect((await encoder.put(path, value, { 'if-match': '0' })).statusCode).toBe(403);
    expect((await owner.put(path, value, { 'if-match': '0' })).json().code).toBe('STEP_UP_REQUIRED');
    expect((await owner.post('/api/auth/step-up', { password: PASSWORD })).statusCode).toBe(200);
    expect((await owner.put(path, value)).statusCode).toBe(428);
    expect((await owner.put(path, value, { 'if-match': '0' })).json()).toMatchObject({ version: 1, registeredName: value.registeredName });
    expect((await owner.put(path, { ...value, tradeName: 'New Trade Name' }, { 'if-match': '0' })).statusCode).toBe(409);
    expect((await owner.put(path, { ...value, tradeName: 'New Trade Name' }, { 'if-match': '1' })).json()).toMatchObject({ version: 2 });
    expect((await owner.get(`${path}/history`)).json()).toMatchObject([{ version: 1, tradeName: value.tradeName }]);
    expect(() => env.db.prepare('UPDATE prn_company_profile_history SET trade_name = ? WHERE version = 1').run('changed')).toThrow(/IMMUTABLE/);
    expect((env.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'prn.company_profile_edit'").get() as { n: number }).n).toBe(2);
  });
});

describe('print base', () => {
  it('places the legend on public printouts and omits it on the production ticket', () => {
    const quote = { customerName: 'Sample Buyer', validUntil: '2026-10-13', totalCents: 10000,
      lines: [{ description: 'Sample item', qty: 1, unit: 'pc', unitPriceCents: 10000, lineTotalCents: 10000 }] };
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
    expect(ticket).toContain('JOB TICKET');
    expect(ticket).not.toContain('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.');
    expect(ticket).not.toContain('₱');
  });

  it('increments the reprint counter and returns 403 when the user cannot view the document', async () => {
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.put('/api/prn/company-profile', value, { 'if-match': '0' })).statusCode).toBe(200);
    const item = await owner.post('/api/cat/items', { code: 'PRN-SAMPLE', name: 'Sample patch', class: 'service', garmentType: null, unit: 'pc', setComponents: 1 });
    const itemId = item.json().id;
    expect((await owner.post(`/api/cat/items/${itemId}/prices`, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 10000 }, { 'if-match': '1' })).statusCode).toBe(200);
    const input = { prospectName: 'Sample Buyer', lines: [{ itemId, description: 'Sample patch', qty: 1, unit: 'pc' }] };
    const posted = await encoder.post('/api/docs/quo.quotation/post', { input, expectedTotalCents: 10000 }, idem());
    expect(posted.statusCode, posted.body).toBe(200);
    const path = `/api/prn/print/quo.quotation/${posted.json().id}`;
    const one = await encoder.post(path, {});
    const two = await encoder.post(path, {});
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json()).toMatchObject({ copyNumber: 1 });
    expect(two.json()).toMatchObject({ copyNumber: 2 });
    expect(two.json().html).toContain('REPRINT no. 1');
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM prn_print_log').get() as { n: number }).n).toBe(2);
    expect(() => env.db.prepare('UPDATE prn_print_log SET copy_number = 99').run()).toThrow(/IMMUTABLE/);
    const production = await env.as('production');
    expect((await production.post(path, {})).statusCode).toBe(403);
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM prn_print_log').get() as { n: number }).n).toBe(2);
  });
});
