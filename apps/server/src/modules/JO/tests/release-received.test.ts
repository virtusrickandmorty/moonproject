/** Who received a release for delivery (the owner's request, Nov 2026): typed afterwards from the signed slip. Made-up people only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { verifyAuditChain } from '../../../engine/audit.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv, owner: Client, encoder: Client, c: ReturnType<typeof seedCustomers>, today: string;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
  today = (await owner.get('/api/rate/rates')).json().asOf;
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const profile = { registeredName: 'Example Garments Corp.', tradeName: 'Example Garments', tin: '000-111-222', registeredAddress: '1 Sample Street, Manila', isVatRegistered: true };
  expect((await owner.put('/api/prt/company-profile', profile, { 'if-match': '0' })).statusCode).toBe(200);
});

async function release(extra: object) {
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 2, unitPriceCents: 0, discountCents: 0, roster: [] }] };
  const jo = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 0 }, idem());
  expect(jo.statusCode, jo.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo.json().id}/stage`, { from, to });
  const r = await encoder.post('/api/jo/releases', { release: { jobOrderId: jo.json().id, lines: [{ lineNo: 1, qty: 2 }], ...extra }, invoice: null, expectedTotalCents: 0 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().release as { id: string; number: string };
}
const forDelivery = { claimedBy: 'For delivery', idSeen: 'none', forDelivery: true };
const received = (id: string, body: object, who: Client = encoder) => who.post(`/api/jo/releases/${id}/received`, body);
const print = async (id: string) => { const r = await owner.post(`/api/prt/print/jo.release/${id}`, {}); expect(r.statusCode, r.body).toBe(200); return r.json().html as string; };

describe('who received a release for delivery', () => {
  it('is kept apart from the release, read back with it, and leaves a trail', async () => {
    const rel = await release(forDelivery);
    expect(releaseDoc.load(env.db, rel.id)).not.toHaveProperty('receivedBy');
    expect((await received(rel.id, { receivedBy: 'Ana Halimbawa', receivedOn: today })).statusCode).toBe(200);
    expect(releaseDoc.load(env.db, rel.id)).toMatchObject({ receivedBy: 'Ana Halimbawa', receivedOn: today, claimedBy: 'For delivery' });
    expect(env.db.prepare('SELECT claimed_by FROM jo_releases WHERE document_id = ?').pluck().get(rel.id)).toBe('For delivery'); // the recorded release stays as it was
    expect(verifyAuditChain(env.db)).toBeNull();
  });

  it('comes back on the slip page and prints in place of the blank lines', async () => {
    const rel = await release(forDelivery);
    expect(await print(rel.id)).toContain('Received by (name and signature)');
    await received(rel.id, { receivedBy: 'Ana Halimbawa', receivedOn: today });
    expect((await owner.get(`/api/docs/jo.release/${rel.id}`)).json().doc).toMatchObject({ forDelivery: true, receivedBy: 'Ana Halimbawa', receivedOn: today });
    const html = await print(rel.id);
    expect(html).toContain('Ana Halimbawa');
    expect(html).not.toContain('Received by (name and signature)');
    expect(html).not.toContain(`>${today}<`);
  });

  it('puts a wrong name right, keeping the first', async () => {
    const rel = await release(forDelivery);
    await received(rel.id, { receivedBy: 'Wrong Name', receivedOn: today });
    await received(rel.id, { receivedBy: 'Right Name', receivedOn: today });
    expect(releaseDoc.load(env.db, rel.id)).toMatchObject({ receivedBy: 'Right Name' });
    expect(env.db.prepare('SELECT COUNT(*) FROM jo_release_received WHERE document_id = ?').pluck().get(rel.id)).toBe(2);
  });

  it('refuses a date before the release or in the future, and an empty name', async () => {
    const rel = await release(forDelivery);
    expect((await received(rel.id, { receivedBy: 'Ana', receivedOn: '2020-01-01' })).json().code).toBe('BEFORE_RELEASE');
    expect((await received(rel.id, { receivedBy: 'Ana', receivedOn: '2999-01-01' })).json().code).toBe('FUTURE');
    expect((await received(rel.id, { receivedBy: '  ', receivedOn: today })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('is only for a release for delivery: one claimed in person already says who', async () => {
    const rel = await release({ claimedBy: 'Coach Placeholder', idSeen: 'school_id' });
    expect((await received(rel.id, { receivedBy: 'Ana', receivedOn: today })).json().code).toBe('NOT_FOR_DELIVERY');
  });

  it('is refused on a cancelled release, and for those who may not release', async () => {
    const rel = await release(forDelivery);
    expect((await received(rel.id, { receivedBy: 'Ana', receivedOn: today }, await env.as('production'))).statusCode).toBe(403);
    expect((await owner.post(`/api/docs/jo.release/${rel.id}/cancel`, { reason: 'Recorded by mistake' }, idem())).statusCode).toBe(200);
    expect((await received(rel.id, { receivedBy: 'Ana', receivedOn: today })).json().code).toBe('CANCELLED');
  });
});
