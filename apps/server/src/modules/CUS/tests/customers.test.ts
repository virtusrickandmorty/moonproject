import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { activeCustomers, customerTaxInfo } from '../public.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env?.db.close(); env = undefined; });

describe('CUS master data', () => {
  it('exposes tax details and only active customers to sales modules', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const first = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Fictional Academy',
      registeredName: 'Fictional Academy Inc.', tin: '000-111-222', isVatRegistered: true })).json();
    const second = (await encoder.post('/api/cus/customers', { kind: 'person', displayName: 'Sample Customer' })).json();
    expect(customerTaxInfo(env.db, first.id)).toEqual({ tin: '000-111-222', registeredName: 'Fictional Academy Inc.', isVatRegistered: true });
    expect(customerTaxInfo(env.db, second.id)).toEqual({ tin: null, registeredName: null, isVatRegistered: false });
    expect(customerTaxInfo(env.db, 'missing')).toBeUndefined();
    expect((await encoder.post(`/api/cus/customers/${second.id}/deactivate`, {}, { 'if-match': '1' })).statusCode).toBe(200);
    expect(activeCustomers(env.db)).toEqual([{ id: first.id, name: 'Fictional Academy' }]);
  });
  it('creates a customer, group and wearer; rejects wrong-group and stale edits', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Moonlight School' })).json();
    expect(customer.code).toBe('CUS-00001');
    expect((await env.app.inject({ method: 'GET', url: '/api/cus/customers' })).statusCode).toBe(401);
    expect((await encoder.put(`/api/cus/customers/${customer.id}`, { isVatRegistered: true })).statusCode).toBe(428);
    expect((await encoder.put(`/api/cus/customers/${customer.id}`, { isVatRegistered: true }, { 'if-match': '0' })).statusCode).toBe(409);
    const edited = await encoder.put(`/api/cus/customers/${customer.id}`, { displayName: 'Moonlight Academy', isVatRegistered: true }, { 'if-match': '1' });
    expect(edited.statusCode).toBe(200);
    const change = env.db.prepare("SELECT data FROM audit_log WHERE action = 'cus.customer.update' ORDER BY seq DESC LIMIT 1").get() as { data: string };
    const auditData = JSON.parse(change.data);
    expect(auditData.fields).toEqual(['displayName', 'isVatRegistered']);
    expect(auditData.changes).toEqual({ isVatRegistered: { before: 0, after: 1 } });
    expect(change.data).not.toContain('Moonlight Academy');
    const group = (await encoder.post(`/api/cus/customers/${customer.id}/groups`, { name: 'Chess Team' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Ari Sample', groupId: group.id })).json();
    expect(person.group_id).toBe(group.id);
    const other = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Paper Lantern Club' })).json();
    expect((await encoder.put(`/api/cus/customers/${other.id}`, { legacyId: 'OLD-1' }, { 'if-match': '1' })).statusCode).toBe(400);
    expect((await encoder.post('/api/cus/customers', { kind: 'person', displayName: 'Legacy Example', legacyId: 'OLD-2' })).statusCode).toBe(400);
    const wrong = await encoder.post(`/api/cus/customers/${other.id}/people`, { fullName: 'Robin Example', groupId: group.id });
    expect(wrong.statusCode).toBe(409);
    const stale = await encoder.put(`/api/cus/people/${person.id}`, { nickname: 'Ari' }, { 'if-match': '0' });
    expect(stale.statusCode).toBe(409);
    const moved = await encoder.put(`/api/cus/people/${person.id}`, { groupId: null }, { 'if-match': '1' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().group_id).toBeNull();
    const personChange = env.db.prepare("SELECT data FROM audit_log WHERE action = 'cus.person.update' ORDER BY seq DESC LIMIT 1").get() as { data: string };
    expect(JSON.parse(personChange.data).changes.groupId).toEqual({ before: group.id, after: null });
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('keeps measurement revisions and rejects changing stored values', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'person', displayName: 'Taylor Sample' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Taylor Sample' })).json();
    const first = await encoder.post(`/api/cus/people/${person.id}/measurements`, {
      sizeMode: 'measured', values: { chest: 34.25, sleeveHole: 7.5 }, remarks: 'First fitting',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().values.chest).toBe(34.25);
    expect(first.json().chest_hundredths).toBeUndefined();
    const firstId = first.json().id;
    const noReason = await encoder.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'measured', values: { chest: 36 } });
    expect(noReason.statusCode).toBe(400);
    const tooPrecise = await encoder.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'measured', values: { chest: 36.123 }, reason: 'Rechecked at fitting' });
    expect(tooPrecise.statusCode).toBe(400);
    expect(tooPrecise.json().code).toBe('MEASUREMENT_PRECISION');
    const second = await encoder.post(`/api/cus/people/${person.id}/measurements`, {
      sizeMode: 'measured', unit: 'cm', values: { chest: 91.44, sleeveHole: 75 }, reason: 'Rechecked at fitting',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().warnings[0].field).toBe('sleeveHole');
    const old = env.db.prepare('SELECT * FROM cus_measure_charts WHERE id = ?').get(firstId) as { chest_hundredths: number; status: string; revision_no: number };
    expect(old).toMatchObject({ chest_hundredths: 3425, status: 'superseded', revision_no: 1 });
    const stored = env.db.prepare('SELECT chest_hundredths, sleeve_hole_hundredths, typeof(chest_hundredths) AS storage FROM cus_measure_charts WHERE id = ?').get(second.json().id) as { chest_hundredths: number; sleeve_hole_hundredths: number; storage: string };
    expect(stored).toEqual({ chest_hundredths: 3600, sleeve_hole_hundredths: 2953, storage: 'integer' });
    expect(second.json()).toMatchObject({ status: 'active', revision_no: 2, supersedes_id: firstId, unit: 'cm', values: { chest: 91.44 } });
    expect(second.json().values.sleeveHole).toBe(75.0062);
    expect((await encoder.get(`/api/cus/people/${person.id}/measurements`)).json()[0].values.chest).toBe(91.44);
    expect(() => env!.db.prepare('UPDATE cus_measure_charts SET chest_hundredths = 9900 WHERE id = ?').run(firstId)).toThrow();
    expect(() => env!.db.prepare('DELETE FROM cus_measure_charts WHERE id = ?').run(firstId)).toThrow();
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('normalizes phones, warns on duplicates and limits merge to owners', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder'), owner = await env.as('owner');
    const first = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'North Star Team' })).json();
    const second = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'North Star Team' })).json();
    expect(second.duplicateWarnings).toContainEqual({ id: first.id, reason: 'similar name' });
    const phone = await encoder.post(`/api/cus/customers/${first.id}/phones`, { phone: '0917 555 1234' });
    expect(phone.json().phone).toBe('+639175551234');
    const duplicatePhone = await encoder.post(`/api/cus/customers/${second.id}/phones`, { phone: '+63 917 555 1234' });
    expect(duplicatePhone.json().duplicateWarnings).toContainEqual({ id: first.id, reason: 'phone' });
    const group = (await encoder.post(`/api/cus/customers/${first.id}/groups`, { name: 'Field Team' })).json();
    const person = (await encoder.post(`/api/cus/customers/${first.id}/people`, { fullName: 'Morgan Example', groupId: group.id })).json();
    const contact = (await encoder.post(`/api/cus/customers/${first.id}/contacts`, { name: 'Casey Example' })).json();
    const child = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'North Star Junior', parentCustomerId: first.id })).json();
    const denied = await encoder.post(`/api/cus/customers/${first.id}/merge`, { intoCustomerId: second.id, reason: 'Duplicate after review' });
    expect(denied.statusCode).toBe(403);
    const malformed = await owner.post(`/api/cus/customers/${first.id}/merge`, { intoCustomerId: second.id, reason: 'Duplicate after review', unknown: true }, { 'if-match': '1', 'x-target-version': '1' });
    expect(malformed.statusCode).toBe(400);
    const merged = await owner.post(`/api/cus/customers/${first.id}/merge`, { intoCustomerId: second.id, reason: 'Duplicate after review' }, { 'if-match': '1', 'x-target-version': '1' });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({ is_active: 0, merged_into_id: second.id });
    const moved = env.db.prepare('SELECT customer_id FROM cus_groups WHERE id = ?').get(group.id) as { customer_id: string };
    expect(moved.customer_id).toBe(second.id);
    const mergeAudit = env.db.prepare("SELECT seq FROM audit_log WHERE action = 'cus.customer.merge' ORDER BY seq DESC LIMIT 1").get() as { seq: number };
    const relinks = env.db.prepare('SELECT table_name,row_id,from_customer_id,to_customer_id FROM cus_merge_relinks WHERE merge_audit_seq = ?').all(mergeAudit.seq) as { table_name: string; row_id: string; from_customer_id: string; to_customer_id: string }[];
    expect(relinks).toHaveLength(5);
    expect(relinks.map((r) => `${r.table_name}:${r.row_id}`).sort()).toEqual([
      `cus_customer_contacts:${contact.id}`, `cus_customer_phones:${phone.json().id}`,
      `cus_customers:${child.id}`, `cus_groups:${group.id}`, `cus_people:${person.id}`,
    ].sort());
    expect(relinks.every((r) => r.from_customer_id === first.id && r.to_customer_id === second.id)).toBe(true);
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('lets production view measurements but not record them or manage customers', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder'), production = await env.as('production');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Sample Running Club' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Jamie Example' })).json();
    expect((await production.post('/api/cus/customers', { kind: 'person', displayName: 'Blocked' })).statusCode).toBe(403);
    expect((await production.get(`/api/cus/customers/${customer.id}`)).statusCode).toBe(403);
    expect((await production.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'preset', upperSize: 'M', values: {} })).statusCode).toBe(403);
    expect((await production.get(`/api/cus/people/${person.id}/measurements`)).json()).toHaveLength(0);
  });

  it('deactivates a customer only after its wearers and groups are inactive', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Cedar School' })).json();
    const group = (await encoder.post(`/api/cus/customers/${customer.id}/groups`, { name: 'Section A' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Sky Example', groupId: group.id })).json();
    expect((await encoder.post(`/api/cus/customers/${customer.id}/deactivate`, {}, { 'if-match': '1' })).statusCode).toBe(409);
    expect((await encoder.post(`/api/cus/people/${person.id}/deactivate`, {}, { 'if-match': '1' })).statusCode).toBe(200);
    expect((await encoder.post(`/api/cus/groups/${group.id}/deactivate`, {}, { 'if-match': '1' })).statusCode).toBe(200);
    const inactive = await encoder.post(`/api/cus/customers/${customer.id}/deactivate`, {}, { 'if-match': '1' });
    expect(inactive.json().is_active).toBe(0);
    expect((env.db.prepare('SELECT count(*) AS n FROM cus_customers WHERE id = ?').get(customer.id) as { n: number }).n).toBe(1);
  });

  it('returns clear conflicts for duplicate group and size names; size IDs are generated', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder'), owner = await env.as('owner');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Lantern School' })).json();
    await encoder.post(`/api/cus/customers/${customer.id}/groups`, { name: 'Team A' });
    const second = (await encoder.post(`/api/cus/customers/${customer.id}/groups`, { name: 'Team B' })).json();
    const duplicate = await encoder.post(`/api/cus/customers/${customer.id}/groups`, { name: 'team a' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('GROUP_EXISTS');
    expect((await encoder.put(`/api/cus/groups/${second.id}`, { name: 'TEAM A' }, { 'if-match': '1' })).statusCode).toBe(409);
    const size = (await owner.post('/api/cus/sizes', { label: 'Kids 8', category: 'kids' })).json();
    expect(size.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    expect(size.id).not.toBe(size.label);
    const wearer = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Avery Sample' })).json();
    expect((await encoder.post(`/api/cus/people/${wearer.id}/measurements`, { sizeMode: 'preset', upperSize: size.id, values: {} })).statusCode).toBe(200);
    const duplicateSize = await owner.post('/api/cus/sizes', { label: 'xl', category: 'adult' });
    expect(duplicateSize.statusCode).toBe(409);
    expect(duplicateSize.json().code).toBe('SIZE_EXISTS');
  });

  it('requires matching versions to deactivate contacts and phones', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Willow Club' })).json();
    const contact = (await encoder.post(`/api/cus/customers/${customer.id}/contacts`, { name: 'Lee Example' })).json();
    const phone = (await encoder.post(`/api/cus/customers/${customer.id}/phones`, { phone: '0917 555 6789' })).json();
    for (const [kind, rowId] of [['contacts', contact.id], ['phones', phone.id]]) {
      const url = `/api/cus/${kind}/${rowId}/deactivate`;
      expect((await encoder.post(url, {})).statusCode).toBe(428);
      expect((await encoder.post(url, {}, { 'if-match': '0' })).statusCode).toBe(409);
      const done = await encoder.post(url, {}, { 'if-match': '1' });
      expect(done.statusCode).toBe(200);
      expect(done.json()).toMatchObject({ is_active: 0, version: 2 });
    }
  });
});
