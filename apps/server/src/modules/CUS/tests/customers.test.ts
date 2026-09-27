import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env?.db.close(); env = undefined; });

describe('CUS master data', () => {
  it('creates a customer, group and wearer; rejects wrong-group and stale edits', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Moonlight School' })).json();
    expect(customer.code).toBe('CUS-00001');
    const group = (await encoder.post(`/api/cus/customers/${customer.id}/groups`, { name: 'Chess Team' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Ari Sample', groupId: group.id })).json();
    expect(person.group_id).toBe(group.id);
    const other = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Paper Lantern Club' })).json();
    const wrong = await encoder.post(`/api/cus/customers/${other.id}/people`, { fullName: 'Robin Example', groupId: group.id });
    expect(wrong.statusCode).toBe(409);
    const stale = await encoder.put(`/api/cus/people/${person.id}`, { nickname: 'Ari' }, { 'if-match': '0' });
    expect(stale.statusCode).toBe(409);
    const moved = await encoder.put(`/api/cus/people/${person.id}`, { groupId: null }, { 'if-match': '1' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().group_id).toBeNull();
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('keeps measurement revisions and rejects changing stored values', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'person', displayName: 'Taylor Sample' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Taylor Sample' })).json();
    const first = await encoder.post(`/api/cus/people/${person.id}/measurements`, {
      sizeMode: 'measured', values: { chest: 34, sleeveHole: 7.5 }, remarks: 'First fitting',
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().id;
    const noReason = await encoder.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'measured', values: { chest: 36 } });
    expect(noReason.statusCode).toBe(400);
    const second = await encoder.post(`/api/cus/people/${person.id}/measurements`, {
      sizeMode: 'measured', values: { chest: 36, sleeveHole: 75 }, reason: 'Rechecked at fitting',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().warnings[0].field).toBe('sleeveHole');
    const old = env.db.prepare('SELECT * FROM cus_measure_charts WHERE id = ?').get(firstId) as { chest: number; status: string; revision_no: number };
    expect(old).toMatchObject({ chest: 34, status: 'superseded', revision_no: 1 });
    expect(second.json()).toMatchObject({ chest: 36, status: 'active', revision_no: 2, supersedes_id: firstId });
    expect(() => env!.db.prepare('UPDATE cus_measure_charts SET chest = 99 WHERE id = ?').run(firstId)).toThrow();
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
    const denied = await encoder.post(`/api/cus/customers/${first.id}/merge`, { intoCustomerId: second.id, reason: 'Duplicate after review' });
    expect(denied.statusCode).toBe(403);
    const merged = await owner.post(`/api/cus/customers/${first.id}/merge`, { intoCustomerId: second.id, reason: 'Duplicate after review' }, { 'if-match': '1', 'x-target-version': '1' });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({ is_active: 0, merged_into_id: second.id });
    const moved = env.db.prepare('SELECT customer_id FROM cus_groups WHERE id = ?').get(group.id) as { customer_id: string };
    expect(moved.customer_id).toBe(second.id);
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('lets production record measurements but not manage customers', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder'), production = await env.as('production');
    const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Sample Running Club' })).json();
    const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Jamie Example' })).json();
    expect((await production.post('/api/cus/customers', { kind: 'person', displayName: 'Blocked' })).statusCode).toBe(403);
    expect((await production.get(`/api/cus/customers/${customer.id}`)).statusCode).toBe(403);
    expect((await production.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'preset', upperSize: 'M', values: {} })).statusCode).toBe(200);
    expect((await production.get(`/api/cus/people/${person.id}/measurements`)).json()).toHaveLength(1);
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
});
