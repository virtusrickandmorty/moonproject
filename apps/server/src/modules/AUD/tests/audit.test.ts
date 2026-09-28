import { beforeEach, describe, expect, it } from 'vitest';
import { appendAudit } from '../../../engine/audit.ts';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let accountant: Client;
let encoder: Client;

beforeEach(async () => {
  env = await createTestEnv();
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

function add(at: string, action: string, entityType: string, entityId: string, userId = accountant.userId) {
  appendAudit(env.db, { at, userId, action, entityType, entityId, data: { note: `Entry for ${entityId}` } });
}

describe('AUD audit log and integrity', () => {
  it('filters by dates, user, action, entity and pages by sequence newest first', async () => {
    add('2026-09-26T10:00:00.000+08:00', 'cus.update', 'customer', 'c1');
    add('2026-09-27T10:00:00.000+08:00', 'cus.update', 'customer', 'c2');
    add('2026-09-28T10:00:00.000+08:00', 'cus.update', 'customer', 'c3');
    add('2026-09-28T11:00:00.000+08:00', 'cus.update', 'customer', 'c4', encoder.userId);
    const base = `/api/aud/log?from=2026-09-27&to=2026-09-28&userId=${accountant.userId}&action=cus.update&entityType=customer`;
    const first = await accountant.get(`${base}&limit=1`);
    expect(first.statusCode).toBe(200);
    expect(first.json().rows).toMatchObject([{ action: 'cus.update', entityId: 'c3', userName: expect.any(String), data: { note: 'Entry for c3' } }]);
    const next = await accountant.get(`${base}&limit=1&before=${first.json().nextBefore}`);
    expect(next.json().rows.map((r: { entityId: string }) => r.entityId)).toEqual(['c2']);
    expect(next.json().nextBefore).toBeNull();
    const one = await accountant.get(`${base}&entityId=c2`);
    expect(one.json().rows.map((r: { entityId: string }) => r.entityId)).toEqual(['c2']);
    expect((await accountant.get('/api/aud/log?limit=999')).json().rows.length).toBeLessThanOrEqual(200);
  });

  it('exports exactly the selected page as CSV and records the filters in the audit chain', async () => {
    add('2026-09-28T10:00:00.000+08:00', 'cus.update', 'customer', 'CSV-1');
    add('2026-09-28T10:01:00.000+08:00', 'cus.update', 'customer', 'CSV-2');
    const url = '/api/aud/log?action=cus.update&entityType=customer&limit=1';
    const selected = (await accountant.get(url)).json().rows;
    const before = (env.db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get() as number);
    const csv = await accountant.get(`${url}&format=csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.body).toContain(`"${selected[0].seq}"`);
    expect(csv.body).toContain('CSV-2');
    expect(csv.body).not.toContain('CSV-1');
    const after = (env.db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get() as number);
    expect(after).toBe(before + 1);
    const exported = env.db.prepare("SELECT action, data, user_id FROM audit_log WHERE action = 'audit.export' ORDER BY seq DESC LIMIT 1").get() as { action: string; data: string; user_id: string };
    expect(exported.user_id).toBe(accountant.userId);
    expect(JSON.parse(exported.data)).toMatchObject({ filters: { action: 'cus.update', entityType: 'customer', limit: 1 } });
    expect((await accountant.get('/api/aud/integrity')).json().audit.ok).toBe(true);
  });

  it('reports the first broken audit row and invariant problems in plain English', async () => {
    const good = await accountant.get('/api/aud/integrity');
    expect(good.statusCode).toBe(200);
    expect(good.json().audit).toMatchObject({ ok: true, brokenAt: null, count: expect.any(Number), newestAt: expect.any(String) });
    expect(good.json().checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'L12', ok: true, problems: [] })]));
    env.db.exec('DROP TRIGGER audit_log_no_update');
    env.db.prepare("UPDATE audit_log SET action = 'tampered' WHERE seq = 1").run();
    const bad = await accountant.get('/api/aud/integrity');
    expect(bad.statusCode).toBe(200);
    expect(bad.json().audit).toMatchObject({ ok: false, brokenAt: 1, message: expect.stringContaining('entry 1') });
    expect(bad.json().checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'L12', ok: false, problems: [expect.stringContaining('entry 1')] })]));
  });

  it('denies the encoder both views and CSV export', async () => {
    for (const path of ['/api/aud/log', '/api/aud/log?format=csv', '/api/aud/users', '/api/aud/integrity'])
      expect((await encoder.get(path)).statusCode).toBe(403);
  });
});
