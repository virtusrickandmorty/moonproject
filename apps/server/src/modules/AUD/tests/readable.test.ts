/** The audit log in plain words (the owner's request, Nov 2026): what happened, to which record, and what changed. */
import { beforeEach, describe, expect, it } from 'vitest';
import { appendAudit } from '../../../engine/audit.ts';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { dayWords, detailsLine, nameBook, readable, whenWords } from '../readable.ts';

let env: TestEnv, owner: Client, encoder: Client;
beforeEach(async () => {
  env = await createTestEnv('2026-11-10T06:00:00Z'); encoderOwnDefaults(env);
  owner = await env.as('owner'); encoder = await env.as('encoder');
});

const words = (e: { action: string; entityType: string; entityId?: string | null; data: Record<string, unknown> }) =>
  readable(env.deps.registry, nameBook(env.db, env.deps.registry), { entityId: null, ...e }, new Map(env.deps.registry.modules.map((m) => [m.code, m.name])));

describe('dates and times', () => {
  it('reads as a person would say them', () => {
    expect(dayWords('2026-11-10')).toBe('Nov 10, 2026');
    expect(whenWords('2026-11-10T16:12:23.986+08:00')).toBe('Nov 10, 2026, 4:12 PM');
    expect(whenWords('2026-11-10T00:05:00.000+08:00')).toBe('Nov 10, 2026, 12:05 AM');
    expect(whenWords('2026-11-10T12:30:00.000+08:00')).toBe('Nov 10, 2026, 12:30 PM');
  });
});

describe('an entry in words', () => {
  it('shows only what changed, old and new, without the bookkeeping fields', () => {
    const r = words({ action: 'pur.supplier.edit', entityType: 'pur_suppliers', entityId: 'made-up', data: {
      before: { name: 'Sample Textile', tin: null, is_active: 1, updated_at: '2026-11-01T10:00:00.000+08:00', version: 1 },
      after: { name: 'Sample Textile', tin: '123-456-789-000', is_active: 0, updated_at: '2026-11-10T10:00:00.000+08:00', version: 2 } } });
    expect(r.what).toBe('Changed a supplier');
    expect(r.record).toEqual({ label: 'Supplier: Sample Textile', href: '/pur/suppliers/made-up' });
    expect(r.details).toEqual([{ label: 'TIN', before: '—', after: '123-456-789-000' }, { label: 'Active', before: 'Yes', after: 'No' }]);
    expect(detailsLine(r.details)).toBe('TIN: — → 123-456-789-000; Active: Yes → No');
  });

  it('says amounts in pesos, rates in percent and codes in words', () => {
    const r = words({ action: 'est.rules', entityType: 'est.rules', data: { overheadBp: 5000, roundToCents: 1000, payGroup: 'WEEKLY_DAILY', kind: 'made_to_order', ok: true } });
    expect(r.what).toBe('Changed the costing rules');
    expect(r.details).toEqual([
      { label: 'Overhead', value: '50%' }, { label: 'Round to', value: '₱10.00' }, { label: 'Pay group', value: 'weekly daily' },
      { label: 'Kind', value: 'made to order' }, { label: 'Worked', value: 'Yes' }]);
  });

  it('names fields that changed when their values are kept out of the log', () => {
    expect(words({ action: 'emp.employee.update', entityType: 'emp.employee', data: { changes: {}, fields: ['fullName', 'payslipEmail'] } }).details)
      .toEqual([{ label: 'Fields changed', value: 'Full name, Payslip email' }]);
  });

  it('reads an action it does not know from its module and code', () => {
    expect(words({ action: 'cus.something_new', entityType: 'cus_customer', data: {} }).what).toBe('Customers & Measurements: something new');
  });
});

describe('the audit log screen and file', () => {
  it('gives each entry in words, finds a document by its number, and lists the actions to filter by', async () => {
    const c = seedCustomers(env.db, encoder.userId);
    const posted = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 10, unitPriceCents: 50_000, discountCents: 0, roster: [] }] }, expectedTotalCents: 500_000 }, idem());
    expect(posted.statusCode).toBe(200);
    const { id, number } = posted.json() as { id: string; number: string };
    appendAudit(env.db, { at: '2026-11-10T14:05:00.000+08:00', userId: owner.userId, action: 'prt.print', entityType: 'document', entityId: id, data: { kind: 'job_ticket', copyNumber: 1 } });

    const log = (await owner.get(`/api/aud/log?number=${number.toLowerCase()}`)).json();
    expect(log.rows.map((r: { what: string }) => r.what)).toEqual(['Printed', 'Recorded']);
    expect(log.rows[1]).toMatchObject({ what: 'Recorded', when: expect.stringMatching(/^Nov 10, 2026, /),
      record: { label: `Job Order ${number}`, href: `/docs/jo.job_order/${id}` } });
    expect(log.rows[1].details).toEqual(expect.arrayContaining([{ label: 'Amount', value: '₱5,000.00' }, { label: 'Date', value: 'Nov 10, 2026' }]));
    expect(log.rows[1].details.map((d: { label: string }) => d.label)).not.toContain('Journal'); // empty: left out

    const choices = (await owner.get('/api/aud/choices')).json();
    expect(choices.actions).toEqual(expect.arrayContaining([{ value: 'document.post', label: 'Recorded' }, { value: 'auth.login', label: 'Signed in' }]));

    const csv = (await owner.get(`/api/aud/log?number=${number}&format=csv`)).body;
    expect(csv.split('\n')[0]).toContain('"What happened","Record","Details"');
    expect(csv).toContain(`"Job Order ${number}"`);
    expect((await encoder.get('/api/aud/choices')).statusCode).toBe(403);
  });
});
