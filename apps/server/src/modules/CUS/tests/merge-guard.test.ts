/**
 * Merging a duplicate customer (the owner's request, 26 Oct 2026): the owner sees the likely duplicates and what a merge
 * would move, and a duplicate with anything open (a job order not yet released, money owed or held in the books) is not
 * merged, so nothing is left behind on a record that is switched off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env?.db.close(); env = undefined; });

describe('merging a duplicate customer', () => {
  it('lists likely duplicates, previews the move, and refuses while a job order or money is open on the duplicate', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder'), owner = await env.as('owner');
    const keep = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Sample Running Club' })).json();
    const dup = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Sample running club.' })).json();
    await encoder.post(`/api/cus/customers/${dup.id}/phones`, { phone: '0917 555 2222' });
    await encoder.post(`/api/cus/customers/${dup.id}/people`, { fullName: 'Jordan Example' });

    // The owner's list of likely duplicates; others may not see it.
    const groups = (await owner.get('/api/cus/duplicates')).json() as { reason: string; customers: { id: string }[] }[];
    expect(groups).toContainEqual({ reason: 'same name', customers: expect.arrayContaining([expect.objectContaining({ id: keep.id }), expect.objectContaining({ id: dup.id })]) });
    expect((await encoder.get('/api/cus/duplicates')).statusCode).toBe(403);

    // An open job order on the duplicate: the preview says so and the merge is refused.
    const jo = await encoder.post('/api/docs/jo.job_order/post', { input: {
      customerId: dup.id, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Made-up shirts', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }],
    }, expectedTotalCents: 100_000 }, idem());
    expect(jo.statusCode, jo.body).toBe(200);
    const preview = (await owner.get(`/api/cus/customers/${dup.id}/merge-preview?into=${keep.id}`)).json();
    expect(preview).toMatchObject({ from: { id: dup.id }, into: { id: keep.id }, moves: { phones: 1, people: 1, groups: 0, contacts: 0, subCustomers: 0 }, sameGroups: [] });
    expect(preview.blockers).toEqual([`${jo.json().number} is not fully released yet: finish or cancel it first.`]);
    const merge = () => owner.post(`/api/cus/customers/${dup.id}/merge`, { intoCustomerId: keep.id, reason: 'The same club typed twice' },
      { 'if-match': String((env!.db.prepare('SELECT version FROM cus_customers WHERE id = ?').pluck().get(dup.id))), 'x-target-version': String(env!.db.prepare('SELECT version FROM cus_customers WHERE id = ?').pluck().get(keep.id)) });
    const refused = await merge();
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'MERGE_BLOCKED' });

    // The job order cancelled, a payment kept for them is still open: refused, saying what to do.
    expect((await owner.post(`/api/docs/jo.job_order/${jo.json().id}/cancel`, { reason: 'Recorded for the wrong record' }, idem())).statusCode).toBe(200);
    const paid = await encoder.post('/api/docs/col.collection/post', { input: { customerId: dup.id, crNumber: '7001', applications: [], tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 50_000 }] }, expectedTotalCents: 50_000 }, idem());
    expect(paid.statusCode, paid.body).toBe(200);
    expect((await owner.get(`/api/cus/customers/${dup.id}/merge-preview?into=${keep.id}`)).json().blockers).toEqual(['₱500.00 is held for them (deposits or a payment not yet applied): apply, move or refund it first.']);
    expect((await merge()).json().code).toBe('MERGE_BLOCKED');

    // Once the payment is cancelled, nothing is open: it merges, and the old record says where it went.
    expect((await owner.post(`/api/docs/col.collection/${paid.json().id}/cancel`, { reason: 'Recorded for the wrong record' }, idem())).statusCode).toBe(200);
    const done = await merge();
    expect(done.statusCode, done.body).toBe(200);
    expect((await owner.get(`/api/cus/customers/${dup.id}`)).json()).toMatchObject({ is_active: 0, mergedInto: { id: keep.id, code: keep.code } });
    expect(((await owner.get('/api/cus/duplicates')).json() as { customers: { id: string }[] }[]).some((g) => g.customers.some((c) => c.id === dup.id))).toBe(false);
  });
});
